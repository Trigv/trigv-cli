# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-01

### Changed

- Default API URL is now `https://api.trigv.com`; paths are `/v1/events` and `/v1/connection`. A `--base-url` ending in `/api` keeps working.
- `public_id` values are 26 character ULIDs (no `evt_` prefix).
- Rate limit is 60 requests per minute per workspace.
- Invalid JSON bodies return 422.

### Added

- Typed 409 (`conflict`) and 503 (`service_unavailable`) errors, retried with `Retry-After` when `--idempotency-key` is set.
- Errors show the `X-Request-ID` (human output) and `request_id` (`--json` output).
- When `Retry-After` is longer than the request timeout, the original 409, 429 or 503 error is thrown at once instead of waiting.

### Removed

- Monthly event cap handling.

### Deprecated

- `RateLimitError.retryable` (always `true`) and `isMonthlyLimitMessage` (always `false`) are kept as deprecated aliases for compatibility. The old `RateLimitError(message, retryable, retryAfterMs)` argument order still works. Both will be removed in the next major version.

## [0.1.0] - 2026-07-07

### Added

- Initial release of `@trigv/cli` (`trigv` binary)
- `trigv send` — send events from the shell with flags
- `trigv connection` — verify API key via GET `/v1/connection`
- `trigv config set-key` — store API key (env, macOS Keychain, or `~/.config/trigv/credentials`); key read from stdin or hidden prompt

### Fixed

- Reject invalid `maxRetries` and `timeout` in the HTTP client
- Validate string max lengths by Unicode code point (not UTF-16 code units)
- Honour `Retry-After` on retryable HTTP 429 responses
- Tighten credentials file permissions with `chmod` after every write (POSIX)
- Strict CLI argument parsing (reject unknown flags and extra positionals)
- `trigv config set-key` reads API key from stdin or hidden prompt (not positional argument)
- Credential `chmod` failures on POSIX fail storage instead of being silently ignored
- TTY hidden input handles pasted multi-character chunks; no echoing readline fallback
- `config set-key` accepts only `--json` and `--help` (rejects `--base-url`)
- `--json` output and structured exit codes for scripting
