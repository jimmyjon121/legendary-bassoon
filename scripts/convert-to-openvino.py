"""
DevForge helper script to convert models to OpenVINO IR for NPU acceleration.

Supports:
- HuggingFace models (recommended)
- ONNX models
- PyTorch models

Note: GGUF files cannot be directly converted. Use the original HuggingFace model instead.
"""

import argparse
import sys
import os
from pathlib import Path


def check_dependencies():
    """Check if required packages are installed."""
    missing = []
    
    try:
        import openvino  # noqa
    except ImportError:
        missing.append("openvino")
    
    try:
        import optimum.intel  # noqa
    except ImportError:
        missing.append("optimum-intel")
    
    try:
        import nncf  # noqa
    except ImportError:
        missing.append("nncf")
    
    try:
        import transformers  # noqa
    except ImportError:
        missing.append("transformers")
    
    if missing:
        print(f"Missing packages: {', '.join(missing)}", file=sys.stderr)
        print("\nInstall with:", file=sys.stderr)
        print(f"  pip install {' '.join(missing)}", file=sys.stderr)
        sys.exit(1)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Convert models to OpenVINO IR for Intel NPU",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Convert a HuggingFace model
  python convert-to-openvino.py --input "microsoft/phi-2" --output-dir ./npu-models/phi-2

  # Convert with INT4 quantization for smaller size
  python convert-to-openvino.py --input "TinyLlama/TinyLlama-1.1B-Chat-v1.0" --output-dir ./npu-models/tinyllama --precision int4

  # Convert a local ONNX model
  python convert-to-openvino.py --input ./model.onnx --output-dir ./npu-models/custom
        """
    )
    parser.add_argument(
        "--input", 
        required=True, 
        help="HuggingFace model ID (e.g., 'microsoft/phi-2') or path to local model"
    )
    parser.add_argument(
        "--output-dir", 
        required=True, 
        help="Directory to save the converted OpenVINO model"
    )
    parser.add_argument(
        "--precision",
        default="int4",
        choices=["fp32", "fp16", "int8", "int4"],
        help="Target precision. int4 recommended for NPU (default: int4)",
    )
    parser.add_argument(
        "--task",
        default="text-generation",
        choices=["text-generation", "text-generation-with-past", "feature-extraction"],
        help="Model task type (default: text-generation)",
    )
    return parser.parse_args()


def is_gguf_file(path: str) -> bool:
    """Check if the path is a GGUF file."""
    return path.lower().endswith('.gguf')


def convert_huggingface_model(model_id: str, output_dir: Path, precision: str, task: str):
    """Convert a HuggingFace model to OpenVINO format."""
    from optimum.intel import OVModelForCausalLM
    from transformers import AutoTokenizer
    import nncf
    
    print(f"[DevForge] Loading model: {model_id}")
    
    # Determine weight format based on precision
    if precision == "int4":
        weight_format = "int4_sym_g128"
        print("[DevForge] Using INT4 symmetric quantization (optimized for NPU)")
    elif precision == "int8":
        weight_format = "int8"
        print("[DevForge] Using INT8 quantization")
    else:
        weight_format = precision
        print(f"[DevForge] Using {precision.upper()} precision")
    
    # Load and convert the model
    print("[DevForge] Converting to OpenVINO format (this may take a while)...")
    
    try:
        model = OVModelForCausalLM.from_pretrained(
            model_id,
            export=True,
            compile=False,
            load_in_8bit=(precision == "int8"),
        )
        
        # Apply weight compression if needed
        if precision in ["int4", "int8"]:
            print(f"[DevForge] Applying {precision.upper()} weight compression...")
            model = nncf.compress_weights(
                model.model,
                mode=nncf.CompressWeightsMode.INT4_SYM if precision == "int4" else nncf.CompressWeightsMode.INT8_SYM,
                ratio=1.0,
            )
        
        # Save the model
        print(f"[DevForge] Saving to: {output_dir}")
        model.save_pretrained(output_dir)
        
        # Also save the tokenizer
        print("[DevForge] Saving tokenizer...")
        tokenizer = AutoTokenizer.from_pretrained(model_id)
        tokenizer.save_pretrained(output_dir)
        
        print("[DevForge] ✓ Conversion complete!")
        print(f"[DevForge] Model saved to: {output_dir}")
        
    except Exception as e:
        print(f"[DevForge] Error during conversion: {e}", file=sys.stderr)
        
        # Fallback to simple export
        print("[DevForge] Trying alternative conversion method...")
        try:
            from optimum.exporters.openvino import main_export
            
            main_export(
                model_id,
                str(output_dir),
                task=task,
                fp16=(precision == "fp16"),
            )
            print("[DevForge] ✓ Conversion complete (alternative method)!")
            
        except Exception as e2:
            print(f"[DevForge] Alternative method also failed: {e2}", file=sys.stderr)
            sys.exit(1)


def convert_onnx_model(input_path: Path, output_dir: Path, precision: str):
    """Convert an ONNX model to OpenVINO format."""
    from openvino.tools import mo
    
    print(f"[DevForge] Converting ONNX model: {input_path}")
    
    compress_to_fp16 = precision in ["fp16", "int8", "int4"]
    
    mo.convert_model(
        input_model=str(input_path),
        model_name=input_path.stem,
        output_dir=str(output_dir),
        compress_to_fp16=compress_to_fp16,
    )
    
    print("[DevForge] ✓ ONNX conversion complete!")


def main():
    args = parse_args()
    
    input_path = args.input
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Check if it's a GGUF file
    if is_gguf_file(input_path):
        print("\n" + "=" * 60, file=sys.stderr)
        print("⚠️  GGUF files cannot be directly converted to OpenVINO", file=sys.stderr)
        print("=" * 60, file=sys.stderr)
        print("\nGGUF is a quantized format specific to llama.cpp.", file=sys.stderr)
        print("To use a model on NPU, you need the original HuggingFace model.", file=sys.stderr)
        print("\nRecommended NPU-optimized models:", file=sys.stderr)
        print("  • microsoft/phi-2 (2.7B params)", file=sys.stderr)
        print("  • TinyLlama/TinyLlama-1.1B-Chat-v1.0", file=sys.stderr)
        print("  • Qwen/Qwen2-1.5B-Instruct", file=sys.stderr)
        print("  • stabilityai/stablelm-2-1_6b-chat", file=sys.stderr)
        print("\nExample:", file=sys.stderr)
        print(f'  python {sys.argv[0]} --input "microsoft/phi-2" --output-dir {output_dir}', file=sys.stderr)
        sys.exit(1)
    
    # Check dependencies
    check_dependencies()
    
    # Determine input type and convert
    local_path = Path(input_path).expanduser()
    
    if local_path.exists():
        if local_path.suffix.lower() == '.onnx':
            convert_onnx_model(local_path, output_dir, args.precision)
        elif local_path.is_dir():
            # Assume it's a local HuggingFace model directory
            convert_huggingface_model(str(local_path), output_dir, args.precision, args.task)
        else:
            print(f"[DevForge] Unknown file type: {local_path}", file=sys.stderr)
            sys.exit(1)
    else:
        # Assume it's a HuggingFace model ID
        convert_huggingface_model(input_path, output_dir, args.precision, args.task)


if __name__ == "__main__":
    main()
