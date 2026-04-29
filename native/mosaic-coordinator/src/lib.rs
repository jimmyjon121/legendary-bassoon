use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const DEFAULT_GATE2_MODEL: &str = "deepseek-coder:33b";
const GATE2_SPEEDUP_THRESHOLD: f64 = 1.5;

fn value_bool(value: Option<&Value>, key: &str, default_value: bool) -> bool {
    value
        .and_then(|v| v.get(key))
        .and_then(Value::as_bool)
        .unwrap_or(default_value)
}

fn value_string(value: Option<&Value>, key: &str) -> Option<String> {
    value
        .and_then(|v| v.get(key))
        .and_then(Value::as_str)
        .map(str::to_owned)
}

fn command_looks_like_path(command: &str) -> bool {
    command.contains('\\')
        || command.contains('/')
        || command.ends_with(".exe")
        || (command.len() > 2 && command.as_bytes()[1] == b':')
}

fn run_probe(command: &str, arg: &str) -> Option<String> {
    let output = Command::new(command).arg(arg).output().ok()?;
    let mut text = String::new();
    text.push_str(&String::from_utf8_lossy(&output.stdout));
    text.push('\n');
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    Some(text)
}

fn discover_winget_llama_cli() -> Vec<String> {
    let Some(local_app_data) = env::var_os("LOCALAPPDATA") else {
        return Vec::new();
    };
    let packages_dir = PathBuf::from(local_app_data)
        .join("Microsoft")
        .join("WinGet")
        .join("Packages");
    let Ok(entries) = fs::read_dir(packages_dir) else {
        return Vec::new();
    };
    entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .to_ascii_lowercase()
                .starts_with("ggml.llamacpp_")
        })
        .map(|entry| entry.path().join("llama-cli.exe"))
        .filter(|path| path.exists())
        .filter_map(|path| path.to_str().map(str::to_owned))
        .collect()
}

fn list_runner_devices(command: &str) -> Vec<Value> {
    let Some(text) = run_probe(command, "--list-devices") else {
        return Vec::new();
    };
    let mut devices = Vec::new();
    for raw_line in text.lines() {
        let line = raw_line.trim();
        let Some((id, rest)) = line.split_once(':') else {
            continue;
        };
        if !["CUDA", "Vulkan", "Metal", "SYCL", "RPC"]
            .iter()
            .any(|prefix| id.starts_with(prefix))
        {
            continue;
        }
        let backend = id.chars().take_while(|ch| ch.is_ascii_alphabetic()).collect::<String>();
        let index = id
            .chars()
            .skip_while(|ch| ch.is_ascii_alphabetic())
            .collect::<String>()
            .parse::<u32>()
            .unwrap_or(0);
        let name = rest.split('(').next().unwrap_or(rest).trim();
        devices.push(json!({
            "id": id,
            "backend": backend,
            "index": index,
            "name": name
        }));
    }
    devices
}

fn infer_kind(command: &str, probe_text: &str) -> &'static str {
    let base = Path::new(command)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(command)
        .to_ascii_lowercase();
    let text = probe_text.to_ascii_lowercase();
    if base.contains("server") || text.contains("llama-server") {
        "server"
    } else if base.contains("bench") || text.contains("llama-bench") {
        "bench"
    } else if base.contains("cli") || text.contains("llama-cli") || base == "main" || base.contains("llama-main") {
        "cli"
    } else {
        "unknown"
    }
}

