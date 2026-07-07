import { storeApiKey } from '../credentials.js';
import type { CredentialsDeps } from '../credentials.js';
import { ConfigError } from '../errors.js';
import { formatSetKeySuccess, printHuman, printJson } from '../output.js';
import { readApiKeyFromStdin } from '../read-api-key.js';

export interface SetKeyOptions {
  readInput?: () => Promise<string>;
  json?: boolean;
  credentialsDeps?: CredentialsDeps;
}

export async function runSetKey(options: SetKeyOptions): Promise<void> {
  const readInput = options.readInput ?? readApiKeyFromStdin;
  const apiKey = (await readInput()).trim();

  if (apiKey === '') {
    throw new ConfigError('API key cannot be empty');
  }

  const location = await storeApiKey(apiKey, options.credentialsDeps);

  if (options.json) {
    printJson({
      ok: true,
      stored_in: location,
    });
  } else {
    formatSetKeySuccess(location, false);
  }
}

export function printConfigUsage(): void {
  printHuman(`Usage: trigv config set-key [options]

Store a workspace API key securely (macOS Keychain or ~/.config/trigv/credentials).
Run interactively and enter the key at the hidden prompt (recommended).

Automation (piped stdin — avoid putting secrets in shell history):
  printf '%s' "$TRIGV_API_KEY" | trigv config set-key

Options:
  --json        Output JSON to stdout
  -h, --help    Show help`);
}
