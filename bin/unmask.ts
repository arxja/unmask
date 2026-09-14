#!/usr/bin/env node
import { Command } from "commander";
import { createRequire } from "node:module";

import { runScan, type ScanCliOptions } from "../src/commands/scan";

// Read package.json at runtime to keep the version string in one place.
// `createRequire` gives us CommonJS `require` semantics inside an ESM
// module — the JSON is loaded synchronously, which is fine at startup.
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const program = new Command();

program
  .name("unmask")
  .description("Scan a codebase for hardcoded secrets")
  .version(pkg.version, "-v, --version");

program
  .command("scan")
  .description("Scan a directory for hardcoded secrets")
  .option(
    "-p, --path <dir>",
    "directory to scan (default: current working directory)",
  )
  .option("-f, --format <format>", "output format: terminal | json", "terminal")
  .option(
    "-o, --output <file>",
    "write output to a file (requires --format=json)",
  )
  .option("--fail-on <severity>", "minimum severity that fails the scan")
  .option(
    "--max-findings <n>",
    "maximum findings to print; 0 = unlimited",
    "50",
  )
  .option("--verbose", "print the source context under each finding")
  .option("--no-color", "disable ANSI colors in terminal output")
  .action(async (opts: ScanCliOptions) => {
    const code = await runScan(opts, pkg.version);
    process.exitCode = code;
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`unmask: ${message}\n`);
  process.exitCode = 2;
});
