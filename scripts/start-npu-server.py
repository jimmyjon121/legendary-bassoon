"""
DevForge OpenVINO Inference Server

Phase 1: prefers OpenVINO GenAI (openvino_genai.LLMPipeline) for chat
generation because it's the supported path for continuous batching,
native streaming, and the speculative-decoding pipeline we'll wire up in
Phase 2. Falls back to optimum.intel.openvino (the legacy path) when
GenAI can't load a given model — e.g., the model isn't exported for
GenAI, or the NPU driver doesn't support the operator set.

Embeddings still use the optimum hidden-states path because GenAI's
LLMPipeline doesn't expose them.

Requirements inside your OpenVINO environment:
    pip install fastapi uvicorn openvino-dev openvino-genai transformers optimum[openvino]
"""

import json
import os
import sys
import time
import uuid
from pathlib import Path
from threading import Lock, Thread
from typing import Dict, Generator, Optional

try:
    from fastapi import FastAPI  # type: ignore[import]
    from fastapi.responses import StreamingResponse  # type: ignore[import]
    from pydantic import BaseModel  # type: ignore[import]
    import uvicorn  # type: ignore[import]
except ImportError as exc:
    print("fastapi/uvicorn are required. Install with `pip install fastapi uvicorn`.", file=sys.stderr)
    raise exc

try:
    import torch  # type: ignore[import]
    from transformers import AutoTokenizer, TextIteratorStreamer  # type: ignore[import]
    from optimum.intel.openvino import OVModelForCausalLM  # type: ignore[import]
except ImportError as exc:
    print(
        "Missing transformers/optimum dependencies. Install with: pip install transformers optimum[openvino]",
        file=sys.stderr,
    )
    raise exc

# OpenVINO GenAI is optional at runtime — if it fails to import or a model
# can't be loaded with it, we transparently fall back to the optimum path.
try:
    import openvino_genai as ov_genai  # type: ignore[import]
    GENAI_AVAILABLE = True
except Exception as _exc:  # noqa: BLE001
    ov_genai = None
    GENAI_AVAILABLE = False
    print(f'[DevForge][NPU] openvino_genai not available ({_exc}); falling back to optimum path for chat.', flush=True)


APP_DIR = Path(__file__).resolve().parent
CONFIG_PATH = Path(__file__).with_name('openvino-model.json')
# GenAI needs a local directory of exported OV files. When model_path is an
# HF repo id, we download the snapshot into this cache on first load.
GENAI_CACHE_DIR = APP_DIR.parent / '.cache' / 'openvino-genai'

DEFAULT_CONFIG = {
    'model_path': '',
    'tokenizer': '',
    'device': 'AUTO',
    'precision': 'fp16',
}

# If a configured NPU model cannot be loaded by GenAI on target hardware,
# fall back to a smaller known-good OpenVINO export so chat can stay live.
GENAI_FALLBACK_MODEL_IDS = [
    'OpenVINO/Qwen2.5-1.5B-Instruct-int8-ov',
    'OpenVINO/Qwen2.5-1.5B-Instruct-fp16-ov',
    'OpenVINO/TinyLlama-1.1B-Chat-v1.0-int8-ov',
]


def load_config() -> Dict[str, str]:
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH, 'r', encoding='utf-8') as handle:
            data = json.load(handle)
            return {**DEFAULT_CONFIG, **data}
    CONFIG_PATH.write_text(json.dumps(DEFAULT_CONFIG, indent=2), encoding='utf-8')
    return DEFAULT_CONFIG.copy()


def save_config(cfg: Dict[str, str]) -> None:
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2), encoding='utf-8')


class ServerState:
    def __init__(self):
        self.config = load_config()
        # Optimum path (legacy + embeddings).
        self.model = None
        self.tokenizer = None
        # When the optimum bootstrap has already failed for the active
        # model, skip the retry on every subsequent request -- the model
        # is GenAI-loadable but optimum can't ingest a pre-converted IR
        # without weight files, and burning ~1s per request retrying it
        # is just log spam plus latency. Reset on state.reset() so a
        # model-switch gets one fresh attempt.
        self.optimum_load_skipped: bool = False
        self.optimum_load_error: Optional[str] = None
        # GenAI path (preferred for chat).
        self.genai_pipe: Optional['ov_genai.LLMPipeline'] = None
        self.genai_model_id: Optional[str] = None
        self.genai_device: Optional[str] = None
        # Phase 2 A4 tree speculation: secondary drafter pipeline that
        # runs the SAME model on a different device (typically Intel Arc
        # GPU) so we can fan out to two parallel drafts per round and let
        # the verifier pick the longer-matching branch.
        self.genai_pipe_secondary: Optional['ov_genai.LLMPipeline'] = None
        self.genai_secondary_device: Optional[str] = None

    def reset(self):
        self.model = None
        self.tokenizer = None
        self.optimum_load_skipped = False
        self.optimum_load_error = None
        self.genai_pipe = None
        self.genai_model_id = None
        self.genai_device = None
        self.genai_pipe_secondary = None
        self.genai_secondary_device = None


state = ServerState()
app = FastAPI(title='DevForge OpenVINO Server', version='0.3.0')


class GenerateRequest(BaseModel):
    prompt: str
    max_tokens: int = 128
    temperature: float = 0.7
    top_k: int = 40
    top_p: float = 0.9


class LoadModelRequest(BaseModel):
    model_path: str
    tokenizer: str | None = None
    device: str | None = None
    precision: str | None = None


class EmbeddingRequest(BaseModel):
    texts: list[str] | None = None
    text: str | None = None
    normalize: bool = True


class ChatCompletionRequest(BaseModel):
    model: str | None = None
    messages: list[dict] | None = None
    stream: bool = False
    max_tokens: int = 128
    temperature: float = 0.7
    top_k: int = 40
    top_p: float = 0.9


