import { storeApiKey } from '../credentials.js';
import type { CredentialsDeps } from '../credentials.js';
import { ConfigError } from '../errors.js';
import { formatSetKeySuccess, printHuman, printJson } from '../output.js';

export interface SetKeyOptions {
  apiKey?: string;
  json?: boolean;
  credentialsDeps?: CredentialsDeps;
}

export async function runSetKey(options: SetKeyOptions): Promise<void> {
  if (!options.apiKey || options.apiKey.trim() === '') {
    throw new ConfigError('API key argument is required');
  }

  const location = await storeApiKey(options.apiKey, options.credentialsDeps);

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
  printHuman(`Usage: trigv config set-key <api-key> [options]

Store a workspace API key securely (macOS Keychain or ~/.config/trigv/credentials).

Options:
  --json        Output JSON to stdout`);
}
