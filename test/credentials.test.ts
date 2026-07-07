import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigError } from '../src/errors.js';
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

  it('tightens permissions on an existing credentials file', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const dir = await mkdtemp(join(tmpdir(), 'trigv-cli-'));
    const path = join(dir, 'credentials');
    await writeFile(path, '{"api_key":"old"}\n', { mode: 0o644 });
    await chmod(path, 0o644);

    await writeCredentialsFile(path, 'trgv_stored_key_abcdefghijklmnopqrstuvwxyz1234');

    const fileStat = await stat(path);
    expect(fileStat.mode & 0o777).toBe(0o600);
    expect(await readCredentialsFile(path)).toBe('trgv_stored_key_abcdefghijklmnopqrstuvwxyz1234');
  });

  it('writes credentials file with mode 0600', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trigv-cli-'));
    const path = join(dir, 'nested', 'credentials');
    await writeCredentialsFile(path, 'trgv_stored_key_abcdefghijklmnopqrstuvwxyz1234');

    const content = await readCredentialsFile(path);
    expect(content).toBe('trgv_stored_key_abcdefghijklmnopqrstuvwxyz1234');

    if (process.platform !== 'win32') {
      const fileStat = await stat(path);
      expect(fileStat.mode & 0o777).toBe(0o600);
      const dirStat = await stat(join(dir, 'nested'));
      expect(dirStat.mode & 0o777).toBe(0o700);
    }

    const raw = await readFile(path, 'utf8');
    expect(JSON.parse(raw)).toEqual({ api_key: 'trgv_stored_key_abcdefghijklmnopqrstuvwxyz1234' });
  });

  it('fails when directory chmod fails on POSIX', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trigv-cli-'));
    const path = join(dir, 'credentials');

    await expect(
      writeCredentialsFile(path, 'trgv_stored_key_abcdefghijklmnopqrstuvwxyz1234', {
        platformFn: () => 'linux',
        chmodFn: async (_target, mode) => {
          if (mode === 0o700) {
            throw new Error('chmod denied');
          }
        },
      }),
    ).rejects.toThrow(ConfigError);
  });

  it('fails when credentials file chmod fails on POSIX', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trigv-cli-'));
    const path = join(dir, 'credentials');

    await expect(
      writeCredentialsFile(path, 'trgv_stored_key_abcdefghijklmnopqrstuvwxyz1234', {
        platformFn: () => 'linux',
        chmodFn: async (_target, mode) => {
          if (mode === 0o600) {
            throw new Error('chmod denied');
          }
        },
      }),
    ).rejects.toThrow(ConfigError);
  });

  it('skips chmod on Windows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trigv-cli-'));
    const path = join(dir, 'credentials');
    const chmodFn = vi.fn(async () => {
      throw new Error('chmod should not run on Windows');
    });

    await writeCredentialsFile(path, 'trgv_stored_key_abcdefghijklmnopqrstuvwxyz1234', {
      platformFn: () => 'win32',
      chmodFn,
    });

    expect(chmodFn).not.toHaveBeenCalled();
    expect(await readCredentialsFile(path)).toBe('trgv_stored_key_abcdefghijklmnopqrstuvwxyz1234');
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
