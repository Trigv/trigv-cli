import { describe, expect, it } from 'vitest';
import { validateSendEventParams } from '../src/validation.js';
import { ValidationError } from '../src/errors.js';

describe('validateSendEventParams unicode lengths', () => {
  it('accepts ASCII at limit', () => {
    const body = validateSendEventParams({
      channel: 'a'.repeat(120),
      title: 'x',
    });
    expect(body.channel).toHaveLength(120);
  });

  it('rejects ASCII over limit', () => {
    expect(() =>
      validateSendEventParams({
        channel: 'a'.repeat(121),
        title: 'x',
      }),
    ).toThrow(ValidationError);
  });

  it('accepts Unicode at rune limit', () => {
    const channel = '🎉'.repeat(120);
    const body = validateSendEventParams({
      channel,
      title: 'x',
    });
    expect(body.channel).toBe(channel);
    expect(channel.length).toBeGreaterThan(120);
  });

  it('accepts emoji within limit', () => {
    const body = validateSendEventParams({
      channel: 'general',
      title: '🎉'.repeat(10),
    });
    expect(body.title).toBe('🎉'.repeat(10));
  });

  it('rejects emoji over limit', () => {
    expect(() =>
      validateSendEventParams({
        channel: '🎉'.repeat(121),
        title: 'x',
      }),
    ).toThrow(ValidationError);
  });
});