fn probe_runner_candidate(command: &str, source: &str) -> Option<Value> {
    if command_looks_like_path(command) && !Path::new(command).exists() {
        return Some(json!({
            "available": false,
            "compatible": false,
            "path": command,
            "source": source,
            "blockedReason": "configured_runner_path_missing"
        }));
    }

    let version = run_probe(command, "--version")?;
    let help = run_probe(command, "--help").or_else(|| run_probe(command, "-h")).unwrap_or_default();
    let probe_text = format!("{version}\n{help}");
    let lower = probe_text.to_ascii_lowercase();
    let capabilities = json!({
        "prompt": lower.contains("--prompt") || lower.contains("-p"),
        "context": lower.contains("--ctx-size") || lower.contains("--context-size") || lower.contains("-c"),
        "gpuLayers": lower.contains("--n-gpu-layers") || lower.contains("--gpu-layers") || lower.contains("-ngl"),
        "splitMode": lower.contains("--split-mode"),
        "tensorSplit": lower.contains("--tensor-split"),
        "device": lower.contains("--device"),
        "temperature": lower.contains("--temp") || lower.contains("--temperature")
    });

    let mut missing = Vec::new();
    for key in ["prompt", "context", "gpuLayers", "splitMode", "tensorSplit", "temperature"] {
        if !capabilities.get(key).and_then(Value::as_bool).unwrap_or(false) {
            missing.push(key);
        }
    }
    let kind = infer_kind(command, &probe_text);
    let compatible = kind == "cli" && missing.is_empty();
    let devices = if compatible {
        list_runner_devices(command)
    } else {
        Vec::new()
    };
    Some(json!({
        "available": true,
        "compatible": compatible,
        "path": command,
        "source": source,
        "kind": kind,
        "version": version.trim().chars().take(240).collect::<String>(),
        "capabilities": capabilities,
        "devices": devices,
        "missingCapabilities": missing
    }))
}

fn detect_runner(options: Option<&Value>) -> Value {
    let mut configured = Vec::new();
    if let Some(runner_path) = value_string(options, "runnerPath") {
        configured.push(runner_path);
    }
    for key in [
        "DEVFORGE_MOSAIC_RUNNER",
        "LLAMA_CPP_CLI_PATH",
        "LLAMA_CPP_SERVER_PATH",
        "LLAMA_CPP_BENCH_PATH",
    ] {
        if let Ok(value) = env::var(key) {
            if !value.is_empty() {
                configured.push(value);
            }
        }
    }
    configured.extend(discover_winget_llama_cli());

    let mut configured_results = Vec::new();
    for candidate in configured {
        if let Some(result) = probe_runner_candidate(&candidate, "configured") {
            if result.get("compatible").and_then(Value::as_bool).unwrap_or(false) {
                return result;
            }
            configured_results.push(result);
        }
    }
    if let Some(found) = configured_results
        .iter()
        .find(|result| result.get("available").and_then(Value::as_bool).unwrap_or(false))
    {
        return found.clone();
    }
    if let Some(first) = configured_results.first() {
        return first.clone();
    }

    let mut discovered = Vec::new();
    for command in ["llama-cli", "llama-cli.exe", "main", "llama-main", "llama-server", "llama-bench"] {
        if let Some(result) = probe_runner_candidate(command, "path") {
            if result.get("compatible").and_then(Value::as_bool).unwrap_or(false) {
                return result;
            }
            discovered.push(result);
        }
    }

    discovered.first().cloned().unwrap_or_else(|| {
        json!({
            "available": false,
            "compatible": false,
            "path": null,
            "source": null,
            "blockedReason": "runner_unavailable"
        })
    })
}

fn profile_source(artifact_dir: Option<&str>, id: &str) -> Option<String> {
    let dir = artifact_dir?;
    let text = fs::read_to_string(Path::new(dir).join(format!("profile-{id}.json"))).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    value
        .pointer("/runMeta/source")
        .and_then(Value::as_str)
        .map(str::to_owned)
}

