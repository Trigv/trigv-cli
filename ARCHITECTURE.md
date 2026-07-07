# trigv-cli — Architecture

> **Version:** 0.1.0  
> **API contract:** [Trigv OpenAPI](https://api.trigv.com/openapi.yaml) · [API reference](https://github.com/Trigv/platform/blob/main/_docs/trigv-api-reference.md)

---

## Purpose

`@trigv/cli` is the official command-line interface for Trigv workspace ingest. It wraps the same two API endpoints as the SDKs:

- `POST /v1/events` — send a notification event
- `GET /v1/connection` — verify API key (no side effects)

The CLI targets shell scripts, cron jobs, and CI pipelines where a library dependency is unnecessary.

---

## Language and runtime: TypeScript on Node.js

| Option | Verdict |
|--------|---------|
| **TypeScript / Node.js** | **Chosen.** Matches `trigv-node` (`@trigv/sdk`), shares validation rules and HTTP semantics, ships as a single `npm install -g @trigv/cli` binary. Node 18+ is already present in most CI and developer environments. |
| Python (`click` / `typer`) | Strong for scripting ecosystems, but duplicates HTTP client logic already implemented in `trigv-python`. Cross-repo drift risk. |
| Go (`cobra`) | Excellent single-binary distribution, but the programme already standardises on per-language SDKs; Go module would be a fourth HTTP implementation to maintain. |
| Rust (`clap`) | Same distribution advantage as Go; higher implementation cost for a thin HTTP wrapper. |

**Node.js version:** `>=18` (native `fetch`, `node:util` `parseArgs`, ESM).

---

## Dependency on `@trigv/sdk`

| Approach | Verdict |
|----------|---------|
| **Inline minimal HTTP client** | **Chosen.** Copy the proven patterns from `trigv-node/src/` (client, validation, errors, constants). Avoids an unpublished npm dependency and keeps the CLI self-contained. Behaviour stays aligned by sharing the same contract tests and validation rules. |
| `file:../trigv-node` local path | Works in monorepo dev, breaks when repos are checked out independently. |
| `@trigv/sdk` npm dependency | Correct long-term, but package is not published yet; would block standalone installs. |

The inline client is intentionally thin (~200 lines): fetch wrapper, retry policy, error mapping, and client-side validation — identical semantics to `@trigv/sdk`.

---

## Package layout

```
trigv-cli/
├── ARCHITECTURE.md
├── README.md
├── LICENSE
├── package.json          # name: @trigv/cli, bin: trigv
├── src/
│   ├── cli.ts            # argv routing, exit codes
│   ├── client.ts         # HTTP transport (from trigv-node pattern)
│   ├── validation.ts
│   ├── errors.ts
│   ├── types.ts
│   ├── constants.ts
│   ├── credentials.ts    # API key resolution and secure storage
│   ├── output.ts         # human vs --json formatting
│   └── exit-codes.ts
├── test/
│   ├── cli.test.ts
│   ├── client.test.ts
│   └── credentials.test.ts
└── .github/workflows/ci.yml
```

Build with `tsup` (same as `trigv-node`). Binary entry: `dist/cli.js` with shebang.

---

## Commands

| Command | API call | Required args |
|---------|----------|---------------|
| `trigv send` | `POST /v1/events` | `--channel`, `--title` |
| `trigv connection` | `GET /v1/connection` | — |
| `trigv config set-key` | — (local only) | API key via stdin or hidden prompt |

### `trigv send` flags

| Flag | Maps to JSON field |
|------|-------------------|
| `--channel` | `channel` |
| `--title` | `title` |
| `--description` | `description` |
| `--level` | `level` |
| `--delivery-urgency` | `delivery_urgency` |
| `--event-type` | `event_type` |
| `--image-url` | `image_url` |
| `--idempotency-key` | `idempotency_key` |

Global flags: `--json`, `--base-url` (override default `https://api.trigv.com/api`).

Kebab-case flags map to snake_case JSON fields per SDK spec.

---

## API key resolution

Priority (first match wins):

1. `TRIGV_API_KEY` environment variable
2. macOS Keychain (`security find-generic-password`, service `trigv-cli`)
3. `~/.config/trigv/credentials` (JSON, mode `0600`)

`trigv config set-key` writes to Keychain on macOS, otherwise the credentials file.

Keys are never logged, printed in errors, or included in `--json` output.

---

## Exit codes

| Code | Meaning | Examples |
|------|---------|----------|
| `0` | Success | Event sent, connection verified, key stored |
| `1` | Validation / usage | Missing `--channel`, invalid `--level`, unknown subcommand |
| `2` | Auth / config missing | No API key in env, keychain, or credentials file |
| `3` | API error | HTTP 401/403/404/422/429/5xx, network failure, timeout |

Client-side `ValidationError` → exit `1`. Server-side 422 → exit `3` (API rejected payload).

---

## Output modes

**Default (human):** concise one-line success messages on stderr; errors on stderr.

**`--json`:** structured JSON on stdout for scripting:

```json
// send success
{"ok": true, "event": { ... }, "duplicate": false}

// connection success
{"ok": true, "workspace": { ... }, "api_key": { ... }}

// error
{"ok": false, "error": "channel is required", "code": "validation"}
```

---

## Retry policy

Identical to SDK spec and `trigv-node`:

- Max 2 retries (3 attempts total)
- Exponential backoff with jitter
- Retry on network, timeout, 429 (burst only), 502/503/504
- POST without `idempotency_key`: no retry on ambiguous failure
- POST with `idempotency_key`: safe to retry

---

## User-Agent

`trigv-cli/0.1.0` — distinct from `trigv-node/1.0.0` for server-side analytics.

---

## Testing

Vitest with mocked `fetch` (client tests) and subprocess invocation of the built CLI (integration-style command tests). No live API key in CI.

Coverage targets:

- Minimum and full event send
- Each validation path and exit code
- Credential file read/write with temp directories
- `--json` output shape
- `TRIGV_API_KEY` env override

---

## CI

GitHub Actions: lint, format check, typecheck, test, build — Node 18/20/22 matrix (matches `trigv-node`).

---

## Out of scope

- Sanctum / dashboard routes
- Channel or device management
- Interactive TUI or login flow
- Publishing to npm (programme phase — not yet released)
