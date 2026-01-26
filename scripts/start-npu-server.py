"""
DevForge OpenVINO Inference Server

Wraps an OpenVINO (NPU/GPU/CPU) causal language model with a lightweight FastAPI app.

Requirements inside your OpenVINO environment:
    pip install fastapi uvicorn openvino-dev transformers optimum[openvino]
"""

import json
import os
import sys
from pathlib import Path
from threading import Thread
from typing import Dict, Generator

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


APP_DIR = Path(__file__).resolve().parent
CONFIG_PATH = Path(__file__).with_name('openvino-model.json')

DEFAULT_CONFIG = {
    'model_path': '',
    'tokenizer': '',
    'device': 'AUTO',
    'precision': 'fp16',
}


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
        self.model = None
        self.tokenizer = None

    def reset(self):
        self.model = None
        self.tokenizer = None


state = ServerState()
app = FastAPI(title='DevForge OpenVINO Server', version='0.2.0')


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


def ensure_model_loaded():
    if state.model and state.tokenizer:
        return

    cfg = state.config
    model_id = cfg.get('model_path') or cfg.get('model_id')
    if not model_id:
        raise RuntimeError(
            f'Configure {CONFIG_PATH} with "model_path" pointing to an OpenVINO model or HF repo.'
        )

    tokenizer_id = cfg.get('tokenizer') or model_id
    device = cfg.get('device') or 'AUTO'

    print(f'[DevForge][NPU] Loading model={model_id} tokenizer={tokenizer_id} device={device}')
    tokenizer = AutoTokenizer.from_pretrained(tokenizer_id, trust_remote_code=True)
    model = OVModelForCausalLM.from_pretrained(
        model_id,
        device=device,
        trust_remote_code=True,
    )
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    state.model = model
    state.tokenizer = tokenizer
    state.config['device'] = device
    print('[DevForge][NPU] Model loaded.')


def stream_tokens(req: GenerateRequest) -> Generator[str, None, None]:
    ensure_model_loaded()
    tokenizer = state.tokenizer
    model = state.model

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


@app.get('/status')
def status():
    """Basic status check - doesn't require model to be loaded"""
    cfg = state.config
    return {
        'status': 'ok',
        'server': 'running',
        'model_configured': bool(cfg.get('model_path') or cfg.get('model_id')),
        'model_loaded': state.model is not None,
        'device': cfg.get('device'),
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
            'device': cfg.get('device'),
            'precision': cfg.get('precision'),
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
    ensure_model_loaded()
    return {'status': 'loaded', 'model': cfg.get('model_path'), 'device': cfg.get('device')}


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
            }
        ]
    }


@app.post('/generate')
def generate(req: GenerateRequest):
    ensure_model_loaded()
    tokenizer = state.tokenizer
    model = state.model

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
    return {'response': completion.strip(), 'done': True}


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


def main():
    # Force unbuffered output for Electron subprocess capture
    import sys
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
    
    port = int(os.environ.get('OPENVINO_SERVER_PORT', '8081'))
    print(f'[DevForge][NPU] Starting OpenVINO server on port {port}...', flush=True)
    
    # Configure uvicorn to log to stdout
    import logging
    logging.basicConfig(level=logging.INFO, format='%(message)s', stream=sys.stdout)
    
    uvicorn.run(app, host='0.0.0.0', port=port, log_level='info')


if __name__ == '__main__':
    main()


