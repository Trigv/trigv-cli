import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readCredentialsFile,
  resolveApiKey,
  storeApiKey,
  writeCredentialsFile,
} from '../src/credentials.js';

describe('credentials', () => {
  const originalEnv = process.env.TRIGV_API_KEY;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.TRIGV_API_KEY;
    } else {
      process.env.TRIGV_API_KEY = originalEnv;
    }
  });

  it('prefers TRIGV_API_KEY env var', async () => {
    process.env.TRIGV_API_KEY = 'trgv_env_key_abcdefghijklmnopqrstuvwxyz1234';
    const key = await resolveApiKey({
      readKeychain: () => 'trgv_keychain',
      credentialsPath: '/tmp/should-not-read',
    });
    expect(key).toBe('trgv_env_key_abcdefghijklmnopqrstuvwxyz1234');
  });

  it('falls back to keychain when env is unset', async () => {
    delete process.env.TRIGV_API_KEY;
    const key = await resolveApiKey({
      readKeychain: () => 'trgv_keychain_key_abcdefghijklmnopqrstuvwxyz12',
      credentialsPath: '/tmp/should-not-read',
    });
    expect(key).toBe('trgv_keychain_key_abcdefghijklmnopqrstuvwxyz12');
  });

  it('reads credentials file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trigv-cli-'));
    const path = join(dir, 'credentials');
    await writeCredentialsFile(path, 'trgv_file_key_abcdefghijklmnopqrstuvwxyz12345');

    delete process.env.TRIGV_API_KEY;
    const key = await resolveApiKey({
      readKeychain: () => null,
      credentialsPath: path,
    });
    expect(key).toBe('trgv_file_key_abcdefghijklmnopqrstuvwxyz12345');
  });

  it('writes credentials file with mode 0600', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trigv-cli-'));
    const path = join(dir, 'nested', 'credentials');
    await writeCredentialsFile(path, 'trgv_stored_key_abcdefghijklmnopqrstuvwxyz1234');

    const content = await readCredentialsFile(path);
    expect(content).toBe('trgv_stored_key_abcdefghijklmnopqrstuvwxyz1234');

    const fileStat = await stat(path);
    expect(fileStat.mode & 0o777).toBe(0o600);

    const raw = await readFile(path, 'utf8');
    expect(JSON.parse(raw)).toEqual({ api_key: 'trgv_stored_key_abcdefghijklmnopqrstuvwxyz1234' });
  });

  it('stores to file when not on darwin', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trigv-cli-'));
    const path = join(dir, 'credentials');

    const location = await storeApiKey('trgv_new_key_abcdefghijklmnopqrstuvwxyz123456', {
      platformFn: () => 'linux',
      credentialsPath: path,
    });

    expect(location).toBe(path);
    expect(await readCredentialsFile(path)).toBe('trgv_new_key_abcdefghijklmnopqrstuvwxyz123456');
  });

  it('stores to keychain on darwin when available', async () => {
    const writeKeychain = vi.fn();
    const location = await storeApiKey('trgv_mac_key_abcdefghijklmnopqrstuvwxyz123456', {
      platformFn: () => 'darwin',
      writeKeychain,
    });

    expect(location).toBe('macOS Keychain');
    expect(writeKeychain).toHaveBeenCalledWith('trgv_mac_key_abcdefghijklmnopqrstuvwxyz123456');
  });
});
