import { describe, expect, it, vi } from 'vitest';
import { Trigv } from '../src/client.js';
import {
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '../src/errors.js';

const API_KEY = 'trgv_testkey1_abcdefghijklmnopqrstuvwxyz123456';

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    return handler(url, init);
  }) as typeof fetch;
}

const sampleEvent = {
  public_id: 'evt_abc',
  event_uuid: '550e8400-e29b-41d4-a716-446655440000',
  status: 'queued',
  level: 'info',
  event_type: null,
  target_device_count: 1,
  received_at: '2026-06-16T12:00:00+00:00',
};

describe('Trigv client', () => {
  it('requires an API key', () => {
    expect(() => new Trigv({ apiKey: '' })).toThrow(ValidationError);
  });

  it('sends a minimum valid event', async () => {
    const fetch = mockFetch((_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ channel: 'general', title: 'Hello' });
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${API_KEY}`,
        Accept: 'application/json',
      });
      return new Response(JSON.stringify({ event: sampleEvent }), { status: 202 });
    });

    const client = new Trigv({ apiKey: API_KEY, fetch, maxRetries: 0 });
    const result = await client.sendEvent({ channel: 'general', title: 'Hello' });

    expect(result.duplicate).toBe(false);
    expect(result.event.public_id).toBe('evt_abc');
  });

  it('sends all optional fields', async () => {
    const fetch = mockFetch((_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        channel: 'deploys',
        title: 'Production deploy complete',
        description: 'Build #42 succeeded in 38s (commit abc1234)',
        level: 'success',
        delivery_urgency: 'standard',
        event_type: 'deploy.completed',
        idempotency_key: 'deploy-prod-42',
      });
      return new Response(JSON.stringify({ event: { ...sampleEvent, level: 'success' } }), {
        status: 202,
      });
    });

    const client = new Trigv({ apiKey: API_KEY, fetch, maxRetries: 0 });
    await client.sendEvent({
      channel: 'deploys',
      title: 'Production deploy complete',
      description: 'Build #42 succeeded in 38s (commit abc1234)',
      level: 'success',
      delivery_urgency: 'standard',
      event_type: 'deploy.completed',
      idempotency_key: 'deploy-prod-42',
    });
  });

  it('rejects invalid level client-side', async () => {
    const client = new Trigv({
      apiKey: API_KEY,
      fetch: mockFetch(() => new Response()),
      maxRetries: 0,
    });
    await expect(
      client.sendEvent({ channel: 'general', title: 'x', level: 'meta' as 'info' }),
    ).rejects.toThrow(ValidationError);
  });

  it('handles duplicate idempotency', async () => {
    const fetch = mockFetch(
      () => new Response(JSON.stringify({ event: sampleEvent }), { status: 200 }),
    );
    const client = new Trigv({ apiKey: API_KEY, fetch, maxRetries: 0 });
    const result = await client.sendEvent({
      channel: 'general',
      title: 'x',
      idempotency_key: 'retry-123',
    });
    expect(result.duplicate).toBe(true);
  });

  it('maps 401 to AuthenticationError', async () => {
    const fetch = mockFetch(
      () => new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 }),
    );
    const client = new Trigv({ apiKey: API_KEY, fetch, maxRetries: 0 });
    await expect(client.sendEvent({ channel: 'general', title: 'x' })).rejects.toThrow(
      AuthenticationError,
    );
  });

  it('maps 404 to NotFoundError', async () => {
    const fetch = mockFetch(
      () => new Response(JSON.stringify({ message: 'Channel not found.' }), { status: 404 }),
    );
    const client = new Trigv({ apiKey: API_KEY, fetch, maxRetries: 0 });
    await expect(client.sendEvent({ channel: 'missing', title: 'x' })).rejects.toThrow(
      NotFoundError,
    );
  });

  it('marks server 422 as not client-side', async () => {
    const fetch = mockFetch(
      () =>
        new Response(
          JSON.stringify({ message: 'Validation failed', errors: { channel: ['invalid'] } }),
          { status: 422 },
        ),
    );
    const client = new Trigv({ apiKey: API_KEY, fetch, maxRetries: 0 });
    try {
      await client.sendEvent({ channel: 'general', title: 'x' });
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).clientSide).toBe(false);
    }
  });

  it('sets User-Agent header', async () => {
    const fetch = mockFetch((_url, init) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers['User-Agent']).toMatch(/^trigv-cli\//);
      return new Response(JSON.stringify({ event: sampleEvent }), { status: 202 });
    });
    const client = new Trigv({ apiKey: API_KEY, fetch, maxRetries: 0 });
    await client.sendEvent({ channel: 'general', title: 'x' });
  });

  it('rejects negative maxRetries', () => {
    expect(() => new Trigv({ apiKey: API_KEY, maxRetries: -1 })).toThrow(ValidationError);
  });

  it('accepts zero maxRetries', () => {
    expect(() => new Trigv({ apiKey: API_KEY, maxRetries: 0 })).not.toThrow();
  });

  it('accepts positive maxRetries', () => {
    expect(() => new Trigv({ apiKey: API_KEY, maxRetries: 2 })).not.toThrow();
  });

  it('rejects zero timeout', () => {
    expect(() => new Trigv({ apiKey: API_KEY, timeout: 0 })).toThrow(ValidationError);
  });

  it('rejects negative timeout', () => {
    expect(() => new Trigv({ apiKey: API_KEY, timeout: -1 })).toThrow(ValidationError);
  });

  it('accepts positive timeout', () => {
    expect(() => new Trigv({ apiKey: API_KEY, timeout: 5000 })).not.toThrow();
  });

  it('retries burst 429 with Retry-After seconds', async () => {
    let calls = 0;
    let secondCallAt = 0;
    const start = Date.now();
    const fetch = mockFetch(() => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ message: 'Too many requests for this API key.' }), {
          status: 429,
          headers: { 'Retry-After': '1' },
        });
      }
      secondCallAt = Date.now();
      return new Response(JSON.stringify({ event: sampleEvent }), { status: 202 });
    });

    const client = new Trigv({ apiKey: API_KEY, fetch, maxRetries: 2 });
    const result = await client.sendEvent({
      channel: 'general',
      title: 'x',
      idempotency_key: 'k1',
    });

    expect(calls).toBe(2);
    expect(secondCallAt - start).toBeGreaterThanOrEqual(900);
    expect(result.event.public_id).toBe('evt_abc');
  });

  it('retries burst 429 with HTTP-date Retry-After', async () => {
    let calls = 0;
    const fetch = mockFetch(() => {
      calls += 1;
      if (calls === 1) {
        const retryAt = new Date(Date.now() + 1000).toUTCString();
        return new Response(JSON.stringify({ message: 'Too many requests for this API key.' }), {
          status: 429,
          headers: { 'Retry-After': retryAt },
        });
      }
      return new Response(JSON.stringify({ event: sampleEvent }), { status: 202 });
    });

    const client = new Trigv({ apiKey: API_KEY, fetch, maxRetries: 2 });
    await client.sendEvent({
      channel: 'general',
      title: 'x',
      idempotency_key: 'k1',
    });
    expect(calls).toBe(2);
  });

  it('falls back when Retry-After is invalid', async () => {
    let calls = 0;
    const fetch = mockFetch(() => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ message: 'Too many requests for this API key.' }), {
          status: 429,
          headers: { 'Retry-After': 'not-a-number' },
        });
      }
      return new Response(JSON.stringify({ event: sampleEvent }), { status: 202 });
    });

    const client = new Trigv({ apiKey: API_KEY, fetch, maxRetries: 2 });
    await client.sendEvent({
      channel: 'general',
      title: 'x',
      idempotency_key: 'k1',
    });
    expect(calls).toBe(2);
  });

  it('falls back when Retry-After is missing', async () => {
    let calls = 0;
    const fetch = mockFetch(() => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ message: 'Too many requests for this API key.' }), {
          status: 429,
        });
      }
      return new Response(JSON.stringify({ event: sampleEvent }), { status: 202 });
    });

    const client = new Trigv({ apiKey: API_KEY, fetch, maxRetries: 2 });
    await client.sendEvent({
      channel: 'general',
      title: 'x',
      idempotency_key: 'k1',
    });
    expect(calls).toBe(2);
  });

  it('does not retry monthly-cap 429', async () => {
    let calls = 0;
    const fetch = mockFetch(() => {
      calls += 1;
      return new Response(
        JSON.stringify({ message: 'Monthly event limit reached for this workspace.' }),
        { status: 429, headers: { 'Retry-After': '60' } },
      );
    });

    const client = new Trigv({ apiKey: API_KEY, fetch, maxRetries: 2 });
    await expect(
      client.sendEvent({ channel: 'general', title: 'x', idempotency_key: 'k1' }),
    ).rejects.toSatisfy((error: unknown) => {
      return error instanceof RateLimitError && error.retryable === false;
    });
    expect(calls).toBe(1);
  });
});
