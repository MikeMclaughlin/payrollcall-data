#!/usr/bin/env node
import { loadEnv } from "./env.js";
import { parseArgs, helpText } from "./cli.js";
import { run } from "./pipeline.js";

loadEnv();

const args = parseArgs(process.argv);

if (args.help) {
  process.stdout.write(helpText());
  process.exit(0);
}

try {
  await run(args);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\nError: ${message}`);
  if (args.verbose && err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
}
