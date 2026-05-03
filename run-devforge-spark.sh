#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ -x "$PWD/.tooling/node/bin/node" ]]; then
  export PATH="$PWD/.tooling/node/bin:$PATH"
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "[DevForge Spark] This profile is tuned for NVIDIA Spark Linux; continuing with your current platform."
fi

# Spark/Linux user namespaces can block Electron's Chromium sandbox.
export ELECTRON_DISABLE_SANDBOX="${ELECTRON_DISABLE_SANDBOX:-1}"
export DEVFORGE_SPARK_PROFILE="${DEVFORGE_SPARK_PROFILE:-nvidia-spark-linux}"

# Keep the normal runtime conservative: Ollama/CUDA first. Experimental
# multi-backend labs stay opt-in so missing OpenVINO, llama.cpp, robotjs, or
# Mosaic/spec-decode pieces never block startup on fresh Spark installs.
if [[ "${DEVFORGE_ENABLE_LABS:-0}" != "1" ]]; then
  unset DEVFORGE_MOSAIC_DEV
  unset DEVFORGE_MOSAIC_ENABLE
  unset DEVFORGE_SPEC_DECODE_ENABLE
  unset DEVFORGE_SPEC_DRAFTER
fi

export OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
export OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:-30m}"
export OLLAMA_NUM_PARALLEL="1"
export OLLAMA_MAX_LOADED_MODELS="1"
export OLLAMA_FLASH_ATTENTION="${OLLAMA_FLASH_ATTENTION:-1}"
export OLLAMA_KV_CACHE_TYPE="${OLLAMA_KV_CACHE_TYPE:-q4_0}"

echo "[DevForge Spark] profile=$DEVFORGE_SPARK_PROFILE host=$OLLAMA_HOST keep_alive=$OLLAMA_KEEP_ALIVE parallel=$OLLAMA_NUM_PARALLEL"
if [[ "${DEVFORGE_ENABLE_LABS:-0}" != "1" ]]; then
  echo "[DevForge Spark] optional labs disabled; set DEVFORGE_ENABLE_LABS=1 to pass Mosaic/spec-decode env through"
fi

npm run app
