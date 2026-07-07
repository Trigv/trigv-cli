import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { ConfigError } from '../src/errors.js';
import { processHiddenInputChar, readApiKeyFromStdin } from '../src/read-api-key.js';

function createMockTTY(): NodeJS.ReadStream & EventEmitter {
  const emitter = new EventEmitter();
  const stream = emitter as NodeJS.ReadStream & EventEmitter;
  stream.isTTY = true;
  stream.setRawMode = vi.fn();
  stream.resume = vi.fn();
  stream.pause = vi.fn();
  stream.setEncoding = vi.fn();
  return stream;
}

function emitChunks(stream: EventEmitter, chunks: string[]): void {
  for (const chunk of chunks) {
    stream.emit('data', chunk);
  }
}

describe('processHiddenInputChar', () => {
  it('appends printable characters', () => {
    expect(processHiddenInputChar('', 'a')).toEqual({
      value: 'a',
      done: false,
      cancelled: false,
    });
  });

  it('handles backspace', () => {
    expect(processHiddenInputChar('ab', '\b')).toEqual({
      value: 'a',
      done: false,
      cancelled: false,
    });
  });

  it('marks Enter as done', () => {
    expect(processHiddenInputChar('key', '\n')).toEqual({
      value: 'key',
      done: true,
      cancelled: false,
    });
  });

  it('marks Ctrl+C as cancelled', () => {
    expect(processHiddenInputChar('key', '\u0003')).toEqual({
      value: 'key',
      done: true,
      cancelled: true,
    });
  });
});

describe('readApiKeyFromStdin TTY', () => {
  it('resolves single-character chunks', async () => {
    const stream = createMockTTY();
    const promise = readApiKeyFromStdin(stream);
    emitChunks(stream, ['t', 'r', 'g', 'v', '_', 'k', '\n']);
    await expect(promise).resolves.toBe('trgv_k');
  });

  it('resolves pasted key in one multi-character chunk', async () => {
    const stream = createMockTTY();
    const promise = readApiKeyFromStdin(stream);
    emitChunks(stream, ['trgv_pasted_key_abcdefghijklmnopqrstuvwxyz12\n']);
    await expect(promise).resolves.toBe('trgv_pasted_key_abcdefghijklmnopqrstuvwxyz12');
  });

  it('resolves pasted key plus CR in one chunk', async () => {
    const stream = createMockTTY();
    const promise = readApiKeyFromStdin(stream);
    emitChunks(stream, ['trgv_pasted_key_abcdefghijklmnopqrstuvwxyz12\r']);
    await expect(promise).resolves.toBe('trgv_pasted_key_abcdefghijklmnopqrstuvwxyz12');
  });

  it('resolves CRLF in one chunk', async () => {
    const stream = createMockTTY();
    const promise = readApiKeyFromStdin(stream);
    emitChunks(stream, ['trgv_key\r\n']);
    await expect(promise).resolves.toBe('trgv_key');
  });

  it('rejects on Ctrl+C', async () => {
    const stream = createMockTTY();
    const promise = readApiKeyFromStdin(stream);
    emitChunks(stream, ['trgv', '\u0003']);
    await expect(promise).rejects.toThrow('Cancelled');
    expect(stream.setRawMode).toHaveBeenCalledWith(false);
  });

  it('restores raw mode and resolves on stream end', async () => {
    const stream = createMockTTY();
    const promise = readApiKeyFromStdin(stream);
    emitChunks(stream, ['trgv_end_key']);
    stream.emit('end');
    await expect(promise).resolves.toBe('trgv_end_key');
    expect(stream.setRawMode).toHaveBeenCalledWith(false);
    expect(stream.pause).toHaveBeenCalled();
  });

  it('restores raw mode and rejects on stream error', async () => {
    const stream = createMockTTY();
    const promise = readApiKeyFromStdin(stream);
    const error = new Error('tty broken');
    stream.emit('error', error);
    await expect(promise).rejects.toThrow('tty broken');
    expect(stream.setRawMode).toHaveBeenCalledWith(false);
  });

  it('rejects when raw mode is unavailable', async () => {
    const stream = createMockTTY();
    delete (stream as { setRawMode?: unknown }).setRawMode;
    await expect(readApiKeyFromStdin(stream)).rejects.toThrow(ConfigError);
  });
});

describe('readApiKeyFromStdin piped', () => {
  it('reads piped stdin', async () => {
    const input = Readable.from(['trgv_piped_key_abcdefghijklmnopqrstuvwxyz12\n']);
    Object.defineProperty(input, 'isTTY', { value: false });
    await expect(readApiKeyFromStdin(input)).resolves.toBe(
      'trgv_piped_key_abcdefghijklmnopqrstuvwxyz12',
    );
  });
});
