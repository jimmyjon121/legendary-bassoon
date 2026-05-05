# DevForge v2 Smart AI Harness for Local Agent Systems

## Approach

The right architecture for DevForge is not “one super chat box with lots of prompts.” It is a layered system: Ollama as the transport and model host, a canonical internal tool contract based on JSON Schema, an explicit state machine for agent execution, project-scoped memory, and a Smart AI Harness that chooses decoding, prompting, memory policy, and tool protocol per model. That design matches where the best current agent systems have converged: simple composable patterns over opaque magic, durable state over implicit chat history, typed tools over regex parsing, and human oversight for side-effecting actions. citeturn35view0turn29view2turn24view0turn36view0

For a local-first workstation, the decisive constraint is not only “can the model answer?” but “can the whole loop remain reliable under long context, streaming, tool use, retries, and side effects on real files and shells?” The answer in 2026 is yes, but only if you separate concerns cleanly: model inference, tool orchestration, memory management, security policy, and evaluation should be distinct subsystems rather than prompt hacks inside one big conversation. citeturn35view0turn29view4turn31search12turn31search1

## Wiring models through Ollama

Ollama should be the default inference backplane, but not your only abstraction boundary. Use `/api/chat` as the primary runtime endpoint because it is message-based and supports tool calling; reserve `/api/generate` for specialist cases such as fill-in-the-middle, raw prompt/template control, and schema-constrained extraction jobs. Ollama’s API is intentionally stable and available both locally and against the cloud endpoint with the same basic shape, which makes it suitable as the engine under a higher-level adapter layer in DevForge. citeturn5search8turn4search0turn5search3

Streaming matters operationally, not cosmetically. Ollama returns usage metrics such as `load_duration`, `prompt_eval_count`, `prompt_eval_duration`, `eval_count`, and `eval_duration`, and it includes them in the final streaming chunk when `done` is `true`. Those fields should feed your harness telemetry, because they tell you when a model is cold-loading too often, when prompts are bloating, and when a supposedly “fast” model is actually slow at prompt ingestion versus generation. citeturn6view2

Structured outputs should be first-class. Ollama accepts `format: "json"` or a full JSON Schema object on `/api/generate`, and its tool-calling support on `/api/chat` uses a function schema very close to the now-standard OpenAI-style format. In practice, that means your internal representation should be JSON Schema everywhere, with adapters that emit Ollama native tool definitions, OpenAI-compatible `tools`, or Anthropic/MCP equivalents as needed. JSON mode is useful, but schema-constrained outputs are the right default when correctness matters. citeturn4search0turn3view4turn3view7turn6view3turn24view1turn20search0

A good Ollama adapter in DevForge should expose only a small, stable interface to the rest of the app:

