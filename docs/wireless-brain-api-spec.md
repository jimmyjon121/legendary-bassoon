# Wireless Brain API Spec

Status: design-ready specification (no runtime implementation yet)
Date: February 19, 2026

## Scope

This API exposes a minimal remote surface for mobile access to a desktop DevForge node.

- Transport: HTTPS over Tailscale interface only
- Auth: device pairing + short-lived access token
- Default permissions: chat/inference allowed, mutating tools disabled

## Base URL

`https://<tailscale-node>:<port>/api/v1`

## Endpoint Summary

### Health

- `GET /health`
  - Response: `{ ok: true, nodeId, version, time }`

### Pairing

- `POST /pairing/start`
  - Request: `{ deviceName, platform, requestedScopes }`
  - Response: `{ pairingId, challenge, expiresAt }`

- `POST /pairing/complete`
  - Request: `{ pairingId, challengeResponse }`
  - Response: `{ accessToken, refreshToken, expiresIn, grantedScopes, deviceId }`

- `POST /pairing/revoke`
  - Request: `{ deviceId }`
  - Response: `{ success: true }`

### Session

- `POST /session/refresh`
  - Request: `{ refreshToken }`
  - Response: `{ accessToken, expiresIn }`

- `POST /session/logout`
  - Request: `{ refreshToken }`
  - Response: `{ success: true }`

### Chat

- `POST /chat/send`
  - Request: `{ workspace, conversationId?, model?, messages, stream?, options? }`
  - Response (non-stream): `{ messageId, response, model, citations?, usage }`
  - Response (stream): SSE chunks with `delta`, final `done`

### Memory (read-only by default)

- `GET /memory/context?conversationId=<id>&limit=<n>`
  - Response: `{ items: [...], total }`

### Research output handoff (read-only)

- `GET /research/context?limit=<n>`
  - Response: `{ items: [{ id, title, summary, citations, createdAt }] }`

### Audit

- `GET /audit/events?limit=<n>&cursor=<cursor>`
  - Response: `{ events: [...], nextCursor }`

## Error Model

All non-2xx responses:

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "requestId": "string"
  }
}
```

Common codes:

- `unauthorized`
- `forbidden_scope`
- `rate_limited`
- `network_binding_required`
- `service_unavailable`

## Rate Limits

Defaults per device:

- Chat send: 30 requests/minute
- Pairing attempts: 10/hour
- Refresh calls: 60/hour

## Permission Matrix (default)

- `chat:send`: enabled
- `memory:read`: enabled
- `research:read`: enabled
- `tools:mutate`: disabled
- `fs:read`: disabled
- `fs:write`: disabled

## Event/Audit Schema

Each request writes an audit record:

- `eventId`
- `requestId`
- `deviceId`
- `route`
- `scopesUsed`
- `result` (`allowed`/`denied`/`error`)
- `latencyMs`
- `ts`
