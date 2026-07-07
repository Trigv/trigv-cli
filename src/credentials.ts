import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

export function writeKeychainDefault(apiKey: string): void {
  execFileSync(
    'security',
    ['add-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w', apiKey, '-U'],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
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

export async function writeCredentialsFile(path: string, apiKey: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const payload: CredentialsFile = { api_key: apiKey };
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
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
  await writeCredentialsFile(path, trimmed);
  return path;
}

export function missingApiKeyMessage(): string {
  return (
    'No API key found. Set TRIGV_API_KEY, run `trigv config set-key <key>`, ' +
    'or store a key in ~/.config/trigv/credentials.'
  );
}
