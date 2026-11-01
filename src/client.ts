import { DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, MAX_RETRIES, VERSION } from './constants.js';
import {
  ApiError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  ServiceUnavailableError,
  TimeoutError,
  TrigvError,
  ValidationError,
} from './errors.js';
import { parseRetryAfterHeader, retryBackoffMs, sleep } from './retry.js';
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

function errorFromResponse(
  status: number,
  body: JsonBody | null,
  retryAfterHeader: string | null = null,
  requestId: string | null = null,
): never {
  const message = body?.message ?? `Trigv API returned HTTP ${status}`;
  const retryAfterMs = parseRetryAfterHeader(retryAfterHeader);

  let error: TrigvError;
  switch (status) {
    case 401:
      error = new AuthenticationError(message);
      break;
    case 403:
      error = new AuthorizationError(message);
      break;
    case 404:
      error = new NotFoundError(message);
      break;
    case 409:
      error = new ConflictError(message, retryAfterMs);
      break;
    case 422:
      error = new ValidationError(message, body?.errors ?? {}, false);
      break;
    case 429:
      error = new RateLimitError(message, retryAfterMs);
      break;
    case 503:
      error = new ServiceUnavailableError(message, retryAfterMs);
      break;
    default:
      error = new ApiError(message, status, body);
  }
  if (requestId) {
    error.requestId = requestId;
  }
  throw error;
}

function isRetryableStatus(status: number): boolean {
  return status === 502 || status === 504;
}

function retryAfterOf(error: unknown): number | undefined {
  if (
    error instanceof RateLimitError ||
    error instanceof ConflictError ||
    error instanceof ServiceUnavailableError
  ) {
    return error.retryAfterMs;
  }
  return undefined;
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

    if (options.maxRetries !== undefined && options.maxRetries < 0) {
      throw new ValidationError('maxRetries must be zero or greater', {
        maxRetries: ['maxRetries must be zero or greater'],
      });
    }

    if (options.timeout !== undefined && options.timeout <= 0) {
      throw new ValidationError('timeout must be greater than zero', {
        timeout: ['timeout must be greater than zero'],
      });
    }

    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
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

        const retryable =
          error instanceof NetworkError ||
          error instanceof TimeoutError ||
          error instanceof RateLimitError ||
          error instanceof ConflictError ||
          error instanceof ServiceUnavailableError ||
          (error instanceof ApiError && isRetryableStatus(error.statusCode));
        if (!retryable) {
          throw error;
        }

        const retryAfterMs = retryAfterOf(error);
        if (retryAfterMs !== undefined && retryAfterMs > this.timeout) {
          // Server asks for a longer wait than we allow: surface the original error.
          throw error;
        }
        const waitMs = retryAfterMs ?? retryBackoffMs(attempt);

        await sleep(waitMs);
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

      errorFromResponse(
        response.status,
        parsed,
        response.headers.get('Retry-After'),
        response.headers.get('X-Request-ID'),
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TimeoutError();
      }
      if (
        error instanceof TrigvError &&
        !(error instanceof NetworkError) &&
        !(error instanceof TimeoutError)
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
