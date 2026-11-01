import { describe, expect, it, vi } from 'vitest';
import { Trigv } from '../src/client.js';
import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  RateLimitError,
  ServiceUnavailableError,
  TimeoutError,
  ValidationError,
  isMonthlyLimitMessage,
} from '../src/errors.js';

const API_KEY = 'trgv_testkey1_abcdefghijklmnopqrstuvwxyz123456';

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    return handler(url, init);
  }) as typeof fetch;
}

const sampleEvent = {
  public_id: '01JXXXXXXXXXXXXXXXXXXXXXXX',
  event_uuid: '550e8400-e29b-41d4-a716-446655440000',
  status: 'sent',
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
    expect(result.event.public_id).toBe('01JXXXXXXXXXXXXXXXXXXXXXXX');
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
        url: 'https://example.com/deployments/42',
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
      url: 'https://example.com/deployments/42',
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
    expect(result.event.public_id).toBe('01JXXXXXXXXXXXXXXXXXXXXXXX');
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

  it('defaults to https://api.trigv.com/v1/events', async () => {
    const urls: string[] = [];
    const fetch = mockFetch((url) => {
      urls.push(url);
      return new Response(JSON.stringify({ event: sampleEvent }), { status: 202 });
    });
    await new Trigv({ apiKey: API_KEY, fetch }).sendEvent({ channel: 'general', title: 'x' });
    expect(urls).toEqual(['https://api.trigv.com/v1/events']);
  });

  it('keeps working with the old /api base URL', async () => {
    const urls: string[] = [];
    const fetch = mockFetch((url) => {
      urls.push(url);
      return new Response(JSON.stringify({ event: sampleEvent }), { status: 202 });
    });
    await new Trigv({ apiKey: API_KEY, fetch, baseUrl: 'https://api.trigv.com/api/' }).sendEvent({
      channel: 'general',
      title: 'x',
    });
    expect(urls).toEqual(['https://api.trigv.com/api/v1/events']);
  });

  it('builds /v1/connection from the default base URL', async () => {
    const urls: string[] = [];
    const fetch = mockFetch((url) => {
      urls.push(url);
      return new Response(
        JSON.stringify({
          workspace: { public_id: '01JXXXXXXXXXXXXXXXXXXXXXXX', name: 'Acme' },
          api_key: {
            public_id: '01JXXXXXXXXXXXXXXXXXXXXXXX',
            name: 'Prod',
            prefix: 'trgv_abcd1234',
          },
        }),
        { status: 200 },
      );
    });
    await new Trigv({ apiKey: API_KEY, fetch }).verifyConnection();
    expect(urls).toEqual(['https://api.trigv.com/v1/connection']);
  });

  it('maps 200 "already stored" to duplicate', async () => {
    const fetch = mockFetch(
      () =>
        new Response(JSON.stringify({ event: sampleEvent, message: 'already stored' }), {
          status: 200,
        }),
    );
    const client = new Trigv({ apiKey: API_KEY, fetch, maxRetries: 0 });
    const result = await client.sendEvent({ channel: 'general', title: 'x', idempotency_key: 'k' });
    expect(result.duplicate).toBe(true);
  });

  const headers = { 'Retry-After': '7', 'X-Request-ID': '01JREQXXXXXXXXXXXXXXXXXXXX' };

  it('maps 409 to ConflictError with Retry-After and request id', async () => {
    const fetch = mockFetch(
      () => new Response(JSON.stringify({ message: 'busy' }), { status: 409, headers }),
    );
    const client = new Trigv({ apiKey: API_KEY, fetch, maxRetries: 0 });
    const error = await client
      .sendEvent({ channel: 'general', title: 'x' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).retryAfterMs).toBe(7000);
    expect((error as ConflictError).requestId).toBe('01JREQXXXXXXXXXXXXXXXXXXXX');
  });

  it('maps 503 to ServiceUnavailableError with Retry-After', async () => {
    const fetch = mockFetch(
      () => new Response(JSON.stringify({ message: 'down' }), { status: 503, headers }),
    );
    const client = new Trigv({ apiKey: API_KEY, fetch, maxRetries: 0 });
    const error = await client
      .sendEvent({ channel: 'general', title: 'x' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect((error as ServiceUnavailableError).retryAfterMs).toBe(7000);
  });

  it('maps 429 to RateLimitError with Retry-After and request id', async () => {
    const fetch = mockFetch(
      () =>
        new Response(JSON.stringify({ message: 'Too many requests. Try again in 7 seconds.' }), {
          status: 429,
          headers,
        }),
    );
    const client = new Trigv({ apiKey: API_KEY, fetch, maxRetries: 0 });
    const error = await client
      .sendEvent({ channel: 'general', title: 'x' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterMs).toBe(7000);
    expect((error as RateLimitError).requestId).toBe('01JREQXXXXXXXXXXXXXXXXXXXX');
  });

  it('maps 422 (bad JSON body) to a server ValidationError and does not retry', async () => {
    let calls = 0;
    const fetch = mockFetch(() => {
      calls += 1;
      return new Response(
        JSON.stringify({
          message: 'The channel field is required.',
          errors: { channel: ['The channel field is required.'] },
        }),
        { status: 422 },
      );
    });
    const client = new Trigv({ apiKey: API_KEY, fetch, maxRetries: 2 });
    const error = await client
      .sendEvent({ channel: 'general', title: 'x', idempotency_key: 'k' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).clientSide).toBe(false);
    expect(calls).toBe(1);
  });

  it.each([409, 503])(
    'retries %i with the same idempotency key after Retry-After',
    async (status) => {
      const bodies: string[] = [];
      let calls = 0;
      const start = Date.now();
      const fetch = mockFetch((_url, init) => {
        calls += 1;
        bodies.push(String(init?.body));
        if (calls === 1) {
          return new Response(JSON.stringify({ message: 'retry' }), {
            status,
            headers: { 'Retry-After': '1' },
          });
        }
        return new Response(JSON.stringify({ event: sampleEvent }), { status: 202 });
      });
      const client = new Trigv({ apiKey: API_KEY, fetch, maxRetries: 2 });
      await client.sendEvent({ channel: 'general', title: 'x', idempotency_key: 'k1' });
      expect(calls).toBe(2);
      expect(Date.now() - start).toBeGreaterThanOrEqual(900);
      expect(bodies[0]).toBe(bodies[1]);
    },
  );

  it('does not retry 409 without an idempotency key', async () => {
    let calls = 0;
    const fetch = mockFetch(() => {
      calls += 1;
      return new Response(JSON.stringify({ message: 'busy' }), { status: 409 });
    });
    const client = new Trigv({ apiKey: API_KEY, fetch, maxRetries: 2 });
    await expect(client.sendEvent({ channel: 'general', title: 'x' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(calls).toBe(1);
  });
});

describe('Retry-After above the wait cap', () => {
  it.each([409, 429, 503])('throws the original %i error without waiting', async (status) => {
    let calls = 0;
    const fetch = mockFetch(() => {
      calls += 1;
      return new Response(JSON.stringify({ message: 'slow down' }), {
        status,
        headers: { 'Retry-After': '120', 'X-Request-ID': '01JREQXXXXXXXXXXXXXXXXXXXX' },
      });
    });
    const client = new Trigv({ apiKey: API_KEY, fetch, maxRetries: 2, timeout: 30_000 });
    const start = Date.now();
    const error = await client
      .sendEvent({ channel: 'general', title: 'x', idempotency_key: 'k1' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(
      status === 409 ? ConflictError : status === 429 ? RateLimitError : ServiceUnavailableError,
    );
    expect(error).not.toBeInstanceOf(TimeoutError);
    expect((error as { retryAfterMs?: number }).retryAfterMs).toBe(120_000);
    expect((error as { requestId?: string }).requestId).toBe('01JREQXXXXXXXXXXXXXXXXXXXX');
    expect(calls).toBe(1);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('throws at once for an HTTP-date Retry-After above the cap', async () => {
    let calls = 0;
    const fetch = mockFetch(() => {
      calls += 1;
      return new Response(JSON.stringify({ message: 'busy' }), {
        status: 503,
        headers: { 'Retry-After': new Date(Date.now() + 3_600_000).toUTCString() },
      });
    });
    const client = new Trigv({ apiKey: API_KEY, fetch, maxRetries: 2 });
    await expect(
      client.sendEvent({ channel: 'general', title: 'x', idempotency_key: 'k1' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(calls).toBe(1);
  });
});

describe('base URL trailing slashes', () => {
  it('strips every trailing slash', async () => {
    const urls: string[] = [];
    const fetch = mockFetch((url) => {
      urls.push(url);
      return new Response(JSON.stringify({ event: sampleEvent }), { status: 202 });
    });
    await new Trigv({ apiKey: API_KEY, fetch, baseUrl: 'https://api.trigv.com//' }).sendEvent({
      channel: 'general',
      title: 'x',
    });
    expect(urls).toEqual(['https://api.trigv.com/v1/events']);
  });
});

describe('deprecated compatibility members', () => {
  it('keeps RateLimitError.retryable and the old constructor order', () => {
    const current = new RateLimitError('slow', 5000);
    expect(current.retryable).toBe(true);
    expect(current.retryAfterMs).toBe(5000);

    const legacy = new (
      RateLimitError as unknown as new (
        message: string,
        retryable: boolean,
        retryAfterMs?: number,
      ) => RateLimitError
    )('slow', false, 7000);
    expect(legacy.retryable).toBe(true);
    expect(legacy.retryAfterMs).toBe(7000);
  });

  it('keeps isMonthlyLimitMessage, always false', () => {
    expect(isMonthlyLimitMessage('Monthly event limit reached')).toBe(false);
  });
});
