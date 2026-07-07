/**
 * Parse Retry-After header (integer seconds or HTTP-date).
 * Returns wait duration in milliseconds when valid.
 */
export function parseRetryAfterHeader(value: string | null, now = Date.now()): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const trimmed = value.trim();

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    if (seconds < 0) {
      return undefined;
    }
    return seconds * 1000;
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

export function retryBackoffMs(attempt: number): number {
  return 500 * 2 ** attempt + Math.floor(Math.random() * 251);
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