```ts
type Role = "system" | "user" | "assistant" | "tool";

type ChatMessage = {
  role: Role;
  content: string;
  tool_calls?: Array<{
    id?: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_name?: string; // for tool result messages if you normalize them this way
};

type OllamaTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
};

type ChatRequest = {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  tools?: OllamaTool[];
  format?: "json" | Record<string, unknown>;
  keep_alive?: string | number;
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    min_p?: number;
    num_predict?: number;
    num_ctx?: number;
    seed?: number;
    stop?: string[];
  };
  signal?: AbortSignal;
};

export async function* streamOllamaChat(req: ChatRequest) {
  const res = await fetch(`${req.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: req.model,
      messages: req.messages,
      tools: req.tools,
      format: req.format,
      keep_alive: req.keep_alive ?? "10m",
      options: req.options ?? {},
      stream: true,
    }),
    signal: req.signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Ollama error: ${res.status} ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const chunk = JSON.parse(line);
      yield chunk; // accumulate message.content, tool_calls, and final usage metrics outside
    }
  }

  if (buffer.trim()) {
    yield JSON.parse(buffer);
  }
}
```

Use the compatibility layers strategically. If you want reuse of existing SDKs or third-party tooling, Ollama offers OpenAI-compatible and Anthropic-compatible interfaces, including support for clients that expect the Anthropic Messages API. That is valuable for DevForge because it allows you to support ecosystems like LangChain-style tool abstractions, OpenAI SDK-based libraries, and Claude-Code-like clients without rewriting the entire model integration layer. citeturn3view7turn6view3

Model-family handling should be explicit, not guessed from vibes. Ollama gives you a useful static inspection layer via `/api/tags` and `/api/show`, including family, quantization level, template, parameters, capabilities, and `model_info`; `/api/ps` adds runtime facts such as current context length, VRAM residency, and unload time. That is enough to build a real model profiler before you ever run a benchmark. citeturn6view0turn6view1turn33search0

The practical family notes that matter most are these:

- **Qwen 3 and Qwen Coder variants** are strong candidates for tool routing and coding. The Qwen 3 report explicitly introduces unified thinking and non-thinking modes, while Qwen’s own docs say Qwen 3 excels in tool calling and recommend Qwen-Agent, which includes parser fallbacks, parallel multi-step tool calls, and MCP support. In DevForge, that means Qwen-family models should usually get native tool mode first, adaptive reasoning second, and a low-temperature routing profile for agent actions. citeturn14view4turn14view0turn14view1turn14view2

- **Llama 3.1** is a strong generalist planner/router. Meta documents 128K context, native tool use, multilingual support, and instruction-tuning for tool-use scenarios such as web search, math analysis, and code interpretation. I would treat Llama 3.1 as the safe “default agent brain” when you need broad competence more than maximum coding specialization. citeturn12view1turn12view2

- **Gemma 4** is now directly relevant for local-first agent systems. Google positions Gemma 4 as purpose-built for advanced reasoning and agentic workflows, with native function calling and long context. The biggest quirk is thought handling: Google explicitly says to strip generated thoughts between normal turns, but *not* between tool calls occurring within the same turn. If your harness mishandles that, Gemma-based agents will degrade or loop. citeturn10search4turn15view0turn15view2

- **Mistral, Devstral, and Codestral-class models** are still important as specialist executors, especially for coding. Mistral’s docs explicitly support serial, successive, and parallel function-calling patterns, and the model selection docs list specialized families such as Devstral and Codestral for coding-heavy tasks. In DevForge, these models fit well as “executor workers” under a larger planner. citeturn13view0turn18search1

- **Community and uncensored GGUFs** should never be trusted purely from naming. The harness should inspect family/quantization/template metadata, but authorization to use tools should depend on runtime conformance tests, not on tags like “uncensored,” “aggressive,” or “instruct.” Static metadata tells you what the model is; only evals tell you what it can reliably do. citeturn6view0turn6view1turn31search12turn31search1

Context and KV-cache strategy matter more than most agent builders realize. Ollama’s current context guidance is explicit: smaller VRAM systems default to shorter context, large-context agentic work should be set to at least 64K, bigger contexts consume more memory, and best performance comes from avoiding CPU offload. Ollama also exposes Flash Attention and quantized KV cache controls; with Flash Attention enabled, KV cache can be quantized to `q8_0` or `q4_0`, though the docs note that high-GQA models such as Qwen2-like families may lose more precision and require benchmarking. citeturn3view6turn33search6turn34view0

For long conversations, do not keep appending full transcripts forever. Use a three-layer policy: a token-bounded recent window, rolling summaries of completed segments, and extracted long-term memory objects such as facts, preferences, project decisions, and unresolved TODOs. LangGraph and LlamaIndex both formalize this split between short-term and long-term memory, and LlamaIndex’s newer memory system explicitly flushes older short-term context into long-term blocks when token budgets are exceeded. citeturn28search20turn29view5

Remote Ollama on a dedicated compute node such as a GB10 is absolutely viable, but do it as a trust-boundary decision, not just a network setting. Ollama binds to `127.0.0.1:11434` by default, can be exposed by `OLLAMA_HOST`, and can be proxied through Nginx or tunnels; if you expose it to anything beyond localhost, put it behind TLS and authentication at the proxy/VPN layer and restrict browser origins with `OLLAMA_ORIGINS` where needed. Also preload hot models and use `keep_alive` intentionally, because Ollama supports explicit preloading and model retention controls. citeturn7view0turn7view1turn34view0turn26search15

Concurrency needs policy. Ollama documents that parallel requests multiply effective context memory use, that `OLLAMA_NUM_PARALLEL` scales RAM requirements with context length, and that queue limits and concurrently loaded models are tunable. On a dedicated node, that means you should keep one or two hot models loaded, cap parallelism per large model, and route small chat requests to a smaller hot model instead of spraying everything into your biggest coder/reasoner. citeturn34view0

## Agent patterns that work in practice

The cleanest current framing comes from Anthropic: distinguish **workflows** from **agents**. Workflows are predefined code paths where LLMs and tools are orchestrated by your program; agents are systems where the model dynamically decides how to proceed. Anthropic’s production guidance is to start with the simplest solution that works, then add complexity only when it measurably improves outcomes. That is exactly the right principle for DevForge. citeturn35view0

**ReAct** remains the best default mental model for local agent systems because it interleaves reasoning, action, and observation. The original paper showed that combining reasoning and acting improves factuality and decision-making versus pure chain-of-thought or pure action policies, especially when the model can consult external tools or environments. For local open-weight models, ReAct is especially useful because it gives you a fallback pattern when native function calling is weak or absent. citeturn16search0turn14view2

**Plan-and-execute** systems are better for long-horizon work than vanilla ReAct. The older Plan-and-Solve work showed that explicitly generating a plan first can reduce missing-step errors, and newer Plan-and-Act work extends that into stronger planner/executor separation for long-horizon environments. In DevForge, this pattern is ideal for coding agents, large repo refactors, or multi-source research, where a slower planner can create a structured plan and a cheaper executor can carry out tool actions. citeturn30search0turn17search4

**Reflexion** and **evaluator-optimizer** loops are extremely useful when tasks are verifiable. Reflexion adds linguistic self-critique and episodic memory after failures; Anthropic’s evaluator-optimizer pattern does something similar operationally by generating, evaluating, and refining. These loops shine in code synthesis, test repair, and research summarization where you have clear criteria or external checks. They are not free: latency and loop-risk go up, so they should be bounded by attempt budgets and objective stop conditions. citeturn16search1turn35view0

**Orchestrator-worker** and **multi-agent** designs are best when the task decomposes naturally. Anthropic identifies orchestrator-workers as especially useful for coding and search; LlamaIndex exposes multi-agent workflows, and CrewAI formalizes both crews and event-driven flows. In practice, that means multi-agent is worth it when you truly have specialized roles—planner, repo analyst, editor, tester, researcher—not when you are just splitting one generalist into five copies for aesthetic reasons. citeturn35view0turn36view1turn30search7turn30search15

**Auto-GPT/BabyAGI-style open-ended autonomous loops** are not the right default production pattern. They remain useful as idea generators and experimentation sandboxes, but even the BabyAGI project warns it was never meant as production architecture. The consistent production trend is toward bounded state graphs, approvals, checkpoints, and explicit tool policies rather than “keep looping until the agent feels done.” citeturn30search13turn30search6turn29view3turn29view4

The best implementation shape for DevForge is therefore a **durable state graph** with optional planner and evaluator nodes. LangGraph is a strong reference here because it treats persistence, interrupts, threads, and human-in-the-loop as first-class concerns, not bolt-ons. LlamaIndex is also useful because it shows both high-level function agents and lower-level manual tool loops. If you adopt one idea from the current best systems, make it this: your agent runtime should be a graph with saved state, not a recursive chat function. citeturn29view2turn29view3turn29view4turn36view1

## Tool calling that survives real workloads

Your canonical internal tool format should be an OpenAI-style function/tool object with JSON Schema parameters, plus an internal execution contract that returns typed results. There are two reasons. First, Ollama’s chat tooling already looks like that. Second, the rest of the ecosystem has converged toward the same ideas: Mistral’s function calling uses JSON schema tool definitions, Gemma 4 uses function declarations, Anthropic exposes strict tool use and structured outputs, and MCP uses named tools with schemas over JSON-RPC. If DevForge standardizes internally on JSON Schema, you can adapt outward without rewriting the planner. citeturn3view4turn13view0turn15view1turn23search2turn24view1

Reliability hierarchy in practice is straightforward. Use native tool calling when the model/provider supports it well. Use schema-constrained structured outputs when you only need typed extraction or typed action proposals. Use JSON mode only when a schema adapter is unavailable. Use XML or custom grammar prompts only as last-resort fallbacks for models that cannot produce consistent structured outputs any other way. The reason is simple: modern schema-constrained systems exist precisely because plain JSON mode does not guarantee exact schema adherence. citeturn20search0turn4search0

A robust tool loop in DevForge should validate *everything* before execution:

```ts
import Ajv from "ajv";

