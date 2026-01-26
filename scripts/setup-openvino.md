# OpenVINO NPU Setup Guide

This guide walks you through setting up OpenVINO for Intel NPU acceleration in DevForge.

## Requirements

- **Windows 11** version 22H2 or later
- **Intel Core Ultra processor** (Meteor Lake, Lunar Lake, or Arrow Lake)
- **Latest Intel NPU drivers**
- **Python 3.8 or later**

## Step 1: Install Intel NPU Drivers

1. Download the latest NPU driver from Intel:
   - [Intel NPU Driver for Windows](https://www.intel.com/content/www/us/en/download/794734/intel-npu-driver-windows.html)

2. Run the installer and restart your computer when prompted.

3. Verify the driver is installed:
   - Open Device Manager
   - Look for "Intel(R) AI Boost" under "Neural processors"

## Step 2: Install OpenVINO Toolkit

### Option A: Using pip (Recommended)

```powershell
# Install OpenVINO Python package
pip install openvino

# Verify installation
python -c "from openvino import Core; print(Core().available_devices)"
```

### Option B: Full Toolkit Installation

1. Download OpenVINO from Intel:
   - [OpenVINO Toolkit Download](https://www.intel.com/content/www/us/en/developer/tools/openvino-toolkit/download.html)

2. Run the installer and select:
   - OpenVINO Runtime
   - Python bindings
   - NPU plugin

3. After installation, run the setup script:
   ```powershell
   # Usually located at:
   "C:\Program Files (x86)\Intel\openvino_2024\setupvars.bat"
   ```

## Step 3: Verify NPU Detection

Run this Python script to verify NPU is detected:

```python
from openvino import Core

core = Core()
devices = core.available_devices

print("Available devices:")
for device in devices:
    full_name = core.get_property(device, "FULL_DEVICE_NAME")
    print(f"  {device}: {full_name}")

if "NPU" in devices:
    print("\n✓ NPU is available!")
else:
    print("\n✗ NPU not detected. Check driver installation.")
```

Expected output:
```
Available devices:
  CPU: Intel(R) Core(TM) Ultra 9 285H
  GPU: Intel(R) Arc(TM) Graphics
  NPU: Intel(R) AI Boost
  
✓ NPU is available!
```

## Step 4: Model Conversion (Optional)

To run models on the NPU, they need to be in ONNX or OpenVINO IR format.

### Converting GGUF to ONNX

This requires additional tools:

```powershell
# Install conversion tools
pip install transformers torch onnx

# Convert using llama.cpp's convert script (if available)
# Or use HuggingFace's conversion utilities
```

### Optimizing for NPU

```python
from openvino import Core, save_model
from openvino.runtime import serialize

core = Core()

# Read ONNX model
model = core.read_model("model.onnx")

# Compile for NPU
compiled_model = core.compile_model(model, "NPU")

# Save optimized model
serialize(model, "model_optimized.xml", "model_optimized.bin")
```

## Step 5: Start DevForge with NPU Support

1. Restart DevForge
2. Go to Settings → Hardware
3. You should see "Intel NPU" listed under detected hardware
4. Select "OpenVINO NPU" as your inference backend

## Troubleshooting

### NPU not detected

1. Ensure you have Windows 11 22H2 or later
2. Update Intel NPU drivers to the latest version
3. Restart your computer after driver installation
4. Check Device Manager for "Intel AI Boost"

### OpenVINO import errors

```powershell
# Reinstall OpenVINO
pip uninstall openvino
pip install openvino --upgrade
```

### Performance issues

- NPU is optimized for small models (< 7B parameters)
- For larger models, use CUDA (NVIDIA) or Vulkan (Intel Arc)
- Ensure your model is properly quantized (INT8 works best on NPU)

## Supported Models

The NPU works best with:
- Quantized models (INT8, INT4)
- Small language models (< 7B parameters)
- ONNX or OpenVINO IR format

Recommended models:
- Phi-3-mini (3.8B) - Optimized for Intel NPU
- Llama 3.2 1B/3B - Small and efficient
- Qwen2 0.5B/1.5B - Very fast on NPU

## Resources

- [OpenVINO Documentation](https://docs.openvino.ai/)
- [Intel NPU Plugin Guide](https://docs.openvino.ai/latest/openvino_docs_OV_UG_supported_plugins_NPU.html)
- [Model Optimization Guide](https://docs.openvino.ai/latest/openvino_docs_model_optimization_guide.html)
- [Intel AI PC Developer Guide](https://www.intel.com/content/www/us/en/developer/articles/guide/ai-pc-developer-guide.html)


