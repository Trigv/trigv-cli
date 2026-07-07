import { DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, MAX_RETRIES, VERSION } from './constants.js';
import {
  ApiError,
  AuthenticationError,
  AuthorizationError,
  isMonthlyLimitMessage,
  NetworkError,
  NotFoundError,
  RateLimitError,
  TimeoutError,
  ValidationError,
} from './errors.js';
import type {
  ConnectionResult,
  SendEventParams,
  SendEventResult,
  TrigvClientOptions,
  ValidationErrors,
} from './types.js';
import { validateSendEventParams } from './validation.js';

interface JsonBody {
  message?: string;
  errors?: ValidationErrors;
  event?: SendEventResult['event'];
  workspace?: ConnectionResult['workspace'];
  api_key?: ConnectionResult['api_key'];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(maxMs: number): number {
  return Math.floor(Math.random() * maxMs);
}

function parseJson(text: string): JsonBody | null {
  if (text === '') {
    return null;
  }
  try {
    return JSON.parse(text) as JsonBody;
  } catch {
    return null;
  }
}

function errorFromResponse(status: number, body: JsonBody | null): never {
  const message = body?.message ?? `Trigv API returned HTTP ${status}`;

  switch (status) {
    case 401:
      throw new AuthenticationError(message);
    case 403:
      throw new AuthorizationError(message);
    case 404:
      throw new NotFoundError(message);
    case 422:
      throw new ValidationError(message, body?.errors ?? {}, false);
    case 429:
      throw new RateLimitError(message, !isMonthlyLimitMessage(message));
    default:
      throw new ApiError(message, status, body);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export class Trigv {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TrigvClientOptions) {
    if (!options.apiKey || options.apiKey.trim() === '') {
      throw new ValidationError('apiKey is required');
    }

    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? MAX_RETRIES;
    this.fetchImpl = options.fetch ?? fetch;
  }

  get userAgent(): string {
    return `trigv-cli/${VERSION}`;
  }

  async sendEvent(params: SendEventParams): Promise<SendEventResult> {
    const body = validateSendEventParams(params);
    const hasIdempotency = Boolean(body.idempotency_key);

    return this.requestWithRetry<SendEventResult>(
      'POST',
      '/v1/events',
      body,
      hasIdempotency,
      (status, parsed) => {
        if ((status === 202 || status === 200) && parsed?.event) {
          return { event: parsed.event, duplicate: status === 200 };
        }
        errorFromResponse(status, parsed);
      },
    );
  }

  async verifyConnection(): Promise<ConnectionResult> {
    return this.requestWithRetry<ConnectionResult>(
      'GET',
      '/v1/connection',
      undefined,
      true,
      (status, parsed) => {
        if (status === 200 && parsed?.workspace && parsed?.api_key) {
          return { workspace: parsed.workspace, api_key: parsed.api_key };
        }
        errorFromResponse(status, parsed);
      },
    );
  }

  private async requestWithRetry<T>(
    method: 'GET' | 'POST',
    path: string,
    body: Record<string, string> | undefined,
    allowRetry: boolean,
    parseSuccess: (status: number, parsed: JsonBody | null) => T,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.requestOnce(method, path, body, parseSuccess);
      } catch (error) {
        lastError = error;

        if (!allowRetry || attempt >= this.maxRetries) {
          throw error;
        }

        if (error instanceof ValidationError || error instanceof AuthenticationError) {
          throw error;
        }
        if (error instanceof AuthorizationError || error instanceof NotFoundError) {
          throw error;
        }
        if (error instanceof RateLimitError && !error.retryable) {
          throw error;
        }
        if (error instanceof ApiError && !isRetryableStatus(error.statusCode)) {
          throw error;
        }
        if (error instanceof NetworkError || error instanceof TimeoutError) {
          // retry
        } else if (
          !(error instanceof RateLimitError) &&
          !(error instanceof ApiError && isRetryableStatus(error.statusCode))
        ) {
          throw error;
        }

        const backoff = 500 * 2 ** attempt + jitter(250);
        await sleep(backoff);
      }
    }

    throw lastError;
  }

  private async requestOnce<T>(
    method: 'GET' | 'POST',
    path: string,
    body: Record<string, string> | undefined,
    parseSuccess: (status: number, parsed: JsonBody | null) => T,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'User-Agent': this.userAgent,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      const parsed = parseJson(text);

      if (response.ok) {
        return parseSuccess(response.status, parsed);
      }

      errorFromResponse(response.status, parsed);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TimeoutError();
      }
      if (
        error instanceof ValidationError ||
        error instanceof AuthenticationError ||
        error instanceof AuthorizationError ||
        error instanceof NotFoundError ||
        error instanceof RateLimitError ||
        error instanceof ApiError
      ) {
        throw error;
      }
      throw new NetworkError(
        error instanceof Error ? error.message : 'Network request failed',
        error,
      );
    } finally {
      clearTimeout(timer);
    }

    throw new NetworkError('Unexpected request failure');
  }
}
