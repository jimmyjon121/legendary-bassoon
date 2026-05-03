# DevForge v0.1.0 🔥

**Your Personal AI Development Environment**

DevForge is a powerful, privacy-focused desktop application for running AI models locally on your hardware. Built for developers who want complete control over their AI tools.

## 🚀 Installation

### Windows
1. Download `DevForge Setup 0.1.0.exe` from the `release` folder
2. Run the installer
3. Follow the setup wizard
4. Launch DevForge from your Start Menu or Desktop

### First Launch
On first launch, DevForge will guide you through:
1. Installing Ollama (if not already installed)
2. Downloading your first AI model
3. Setting up your workspace preferences

## ✨ Features

### 🤖 Multi-Model Support
- **Ollama Integration** - Run GGUF models locally
- **Multiple Backends** - CUDA, Vulkan, OpenVINO, CPU
- **Model Finder** - Scan your system for existing AI models
- **Import Options** - Copy, move, or reference models from anywhere

### 🎨 Workspaces
- **Casual** - General conversations and exploration
- **Work** - Professional tasks and documentation
- **Code** - Programming assistance and debugging
- **Private** - Encrypted workspace for sensitive content

### 🖼️ Image Generation
- Integrated Stable Diffusion support
- Multiple samplers and schedulers
- Custom resolution and CFG settings
- Save and manage generated images

### ⚡ Hardware Acceleration
- **NPU Support** - Intel AI Boost NPU detection
- **Multi-GPU** - NVIDIA CUDA + Intel Arc Vulkan
- **Power Mode** - Optimize system for AI performance
- **Hardware Monitor** - Real-time CPU/GPU/RAM tracking

### 🔒 Privacy & Security
- **100% Local** - All processing happens on your machine
- **No Telemetry** - Zero data collection or tracking
- **Encrypted Storage** - Optional encryption for sensitive chats
- **Panic Mode** - Quick hide with Ctrl+Shift+X

### 🎯 Model Management
- **System Scanner** - Find models in common locations
- **Format Support** - GGUF, ONNX, SafeTensors, PyTorch
- **Bulk Import** - Import multiple models at once
- **Smart Detection** - Auto-detect model metadata

## 🖥️ System Requirements

### Minimum
- **OS**: Windows 10/11 (64-bit)
- **RAM**: 8 GB
- **Storage**: 10 GB free space
- **CPU**: Intel Core i5 or AMD Ryzen 5

### Recommended
- **OS**: Windows 11 (64-bit)
- **RAM**: 16-32 GB
- **Storage**: 50+ GB SSD
- **GPU**: NVIDIA RTX 3060+ or Intel Arc A770
- **NPU**: Intel Core Ultra (AI Boost NPU)

## 📁 File Locations

- **User Data**: `%APPDATA%\devforge\`
- **Database**: `%APPDATA%\devforge\devforge.db`
- **Models**: Configurable (default: `%USERPROFILE%\Documents\AI Models\`)
- **Generated Images**: `%APPDATA%\devforge\images\`

## 🔧 Configuration

### Ollama Setup
DevForge requires Ollama for LLM inference:
1. Download from [ollama.ai](https://ollama.ai)
2. Install and start the Ollama service
3. DevForge will auto-detect it

### Model Installation
1. Click the "Find" button in the sidebar
2. Click "Scan System" to find existing models
3. Or click "Browse Files" to manually select models
4. Choose import method (Copy/Move/Reference)
5. Click "Import" to add models to DevForge

### Hardware Acceleration
1. Open Settings → Hardware
2. View detected GPUs and NPU
3. Select preferred backend (Auto/CUDA/Vulkan/CPU)
4. Enable Power Mode for maximum performance

## 🎨 Customization

### Workspaces
- Each workspace has its own conversation history
- Customize system prompts in Settings
- Set different models per workspace

### Themes
- Dark mode (default)
- Workspace-specific accent colors
- Customizable UI density (coming soon)

## 🐛 Troubleshooting

### Ollama Not Detected
- Ensure Ollama is installed and running
- Check if `http://localhost:11434` is accessible
- Restart DevForge after installing Ollama

### Model Import Fails
- Check disk space (models can be 4-20 GB)
- Ensure you have write permissions
- Try "Reference" mode if copy fails

### Performance Issues
- Enable Power Mode in the sidebar
- Close other applications
- Use smaller models (7B instead of 13B+)
- Check GPU drivers are up to date

### Hardware Not Detected
- Install `systeminformation` package: `npm install systeminformation`
- Restart DevForge
- Check Windows Device Manager for hardware

## 🔐 Security Features

### Private Workspace
- All messages encrypted with AES-256
- Password-protected access
- Separate from other workspaces
- Encrypted database storage

### Panic Mode
- Press `Ctrl+Shift+X` to instantly hide the app
- Minimizes to system tray
- Locks Private workspace
- No trace in taskbar

## 📝 Keyboard Shortcuts

- `Ctrl+N` - New conversation
- `Ctrl+K` - Open model selector
- `Ctrl+,` - Open settings
- `Ctrl+Shift+X` - Panic mode (hide app)
- `Enter` - Send message
- `Shift+Enter` - New line in message

## 🔄 Updates

DevForge will check for updates automatically (coming soon). For now:
1. Download the latest release
2. Run the installer
3. Your data and settings will be preserved

## 🤝 Support

- **Issues**: Report bugs or request features
- **Documentation**: Full docs at project repository
- **Community**: Join discussions and share tips

## 📜 License

DevForge is open-source software. See LICENSE file for details.

## 🙏 Credits

Built with:
- Electron - Desktop framework
- React - UI framework
- Ollama - LLM backend
- Vite - Build tool
- Zustand - State management
- Tailwind CSS - Styling

---

**Made with 🔥 for developers who value privacy and performance**

Version 0.1.0 | December 2025

