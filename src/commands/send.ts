import { Trigv } from '../client.js';
import { resolveApiKey, missingApiKeyMessage } from '../credentials.js';
import type { CredentialsDeps } from '../credentials.js';
import { ConfigError, ValidationError } from '../errors.js';
import { formatSendSuccess, printHuman, printJson } from '../output.js';
import type { NotificationLevel, DeliveryUrgency } from '../types.js';

export interface SendOptions {
  channel?: string;
  title?: string;
  description?: string;
  level?: string;
  deliveryUrgency?: string;
  eventType?: string;
  imageUrl?: string;
  url?: string;
  idempotencyKey?: string;
  baseUrl?: string;
  json?: boolean;
  credentialsDeps?: CredentialsDeps;
  fetch?: typeof fetch;
}

export async function runSend(options: SendOptions): Promise<void> {
  if (!options.channel) {
    throw new ValidationError('--channel is required', { channel: ['--channel is required'] });
  }
  if (!options.title) {
    throw new ValidationError('--title is required', { title: ['--title is required'] });
  }

  const apiKey = await resolveApiKey(options.credentialsDeps);
  if (!apiKey) {
    throw new ConfigError(missingApiKeyMessage());
  }

  const client = new Trigv({
    apiKey,
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    maxRetries: 2,
  });

  const result = await client.sendEvent({
    channel: options.channel,
    title: options.title,
    description: options.description,
    level: options.level as NotificationLevel | undefined,
    delivery_urgency: options.deliveryUrgency as DeliveryUrgency | undefined,
    event_type: options.eventType,
    image_url: options.imageUrl,
    url: options.url,
    idempotency_key: options.idempotencyKey,
  });

  if (options.json) {
    printJson({
      ok: true,
      event: result.event,
      duplicate: result.duplicate,
    });
  } else {
    formatSendSuccess(result.duplicate, result.event.public_id, false);
  }
}

export function printSendUsage(): void {
  printHuman(`Usage: trigv send --channel <slug> --title <text> [options]

Options:
  --channel            Channel slug (required)
  --title              Notification title (required)
  --description        Body text
  --level              info | success | warning | error
  --delivery-urgency   standard | time_sensitive
  --event-type         Free-form event label
  --image-url          Image URL
  --url                Destination URL (e.g. deployment details)
  --idempotency-key    Dedup key per workspace
  --base-url           API base URL override
  --json               Output JSON to stdout`);
}
