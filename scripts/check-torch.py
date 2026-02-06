import torch
print("PyTorch:", torch.__version__)
print("CUDA available:", torch.cuda.is_available())
print("CUDA version:", torch.version.cuda)
try:
    print("GPU count:", torch.cuda.device_count())
    if torch.cuda.is_available():
        print("GPU name:", torch.cuda.get_device_name(0))
        a = torch.randn(1000, 1000, device='cuda')
        b = torch.randn(1000, 1000, device='cuda')
        c = torch.mm(a, b)
        print("GPU compute test: PASSED")
        mem = torch.cuda.mem_get_info(0)
        print(f"GPU Memory: {mem[0]/(1024**3):.1f} GB free / {mem[1]/(1024**3):.1f} GB total")
except Exception as e:
    print("GPU error:", e)