type ToolResult =
  | { ok: true; data: unknown; meta?: Record<string, unknown> }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

type RegisteredTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  execute(args: any, ctx: ToolContext): Promise<ToolResult>;
};

type ToolContext = {
  cwd: string;
  requestApproval(call: { name: string; args: any }): Promise<boolean>;
};

const ajv = new Ajv({ allErrors: true, strict: false });

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private validators = new Map<string, ReturnType<Ajv["compile"]>>();

  register(tool: RegisteredTool) {
    this.tools.set(tool.name, tool);
    this.validators.set(tool.name, ajv.compile(tool.inputSchema));
  }

  async invoke(call: { name: string; args: any }, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return { ok: false, error: { code: "UNKNOWN_TOOL", message: call.name, retryable: false } };
    }

    const validate = this.validators.get(call.name)!;
    if (!validate(call.args)) {
      return {
        ok: false,
        error: {
          code: "INVALID_ARGS",
          message: ajv.errorsText(validate.errors),
          retryable: true,
        },
      };
    }

    if (!tool.readOnly) {
      const approved = await ctx.requestApproval(call);
      if (!approved) {
        return {
          ok: false,
          error: { code: "DENIED", message: "User denied tool invocation", retryable: false },
        };
      }
    }

    return tool.execute(call.args, ctx);
  }
}
```

On top of this, the agent loop should enforce a retry ladder, not a blind retry storm:

1. Validate the tool name and arguments locally.  
2. If invalid, ask the model for **one** deterministic repair attempt with the validation error attached.  
3. If that fails, fall back to a safer parser strategy or a stronger fallback model.  
4. If the action is side-effecting, pause for user approval or fail closed.  
5. If the model repeats the same tool call with materially identical arguments, treat it as a loop, not as progress. citeturn29view1turn29view3turn28search5

Parallel tool calls should be allowed only for read-only or idempotent actions. Mistral explicitly documents parallel function calling, and Qwen-Agent documents parallel multi-step function use. That is excellent for search, file reads, embeddings, or metadata queries. It is usually a bad idea for edits, shell commands, git writes, purchases, or browser actions with side effects. DevForge should classify tools into `read`, `write`, `external_side_effect`, and `dangerous`, and parallelize only the first class by default. citeturn13view0turn14view1turn24view1

Keep tool outputs compact and structured. Most tool failures in agents are not caused by selection; they are caused by bloated or ambiguous observations. Return concise JSON objects with `ok`, `data`, `error`, and optional `meta`, not megabytes of raw logs unless the calling tool specifically requested them. That keeps context lean and improves follow-up tool choice. Use Ollama’s usage metrics plus your own trace metadata to log every tool call’s latency, result size, and retry count. citeturn6view2turn31search1

## Tool engineering, security, and observability

The model is only as safe and useful as the tools you hand it. Anthropic’s tool-engineering guidance is exactly right: formats that are easy for humans are not always easy for models, and tool schemas deserve the same level of design attention as prompts. Parameter names, examples, edge cases, and boundaries between similar tools matter enormously. citeturn35view0

The core design rules for DevForge tools should be:

- one clear responsibility per tool;  
- JSON Schema inputs with narrow required fields;  
- deterministic output envelopes;  
- explicit `readOnly` and `dangerLevel` metadata;  
- idempotence where possible;  
- full tracing and replay support. citeturn24view1turn29view2turn18search7

For filesystem tools, path validation must be non-negotiable. Use `path.resolve()` and then verify the resolved path remains inside one of the explicitly allowed roots; for URLs converted to file paths, Node’s own docs warn that `fileURLToPath()` alone is not sufficient to prevent traversal and that explicit path validation is still required. Anthropic’s text-editor implementation guidance says the same thing in practical terms: validate file paths, create backups before edits, handle unique replacements carefully, and verify changes afterward. citeturn27search0turn27search10turn22search0

For shell and terminal tools, the safest default is to avoid shell invocation when a library API exists. OWASP’s command-injection guidance explicitly recommends replacing OS commands with built-in library functions wherever possible, and Node’s own security releases show why this matters: `child_process.spawn` had Windows command-injection vulnerabilities even without `shell: true`. So DevForge should prefer direct libraries for file ops, git status, directory walking, and HTTP, and reserve subprocess tools for cases where there is no adequate library substitute. citeturn26search1turn25search4turn25search7

For file upload, web fetch, and browser-adjacent tools, apply standard web security hygiene. OWASP’s file-upload guidance emphasizes allowlisted extensions, size limits, authorization, and distrust of user-provided content types; its LLM prompt injection guidance is equally relevant, because retrieved web or repo content should be treated as *data*, not as instructions to the agent runtime. In DevForge, any tool that ingests remote text should mark that content as untrusted and keep system/tool policies outside the model-visible retrieved text. citeturn26search2turn26search10turn26search15

Human approval must be built into side-effecting tools. MCP’s tool spec explicitly recommends clear UI indicators and confirmation prompts so humans remain in the loop, and LangChain/LangGraph show the same operational pattern for pausing, editing, rejecting, or approving tool calls before execution. The Smart AI Harness should therefore control **which** tools are exposed, while a separate permission layer controls **which proposed calls actually run**. Those are different mechanisms and you want both. citeturn24view1turn29view1turn29view3

Observability should be rich enough to debug a bad run without reproducing it live. LangGraph emphasizes checkpoints, threads, fault tolerance, and time-travel debugging; CrewAI emphasizes observability for production agent workflows. DevForge should log at least: model profile version, prompt template version, tools exposed, tool calls proposed, arguments after validation, approval decisions, results returned, retries, step budgets, token usage, cold/hot load status, and final task outcome. citeturn29view4turn18search7turn29view2

## Building the Smart AI Harness

The harness should combine **static profiling**, **manual overrides**, **microbenchmarks**, and **runtime adaptation**.

Static profiling comes first. Query `/api/tags` and `/api/show` when a model appears in the catalog, store family, parameter size, quantization level, template, embedded parameters, capabilities, and model info, and track runtime residency via `/api/ps`. This gives you enough information to infer a sensible starting profile before the first user message is ever sent. citeturn6view0turn6view1turn33search0

Then add manual overrides. This is where DevForge’s edit modal becomes important. Users should be able to tag a model as `coding`, `reasoning`, `creative`, `uncensored`, `weak_json`, `excellent_tools`, `no_thinking_echo`, or `experimental`. Community model names are too inconsistent for static heuristics alone. The edit modal is not a convenience feature; it is part of the control plane. citeturn6view0turn6view1

Then run microbenchmarks. Do not expose “agent mode” for a model because it looks promising. Gate that mode behind a small local eval battery inspired by BFCL and ToolSandbox, but customized to DevForge’s actual tools. At minimum, benchmark: structured extraction, single-tool selection, multi-tool selection, argument exactness, repeated-tool-loop behavior, code-edit/test-repair, and long-context recall. BFCL is useful for atomic function-calling quality; ToolSandbox is useful because it adds stateful, conversational, multi-turn difficulty that better resembles real agent runs. citeturn31search12turn31search1

Finally, adapt at runtime. The best harnesses do not freeze a profile forever. Use rolling success rates and performance metrics to update the model profile: how often tool args validate, how often a tool call needs repair, average tokens/sec, cold-load frequency, memory pressure, and whether the model tends to over-call or under-call tools. If a model’s tool-arg failure rate crosses a threshold, silently downgrade it from `native_tools` to `json_schema_action_proposals` or to `ReAct` fallback until the user or the next benchmark says otherwise. citeturn6view2turn35view0turn31search12

A practical profile object in DevForge might look like this:

```ts
type HarnessMode = "chat" | "coding" | "agent" | "creative";