class DraftRequest(BaseModel):
    """Phase 2 speculative-decoding draft request. The caller supplies
    either a `prompt` string or a `prefix_tokens` list; the server
    generates `lookahead` (4-8) candidate next tokens for the verifier
    to accept or reject. Same-tokenizer pairs are required for the
    token IDs returned here to be valid in the verifier's vocabulary.
    `branch` selects between the primary device pipe (default, NPU) and
    the secondary device pipe (Intel Arc GPU) for tree speculation."""

    prompt: str | None = None
    prefix_tokens: list[int] | None = None
    lookahead: int = 4
    request_id: str | None = None
    temperature: float = 0.0
    top_k: int = 40
    top_p: float = 0.95
    branch: str | None = None  # 'primary' (default) or 'secondary'


# Active draft requests keyed by request_id. Phase 2 uses this for
# mid-flight cancellation: when the verifier rejects an earlier batch
# and wants to discard the in-flight remainder, it DELETEs the request
# id and the next iteration of the streamer returns early.
_draft_requests: Dict[str, Dict[str, object]] = {}
_draft_requests_lock = Lock()


def _resolve_genai_model_dir(model_id: str) -> Optional[Path]:
    """Return a local path containing an exported OpenVINO model suitable
    for GenAI's LLMPipeline. If `model_id` is a local directory, use it
    directly. If it's a HuggingFace repo id (contains a slash and doesn't
    exist on disk), snapshot_download it into our cache. Returns None if
    we can't produce a usable local directory."""
    if not model_id:
        return None

    as_path = Path(model_id)
    if as_path.exists() and as_path.is_dir():
        return as_path

    # HF repo id path.
    try:
        from huggingface_hub import snapshot_download  # type: ignore[import]
    except ImportError:
        print('[DevForge][NPU] huggingface_hub not available; cannot snapshot for GenAI.', flush=True)
        return None

    try:
        GENAI_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        local_dir = GENAI_CACHE_DIR / model_id.replace('/', '__')
        print(f'[DevForge][NPU] GenAI: downloading {model_id} -> {local_dir}', flush=True)
        snapshot_download(
            repo_id=model_id,
            local_dir=str(local_dir),
            local_dir_use_symlinks=False,
        )
        return local_dir
    except Exception as exc:  # noqa: BLE001
        print(f'[DevForge][NPU] GenAI snapshot download failed for {model_id}: {exc}', flush=True)
        return None


def _try_load_genai(model_id: str, device: str) -> bool:
    """Attempt to load the model via OpenVINO GenAI. Returns True on success."""
    if not GENAI_AVAILABLE or ov_genai is None:
        return False

    model_dir = _resolve_genai_model_dir(model_id)
    if model_dir is None:
        return False

    try:
        print(f'[DevForge][NPU] GenAI: loading {model_dir} on {device}', flush=True)
        pipe = ov_genai.LLMPipeline(str(model_dir), device)
        state.genai_pipe = pipe
        state.genai_model_id = model_id
        state.genai_device = device
        print(f'[DevForge][NPU] GenAI: loaded {model_id} on {device}', flush=True)
        return True
    except Exception as exc:  # noqa: BLE001
        print(f'[DevForge][NPU] GenAI load failed for {model_id} on {device}: {exc}', flush=True)
        state.genai_pipe = None
        state.genai_model_id = None
        state.genai_device = None
        return False


def _try_load_optimum_model(model_id: str, device: str, export: bool = False):
    """Attempt to load a model via optimum+openvino, returns model or raises."""
    kwargs = dict(device=device, trust_remote_code=True)
    if export:
        kwargs['export'] = True
    return OVModelForCausalLM.from_pretrained(model_id, **kwargs)


DEVICE_FALLBACK_CHAIN = [
    # (device, export) — try each in order until one works
    (None, False),   # requested device, no export
    (None, True),    # requested device, with export (converts from HF)
    ('GPU', True),   # GPU only with export
    ('CPU', True),   # CPU only with export (always works)
]


