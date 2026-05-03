# NVIDIA Spark Linux Profile

Use this profile when running DevForge on NVIDIA Spark Linux hardware:

```bash
./run-devforge-spark.sh
# or
npm run app:spark
```

The profile keeps the normal desktop flow intact while making Spark Linux a first-class launch target:

- Uses the repo-local Node/npm under `.tooling/node` when present, then falls back to the system `node`.
- Sets `ELECTRON_DISABLE_SANDBOX=1` by default because Spark/Linux user namespaces can block Electron's Chromium sandbox. Override it before launch if your distro supports the sandbox.
- Defaults Ollama to `http://127.0.0.1:11434`, `OLLAMA_KEEP_ALIVE=24h`, `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_MAX_LOADED_MODELS=1`, and `OLLAMA_FLASH_ATTENTION=1` for a conservative CUDA-first desktop session.
- Leaves macOS and Windows on the standard `npm run app`, `npm run dev`, `npm run build:mac`, and `npm run build:win` paths.

## Expected Runtime Shape

Spark Linux should prefer Ollama on CUDA when Ollama is running and at least one model is pulled. OpenVINO/NPU, `robotjs`, llama.cpp / `node-llama-cpp`, Mosaic, and speculative decoding are optional paths. If they are missing or unavailable, DevForge should report that status but continue with Ollama/CUDA.

Mosaic and speculative decoding stay off in the Spark launcher unless explicitly requested:

```bash
DEVFORGE_ENABLE_LABS=1 DEVFORGE_SPEC_DECODE_ENABLE=1 ./run-devforge-spark.sh
```

Only enable these lab paths for measurement or development. Current spec-decode documentation still treats the path as opt-in because the speedup gate has not passed.

## Quick Checks

Before launching, verify the local model runtime:

```bash
ollama serve
ollama list
nvidia-smi
```

You can override the Ollama endpoint without editing the script:

```bash
OLLAMA_HOST=http://127.0.0.1:11434 ./run-devforge-spark.sh
```