type ModelProfile = {
  model: string;
  family: string;
  parameterSize?: string;
  quantization?: string;
  supportsNativeTools: boolean;
  supportsStructuredOutput: boolean;
  thinkingStyle: "none" | "adaptive" | "strip-between-turns" | "preserve-within-tool-turn";
  primaryRole: "generalist" | "planner" | "coder" | "creative";
  toolProtocol: "native" | "json-schema" | "react";
  exposeToolsByDefault: boolean;
  decode: Record<HarnessMode, {
    temperature: number;
    top_p: number;
    num_predict: number;
  }>;
};

function deriveProfile(show: any): ModelProfile {
  const family = String(show?.details?.family ?? "").toLowerCase();
  const capabilities = new Set(show?.capabilities ?? []);

  if (family.includes("qwen")) {
    return {
      model: show.model,
      family,
      parameterSize: show?.details?.parameter_size,
      quantization: show?.details?.quantization_level,
      supportsNativeTools: true,
      supportsStructuredOutput: true,
      thinkingStyle: "adaptive",
      primaryRole: family.includes("coder") ? "coder" : "generalist",
      toolProtocol: "native",
      exposeToolsByDefault: true,
      decode: {
        chat: { temperature: 0.7, top_p: 0.9, num_predict: 2048 },
        coding: { temperature: 0.2, top_p: 0.9, num_predict: 4096 },
        agent: { temperature: 0.1, top_p: 0.9, num_predict: 1024 },
        creative: { temperature: 0.9, top_p: 0.95, num_predict: 4096 },
      },
    };
  }

  if (family.includes("gemma4")) {
    return {
      model: show.model,
      family,
      parameterSize: show?.details?.parameter_size,
      quantization: show?.details?.quantization_level,
      supportsNativeTools: true,
      supportsStructuredOutput: true,
      thinkingStyle: "strip-between-turns", // except within a single tool-call turn
      primaryRole: capabilities.has("vision") ? "generalist" : "planner",
      toolProtocol: "native",
      exposeToolsByDefault: true,
      decode: {
        chat: { temperature: 1.0, top_p: 0.95, num_predict: 2048 },
        coding: { temperature: 0.3, top_p: 0.95, num_predict: 4096 },
        agent: { temperature: 0.2, top_p: 0.9, num_predict: 1024 },
        creative: { temperature: 1.0, top_p: 0.95, num_predict: 4096 },
      },
    };
  }

  return {
    model: show.model,
    family,
    parameterSize: show?.details?.parameter_size,
    quantization: show?.details?.quantization_level,
    supportsNativeTools: false,
    supportsStructuredOutput: true,
    thinkingStyle: "none",
    primaryRole: "generalist",
    toolProtocol: "json-schema",
    exposeToolsByDefault: false,
    decode: {
      chat: { temperature: 0.7, top_p: 0.9, num_predict: 2048 },
      coding: { temperature: 0.2, top_p: 0.9, num_predict: 4096 },
      agent: { temperature: 0.1, top_p: 0.9, num_predict: 1024 },
      creative: { temperature: 0.95, top_p: 0.95, num_predict: 4096 },
    },
  };
}
```

Mode handling is where the harness becomes “magical.” The user should not have to choose between a dozen model settings; they should choose an outcome: **chat**, **coding**, **agent**, or **creative/vault**. The harness then does the ugly work: low-temperature tool routing, different context budgets, planner/executor splits, approval policies, and family-specific thought handling. Google’s own Gemma 4 docs and Qwen’s reasoning-mode design both reinforce that “reasoning strategy” should be runtime-configurable rather than tied to one permanently selected model persona. citeturn15view0turn15view2turn14view4

The “Vault” or unhinged mode should be isolated from agentic privileges. If you include a creative or uncensored workspace, treat it as a *prompting and behavior tier*, not as permission to run broader tools. Creative freedom and system side effects should be orthogonal. A model can be maximally expressive while still requiring the same confirmation flow for edits, shell commands, browser actions, or remote API writes. That is the difference between a fun mode and an unsafe architecture. citeturn24view1turn29view1turn35view0

## Open questions and limitations

Official docs tell you what major families are designed to support, but community quantizations and repackaged GGUFs can still underperform those capabilities in practice. That is especially true for tool calling, long-context stability, and reasoning-token handling, so DevForge should treat official family docs as priors and local evals as the source of truth. citeturn6view0turn15view0turn31search12turn31search1

BFCL and ToolSandbox are excellent reference points, but neither benchmark knows your exact filesystem, git, editor, browser, or RAG tools. You will need a DevForge-specific eval suite built from your own high-value workflows—repo patching, multi-file edits, test-fix loops, local search, project memory recall, and human approval interruptions—before “agent-ready” means anything useful. citeturn31search12turn31search1turn29view3turn29view4

The biggest architectural trap is premature complexity. The strongest cross-source lesson is still the simplest one: start with direct model APIs, typed tools, durable state, and a small number of well-tested patterns; only add more autonomous behavior or more agents when your evals prove it helps. That is the path most likely to make DevForge feel magical to the user while staying boringly reliable under the hood. citeturn35view0turn29view2turn36view1