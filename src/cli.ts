import { parseArgs, type ParseArgsConfig, type ParseArgsOptionsConfig } from 'node:util';
import { runConnection, printConnectionUsage } from './commands/connection.js';
import { runSetKey, printConfigUsage } from './commands/config.js';
import { runSend, printSendUsage } from './commands/send.js';
import {
  ApiError,
  AuthenticationError,
  AuthorizationError,
  ConfigError,
  ConflictError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  ServiceUnavailableError,
  TimeoutError,
  TrigvError,
  ValidationError,
} from './errors.js';
import { EXIT_API, EXIT_CONFIG, EXIT_SUCCESS, EXIT_VALIDATION } from './exit-codes.js';
import { VERSION } from './constants.js';
import { printHuman, printJson, type JsonError } from './output.js';

const GLOBAL_OPTIONS = {
  json: { type: 'boolean', default: false },
  'base-url': { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
} as const satisfies ParseArgsConfig['options'];

const SET_KEY_OPTIONS = {
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
} as const satisfies ParseArgsConfig['options'];

const SEND_OPTIONS = {
  ...GLOBAL_OPTIONS,
  channel: { type: 'string' },
  title: { type: 'string' },
  description: { type: 'string' },
  level: { type: 'string' },
  'delivery-urgency': { type: 'string' },
  'event-type': { type: 'string' },
  'image-url': { type: 'string' },
  url: { type: 'string' },
  'idempotency-key': { type: 'string' },
} as const satisfies ParseArgsConfig['options'];

function printRootUsage(): void {
  printHuman(`trigv — send Trigv notification events from the shell

Usage:
  trigv send --channel <slug> --title <text> [options]
  trigv connection [options]
  trigv config set-key [options]

Global options:
  --json        Output JSON to stdout
  --base-url    API base URL (default: https://api.trigv.com; a URL ending in /api also works)
  -h, --help    Show help
  -v, --version Show version

Authentication:
  TRIGV_API_KEY env var, macOS Keychain, or ~/.config/trigv/credentials
  Run \`trigv config set-key\` to store a key locally (stdin or hidden prompt).

Documentation: https://github.com/Trigv/trigv-cli`);
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asBoolean(value: string | boolean | undefined): boolean {
  return value === true;
}

function parseStrictArgs<T extends ParseArgsOptionsConfig>(config: { args: string[]; options: T }) {
  try {
    return parseArgs({
      args: config.args,
      options: config.options,
      strict: true,
      allowPositionals: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid command syntax';
    throw new ValidationError(message);
  }
}

function errorToJson(error: TrigvError): JsonError {
  if (error instanceof ValidationError) {
    return {
      ok: false,
      error: error.message,
      code: 'validation',
      errors: error.errors,
    };
  }
  if (error instanceof ConfigError) {
    return {
      ok: false,
      error: error.message,
      code: 'config',
    };
  }
  if (error instanceof AuthenticationError) {
    return {
      ok: false,
      error: error.message,
      code: 'authentication',
      status_code: error.statusCode,
    };
  }
  if (error instanceof AuthorizationError) {
    return {
      ok: false,
      error: error.message,
      code: 'authorization',
      status_code: error.statusCode,
    };
  }
  if (error instanceof NotFoundError) {
    return {
      ok: false,
      error: error.message,
      code: 'not_found',
      status_code: error.statusCode,
    };
  }
  if (error instanceof RateLimitError) {
    return {
      ok: false,
      error: error.message,
      code: 'rate_limit',
      status_code: error.statusCode,
    };
  }
  if (error instanceof ConflictError) {
    return {
      ok: false,
      error: error.message,
      code: 'conflict',
      status_code: error.statusCode,
    };
  }
  if (error instanceof ServiceUnavailableError) {
    return {
      ok: false,
      error: error.message,
      code: 'service_unavailable',
      status_code: error.statusCode,
    };
  }
  if (error instanceof ApiError) {
    return {
      ok: false,
      error: error.message,
      code: 'api',
      status_code: error.statusCode,
    };
  }
  if (error instanceof NetworkError || error instanceof TimeoutError) {
    return {
      ok: false,
      error: error.message,
      code: error.name === 'TimeoutError' ? 'timeout' : 'network',
    };
  }
  return {
    ok: false,
    error: error.message,
    code: 'unknown',
  };
}

export function mapErrorToExitCode(error: unknown): number {
  if (error instanceof ConfigError) {
    return EXIT_CONFIG;
  }
  if (error instanceof ValidationError) {
    return error.clientSide ? EXIT_VALIDATION : EXIT_API;
  }
  if (
    error instanceof AuthenticationError ||
    error instanceof AuthorizationError ||
    error instanceof NotFoundError ||
    error instanceof RateLimitError ||
    error instanceof ConflictError ||
    error instanceof ServiceUnavailableError ||
    error instanceof ApiError ||
    error instanceof NetworkError ||
    error instanceof TimeoutError
  ) {
    return EXIT_API;
  }
  if (error instanceof TrigvError) {
    return EXIT_VALIDATION;
  }
  return EXIT_VALIDATION;
}

export function handleError(error: unknown, json: boolean): number {
  const exitCode = mapErrorToExitCode(error);
  const message = error instanceof Error ? error.message : String(error);

  if (json) {
    const payload =
      error instanceof TrigvError
        ? { ...errorToJson(error), ...(error.requestId ? { request_id: error.requestId } : {}) }
        : { ok: false, error: message, code: 'usage' };
    printJson(payload);
  } else {
    const requestId = error instanceof TrigvError ? error.requestId : undefined;
    printHuman(requestId ? `Error: ${message} (request id ${requestId})` : `Error: ${message}`);
  }

  return exitCode;
}

export async function run(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const [command, subcommand] = args;

  if (command === '--version' || command === '-v') {
    console.log(VERSION);
    return EXIT_SUCCESS;
  }

  if (!command || command === '--help' || command === '-h') {
    printRootUsage();
    return command ? EXIT_SUCCESS : EXIT_VALIDATION;
  }

  try {
    if (command === 'send') {
      const { values } = parseStrictArgs({
        args: args.slice(1),
        options: SEND_OPTIONS,
      });

      if (values.help) {
        printSendUsage();
        return EXIT_SUCCESS;
      }

      await runSend({
        channel: asString(values.channel),
        title: asString(values.title),
        description: asString(values.description),
        level: asString(values.level),
        deliveryUrgency: asString(values['delivery-urgency']),
        eventType: asString(values['event-type']),
        imageUrl: asString(values['image-url']),
        url: asString(values.url),
        idempotencyKey: asString(values['idempotency-key']),
        baseUrl: asString(values['base-url']),
        json: asBoolean(values.json),
      });
      return EXIT_SUCCESS;
    }

    if (command === 'connection') {
      const { values } = parseStrictArgs({
        args: args.slice(1),
        options: GLOBAL_OPTIONS,
      });

      if (values.help) {
        printConnectionUsage();
        return EXIT_SUCCESS;
      }

      await runConnection({
        baseUrl: asString(values['base-url']),
        json: asBoolean(values.json),
      });
      return EXIT_SUCCESS;
    }

    if (command === 'config' && subcommand === 'set-key') {
      const { values } = parseStrictArgs({
        args: args.slice(2),
        options: SET_KEY_OPTIONS,
      });

      if (values.help) {
        printConfigUsage();
        return EXIT_SUCCESS;
      }

      await runSetKey({
        json: asBoolean(values.json),
      });
      return EXIT_SUCCESS;
    }

    if (command === 'config') {
      printConfigUsage();
      return subcommand ? EXIT_VALIDATION : EXIT_SUCCESS;
    }

    printHuman(`Unknown command: ${command}`);
    printRootUsage();
    return EXIT_VALIDATION;
  } catch (error) {
    const json =
      args.includes('--json') ||
      (() => {
        try {
          const { values } = parseStrictArgs({
            args: args.slice(1),
            options: GLOBAL_OPTIONS,
          });
          return asBoolean(values.json);
        } catch {
          return false;
        }
      })();
    return handleError(error, json);
  }
}
