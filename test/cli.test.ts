import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapErrorToExitCode, run } from '../src/cli.js';
import { AuthenticationError, ConfigError, NotFoundError, ValidationError } from '../src/errors.js';
import { EXIT_API, EXIT_CONFIG, EXIT_SUCCESS, EXIT_VALIDATION } from '../src/exit-codes.js';

const API_KEY = 'trgv_testkey1_abcdefghijklmnopqrstuvwxyz123456';

const sampleEvent = {
  public_id: 'evt_abc',
  event_uuid: '550e8400-e29b-41d4-a716-446655440000',
  status: 'queued',
  level: 'info',
  event_type: null,
  target_device_count: 1,
  received_at: '2026-06-16T12:00:00+00:00',
};

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    return handler(url, init);
  }) as typeof fetch;
}

describe('mapErrorToExitCode', () => {
  it('maps config errors to exit 2', () => {
    expect(mapErrorToExitCode(new ConfigError('missing key'))).toBe(EXIT_CONFIG);
  });

  it('maps client validation to exit 1', () => {
    expect(mapErrorToExitCode(new ValidationError('bad', {}, true))).toBe(EXIT_VALIDATION);
  });

  it('maps server validation to exit 3', () => {
    expect(mapErrorToExitCode(new ValidationError('bad', { channel: ['x'] }, false))).toBe(
      EXIT_API,
    );
  });

  it('maps auth errors to exit 3', () => {
    expect(mapErrorToExitCode(new AuthenticationError('Unauthorized'))).toBe(EXIT_API);
  });
});