def ensure_model_loaded():
    """Load the active config model if not already loaded. Prefers GenAI
    for chat; loads the optimum path in parallel so embeddings still
    work when a chat request routes to GenAI."""
    cfg = state.config
    model_id = cfg.get('model_path') or cfg.get('model_id')
    if not model_id:
        raise RuntimeError(
            f'Configure {CONFIG_PATH} with "model_path" pointing to an OpenVINO model or HF repo.'
        )

    tokenizer_id = cfg.get('tokenizer') or model_id
    requested_device = os.environ.get('OPENVINO_DEVICE') or cfg.get('device') or 'AUTO'

    # Fast path: already loaded with matching id/device.
    already_genai = (
        state.genai_pipe is not None
        and state.genai_model_id == model_id
        and (state.genai_device or '').upper() == requested_device.upper()
    )
    already_optimum = state.model is not None and state.tokenizer is not None

    # Kick off GenAI load if we don't have it and GenAI is available.
    if not already_genai and GENAI_AVAILABLE:
        model_candidates = [model_id, *GENAI_FALLBACK_MODEL_IDS]
        model_candidates = [item for item in model_candidates if item]

        device_candidates = [requested_device]
        requested_upper = requested_device.upper()
        if requested_upper != 'AUTO':
            device_candidates.append('AUTO')
        if requested_upper != 'CPU':
            device_candidates.append('CPU')

        seen_pairs = set()
        genai_loaded = False
        for candidate_model in model_candidates:
            if genai_loaded:
                break
            for candidate_device in device_candidates:
                pair = (candidate_model, candidate_device.upper())
                if pair in seen_pairs:
                    continue
                seen_pairs.add(pair)

                if candidate_model != model_id or candidate_device.upper() != requested_upper:
                    print(
                        f'[DevForge][NPU] GenAI retry candidate model={candidate_model} device={candidate_device}',
                        flush=True,
                    )
                if _try_load_genai(candidate_model, candidate_device):
                    genai_loaded = True
                    state.config['device'] = candidate_device
                    if candidate_model != model_id:
                        print(
                            f'[DevForge][NPU] GenAI fallback active: {candidate_model} (configured {model_id})',
                            flush=True,
                        )
                    if candidate_device.upper() != requested_upper:
                        print(
                            f'[DevForge][NPU] GenAI device fallback active: {candidate_device} (requested {requested_device})',
                            flush=True,
                        )
                    break

    if already_optimum:
        return

    if state.optimum_load_skipped and state.genai_pipe is not None:
        # Skipped on a prior request; GenAI is the active engine. Don't
        # re-run the (failing) optimum load on every request.
        return

    if os.environ.get('DEVFORGE_NPU_GENAI_ONLY') == '1' and state.genai_pipe is not None:
        # Spec-decode smoke/eval paths only need the GenAI draft pipeline.
        # Loading the Optimum fallback at the same time doubles memory
        # pressure and can destabilize low-headroom hardware during tests.
        state.model = None
        state.tokenizer = None
        state.optimum_load_skipped = True
        state.optimum_load_error = 'skipped by DEVFORGE_NPU_GENAI_ONLY'
        print('[DevForge][NPU] Optimum fallback skipped by DEVFORGE_NPU_GENAI_ONLY.', flush=True)
        return

    print(f'[DevForge][NPU] Loading (optimum fallback) model={model_id} tokenizer={tokenizer_id} device={requested_device}', flush=True)
    try:
        tokenizer = AutoTokenizer.from_pretrained(tokenizer_id, trust_remote_code=True)
        model = None
        used_device = requested_device
        errors = []

        for fallback_device, export in DEVICE_FALLBACK_CHAIN:
            device = fallback_device or requested_device
            label = f'device={device}' + (' export=True' if export else '')
            try:
                print(f'[DevForge][NPU] Trying {label} ...', flush=True)
                model = _try_load_optimum_model(model_id, device, export=export)
                used_device = device
                print(f'[DevForge][NPU] Success with {label}', flush=True)
                break
            except Exception as exc:
                msg = f'{label}: {exc}'
                print(f'[DevForge][NPU] Failed — {msg}', flush=True)
                errors.append(msg)

        if model is None:
            if state.genai_pipe is not None:
                # Chat can proceed through GenAI even when optimum embeddings are
                # unavailable on this device/model combo. Mark the skip so the
                # next request doesn't repeat the (failing) load.
                state.model = None
                state.tokenizer = None
                state.optimum_load_skipped = True
                state.optimum_load_error = '\n'.join(errors)
                print(
                    '[DevForge][NPU] Optimum load failed; continuing with GenAI-only chat path. Future requests will skip the optimum retry.',
                    flush=True,
                )
                return
            raise RuntimeError(
                f'Could not load {model_id} on any device. Tried:\n' + '\n'.join(errors)
            )

        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        state.model = model
        state.tokenizer = tokenizer
        state.config['device'] = used_device
        print(f'[DevForge][NPU] Model loaded on {used_device}.', flush=True)
    except Exception as exc:
        if state.genai_pipe is not None:
            state.model = None
            state.tokenizer = None
            state.optimum_load_skipped = True
            state.optimum_load_error = str(exc)
            print(
                '[DevForge][NPU] Optimum bootstrap crashed; continuing with GenAI-only chat path. Future requests will skip the optimum retry.',
                flush=True,
            )
            return
        raise


def _build_genai_config(req: GenerateRequest):
    """Build an ov_genai.GenerationConfig for a generate request. Best-effort —
    some fields may not be supported by older GenAI versions, so we set only
    the ones we know are widely available."""
    cfg = ov_genai.GenerationConfig()
    cfg.max_new_tokens = int(min(req.max_tokens, 2048))
    # Greedy when temperature == 0, sampling otherwise.
    if req.temperature and req.temperature > 0:
        cfg.do_sample = True
        cfg.temperature = float(req.temperature)
        cfg.top_p = float(req.top_p)
        cfg.top_k = int(req.top_k)
    else:
        cfg.do_sample = False
    return cfg


def _prompt_from_chat_messages(messages: list[dict] | None) -> str:
    rows = messages or []
    parts = []
    for msg in rows:
        role = str(msg.get('role') or 'user').strip().lower()
        content = str(msg.get('content') or '').strip()
        if not content:
            continue
        if role == 'system':
            parts.append(f'System: {content}')
        elif role == 'assistant':
            parts.append(f'Assistant: {content}')
        else:
            parts.append(f'User: {content}')
    parts.append('Assistant:')
    return '\n\n'.join(parts)


def stream_tokens_genai(req: GenerateRequest) -> Generator[str, None, None]:
    """Stream via GenAI's iterable streamer. Uses a background thread to
    drive generation and yields decoded tokens as they arrive."""
    pipe = state.genai_pipe
    if pipe is None:
        raise RuntimeError('GenAI pipeline not initialized')

    # GenAI 2024.6+ ships an IterableStreamer; older versions use a
    # callback-based StreamerBase. Try the iterable path first.
    try:
        streamer = ov_genai.TextStreamer(pipe.get_tokenizer())  # type: ignore[attr-defined]
        has_iterable = hasattr(streamer, '__iter__')
    except Exception:  # noqa: BLE001
        streamer = None
        has_iterable = False

    if streamer is not None and has_iterable:
        cfg = _build_genai_config(req)
        thread = Thread(target=pipe.generate, args=(req.prompt,), kwargs={'generation_config': cfg, 'streamer': streamer})
        thread.start()
        try:
            for chunk in streamer:
                if chunk:
                    yield chunk
        finally:
            thread.join()
        return

    # Fallback: callback-based streaming. Accumulate tokens and yield them
    # through a generator. This path works on older GenAI versions.
    queue: list[str] = []
    done_flag = [False]

    def _cb(token: str) -> bool:
        if token:
            queue.append(token)
        return False  # continue generating

    def _run():
        try:
            pipe.generate(req.prompt, _build_genai_config(req), _cb)
        finally:
            done_flag[0] = True

    thread = Thread(target=_run)
    thread.start()
    try:
        while not done_flag[0] or queue:
            if queue:
                yield queue.pop(0)
            else:
                thread.join(timeout=0.02)
    finally:
        thread.join()


