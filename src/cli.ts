import { parseArgs, type ParseArgsConfig } from 'node:util';
import { runConnection, printConnectionUsage } from './commands/connection.js';
import { runSetKey, printConfigUsage } from './commands/config.js';
import { runSend, printSendUsage } from './commands/send.js';
import {
  ApiError,
  AuthenticationError,
  AuthorizationError,
  ConfigError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  TimeoutError,
  TrigvError,
  ValidationError,
} from './errors.js';
import { EXIT_API, EXIT_CONFIG, EXIT_SUCCESS, EXIT_VALIDATION } from './exit-codes.js';
import { printHuman, printJson, type JsonError } from './output.js';

const GLOBAL_OPTIONS = {
  json: { type: 'boolean', default: false },
  'base-url': { type: 'string' },
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
  'idempotency-key': { type: 'string' },
} as const satisfies ParseArgsConfig['options'];

function printRootUsage(): void {
  printHuman(`trigv — send Trigv notification events from the shell

Usage:
  trigv send --channel <slug> --title <text> [options]
  trigv connection [options]
  trigv config set-key <api-key> [options]

Global options:
  --json        Output JSON to stdout
  --base-url    API base URL (default: https://api.trigv.com/api)
  -h, --help    Show help

Authentication:
  TRIGV_API_KEY env var, macOS Keychain, or ~/.config/trigv/credentials
  Run \`trigv config set-key <key>\` to store a key locally.

Documentation: https://github.com/Trigv/trigv-cli`);
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asBoolean(value: string | boolean | undefined): boolean {
  return value === true;
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
        ? errorToJson(error)
        : { ok: false, error: message, code: 'usage' };
    printJson(payload);
  } else {
    printHuman(`Error: ${message}`);
  }

  return exitCode;
}

export async function run(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const [command, subcommand, ...rest] = args;

  if (!command || command === '--help' || command === '-h') {
    printRootUsage();
    return command ? EXIT_SUCCESS : EXIT_VALIDATION;
  }

  try {
    if (command === 'send') {
      const { values } = parseArgs({
        args,
        options: SEND_OPTIONS,
        allowPositionals: true,
        strict: false,
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
        idempotencyKey: asString(values['idempotency-key']),
        baseUrl: asString(values['base-url']),
        json: asBoolean(values.json),
      });
      return EXIT_SUCCESS;
    }

    if (command === 'connection') {
      const { values } = parseArgs({
        args,
        options: GLOBAL_OPTIONS,
        allowPositionals: true,
        strict: false,
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
      const { values } = parseArgs({
        args,
        options: GLOBAL_OPTIONS,
        allowPositionals: true,
        strict: false,
      });

      if (values.help) {
        printConfigUsage();
        return EXIT_SUCCESS;
      }

      const apiKey = rest[0];
      await runSetKey({
        apiKey,
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
          const { values } = parseArgs({
            args,
            options: GLOBAL_OPTIONS,
            allowPositionals: true,
            strict: false,
          });
          return asBoolean(values.json);
        } catch {
          return false;
        }
      })();
    return handleError(error, json);
  }
}
