import { DELIVERY_URGENCIES, FIELD_MAX_LENGTHS, LEVELS, PROHIBITED_FIELDS } from './constants.js';
import { ValidationError } from './errors.js';
import type { SendEventParams } from './types.js';

function trim(field: string, value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string`, {
      [field]: [`${field} must be a string`],
    });
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function codePointCount(value: string): number {
  return Array.from(value).length;
}

function assertMaxLength(field: string, value: string, max: number): void {
  if (codePointCount(value) > max) {
    throw new ValidationError(`${field} must be at most ${max} characters`, {
      [field]: [`${field} must be at most ${max} characters`],
    });
  }
}

function assertEnum<T extends string>(
  field: string,
  value: string,
  allowed: readonly T[],
): asserts value is T {
  if (!allowed.includes(value as T)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`, {
      [field]: [`${field} must be one of: ${allowed.join(', ')}`],
    });
  }
}

export function validateSendEventParams(params: SendEventParams): Record<string, string> {
  for (const prohibited of PROHIBITED_FIELDS) {
    if (prohibited in (params as unknown as Record<string, unknown>)) {
      throw new ValidationError(`Field "${prohibited}" is not allowed`, {
        [prohibited]: [`The ${prohibited} field is prohibited`],
      });
    }
  }

  const channel = trim('channel', params.channel);
  const title = trim('title', params.title);

  if (!channel) {
    throw new ValidationError('channel is required', { channel: ['channel is required'] });
  }
  if (!title) {
    throw new ValidationError('title is required', { title: ['title is required'] });
  }

  assertMaxLength('channel', channel, FIELD_MAX_LENGTHS.channel);
  assertMaxLength('title', title, FIELD_MAX_LENGTHS.title);

  const body: Record<string, string> = { channel, title };

  const description = trim('description', params.description);
  if (description !== undefined) {
    assertMaxLength('description', description, FIELD_MAX_LENGTHS.description);
    body.description = description;
  }

  const imageUrl = trim('image_url', params.image_url);
  if (imageUrl !== undefined) {
    assertMaxLength('image_url', imageUrl, FIELD_MAX_LENGTHS.image_url);
    body.image_url = imageUrl;
  }

  const url = trim('url', params.url);
  if (url !== undefined) {
    assertMaxLength('url', url, FIELD_MAX_LENGTHS.url);
    body.url = url;
  }

  const level = trim('level', params.level);
  if (level !== undefined) {
    assertEnum('level', level, LEVELS);
    body.level = level;
  }

  const deliveryUrgency = trim('delivery_urgency', params.delivery_urgency);
  if (deliveryUrgency !== undefined) {
    assertEnum('delivery_urgency', deliveryUrgency, DELIVERY_URGENCIES);
    body.delivery_urgency = deliveryUrgency;
  }

  const eventType = trim('event_type', params.event_type);
  if (eventType !== undefined) {
    assertMaxLength('event_type', eventType, FIELD_MAX_LENGTHS.event_type);
    body.event_type = eventType;
  }

  const idempotencyKey = trim('idempotency_key', params.idempotency_key);
  if (idempotencyKey !== undefined) {
    assertMaxLength('idempotency_key', idempotencyKey, FIELD_MAX_LENGTHS.idempotency_key);
    body.idempotency_key = idempotencyKey;
  }

  return body;
}