def stream_tokens_optimum(req: GenerateRequest) -> Generator[str, None, None]:
    tokenizer = state.tokenizer
    model = state.model
    if tokenizer is None or model is None:
        raise RuntimeError('Optimum model not initialized')

    inputs = tokenizer(req.prompt, return_tensors='pt')
    streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)
    kwargs = dict(
        **inputs,
        streamer=streamer,
        max_new_tokens=min(req.max_tokens, 512),
        temperature=max(req.temperature, 0.0),
        top_p=req.top_p,
        top_k=req.top_k,
        do_sample=req.temperature > 0,
        repetition_penalty=1.05,
    )

    thread = Thread(target=model.generate, kwargs=kwargs)
    thread.start()

    for text in streamer:
        yield text

    thread.join()


def stream_tokens(req: GenerateRequest) -> Generator[str, None, None]:
    """Route streaming to GenAI when available, falling back to optimum."""
    ensure_model_loaded()
    if state.genai_pipe is not None:
        try:
            yield from stream_tokens_genai(req)
            return
        except Exception as exc:  # noqa: BLE001
            print(f'[DevForge][NPU] GenAI streaming failed, falling back to optimum: {exc}', flush=True)
    yield from stream_tokens_optimum(req)


def _hash_fallback_embedding(text: str, dim: int = 256):
    vector = torch.zeros(dim, dtype=torch.float32)
    if not text:
        return vector.tolist()

    raw = text.encode('utf-8', errors='ignore')
    for idx, byte in enumerate(raw[:8192]):
        vector[(byte + idx) % dim] += 1.0

    norm = torch.norm(vector, p=2)
    if float(norm) > 0:
        vector = vector / norm
    return vector.tolist()


def compute_embedding_vector(text: str, normalize: bool = True):
    ensure_model_loaded()
    tokenizer = state.tokenizer
    model = state.model
    # Embeddings always use the optimum path because GenAI's LLMPipeline
    # doesn't expose hidden states.
    if tokenizer is None or model is None:
        return _hash_fallback_embedding(text), 'hash-fallback'

    inputs = tokenizer(
        text or '',
        return_tensors='pt',
        truncation=True,
        max_length=384,
        padding=True,
    )

    outputs = None
    try:
        outputs = model(**inputs, output_hidden_states=True, return_dict=True)
    except TypeError:
        outputs = model(**inputs)
    except Exception:
        # Fall back to hash embedding if the model cannot expose hidden states.
        return _hash_fallback_embedding(text), 'hash-fallback'

    hidden = None
    logits = None

    if isinstance(outputs, dict):
        hidden = outputs.get('last_hidden_state')
        hidden_states = outputs.get('hidden_states')
        if hidden is None and hidden_states:
            hidden = hidden_states[-1]
        logits = outputs.get('logits')
    else:
        hidden = getattr(outputs, 'last_hidden_state', None)
        hidden_states = getattr(outputs, 'hidden_states', None)
        if hidden is None and hidden_states is not None:
            hidden = hidden_states[-1]
        logits = getattr(outputs, 'logits', None)

    method = 'model-hidden-states'
    pooled = None
    if hidden is not None:
        attention_mask = inputs.get('attention_mask')
        if attention_mask is not None:
            expanded_mask = attention_mask.unsqueeze(-1).expand_as(hidden).float()
            denom = expanded_mask.sum(dim=1).clamp(min=1e-6)
            pooled = (hidden * expanded_mask).sum(dim=1) / denom
        else:
            pooled = hidden.mean(dim=1)
    elif logits is not None:
        # Coarse fallback when hidden states are unavailable.
        pooled = logits.mean(dim=1)
        method = 'logits-fallback'

    if pooled is None:
        return _hash_fallback_embedding(text), 'hash-fallback'

    vector = pooled.squeeze(0).flatten().detach().cpu().to(torch.float32)
    if normalize:
        norm = torch.norm(vector, p=2)
        if float(norm) > 0:
            vector = vector / norm
    return vector.tolist(), method


@app.get('/status')
def status():
    """Basic status check - doesn't require model to be loaded"""
    cfg = state.config
    model_path = cfg.get('model_path') or cfg.get('model_id')
    return {
        'status': 'ok',
        'server': 'running',
        'model_configured': bool(model_path),
        'model_loaded': state.model is not None or state.genai_pipe is not None,
        'model_path': model_path,
        'device': cfg.get('device'),
        'genai_available': GENAI_AVAILABLE,
        'genai_active': state.genai_pipe is not None,
        'genai_model': state.genai_model_id,
    }


@app.get('/health')
def health():
    """Full health check - requires model to be loaded"""
    cfg = state.config
    model_path = cfg.get('model_path') or cfg.get('model_id')

    # If no model configured, return status without loading
    if not model_path:
        return {
            'status': 'no_model',
            'message': 'No model configured. Configure model_path in openvino-model.json or use /models/load endpoint.',
            'device': cfg.get('device'),
        }

    try:
        ensure_model_loaded()
        return {
            'status': 'ok',
            'model': model_path,
            'effective_model': state.genai_model_id or model_path,
            'device': cfg.get('device'),
            'precision': cfg.get('precision'),
            'engine': 'genai' if state.genai_pipe is not None else 'optimum',
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'model': model_path,
        }


@app.post('/models/load')
def load_model(req: LoadModelRequest):
    cfg = state.config
    if req.model_path:
        cfg['model_path'] = req.model_path
    if req.tokenizer:
        cfg['tokenizer'] = req.tokenizer
    if req.device:
        cfg['device'] = req.device
    if req.precision:
        cfg['precision'] = req.precision
    save_config(cfg)
    state.reset()
    try:
        ensure_model_loaded()
        return {
            'status': 'loaded',
            'model': cfg.get('model_path'),
            'device': state.config.get('device'),
            'engine': 'genai' if state.genai_pipe is not None else 'optimum',
        }
    except Exception as exc:
        return {
            'status': 'error',
            'error': str(exc),
            'model': cfg.get('model_path'),
            'device': cfg.get('device'),
        }


@app.post('/models/unload')
def unload_model():
    had_active_model = bool(state.model is not None or state.genai_pipe is not None)
    state.reset()
    return {
        'status': 'unloaded',
        'released': had_active_model,
        'model_loaded': False,
    }


