import type { LEVELS, DELIVERY_URGENCIES } from './constants.js';

export type NotificationLevel = (typeof LEVELS)[number];

export type DeliveryUrgency = (typeof DELIVERY_URGENCIES)[number];

export interface TrigvClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
}

export interface SendEventParams {
  channel: string;
  title: string;
  description?: string;
  image_url?: string;
  level?: NotificationLevel;
  delivery_urgency?: DeliveryUrgency;
  event_type?: string;
  idempotency_key?: string;
}

export interface Event {
  public_id: string;
  event_uuid: string;
  status: string;
  level: string;
  event_type: string | null;
  target_device_count: number;
  received_at: string;
}

export interface SendEventResult {
  event: Event;
  duplicate: boolean;
}

export interface ConnectionWorkspace {
  public_id: string;
  name: string;
}

export interface ConnectionApiKey {
  public_id: string;
  name: string;
  prefix: string;
}

export interface ConnectionResult {
  workspace: ConnectionWorkspace;
  api_key: ConnectionApiKey;
}

export interface ValidationErrors {
  [field: string]: string[];
}

export interface CredentialsFile {
  api_key: string;
}
