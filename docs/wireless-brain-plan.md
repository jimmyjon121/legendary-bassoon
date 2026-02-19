# DevForge Wireless Brain Plan

## 1. Goal
Build a personal AI "brain" that is:
- always available from desktop and phone
- local-first, low recurring cost
- durable across model upgrades and policy/law shifts
- secure enough to run continuously on home hardware

## 2. Current Target Machine
This plan uses two separate nodes with fixed roles:
- Desktop Brain Node (always-on server): your personal "forever" AI, reachable from phone
- Laptop NPU Node (daily driver): your work machine and local ChatGPT alternative during the day

## 3. Product Principle
Do not treat one model as "forever."
Treat **memory + tooling + orchestration** as forever, and swap models under that layer.

## 4. Wireless Brain Architecture
1. Desktop Brain Node (always-on)
   - DevForge app + local services
   - model runtimes focused on desktop GPU/RAM capacity
   - canonical personal memory DB
2. Laptop NPU Node (daily driver)
   - separate local runtime for work sessions
   - optimized for responsiveness and lower power while you actively use the laptop
   - optional access to desktop brain when needed, but not required for normal work flow
3. Secure Private Network
   - Tailscale overlay network for remote phone access
   - no public unauthenticated ports
4. Client Endpoints
   - local desktop UI
   - local laptop UI
   - mobile browser/PWA view over Tailscale
5. Backup Layer
   - scheduled encrypted backups of memory, settings, and model manifests

## 5. Runtime Strategy (NPU + GPU + CPU)
### Desktop Brain Node (server)
- Tier A (always loaded, fast): 7B/8B instruct model
- Tier B (quality mode): 14B instruct/coder model
- Tier C (deep-think mode): larger model on-demand only
- Device priority: GPU first, CPU/RAM fallback

### Laptop NPU Node (daily driver)
- Keep one efficient daily model tuned for NPU/GPU availability
- Use smaller/faster local models for active work sessions
- Treat this as sovereign local assistant mode while you are at work

### Cross-node behavior
- Phone requests always target the Desktop Brain Node
- Laptop usage should not be required to keep phone brain online
- Laptop can query desktop brain on demand, without merging all contexts by default

### Policy defaults
- Casual tab: offline/local-first
- Coding tab: offline/local-first
- Research tab: web-enabled (strict source policy)

## 6. Security Model
- Private network only (Tailscale), no raw public exposure
- Require authentication before any remote prompt execution
- Use least-privilege tool permissions by mode
- Log all mutating actions with execution IDs/checkpoints
- Keep secret storage local and encrypted

## 7. Reliability Model
- Auto-start services on boot
- Health monitor with restart backoff
- Stage checkpoints before risky operations
- Auto-rollback for failed code mutations
- Deterministic run metadata for debugging regressions

## 8. Persistence and Data Ownership
- Desktop brain has the canonical personal memory store (local DB)
- Laptop keeps separate local work memory by default
- Optional explicit "promote/sync" actions from laptop context to desktop brain memory
- Export format: JSON + SQLite snapshots
- Nightly backups + weekly integrity check restore drill
- Keep model identity/persona prompts under version control

## 9. "Dialed In" Build Plan
### Phase 1: Always-On Brain Baseline
- [ ] Configure desktop node as always-on brain service
- [ ] Confirm boot auto-start for DevForge and required desktop services
- [ ] Enforce network policy by mode (casual/code offline, research web-only)
- [ ] Set desktop default daily model (Tier A) and fallback model (Tier B)

### Phase 2: Secure Wireless Access
- [ ] Configure Tailscale on desktop brain node and phone
- [ ] Bind desktop remote endpoint to Tailscale interface only
- [ ] Add remote-session auth gate + idle timeout

### Phase 3: Laptop Daily Driver Profile
- [ ] Tune laptop NPU node for fast local work interactions
- [ ] Keep adaptive backend scoring enabled per node (GPU/NPU/CPU)
- [ ] Add explicit "use desktop brain" action from laptop when needed

### Phase 4: Durability and Recovery
- [ ] Nightly encrypted backups for desktop canonical memory and config
- [ ] Separate backup policy for laptop work context
- [ ] One-click restore validation flow
- [ ] Drift check: model/config mismatch alerts

## 10. Acceptance Criteria
- Remote phone session reaches desktop brain over private network with auth
- Desktop brain survives reboot and recovers services automatically
- Laptop remains responsive during active work and does not need to host phone traffic
- Daily desktop brain chat remains low-latency on Tier A model
- Research stays web-capable while other modes stay local-first
- Backup restore succeeds without data loss

## 11. Upgrade Triggers (Within Reason)
- Upgrade RAM before GPU if frequent context spills occur
- Upgrade GPU when Tier B latency is consistently unacceptable
- Keep NVMe headroom for model cache, logs, and backup rotation

## 12. North Star
The forever asset is your **AI continuity**:
- memory
- preferences
- workflows
- safety rules
- provenance

Models change. Your brain does not.