@app.get('/models')
def list_models():
    cfg = state.config
    ensure_model_loaded()
    return {
        'data': [
            {
                'id': cfg.get('model_path') or cfg.get('model_id'),
                'device': cfg.get('device'),
                'precision': cfg.get('precision'),
                'engine': 'genai' if state.genai_pipe is not None else 'optimum',
            }
        ]
    }


@app.post('/generate')
def generate(req: GenerateRequest):
    """Non-streaming generate. Prefer GenAI, fall back to optimum."""
    ensure_model_loaded()

    if state.genai_pipe is not None:
        try:
            cfg = _build_genai_config(req)
            result = state.genai_pipe.generate(req.prompt, cfg)
            # GenAI returns either a string or a DecodedResults object.
            text = str(result) if not hasattr(result, 'texts') else (result.texts[0] if result.texts else '')
            return {'response': text.strip(), 'done': True, 'engine': 'genai'}
        except Exception as exc:  # noqa: BLE001
            print(f'[DevForge][NPU] GenAI generate failed, falling back to optimum: {exc}', flush=True)

    tokenizer = state.tokenizer
    model = state.model
    if tokenizer is None or model is None:
        raise RuntimeError('No inference engine available')

    inputs = tokenizer(req.prompt, return_tensors='pt')
    output = model.generate(
        **inputs,
        max_new_tokens=min(req.max_tokens, 512),
        temperature=req.temperature,
        top_k=req.top_k,
        top_p=req.top_p,
        do_sample=req.temperature > 0,
        repetition_penalty=1.05,
    )
    text = tokenizer.decode(output[0], skip_special_tokens=True)
    completion = text[len(req.prompt):] if text.startswith(req.prompt) else text
    return {'response': completion.strip(), 'done': True, 'engine': 'optimum'}


@app.post('/v1/chat/completions')
def chat_completions(req: ChatCompletionRequest):
    prompt = _prompt_from_chat_messages(req.messages)
    gen_req = GenerateRequest(
        prompt=prompt,
        max_tokens=req.max_tokens,
        temperature=req.temperature,
        top_k=req.top_k,
        top_p=req.top_p,
    )
    created = int(time.time())
    model_id = req.model or state.config.get('model_path') or state.config.get('model_id') or 'openvino-local'

    if req.stream:
        def event_stream():
            start = time.perf_counter()
            try:
                ensure_model_loaded()
                engine = 'genai' if state.genai_pipe is not None else 'optimum'
                for token in stream_tokens(gen_req):
                    payload = {
                        'id': f'chatcmpl-{created}',
                        'object': 'chat.completion.chunk',
                        'created': created,
                        'model': model_id,
                        'choices': [
                            {
                                'index': 0,
                                'delta': {'content': token},
                                'finish_reason': None,
                            }
                        ],
                        'meta': {
                            'engine': engine,
                            'device': state.config.get('device'),
                        },
                    }
                    yield f'data: {json.dumps(payload)}\n\n'
            except Exception as exc:  # noqa: BLE001
                payload = {
                    'id': f'chatcmpl-{created}',
                    'object': 'chat.completion.chunk',
                    'created': created,
                    'model': model_id,
                    'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'error'}],
                    'error': str(exc),
                }
                yield f'data: {json.dumps(payload)}\n\n'
            finally:
                done_payload = {
                    'id': f'chatcmpl-{created}',
                    'object': 'chat.completion.chunk',
                    'created': created,
                    'model': model_id,
                    'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}],
                    'meta': {
                        'latency_ms': int((time.perf_counter() - start) * 1000),
                    },
                }
                yield f'data: {json.dumps(done_payload)}\n\n'
                yield 'data: [DONE]\n\n'

        return StreamingResponse(event_stream(), media_type='text/event-stream')

    started = time.perf_counter()
    result = generate(gen_req)
    latency_ms = int((time.perf_counter() - started) * 1000)
    response_text = str(result.get('response') or '')
    engine = result.get('engine') or ('genai' if state.genai_pipe is not None else 'optimum')
    prompt_tokens = max(1, len(prompt.split()))
    completion_tokens = max(1, len(response_text.split())) if response_text else 0

    return {
        'id': f'chatcmpl-{created}',
        'object': 'chat.completion',
        'created': created,
        'model': model_id,
        'choices': [
            {
                'index': 0,
                'message': {
                    'role': 'assistant',
                    'content': response_text,
                },
                'finish_reason': 'stop',
            }
        ],
        'usage': {
            'prompt_tokens': prompt_tokens,
            'completion_tokens': completion_tokens,
            'total_tokens': prompt_tokens + completion_tokens,
        },
        'meta': {
            'engine': engine,
            'device': state.config.get('device'),
            'latency_ms': latency_ms,
        },
    }


def _build_draft_config(req: DraftRequest):
    """Build a GenerationConfig sized for a speculative-decoding draft
    pass (4-8 tokens, low temperature). Greedy by default so the
    verifier sees deterministic candidates the user's prompt actually
    determines, not noise from a high-temperature roll."""
    if not GENAI_AVAILABLE or ov_genai is None:
        raise RuntimeError('GenAI not available; draft endpoint requires openvino-genai')
    cfg = ov_genai.GenerationConfig()
    cfg.max_new_tokens = max(1, min(int(req.lookahead or 4), 8))
    if req.temperature and req.temperature > 0:
        cfg.do_sample = True
        cfg.temperature = float(req.temperature)
        cfg.top_p = float(req.top_p)
        cfg.top_k = int(req.top_k)
    else:
        cfg.do_sample = False
    return cfg


def _resolve_draft_prompt(req: DraftRequest, tokenizer) -> str:
    if req.prompt and req.prompt.strip():
        return req.prompt
    if req.prefix_tokens and tokenizer is not None and hasattr(tokenizer, 'decode'):
        try:
            return tokenizer.decode(list(req.prefix_tokens))
        except Exception:  # noqa: BLE001
            return ''
    return ''