describe('CLI run()', () => {
  const originalEnv = process.env.TRIGV_API_KEY;
  const stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  afterEach(() => {
    stdoutSpy.mockClear();
    stderrSpy.mockClear();
    if (originalEnv === undefined) {
      delete process.env.TRIGV_API_KEY;
    } else {
      process.env.TRIGV_API_KEY = originalEnv;
    }
  });

  it('returns validation exit for missing send flags', async () => {
    process.env.TRIGV_API_KEY = API_KEY;
    const code = await run(['node', 'trigv', 'send', '--channel', 'general']);
    expect(code).toBe(EXIT_VALIDATION);
  });

  it('returns config exit when API key is missing', async () => {
    delete process.env.TRIGV_API_KEY;
    const code = await run(['node', 'trigv', 'connection']);
    expect(code).toBe(EXIT_CONFIG);
  });

  it('sends event with --json output', async () => {
    process.env.TRIGV_API_KEY = API_KEY;

    const fetch = mockFetch(
      () => new Response(JSON.stringify({ event: sampleEvent }), { status: 202 }),
    );

    const { runSend } = await import('../src/commands/send.js');
    await runSend({
      channel: 'general',
      title: 'Hello',
      json: true,
      fetch,
      credentialsDeps: {
        readKeychain: () => API_KEY,
      },
    });

    expect(stdoutSpy).toHaveBeenCalled();
    const output = JSON.parse(String(stdoutSpy.mock.calls.at(-1)?.[0]));
    expect(output.ok).toBe(true);
    expect(output.event.public_id).toBe('evt_abc');
  });

  it('verifies connection', async () => {
    process.env.TRIGV_API_KEY = API_KEY;

    const fetch = mockFetch((url) => {
      expect(url).toContain('/v1/connection');
      return new Response(
        JSON.stringify({
          workspace: { public_id: 'ws_1', name: 'Test' },
          api_key: { public_id: 'key_1', name: 'Default', prefix: 'trgv_testkey1' },
        }),
        { status: 200 },
      );
    });

    const { runConnection } = await import('../src/commands/connection.js');
    await runConnection({
      json: true,
      fetch,
      credentialsDeps: { readKeychain: () => API_KEY },
    });

    const output = JSON.parse(String(stdoutSpy.mock.calls.at(-1)?.[0]));
    expect(output.workspace.name).toBe('Test');
  });

  it('stores API key to credentials file', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'trigv-cli-run-'));
    const credPath = join(dir, 'credentials');

    const { runSetKey } = await import('../src/commands/config.js');
    await runSetKey({
      readInput: async () => API_KEY,
      json: true,
      credentialsDeps: {
        platformFn: () => 'linux',
        credentialsPath: credPath,
      },
    });

    const output = JSON.parse(String(stdoutSpy.mock.calls.at(-1)?.[0]));
    expect(output.ok).toBe(true);
    expect(output.stored_in).toBe(credPath);
    expect(JSON.stringify(output)).not.toContain(API_KEY);
  });

  it('returns API exit on 404', async () => {
    process.env.TRIGV_API_KEY = API_KEY;

    const fetch = mockFetch(
      () => new Response(JSON.stringify({ message: 'Channel not found.' }), { status: 404 }),
    );

    const { runSend } = await import('../src/commands/send.js');
    await expect(
      runSend({
        channel: 'missing',
        title: 'x',
        fetch,
        credentialsDeps: { readKeychain: () => API_KEY },
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('returns validation exit for unknown command', async () => {
    const code = await run(['node', 'trigv', 'unknown']);
    expect(code).toBe(EXIT_VALIDATION);
  });

  it('returns success for help', async () => {
    const code = await run(['node', 'trigv', 'send', '--help']);
    expect(code).toBe(EXIT_SUCCESS);
  });

  it('rejects unknown send option', async () => {
    process.env.TRIGV_API_KEY = API_KEY;
    const code = await run([
      'node',
      'trigv',
      'send',
      '--channel',
      'general',
      '--title',
      'x',
      '--unknown',
      'y',
    ]);
    expect(code).toBe(EXIT_VALIDATION);
  });

  it('rejects unknown connection option', async () => {
    process.env.TRIGV_API_KEY = API_KEY;
    const code = await run(['node', 'trigv', 'connection', '--bogus']);
    expect(code).toBe(EXIT_VALIDATION);
  });

  it('rejects extra positional for send', async () => {
    process.env.TRIGV_API_KEY = API_KEY;
    const code = await run([
      'node',
      'trigv',
      'send',
      'extra',
      '--channel',
      'general',
      '--title',
      'x',
    ]);
    expect(code).toBe(EXIT_VALIDATION);
  });

  it('rejects extra positional for connection', async () => {
    process.env.TRIGV_API_KEY = API_KEY;
    const code = await run(['node', 'trigv', 'connection', 'extra']);
    expect(code).toBe(EXIT_VALIDATION);
  });

  it('rejects extra positional for config set-key', async () => {
    const code = await run(['node', 'trigv', 'config', 'set-key', API_KEY]);
    expect(code).toBe(EXIT_VALIDATION);
  });

  it('rejects --base-url for config set-key', async () => {
    const code = await run([
      'node',
      'trigv',
      'config',
      'set-key',
      '--base-url',
      'http://example.test/api',
    ]);
    expect(code).toBe(EXIT_VALIDATION);
  });

  it('accepts --json for config set-key help path', async () => {
    const code = await run(['node', 'trigv', 'config', 'set-key', '--help']);
    expect(code).toBe(EXIT_SUCCESS);
  });

  it('accepts --json flag parsing for config set-key', async () => {
    const { runSetKey } = await import('../src/commands/config.js');
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'trigv-cli-setkey-json-'));
    const credPath = join(dir, 'credentials');

    await runSetKey({
      readInput: async () => API_KEY,
      json: true,
      credentialsDeps: {
        platformFn: () => 'linux',
        credentialsPath: credPath,
      },
    });

    const output = JSON.parse(String(stdoutSpy.mock.calls.at(-1)?.[0]));
    expect(output.ok).toBe(true);
  });

  it('rejects empty set-key input', async () => {
    const { runSetKey } = await import('../src/commands/config.js');
    await expect(
      runSetKey({
        readInput: async () => '   ',
        credentialsDeps: { platformFn: () => 'linux', credentialsPath: '/tmp/unused' },
      }),
    ).rejects.toThrow(ConfigError);
  });

  it('never prints API key in set-key JSON output', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'trigv-cli-setkey-secret-'));
    const credPath = join(dir, 'credentials');

    const { runSetKey } = await import('../src/commands/config.js');
    await runSetKey({
      readInput: async () => API_KEY,
      json: true,
      credentialsDeps: {
        platformFn: () => 'linux',
        credentialsPath: credPath,
      },
    });
    const output = JSON.parse(String(stdoutSpy.mock.calls.at(-1)?.[0]));
    expect(JSON.stringify(output)).not.toContain(API_KEY);
  });

  it('runs valid send command', async () => {
    process.env.TRIGV_API_KEY = API_KEY;
    const fetch = mockFetch(
      () => new Response(JSON.stringify({ event: sampleEvent }), { status: 202 }),
    );

    const { runSend } = await import('../src/commands/send.js');
    await expect(
      runSend({
        channel: 'general',
        title: 'Hello',
        fetch,
        credentialsDeps: { readKeychain: () => API_KEY },
      }),
    ).resolves.toBeUndefined();
  });
});
