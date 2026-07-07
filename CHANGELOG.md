# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-07

### Added

- Initial release of `@trigv/cli` (`trigv` binary)
- `trigv send` — send events from the shell with flags
- `trigv connection` — verify API key via GET `/v1/connection`
- `trigv config set-key` — store API key (env, macOS Keychain, or `~/.config/trigv/credentials`)
- `--json` output and structured exit codes for scripting
