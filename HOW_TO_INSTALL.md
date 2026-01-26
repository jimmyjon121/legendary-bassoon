# 🚀 DevForge Installation Guide

## Your App is Ready! 🎉

DevForge has been successfully built and packaged. Here's how to install it:

---

## 📦 Installation Files

You'll find these files in the `release` folder:

### **Recommended: Installer**
```
📁 release/
  └─ DevForge Setup 0.1.0.exe  ⬅️ USE THIS ONE!
```

**This is the full installer with:**
- ✅ Desktop shortcut creation
- ✅ Start Menu entry
- ✅ Proper uninstaller
- ✅ Auto-updates support (future)
- ✅ File associations

### **Alternative: Portable Version**
```
📁 release/
  └─ DevForge 0.1.0.exe
```

**Portable version:**
- ✅ No installation needed
- ✅ Run from USB drive
- ✅ Leaves no registry entries
- ❌ No shortcuts or file associations

---

## 🔧 Installation Steps

### Option 1: Full Install (Recommended)

1. **Navigate to the release folder:**
   ```
   C:\Users\molin\Downloads\devforge\release\
   ```

2. **Double-click:**
   ```
   DevForge Setup 0.1.0.exe
   ```

3. **Follow the installer:**
   - Choose installation location
   - Select "Create desktop shortcut" ✅
   - Click "Install"

4. **Launch DevForge:**
   - From Desktop shortcut, or
   - From Start Menu → DevForge

### Option 2: Portable

1. **Copy the portable exe** to any folder
2. **Double-click** `DevForge 0.1.0.exe`
3. **Done!** No installation needed

---

## 🎨 The Logo

A beautiful gradient logo has been created at:
```
assets/icon.svg
```

**Design features:**
- 🔥 Purple gradient background (developer vibes)
- ⚒️ Stylized "D" + anvil (forge theme)
- 🤖 Neural network nodes (AI theme)
- ✨ Animated sparks (active development)
- 🎨 Modern, professional look

---

## 🚀 First Launch

When you first open DevForge:

1. **Onboarding Wizard** will guide you through:
   - Installing Ollama (if needed)
   - Downloading your first AI model
   - Setting up preferences

2. **Or Skip Setup** and configure later

3. **Start Chatting!**

---

## 📍 Where Everything Is Stored

After installation, DevForge stores data in:

```
📁 C:\Users\molin\AppData\Roaming\devforge\
  ├─ devforge.db          (Your conversations)
  ├─ images\              (Generated images)
  └─ config.json          (Settings)
```

**Models location** (you choose during setup):
```
📁 C:\Users\molin\Documents\AI Models\
```

---

## 🎯 Quick Start

1. **Install Ollama** (if not already):
   - DevForge will guide you
   - Or download from: https://ollama.ai

2. **Find Models:**
   - Click the "Find" button in sidebar
   - Click "Scan System" to find existing models
   - Or download new ones through Ollama

3. **Start Chatting:**
   - Select a model from the dropdown
   - Type your message
   - Press Enter!

---

## 🔥 Key Features to Try

### 1. Model Finder
- Click "Find" button in sidebar
- Scan your system for AI models
- Import with Copy/Move/Reference options

### 2. Multiple Workspaces
- **Casual** - General chat
- **Work** - Professional tasks
- **Code** - Programming help
- **Private** - Encrypted workspace

### 3. Power Mode
- Click "Power Mode: OFF" in sidebar
- Optimizes your system for AI
- Maximizes performance

### 4. Hardware Monitor
- See real-time CPU/GPU/RAM usage
- Appears in sidebar when expanded

### 5. Image Generation
- Click "Images" button
- Generate AI art with Stable Diffusion
- Requires separate image model

---

## 🐛 Troubleshooting

### "Windows protected your PC" message?
This is normal for unsigned apps. Click "More info" → "Run anyway"

### Ollama not detected?
1. Install Ollama from https://ollama.ai
2. Restart DevForge
3. Check if `http://localhost:11434` works in browser

### Models not found?
1. Click "Find" button
2. Click "Scan System"
3. Or manually download via Ollama: `ollama pull llama3.2`

---

## 📝 What's Next?

### Distribute Your App
To share DevForge with others:

1. **Copy the installer:**
   ```
   release/DevForge Setup 0.1.0.exe
   ```

2. **Upload to:**
   - GitHub Releases
   - Your own website
   - Cloud storage (Google Drive, Dropbox)

3. **Share the link!**

### Sign Your App (Optional)
To remove the "unknown publisher" warning:

1. Get a code signing certificate
2. Add to `package.json`:
   ```json
   "win": {
     "certificateFile": "path/to/cert.pfx",
     "certificatePassword": "your-password"
   }
   ```
3. Rebuild: `npm run build`

---

## 🎉 Congratulations!

You now have a fully functional, packaged desktop AI application!

**DevForge** is ready to:
- ✅ Run AI models locally
- ✅ Protect your privacy
- ✅ Maximize your hardware
- ✅ Work offline
- ✅ Stay future-proof

---

## 📞 Need Help?

- Check `RELEASE.md` for full documentation
- Review the troubleshooting section above
- Explore the app's Settings for customization

**Enjoy your personal AI powerhouse! 🔥**

