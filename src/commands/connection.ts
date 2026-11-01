import { Trigv } from '../client.js';
import { resolveApiKey, missingApiKeyMessage } from '../credentials.js';
import type { CredentialsDeps } from '../credentials.js';
import { ConfigError } from '../errors.js';
import { formatConnectionSuccess, printHuman, printJson } from '../output.js';

export interface ConnectionOptions {
  baseUrl?: string;
  json?: boolean;
  credentialsDeps?: CredentialsDeps;
  fetch?: typeof fetch;
}

export async function runConnection(options: ConnectionOptions): Promise<void> {
  const apiKey = await resolveApiKey(options.credentialsDeps);
  if (!apiKey) {
    throw new ConfigError(missingApiKeyMessage());
  }

  const client = new Trigv({
    apiKey,
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    maxRetries: 2,
  });

  const result = await client.verifyConnection();

  if (options.json) {
    printJson({
      ok: true,
      workspace: result.workspace,
      api_key: result.api_key,
      ...(result.requestId ? { request_id: result.requestId } : {}),
    });
  } else {
    formatConnectionSuccess(result.workspace.name, false, result.requestId);
  }
}

export function printConnectionUsage(): void {
  printHuman(`Usage: trigv connection [options]

Verify the configured API key against GET /v1/connection.

Options:
  --base-url    API base URL override
  --json        Output JSON to stdout`);
}
