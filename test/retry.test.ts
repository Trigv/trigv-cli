import { describe, expect, it } from 'vitest';
import { parseRetryAfterHeader } from '../src/retry.js';

describe('parseRetryAfterHeader', () => {
  const now = Date.parse('Wed, 14 Nov 2023 22:13:20 GMT');

  it('parses integer seconds', () => {
    expect(parseRetryAfterHeader('2', now)).toBe(2000);
  });

  it('rejects invalid values', () => {
    expect(parseRetryAfterHeader('not-a-number', now)).toBeUndefined();
    expect(parseRetryAfterHeader('-1', now)).toBeUndefined();
    expect(parseRetryAfterHeader('', now)).toBeUndefined();
  });

  it('parses HTTP-date', () => {
    const wait = parseRetryAfterHeader('Wed, 14 Nov 2023 22:13:23 GMT', now);
    expect(wait).toBe(3000);
  });

  it('rejects past HTTP-date', () => {
    expect(parseRetryAfterHeader('Wed, 14 Nov 2023 22:13:19 GMT', now)).toBeUndefined();
  });
});
