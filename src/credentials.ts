import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE } from './constants.js';
import { ConfigError } from './errors.js';
import type { CredentialsFile } from './types.js';

export interface CredentialsDeps {
  homedirFn?: () => string;
  platformFn?: () => NodeJS.Platform;
  readKeychain?: () => string | null;
  writeKeychain?: (apiKey: string) => void;
  credentialsPath?: string;
  chmodFn?: (path: string, mode: number) => Promise<void>;
}

function defaultCredentialsPath(home: string): string {
  return join(home, '.config', 'trigv', 'credentials');
}

export function readKeychainDefault(): string | null {
  if (platform() !== 'darwin') {
    return null;
  }
  try {
    const result = execFileSync(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const value = result.trim();
    return value === '' ? null : value;
  } catch {
    return null;
  }
}

export type SpawnSyncFn = (
  command: string,
  args: string[],
  options: { input: string; encoding: 'utf8'; stdio: ['pipe', 'pipe', 'pipe'] },
) => {
  status: number | null;
  signal?: NodeJS.Signals | null;
  error?: Error;
  stderr?: string | null;
};

/**
 * Stores the key in the macOS Keychain without putting it in the argument list
 * or environment of any process (`ps` can show both). The command goes to
 * `security -i` on stdin, and the key is sent as hex (`-X`), so it needs no quoting.
 */
export function writeKeychainDefault(apiKey: string, spawnFn: SpawnSyncFn = spawnSync): void {
  const hex = Buffer.from(apiKey, 'utf8').toString('hex');
  const command = `add-generic-password -s ${KEYCHAIN_SERVICE} -a ${KEYCHAIN_ACCOUNT} -X ${hex} -U\n`;

  const result = spawnFn('security', ['-i'], {
    input: command,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (result.error) {
    // Only the error code is reported, never text that could echo the command.
    const code = (result.error as NodeJS.ErrnoException).code;
    throw new Error(`Could not run the security command${code ? ` (${code})` : ''}`);
  }
  if (result.status !== 0) {
    const reason =
      result.status === null ? `signal ${String(result.signal)}` : `exit code ${result.status}`;
    throw new Error(`The security command failed (${reason})`);
  }
}

export async function readCredentialsFile(path: string): Promise<string | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as CredentialsFile;
    if (typeof parsed.api_key === 'string' && parsed.api_key.trim() !== '') {
      return parsed.api_key.trim();
    }
    return null;
  } catch {
    return null;
  }
}

async function restrictMode(
  path: string,
  mode: number,
  deps: Pick<CredentialsDeps, 'platformFn' | 'chmodFn'>,
): Promise<void> {
  const platformName = deps.platformFn?.() ?? platform();
  if (platformName === 'win32') {
    return;
  }

  const chmodImpl = deps.chmodFn ?? chmod;
  try {
    await chmodImpl(path, mode);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Failed to secure credentials at ${path}: ${detail}`);
  }
}

export async function writeCredentialsFile(
  path: string,
  apiKey: string,
  deps: Pick<CredentialsDeps, 'platformFn' | 'chmodFn'> = {},
): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await restrictMode(dir, 0o700, deps);
  const payload: CredentialsFile = { api_key: apiKey };
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await restrictMode(path, 0o600, deps);
}

export async function resolveApiKey(deps: CredentialsDeps = {}): Promise<string | null> {
  const envKey = process.env.TRIGV_API_KEY?.trim();
  if (envKey) {
    return envKey;
  }

  const readKeychain = deps.readKeychain ?? readKeychainDefault;
  const keychainKey = readKeychain();
  if (keychainKey) {
    return keychainKey;
  }

  const home = deps.homedirFn?.() ?? homedir();
  const path = deps.credentialsPath ?? defaultCredentialsPath(home);
  return readCredentialsFile(path);
}

export async function storeApiKey(apiKey: string, deps: CredentialsDeps = {}): Promise<string> {
  const trimmed = apiKey.trim();
  if (trimmed === '') {
    throw new ConfigError('API key cannot be empty');
  }

  const platformFn = deps.platformFn ?? platform;
  const writeKeychain = deps.writeKeychain ?? writeKeychainDefault;

  if (platformFn() === 'darwin') {
    try {
      writeKeychain(trimmed);
      return 'macOS Keychain';
    } catch {
      // fall through to file storage
    }
  }

  const home = deps.homedirFn?.() ?? homedir();
  const path = deps.credentialsPath ?? defaultCredentialsPath(home);
  await writeCredentialsFile(path, trimmed, deps);
  return path;
}

export function missingApiKeyMessage(): string {
  return (
    'No API key found. Set TRIGV_API_KEY, run `trigv config set-key`, ' +
    'or store a key in ~/.config/trigv/credentials.'
  );
}