def _extract_token_ids(tokenizer, text: str) -> list[int]:
    """OpenVINO GenAI's Tokenizer.encode() returns a TokenizedInputs
    object whose input_ids is an ov.Tensor of shape [1, seq_len]. Drill
    down to a flat python list so the verifier can consume it without
    knowing about the ov.Tensor type."""
    if tokenizer is None or not text:
        return []
    try:
        encoded = tokenizer.encode(text)
        ids = getattr(encoded, 'input_ids', encoded)
        # ids is an ov.Tensor; .data is a numpy ndarray of shape [1, N].
        if hasattr(ids, 'data'):
            arr = ids.data
            try:
                arr = arr.tolist()
            except AttributeError:
                arr = list(arr)
            if arr and isinstance(arr[0], (list, tuple)):
                return [int(x) for x in arr[0]]
            return [int(x) for x in arr]
        # Already a list-like of ints.
        return [int(x) for x in ids]
    except Exception as exc:  # noqa: BLE001
        print(f'[DevForge][NPU] Failed to extract token ids: {exc}', flush=True)
        return []


def _ensure_secondary_pipe(target_device: str = 'GPU') -> bool:
    """Lazy-load the secondary drafter onto a different device. Used by
    tree speculation. Returns True when the pipe is loaded and ready."""
    if state.genai_pipe_secondary is not None and (state.genai_secondary_device or '').upper() == target_device.upper():
        return True
    if not GENAI_AVAILABLE or ov_genai is None:
        return False

    cfg = state.config
    model_id = cfg.get('model_path') or cfg.get('model_id')
    if not model_id:
        return False
    model_dir = _resolve_genai_model_dir(model_id)
    if model_dir is None:
        return False
    try:
        print(f'[DevForge][NPU] GenAI: loading secondary drafter {model_dir} on {target_device}', flush=True)
        pipe = ov_genai.LLMPipeline(str(model_dir), target_device)
        state.genai_pipe_secondary = pipe
        state.genai_secondary_device = target_device
        return True
    except Exception as exc:  # noqa: BLE001
        print(f'[DevForge][NPU] GenAI secondary load failed on {target_device}: {exc}', flush=True)
        state.genai_pipe_secondary = None
        state.genai_secondary_device = None
        return False


@app.post('/draft')
def generate_draft(req: DraftRequest):
    """Phase 2 NPU draft endpoint. Generates up to `lookahead` tokens
    starting from `prompt`/`prefix_tokens` and returns them as raw
    token IDs so the verifier (running in llamanode) can run a single
    forward pass over them. The pair must share a tokenizer for the
    IDs to be valid in the verifier's vocabulary."""
    ensure_model_loaded()
    branch = (req.branch or 'primary').strip().lower()
    if branch == 'secondary':
        target_device = os.environ.get('DEVFORGE_SECONDARY_DRAFT_DEVICE') or 'GPU'
        if not _ensure_secondary_pipe(target_device):
            return {
                'success': False,
                'error': f'Secondary drafter not available on {target_device}',
                'branch': branch,
            }
        pipe = state.genai_pipe_secondary
    else:
        pipe = state.genai_pipe
    if pipe is None:
        return {
            'success': False,
            'error': 'GenAI pipeline unavailable; cannot serve drafts',
            'engine': 'optimum' if state.model is not None else 'none',
            'branch': branch,
        }

    request_id = req.request_id or f'draft-{uuid.uuid4().hex}'
    started_at = time.perf_counter()
    with _draft_requests_lock:
        _draft_requests[request_id] = {'cancelled': False, 'started_at': started_at}

    try:
        try:
            tokenizer = pipe.get_tokenizer()
        except Exception:  # noqa: BLE001
            tokenizer = None

        prompt = _resolve_draft_prompt(req, tokenizer)
        if not prompt:
            return {
                'success': False,
                'error': 'draft request requires either prompt or prefix_tokens',
                'request_id': request_id,
                'branch': branch,
            }

        cfg = _build_draft_config(req)

        # Cooperative cancellation: check the registry between the time
        # the request lands and when generate() is dispatched. The
        # generate() call itself is opaque to mid-flight cancel in this
        # build of GenAI; aborting once issued requires waiting for the
        # 4-8 tokens to finish (microseconds at NPU speed).
        with _draft_requests_lock:
            entry = _draft_requests.get(request_id)
            cancelled = bool(entry and entry.get('cancelled'))
        if cancelled:
            return {
                'success': True,
                'cancelled': True,
                'request_id': request_id,
                'draft_tokens': [],
                'draft_logprobs': [],
                'latency_ms': int((time.perf_counter() - started_at) * 1000),
            }

        result = pipe.generate(prompt, cfg)
        # GenAI returns either a string, a DecodedResults-like object,
        # or (newer builds) a object whose .tokens is a list of int
        # tensors. Always recover the text first, then re-tokenize so
        # we get a flat python int list regardless of build.
        if hasattr(result, 'texts') and result.texts:
            text = str(result.texts[0])
        else:
            text = str(result)
        ids = _extract_token_ids(tokenizer, text)

        # Some GenAI builds prepend prompt ids. Take the last `lookahead`
        # ids so the caller always gets just the freshly-drafted tokens.
        max_n = max(1, min(int(req.lookahead or 4), 8))
        if len(ids) > max_n:
            ids = ids[-max_n:]

        with _draft_requests_lock:
            entry = _draft_requests.get(request_id)
            cancelled = bool(entry and entry.get('cancelled'))

        active_device = (
            state.genai_secondary_device if branch == 'secondary' else state.genai_device
        ) or state.config.get('device')
        return {
            'success': True,
            'cancelled': cancelled,
            'request_id': request_id,
            'draft_tokens': ids,
            'draft_logprobs': None,
            'latency_ms': int((time.perf_counter() - started_at) * 1000),
            'engine': 'genai',
            'device': active_device,
            'branch': branch,
            'tokenizer_id': state.genai_model_id,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            'success': False,
            'error': str(exc),
            'request_id': request_id,
            'branch': branch,
            'latency_ms': int((time.perf_counter() - started_at) * 1000),
        }
    finally:
        with _draft_requests_lock:
            _draft_requests.pop(request_id, None)


