# Wireless Brain Auth Model

Status: design-ready specification (no runtime implementation yet)
Date: February 19, 2026

## Goals

- Strong device identity
- Revocable access
- Short token lifetime
- Local-first secrets handling

## Trust Boundaries

- Desktop node is source of truth
- Mobile client is untrusted until paired
- Network transport trusted only on Tailscale interface

## Pairing Flow

1. User opens desktop node and enables pairing mode.
2. Mobile app calls `POST /pairing/start` with device metadata.
3. Desktop shows pairing challenge (code/QR/approval prompt).
4. Mobile submits `POST /pairing/complete` with challenge response.
5. Server returns:
   - short-lived access token (JWT or opaque token)
   - rotating refresh token
   - granted scopes
6. Pairing record stored locally with device fingerprint and last seen timestamp.

## Token Strategy

- Access token TTL: 15 minutes
- Refresh token TTL: 30 days
- Refresh token rotation: required on each refresh
- Token reuse detection: invalidate device session if old refresh token is replayed

## Claims / Session Fields

- `deviceId`
- `nodeId`
- `scopes`
- `issuedAt`
- `expiresAt`
- `sessionId`

## Revocation

Revocation triggers:

- user removes device
- suspicious token replay
- repeated auth failures
- manual emergency lock

Revocation effects:

- invalidate active access/refresh tokens
- deny subsequent requests
- append audit event with reason code

## Scope Defaults

Default scopes granted after pairing:

- `chat:send`
- `memory:read`
- `research:read`

Not granted by default:

- `tools:mutate`
- `fs:read`
- `fs:write`
- `admin:*`

## Secure Storage

Desktop node stores:

- token signing keys in local secure store (or encrypted file fallback)
- device session table in local DB
- scope grants and revocation history

Mobile stores:

- refresh token in OS secure keystore
- access token in memory only when possible

## Failure Modes

- Expired access token: return `401 unauthorized`
- Invalid refresh token: return `401 unauthorized` and require re-pairing
- Scope violation: return `403 forbidden_scope`
- Tailscale binding mismatch: return `403 network_binding_required`
