# Model Selector Feature Inventory

This file is the no-removal contract for the catalogue-first selector overhaul.
Every current user-facing selector feature must remain reachable in the new UI.

| Current feature | Current location | New home |
| --- | --- | --- |
| Close selector | Header X, outside click, Escape | Same header X, outside click, Escape |
| Refresh all models | Header refresh button | Header refresh button plus per-source refresh status |
| Search models | Search field | Catalogue toolbar search, retained in Browse All |
| Quant filters | Q4, Q5, Q6, Q8, F16 chips | Catalogue filters and Browse All filters |
| Sort | Recent, Size, Name | Sort menu: Recommended, Recent, Size, Name, Speed |
| Agentic Research tab | All Models / Agentic Research toggle | Smart group and Browse All mode toggle |
| Research prioritization notice | Research workspace copy | Recommendation shelf reason trace |
| Vault notice | Vault workspace copy | Vault status badge and cache-only enrichment badge |
| Current model checkmark | Row checkmark | Variant row active state and Now shelf |
| Current model warnings | Top of list warning block | Now shelf warning area |
| Ollama model list | Ollama Models section | Browse All source section and grouped catalogue variants |
| Agentic chip | Ollama row chip | Capability badges and smart group labels |
| Code/Chat/Creative/Instruct chip | Ollama row chip | Capability badges on catalogue rows |
| GPU/NPU-ready chip | Ollama row chip | Runtime/source badge on each variant |
| Spec chip | Ollama row chip | Spec disclosure in row overflow/details |
| VRAM fit dot | Ollama row metadata | Fit bar and compact fit status |
| Size display | Ollama row metadata | Variant metadata and details drawer |
| Parameter size display | Ollama row metadata | Variant label and details drawer |
| Quantization display | Ollama row metadata | Variant label and quant filter |
| LM Studio scan | LM Studio section rescan button | Browse All source section and Add menu |
| LM Studio model use/register | LM Studio rows | Variant action and Browse All source rows |
| NPU/OpenVINO status | NPU section | Runtime group, Browse All NPU source section, Now shelf |
| NPU model selection/start server | NPU row action | Variant action and Browse All NPU source rows |
| Imported GGUF list | DevForge Imported Models section | Local variants and Browse All Imported section |
| Imported GGUF register/use | Imported row action | Variant action and Add menu |
| Footer counts | Footer | Footer source/status summary |
| Connection error display | Error block | State banner plus empty/offline recovery actions |
| Empty Ollama recovery | Refresh button | Start Ollama, Open Model Hub, Use local GGUF, Refresh |
| Direct local GGUF registration | `loadLocalGguf` path | Add menu and Browse All Imported section |
| Sort preference persistence | `modelSelectorPrefs.sort` | Same setting, extended with new sort values |
| Catalog hydration | Mount and refresh | Same store action, fixed for source-specific refresh |