@app.delete('/draft/{request_id}')
def cancel_draft(request_id: str):
    """Mark an in-flight draft as cancelled. The handler returns
    immediately; the actual draft thread observes the flag at its next
    cooperative check (between batches or before the next pipeline call).
    """
    with _draft_requests_lock:
        entry = _draft_requests.get(request_id)
        if entry is None:
            return {'success': False, 'request_id': request_id, 'reason': 'unknown-or-completed'}
        entry['cancelled'] = True
    return {'success': True, 'request_id': request_id}


# ─── Phase 2 A3: DraftSession with server-side prompt state ────────────
# Each session keeps the accumulated prompt + accepted-suffix on the
# server so the orchestrator only ships small `accepted_tokens` deltas
# per draft. The OpenVINO GenAI LLMPipeline still re-prefills internally
# on each generate() call -- truly hot-cache draft latency on Intel NPU
# 3 needs deeper KVCacheEvictionConfig tuning that lives in a follow-up
# (tracker risk: "Spec-decode KV-cache reuse"). The contract here gives
# us the API hook v0.4.1 needs and reduces JSON / network overhead.

_draft_sessions: Dict[str, Dict[str, object]] = {}
_draft_sessions_lock = Lock()


class DraftSessionInitRequest(BaseModel):
    prompt: str | None = None
    prompt_tokens: list[int] | None = None


class DraftSessionExtendRequest(BaseModel):
    accepted_tokens: list[int] | None = None
    accepted_text: str | None = None
    lookahead: int = 4
    request_id: str | None = None
    temperature: float = 0.0
    top_k: int = 40
    top_p: float = 0.95


@app.post('/draft/session')
def create_draft_session(req: DraftSessionInitRequest):
    """Create a new server-side draft session. The session anchors a
    prompt + running accepted-suffix; subsequent extend calls only need
    to ship the newly-accepted tokens.

    v0.4.4 (Phase 2 unblock): when the installed openvino-genai build
    exposes ``LLMPipeline.start_chat()`` we engage chat-mode so each
    ``extend`` only re-prefills the *delta* since the last accepted
    suffix instead of the full running prompt. Older builds fall back
    transparently to the full-prompt generate path."""
    ensure_model_loaded()
    if state.genai_pipe is None:
        return {
            'success': False,
            'error': 'GenAI pipeline unavailable; sessions require the genai engine',
        }

    try:
        tokenizer = state.genai_pipe.get_tokenizer()
    except Exception:  # noqa: BLE001
        tokenizer = None

    prompt_text = ''
    if req.prompt and req.prompt.strip():
        prompt_text = req.prompt
    elif req.prompt_tokens and tokenizer is not None and hasattr(tokenizer, 'decode'):
        try:
            prompt_text = tokenizer.decode(list(req.prompt_tokens))
        except Exception:  # noqa: BLE001
            prompt_text = ''

    chat_mode_active = False
    chat_mode_skip_reason = None
    if hasattr(state.genai_pipe, 'start_chat'):
        try:
            state.genai_pipe.start_chat()
            chat_mode_active = True
        except Exception as exc:  # noqa: BLE001
            chat_mode_skip_reason = f'start_chat raised: {exc}'
            print(f'[DevForge][NPU] start_chat unavailable for session: {exc}', flush=True)
    else:
        chat_mode_skip_reason = 'start_chat not exposed by installed openvino-genai build'

    session_id = f'sess-{uuid.uuid4().hex}'
    with _draft_sessions_lock:
        _draft_sessions[session_id] = {
            'prompt_text': prompt_text,
            'committed_text': '',
            'created_at': time.time(),
            'last_used_at': time.time(),
            'extend_count': 0,
            'chat_mode_active': chat_mode_active,
            'chat_mode_skip_reason': chat_mode_skip_reason,
            'last_full_text_len': 0,
        }
    return {
        'success': True,
        'session_id': session_id,
        'prompt_chars': len(prompt_text),
        'engine': 'genai',
        'device': state.genai_device or state.config.get('device'),
        'chat_mode_active': chat_mode_active,
        'chat_mode_skip_reason': chat_mode_skip_reason,
    }


