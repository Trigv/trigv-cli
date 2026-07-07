# @trigv/cli

Official Trigv command-line interface. Send notification events from shell scripts, cron jobs, and CI pipelines.

## What Trigv is

Trigv delivers developer notifications to your team's devices. Your backend sends lightweight JSON events; Trigv queues push delivery. Notification title and body are not stored on Trigv servers — metadata only.

## Installation

```bash
npm install -g @trigv/cli
```

Or run without installing:

```bash
npx @trigv/cli send --channel general --title "Hello"
```

## Quick start

```bash
export TRIGV_API_KEY="trgv_your_api_key"

trigv send \
  --channel general \
  --title "Deploy finished" \
  --description "Build #42 succeeded in 38s"
```

## Authentication

Create a workspace API key at [app.trigv.com](https://app.trigv.com). Keys look like `trgv_xxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.

**Resolution order:**

1. `TRIGV_API_KEY` environment variable
2. macOS Keychain (when available)
3. `~/.config/trigv/credentials` (mode `0600`)

Store a key locally (recommended — interactive hidden prompt):

```bash
trigv config set-key
```

For automation, pipe from an environment variable (avoids putting the secret in shell history):

```bash
printf '%s' "$TRIGV_API_KEY" | trigv config set-key
```

Verify the key:

```bash
trigv connection
```

## Sending an event

```bash
trigv send --channel general --title "Cron job failed" --level error
```

### Event options

| Flag | Description |
|------|-------------|
| `--channel` | Channel slug (required) |
| `--title` | Notification title (required) |
| `--description` | Body text |
| `--image-url` | HTTPS image URL (not stored server-side) |
| `--level` | `info`, `success`, `warning`, `error` (default: `info`) |
| `--delivery-urgency` | `standard` or `time_sensitive` (default: `standard`) |
| `--event-type` | Free-form label (e.g. `deploy.completed`) |
| `--idempotency-key` | Dedup key per workspace |

### Canonical example

```bash
trigv send \
  --channel deploys \
  --title "Production deploy complete" \
  --description "Build #42 succeeded in 38s (commit abc1234)" \
  --level success \
  --delivery-urgency standard \
  --event-type deploy.completed \
  --idempotency-key deploy-prod-42
```

## Levels

- `info` — general information (default)
- `success` — completed successfully
- `warning` — attention needed
- `error` — failure or alert

## Delivery urgency

- `standard` — normal notifications (default)
- `time_sensitive` — iOS Time Sensitive delivery (requires user permission)

## Idempotency

When you set `--idempotency-key`, retries with the same key return the existing event without billing again.

```bash
trigv send \
  --channel deploys \
  --title "Production deploy complete" \
  --idempotency-key deploy-prod-42
```

## JSON output

Add `--json` for machine-readable output on stdout:

```bash
trigv send --channel general --title "Hello" --json
```

```json
{"ok":true,"event":{"public_id":"evt_…","status":"queued",...},"duplicate":false}
```

Errors also return JSON when `--json` is set:

```json
{"ok":false,"error":"Channel not found.","code":"not_found","status_code":404}
```

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Validation or usage error |
| `2` | Missing API key / config |
| `3` | API or network error |

## Configuration

| Flag / env | Default | Description |
|------------|---------|-------------|
| `TRIGV_API_KEY` | — | Workspace API key |
| `--base-url` | `https://api.trigv.com/api` | API base URL (local: `http://trigv-platform.test/api`) |

## Examples

### Cron job failure

```bash
trigv send \
  --channel ops \
  --title "Nightly backup failed" \
  --description "Exit code 1 on db-backup.sh" \
  --level error \
  --event-type cron.failed
```

### CI pipeline

```bash
trigv send \
  --channel deploys \
  --title "CI build failed" \
  --level error \
  --event-type ci.failed \
  --idempotency-key "ci-${GITHUB_RUN_ID}"
```

## Development

```bash
npm install
npm run build
npm test
npm run lint
```

## Testing

```bash
npm test
```

Tests use mocked HTTP — no live API key required.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for language choice, credential storage, and HTTP client design.

## Contributing

Contributions welcome. Please open an issue before large changes.

## Licence

MIT
