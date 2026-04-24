# Wireless Brain Threat Model

Status: design-ready specification (no runtime implementation yet)
Date: February 19, 2026

## Assets

- Conversation history
- Memory context
- Research outputs and citations
- Local model/runtime controls
- Device auth tokens

## Attackers

- Opportunistic network scanner
- Compromised paired device
- Local malware on desktop node
- Replay attacker with stolen refresh token

## Entry Points

- Remote API endpoints (`/api/v1/*`)
- Pairing flow
- Token refresh endpoint
- Any remote tool execution path

## Key Threats and Mitigations

### 1. Untrusted network exposure

Threat:
- API accidentally bound to all interfaces.

Mitigations:
- bind server to Tailscale interface only
- startup self-check blocks service if binding is non-compliant
- explicit `network_binding_required` error when policy violated

### 2. Token theft/replay

Threat:
- refresh token replay from another device.

Mitigations:
- rotating refresh tokens
- reuse detection and immediate session revocation
- short access token TTL

### 3. Privilege escalation via remote tools

Threat:
- remote client triggers local file/command mutation.

Mitigations:
- mutating scopes off by default
- explicit per-device permission grants
- hard deny for high-risk scopes unless local approval is active

### 4. Brute-force pairing attempts

Threat:
- repeated challenge guessing.

Mitigations:
- pairing rate limits
- short challenge expiry
- lockout cooldown after repeated failures

### 5. Data overexposure in remote responses

Threat:
- remote responses leak broader local context than intended.

Mitigations:
- strict request scoping by workspace
- redact sensitive metadata by default
- response-size and field allowlists per endpoint

### 6. Compromised device remains trusted

Threat:
- lost phone keeps long-lived access.

Mitigations:
- one-click device revocation
- inactivity-based session expiry
- audit alerts for unusual geo/time usage

## Logging and Audit

Every remote request should record:

- request id
- device id
- route
- scopes used
- allow/deny decision
- reason code
- latency and timestamp

Logs are local-only and exportable for debugging.

## Residual Risks

- Desktop compromise can bypass local controls.
- Misconfiguration of Tailscale ACLs can widen access.
- User-approved high-risk scopes can still cause intentional destructive actions.

## Security Gate for implementation phase

Remote implementation should be blocked from release unless:

- tailscale-only bind checks pass
- pairing replay tests pass
- scope-denial tests pass
- revocation tests pass
- audit-event completeness tests pass