@app.post('/draft/session/{session_id}/extend')
def extend_draft_session(session_id: str, req: DraftSessionExtendRequest):
    """Append accepted tokens to the session's committed-suffix and
    return the next batch of draft tokens. Server-side state means the
    orchestrator only ships the small accepted delta per call."""
    ensure_model_loaded()
    if state.genai_pipe is None:
        return {'success': False, 'error': 'GenAI pipeline unavailable', 'session_id': session_id}

    pipe = state.genai_pipe
    try:
        tokenizer = pipe.get_tokenizer()
    except Exception:  # noqa: BLE001
        tokenizer = None

    with _draft_sessions_lock:
        sess = _draft_sessions.get(session_id)
        if sess is None:
            return {'success': False, 'error': 'unknown session', 'session_id': session_id}

    accepted_text_delta = ''
    if req.accepted_text:
        accepted_text_delta = str(req.accepted_text)
    elif req.accepted_tokens and tokenizer is not None and hasattr(tokenizer, 'decode'):
        try:
            accepted_text_delta = tokenizer.decode(list(req.accepted_tokens))
        except Exception:  # noqa: BLE001
            accepted_text_delta = ''

    started_at = time.perf_counter()
    request_id = req.request_id or f'draft-{uuid.uuid4().hex}'
    with _draft_requests_lock:
        _draft_requests[request_id] = {'cancelled': False, 'started_at': started_at}

    try:
        with _draft_sessions_lock:
            sess['committed_text'] = sess.get('committed_text', '') + accepted_text_delta
            full_text = (sess.get('prompt_text') or '') + sess['committed_text']
            sess['last_used_at'] = time.time()
            sess['extend_count'] = int(sess.get('extend_count', 0)) + 1
            chat_mode_active = bool(sess.get('chat_mode_active'))
            last_full_text_len = int(sess.get('last_full_text_len', 0))

        # KV-cache reuse path (v0.4.4): in chat mode, the GenAI pipeline
        # retains its KV state across generate() calls. We feed only the
        # newly-extended text since the last call, so the pipe only
        # prefills the delta instead of the full running prompt.
        if chat_mode_active and last_full_text_len > 0 and len(full_text) >= last_full_text_len:
            generate_input = full_text[last_full_text_len:]
            generate_mode = 'delta'
        else:
            generate_input = full_text
            generate_mode = 'full'

        cfg = _build_draft_config(DraftRequest(
            prompt=generate_input,
            lookahead=req.lookahead,
            temperature=req.temperature,
            top_k=req.top_k,
            top_p=req.top_p,
        ))

        with _draft_requests_lock:
            entry = _draft_requests.get(request_id)
            cancelled = bool(entry and entry.get('cancelled'))
        if cancelled:
            return {
                'success': True,
                'cancelled': True,
                'session_id': session_id,
                'request_id': request_id,
                'draft_tokens': [],
                'latency_ms': int((time.perf_counter() - started_at) * 1000),
            }

        try:
            result = pipe.generate(generate_input, cfg)
        except Exception as exc:  # noqa: BLE001
            # If chat-mode generate fails (e.g. the build accepts start_chat
            # but rejects delta-only inputs on this device), fall back to
            # the full-text path for the rest of this session and try once
            # more so the round still produces useful tokens.
            if chat_mode_active and generate_mode == 'delta':
                print(
                    f'[DevForge][NPU] chat-mode delta generate failed ({exc}); falling back to full-prompt for this session.',
                    flush=True,
                )
                with _draft_sessions_lock:
                    sess_after = _draft_sessions.get(session_id)
                    if sess_after is not None:
                        sess_after['chat_mode_active'] = False
                        sess_after['chat_mode_skip_reason'] = f'delta generate raised: {exc}'
                generate_input = full_text
                generate_mode = 'full-fallback'
                result = pipe.generate(generate_input, cfg)
            else:
                raise

        with _draft_sessions_lock:
            sess_now = _draft_sessions.get(session_id)
            if sess_now is not None:
                sess_now['last_full_text_len'] = len(full_text)

        if hasattr(result, 'texts') and result.texts:
            generated_text = str(result.texts[0])
        else:
            generated_text = str(result)
        ids = _extract_token_ids(tokenizer, generated_text)
        max_n = max(1, min(int(req.lookahead or 4), 8))
        if len(ids) > max_n:
            ids = ids[-max_n:]

        with _draft_requests_lock:
            entry = _draft_requests.get(request_id)
            cancelled = bool(entry and entry.get('cancelled'))

        return {
            'success': True,
            'cancelled': cancelled,
            'session_id': session_id,
            'request_id': request_id,
            'draft_tokens': ids,
            'draft_logprobs': None,
            'latency_ms': int((time.perf_counter() - started_at) * 1000),
            'engine': 'genai',
            'device': state.genai_device or state.config.get('device'),
            'extend_count': int(sess.get('extend_count', 0)),
            'generate_mode': generate_mode,
            'chat_mode_active': bool(sess.get('chat_mode_active')),
        }
    except Exception as exc:  # noqa: BLE001
        return {
            'success': False,
            'error': str(exc),
            'session_id': session_id,
            'request_id': request_id,
            'latency_ms': int((time.perf_counter() - started_at) * 1000),
        }
    finally:
        with _draft_requests_lock:
            _draft_requests.pop(request_id, None)


@app.delete('/draft/session/{session_id}')
def close_draft_session(session_id: str):
    with _draft_sessions_lock:
        sess = _draft_sessions.pop(session_id, None)
    if sess is None:
        return {'success': False, 'session_id': session_id, 'reason': 'unknown-or-already-closed'}
    if sess.get('chat_mode_active') and state.genai_pipe is not None and hasattr(state.genai_pipe, 'finish_chat'):
        try:
            state.genai_pipe.finish_chat()
        except Exception as exc:  # noqa: BLE001
            print(f'[DevForge][NPU] finish_chat raised on session close: {exc}', flush=True)
    return {
        'success': True,
        'session_id': session_id,
        'closed_at': time.time(),
        'extend_count': int(sess.get('extend_count', 0)),
        'chat_mode_active': bool(sess.get('chat_mode_active')),
    }


@app.post('/generate-stream')
def generate_stream(req: GenerateRequest):
    ensure_model_loaded()

    def event_stream():
        try:
            for token in stream_tokens(req):
                payload = json.dumps({'token': token})
                yield f'data: {payload}\n\n'
        except Exception as exc:  # pylint: disable=broad-except
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
        yield 'data: [DONE]\n\n'

    return StreamingResponse(event_stream(), media_type='text/event-stream')


@app.post('/embed')
def embed(req: EmbeddingRequest):
    ensure_model_loaded()
    texts = req.texts or []
    if req.text:
        texts = [*texts, req.text]

    texts = [str(item or '') for item in texts if str(item or '').strip()]
    if not texts:
        return {
            'embeddings': [],
            'count': 0,
            'device': state.config.get('device'),
            'model': state.config.get('model_path') or state.config.get('model_id'),
            'method': 'none',
        }

    embeddings = []
    methods = []
    for text in texts:
        vector, method = compute_embedding_vector(text, normalize=req.normalize)
        embeddings.append(vector)
        methods.append(method)

    preferred_method = methods[0] if methods else 'none'
    if any(method != preferred_method for method in methods):
        preferred_method = 'mixed'

    return {
        'embeddings': embeddings,
        'count': len(embeddings),
        'device': state.config.get('device'),
        'model': state.config.get('model_path') or state.config.get('model_id'),
        'method': preferred_method,
    }


def main():
    # Force unbuffered output for Electron subprocess capture
    import sys
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)

    port = int(os.environ.get('OPENVINO_SERVER_PORT', '8081'))
    engine_hint = 'genai+optimum' if GENAI_AVAILABLE else 'optimum-only'
    print(f'[DevForge][NPU] Starting OpenVINO server on port {port} (engines: {engine_hint})...', flush=True)

    # Configure uvicorn to log to stdout
    import logging
    logging.basicConfig(level=logging.INFO, format='%(message)s', stream=sys.stdout)

    uvicorn.run(app, host='0.0.0.0', port=port, log_level='info')


if __name__ == '__main__':
    main()
