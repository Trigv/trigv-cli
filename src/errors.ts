import type { ValidationErrors } from './types.js';

export class TrigvError extends Error {
  declare name: string;
  /** Value of the `X-Request-ID` response header, when the API answered. */
  requestId?: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends TrigvError {
  readonly name = 'ValidationError';
  readonly errors: ValidationErrors;
  readonly clientSide: boolean;

  constructor(message: string, errors: ValidationErrors = {}, clientSide = true) {
    super(message);
    this.errors = errors;
    this.clientSide = clientSide;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ConfigError extends TrigvError {
  readonly name = 'ConfigError';

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuthenticationError extends TrigvError {
  readonly name = 'AuthenticationError';
  readonly statusCode = 401;

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuthorizationError extends TrigvError {
  readonly name = 'AuthorizationError';
  readonly statusCode = 403;

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends TrigvError {
  readonly name = 'NotFoundError';
  readonly statusCode = 404;

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class RateLimitError extends TrigvError {
  readonly name = 'RateLimitError';
  readonly statusCode = 429;
  readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.retryAfterMs = retryAfterMs;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 409: another request is delivering the same `idempotency_key`. */
export class ConflictError extends TrigvError {
  readonly name = 'ConflictError';
  readonly statusCode = 409;
  readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.retryAfterMs = retryAfterMs;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 503: push delivery is unavailable. */
export class ServiceUnavailableError extends TrigvError {
  readonly name = 'ServiceUnavailableError';
  readonly statusCode = 503;
  readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.retryAfterMs = retryAfterMs;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ApiError extends TrigvError {
  readonly name = 'ApiError';
  readonly statusCode: number;
  readonly body: unknown;

  constructor(message: string, statusCode: number, body: unknown = null) {
    super(message);
    this.statusCode = statusCode;
    this.body = body;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NetworkError extends TrigvError {
  readonly name = 'NetworkError';
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TimeoutError extends TrigvError {
  readonly name = 'TimeoutError';

  constructor(message = 'Request timed out') {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
