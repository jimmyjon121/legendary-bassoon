# Mosaic Coordinator

Rust `napi-rs` scaffold for Phase 3 Mosaic. The Electron app loads this
addon opportunistically through `electron/services/mosaic-coordinator.js`.

The JS facade remains the compatibility layer: if the native addon is not
built, DevForge still boots and normal LM Studio-quality workflows are
unchanged. Native execution is required only for the hidden Gate 2 runtime.

Build locally with:

```powershell
npm run build:native:mosaic
```

The build copies the platform library to `native/mosaic-coordinator/index.node`,
which is the stable path loaded by the Electron coordinator facade. The addon
does not implement custom tensor kernels; it probes the Gate 2 runner contract
and keeps llama.cpp as the execution path.
