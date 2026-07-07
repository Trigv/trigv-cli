import { stderr, stdin } from 'node:process';
import { ConfigError } from './errors.js';

/**
 * Read an API key from stdin (piped) or an interactive hidden TTY prompt.
 */
export async function readApiKeyFromStdin(input: NodeJS.ReadableStream = stdin): Promise<string> {
  const readable = input as NodeJS.ReadStream;
  if (!readable.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of input) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8').trim();
  }

  return readHiddenFromTTY(input);
}

export function processHiddenInputChar(
  value: string,
  char: string,
): { value: string; done: boolean; cancelled: boolean } {
  switch (char) {
    case '\n':
    case '\r':
    case '\u0004':
      return { value, done: true, cancelled: false };
    case '\u0003':
      return { value, done: true, cancelled: true };
    case '\u007f':
    case '\b':
      return { value: value.slice(0, -1), done: false, cancelled: false };
    default:
      if (char >= ' ' || char > '\u007f') {
        return { value: value + char, done: false, cancelled: false };
      }
      return { value, done: false, cancelled: false };
  }
}

function readHiddenFromTTY(input: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const tty = input as NodeJS.ReadStream;

    if (!tty.isTTY || typeof tty.setRawMode !== 'function') {
      reject(
        new ConfigError(
          'Hidden API key input is not supported in this terminal. Pipe the key via stdin instead.',
        ),
      );
      return;
    }

    stderr.write('API key: ');

    let value = '';
    let settled = false;

    const cleanup = () => {
      try {
        tty.setRawMode(false);
      } catch {
        // Best effort — terminal may already be closed.
      }
      tty.pause();
      tty.removeListener('data', onData);
      tty.removeListener('end', onEnd);
      tty.removeListener('error', onError);
    };

    const finish = (action: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      action();
    };

    const onData = (chunk: string | Buffer) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      for (const char of text) {
        const next = processHiddenInputChar(value, char);
        value = next.value;
        if (next.cancelled) {
          finish(() => reject(new Error('Cancelled')));
          return;
        }
        if (next.done) {
          stderr.write('\n');
          finish(() => resolve(value.trim()));
          return;
        }
      }
    };

    const onEnd = () => {
      finish(() => resolve(value.trim()));
    };

    const onError = (error: Error) => {
      finish(() => reject(error));
    };

    tty.setRawMode(true);
    tty.resume();
    tty.setEncoding('utf8');
    tty.on('data', onData);
    tty.on('end', onEnd);
    tty.on('error', onError);
  });
}
