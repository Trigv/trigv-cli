import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigError } from '../src/errors.js';
import {
  type SpawnSyncFn,
  readCredentialsFile,
  resolveApiKey,
  storeApiKey,
  writeCredentialsFile,
  writeKeychainDefault,
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

  describe('writeKeychainDefault', () => {
    const KEY = 'trgv_secret_key_abcdefghijklmnopqrstuvwxyz1234';
    const KEY_HEX = Buffer.from(KEY, 'utf8').toString('hex');

    function okSpawn() {
      return vi.fn<SpawnSyncFn>(() => ({ status: 0, stderr: '' }));
    }

    it('keeps the key out of argv and env and sends it only on stdin', () => {
      const spawn = okSpawn();
      writeKeychainDefault(KEY, spawn);

      expect(spawn).toHaveBeenCalledTimes(1);
      const [command, args, options] = spawn.mock.calls[0];
      expect(command).toBe('security');
      expect(args).toEqual(['-i']);
      for (const arg of args) {
        expect(arg).not.toContain(KEY);
        expect(arg).not.toContain(KEY_HEX);
      }
      expect(Object.keys(options)).not.toContain('env');
      expect(options.stdio[0]).toBe('pipe');
      expect(options.input).toContain(KEY_HEX);
      expect(options.input).not.toContain(KEY);
      expect(options.input).toBe(`add-generic-password -s trigv-cli -a api-key -X ${KEY_HEX} -U\n`);
    });

    it('updates an existing item with -U on a second write', () => {
      const spawn = okSpawn();
      const second = 'trgv_new_key_abcdefghijklmnopqrstuvwxyz123456';
      writeKeychainDefault(KEY, spawn);
      writeKeychainDefault(second, spawn);

      expect(spawn).toHaveBeenCalledTimes(2);
      for (const call of spawn.mock.calls) {
        expect(call[2].input).toMatch(/ -U\n$/);
        expect(call[1]).toEqual(['-i']);
      }
      expect(spawn.mock.calls[1][2].input).toContain(Buffer.from(second).toString('hex'));
    });

    it('throws a message without the key when the process cannot start', () => {
      const spawn = vi.fn<SpawnSyncFn>(() => ({
        status: null,
        error: Object.assign(new Error(`spawn security ENOENT ${KEY} ${KEY_HEX}`), {
          code: 'ENOENT',
        }),
      }));

      let message = '';
      try {
        writeKeychainDefault(KEY, spawn);
      } catch (error) {
        message = String(error);
      }
      expect(message).toContain('ENOENT');
      expect(message).not.toContain(KEY);
      expect(message).not.toContain(KEY_HEX);
    });

    it('throws a message without the key when security exits non-zero', () => {
      const spawn = vi.fn<SpawnSyncFn>(() => ({
        status: 2,
        stderr: `add-generic-password: returned 2 ${KEY}`,
      }));

      let message = '';
      try {
        writeKeychainDefault(KEY, spawn);
      } catch (error) {
        message = String(error);
      }
      expect(message).toContain('exit code 2');
      expect(message).not.toContain(KEY);
      expect(message).not.toContain(KEY_HEX);
    });

    it('reports a signal kill without the key', () => {
      const spawn = vi.fn<SpawnSyncFn>(() => ({ status: null, signal: 'SIGKILL' }));
      expect(() => writeKeychainDefault(KEY, spawn)).toThrow(/SIGKILL/);
    });

    it('falls back to the credentials file when the keychain write fails on darwin', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'trigv-cli-'));
      const path = join(dir, 'credentials');
      const location = await storeApiKey(KEY, {
        platformFn: () => 'darwin',
        writeKeychain: (apiKey) => writeKeychainDefault(apiKey, () => ({ status: 1 })),
        credentialsPath: path,
      });
      expect(location).toBe(path);
      expect(await readCredentialsFile(path)).toBe(KEY);
    });
  });
});
