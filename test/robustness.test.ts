import { describe, expect, it, vi } from 'vitest';
import { Trigv } from '../src/client.js';
import { ValidationError } from '../src/errors.js';
import { parseRetryAfterHeader, retryBackoffMs } from '../src/retry.js';
import { validateSendEventParams } from '../src/validation.js';

const API_KEY = 'trgv_testkey1_abcdefghijklmnopqrstuvwxyz123456';

const sampleEvent = {
  public_id: '01JXXXXXXXXXXXXXXXXXXXXXXX',
  event_uuid: '550e8400-e29b-41d4-a716-446655440000',
  status: 'sent',
  level: 'info',
  event_type: null,
  target_device_count: 1,
  received_at: '2026-06-16T12:00:00+00:00',
};

describe('retry wait is not limited by the request timeout', () => {
  it('retries after a 502 even when the timeout is shorter than the backoff', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? new Response('bad gateway', { status: 502 })
        : new Response(JSON.stringify({ event: sampleEvent }), { status: 202 });
    }) as typeof fetch;

    const client = new Trigv({ apiKey: API_KEY, fetch: fetchMock, timeout: 100, maxRetries: 1 });
    const result = await client.sendEvent({
      channel: 'general',
      title: 'Hello',
      idempotency_key: 'k1',
    });

    expect(result.event.public_id).toBe(sampleEvent.public_id);
    expect(calls).toBe(2);
  });
});

describe('Retry-After parsing', () => {
  it('accepts fractional seconds, rounded up to the next millisecond', () => {
    expect(parseRetryAfterHeader('1.5')).toBe(1500);
    expect(parseRetryAfterHeader('0')).toBe(0);
  });

  it('ignores values that are not finite', () => {
    expect(parseRetryAfterHeader('9'.repeat(400))).toBeUndefined();
  });

  it('keeps the backoff bounded for large attempt numbers', () => {
    expect(retryBackoffMs(30)).toBeLessThanOrEqual(8_250);
  });
});

describe('validation of null and non-string values', () => {
  it('treats null optional fields as omitted', () => {
    const body = validateSendEventParams({
      channel: 'general',
      title: 'Hello',
      description: null,
      level: null,
    } as never);
    expect(body).toEqual({ channel: 'general', title: 'Hello' });
  });

  it('rejects non-string values with a ValidationError', () => {
    expect(() => validateSendEventParams({ channel: 'general', title: 42 } as never)).toThrow(
      ValidationError,
    );
  });
});
