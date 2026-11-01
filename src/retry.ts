/**
 * Parse Retry-After header (seconds, whole or fractional, or HTTP-date).
 * Returns wait duration in milliseconds when valid.
 */
export function parseRetryAfterHeader(value: string | null, now = Date.now()): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const trimmed = value.trim();

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const ms = Math.ceil(Number.parseFloat(trimmed) * 1000);
    return Number.isFinite(ms) ? ms : undefined;
  }

  const retryAt = Date.parse(trimmed);
  if (Number.isNaN(retryAt)) {
    return undefined;
  }

  const waitMs = retryAt - now;
  if (waitMs < 0) {
    return undefined;
  }

  return waitMs;
}

const MAX_BACKOFF_MS = 8_000;

export function retryBackoffMs(attempt: number): number {
  return Math.min(500 * 2 ** attempt, MAX_BACKOFF_MS) + Math.floor(Math.random() * 251);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Aborted'));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('Aborted'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
