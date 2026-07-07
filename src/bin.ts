#!/usr/bin/env node
import { run, handleError } from './cli.js';

async function main(): Promise<void> {
  const code = await run(process.argv);
  process.exit(code);
}

main().catch((error: unknown) => {
  const code = handleError(error, false);
  process.exit(code);
});
