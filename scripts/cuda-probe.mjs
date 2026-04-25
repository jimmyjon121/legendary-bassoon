// Quick CUDA prebuild loadability probe for node-llama-cpp 3.x.
// Sets CUDA 12.9 env explicitly so the in-process fork sees the
// CUDA 12 runtime DLLs the prebuilt llama-addon.node depends on.
process.env.CUDA_PATH = 'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.9';
process.env.CUDAToolkit_ROOT = process.env.CUDA_PATH;
process.env.PATH = process.env.CUDA_PATH + '\\bin;' + process.env.PATH;

const { getLlama } = await import('node-llama-cpp');
const llama = await getLlama({ gpu: 'cuda' });
console.log('gpu:', llama.gpu);
const vram = await llama.getVramState();
console.log('vram:', JSON.stringify(vram));
