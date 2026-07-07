export const VERSION = '0.1.0';

export const DEFAULT_BASE_URL = 'https://api.trigv.com/api';

export const DEFAULT_TIMEOUT_MS = 30_000;

export const MAX_RETRIES = 2;

export const LEVELS = ['info', 'success', 'warning', 'error'] as const;

export const DELIVERY_URGENCIES = ['standard', 'time_sensitive'] as const;

export const FIELD_MAX_LENGTHS = {
  channel: 120,
  title: 255,
  description: 1000,
  image_url: 2048,
  url: 2048,
  event_type: 120,
  idempotency_key: 190,
} as const;

export const PROHIBITED_FIELDS = ['api_key', 'icon'] as const;

export const KEYCHAIN_SERVICE = 'trigv-cli';

export const KEYCHAIN_ACCOUNT = 'api-key';