#[napi]
pub fn probe_runtime(options: Option<Value>) -> Result<Value> {
    let require_combined = value_bool(options.as_ref(), "requireCombinedBackends", true);
    let artifact_dir = value_string(options.as_ref(), "artifactDir");
    let runner = detect_runner(options.as_ref());
    let rtx_source = profile_source(artifact_dir.as_deref(), "rtx");
    let arc_source = profile_source(artifact_dir.as_deref(), "arc");
    let cpu_source = profile_source(artifact_dir.as_deref(), "cpu");
    let npu_source = profile_source(artifact_dir.as_deref(), "npu");
    let rebar_source = profile_source(artifact_dir.as_deref(), "rebar");

    let runner_available = runner.get("available").and_then(Value::as_bool).unwrap_or(false);
    let runner_compatible = runner.get("compatible").and_then(Value::as_bool).unwrap_or(false);
    let runner_has_device = runner
        .pointer("/capabilities/device")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let mut blockers = Vec::new();
    if !runner_available {
        blockers.push("runner_unavailable");
    }
    if runner_available && !runner_compatible {
        blockers.push("runner_incompatible");
    }
    if require_combined && runner_available && runner_compatible && !runner_has_device {
        blockers.push("runner_missing_device_assignment");
    }
    if require_combined && arc_source.as_deref() != Some("live") {
        blockers.push("blocked_arc_not_live");
    }
    if rtx_source.as_deref() != Some("live") {
        blockers.push("rtx_profile_not_live");
    }
    if cpu_source.as_deref() != Some("live") {
        blockers.push("cpu_profile_not_live");
    }

    Ok(json!({
        "available": blockers.is_empty(),
        "native": true,
        "backend": "rust-napi-rs",
        "runner": runner,
        "profiles": {
            "rtx": rtx_source,
            "arc": arc_source,
            "cpu": cpu_source,
            "npu": npu_source,
            "rebar": rebar_source
        },
        "blockedReason": blockers.first().copied(),
        "blockers": blockers,
        "note": "Rust napi-rs coordinator probes the Gate 2 runner contract; llama.cpp still owns execution paths."
    }))
}

#[napi]
pub fn plan_placement(input: Value) -> Result<Value> {
    let model_id = input
        .get("modelId")
        .cloned()
        .unwrap_or_else(|| json!(DEFAULT_GATE2_MODEL));
    let context_size = input
        .get("contextSize")
        .cloned()
        .unwrap_or_else(|| json!(4096));
    Ok(json!({
        "schemaVersion": 1,
        "target": input.get("target").cloned().unwrap_or_else(|| json!("gate2")),
        "modelId": model_id,
        "modelPath": input.get("modelPath").cloned().unwrap_or(Value::Null),
        "contextSize": context_size,
        "threshold": { "speedup": GATE2_SPEEDUP_THRESHOLD },
        "assignment": {
            "devices": ["CUDA0", "Vulkan0", "CPU"],
            "rtxWeight": 0.45,
            "arcWeight": 0.20,
            "cpuWeight": 0.35
        },
        "baseline": {
            "mode": "baseline",
            "devices": ["CUDA0", "CPU"],
            "gpuLayers": 20,
            "splitMode": "layer",
            "tensorSplit": "1,0"
        },
        "mosaic": {
            "mode": "mosaic",
            "devices": ["CUDA0", "Vulkan0", "CPU"],
            "gpuLayers": 99,
            "splitMode": "layer",
            "tensorSplit": "0.450,0.200,0.350"
        }
    }))
}

#[napi]
pub fn build_launch_args(input: Value) -> Result<Value> {
    let mode = input.get("mode").and_then(Value::as_str).unwrap_or("mosaic");
    let plan = input.get("plan").unwrap_or(&input);
    let selected = if mode == "baseline" {
        plan.get("baseline").unwrap_or(plan)
    } else {
        plan.get("mosaic").unwrap_or(plan)
    };
    let model_path = selected
        .get("modelPath")
        .or_else(|| plan.get("modelPath"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let context_size = selected
        .get("contextSize")
        .or_else(|| plan.get("contextSize"))
        .and_then(Value::as_i64)
        .unwrap_or(4096);
    let gpu_layers = selected
        .get("gpuLayers")
        .or_else(|| plan.get("gpuLayers"))
        .and_then(Value::as_i64)
        .unwrap_or(99);
    let split_mode = selected.get("splitMode").and_then(Value::as_str).unwrap_or("layer");
    let tensor_split = selected.get("tensorSplit").and_then(Value::as_str).unwrap_or("1");
    let devices = selected
        .get("devices")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(",")
        })
        .unwrap_or_default();

    let mut args = vec![
        json!("-m"),
        json!(model_path),
        json!("-c"),
        json!(context_size.to_string()),
        json!("-ngl"),
        json!(gpu_layers.to_string()),
        json!("--split-mode"),
        json!(split_mode),
        json!("--tensor-split"),
        json!(tensor_split),
    ];
    if !devices.is_empty() {
        args.push(json!("--device"));
        args.push(json!(devices));
    }
    args.push(json!("--fit"));
    args.push(json!("on"));
    args.push(json!("--single-turn"));
    args.push(json!("--simple-io"));
    Ok(Value::Array(args))
}
