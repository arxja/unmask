#!/usr/bin/env node
import { Command } from "commander";
import { createRequire } from "node:module";

import { runScan, type ScanCliOptions } from "../src/commands/scan";
import {
  InstallCliOptions,
  runInstall,
  runUninstall,
} from "../src/commands/install";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Read package.json at runtime to keep the version string in one place.
// `createRequire` gives us CommonJS `require` semantics inside an ESM
// module — the JSON is loaded synchronously, which is fine at startup.
const require = createRequire(import.meta.url);

/**
 * Read the package version by walking up from this file until a
 * package.json is found.
 *
 * Layouts this has to work in:
 *   dev:     <root>/bin/unmask.ts          → <root>/package.json
 *   build:   <root>/dist/bin/unmask.js     → <root>/package.json
 *   install: <pkg>/dist/bin/unmask.js      → <pkg>/package.json
 *
 * A fixed relative path fails at least one of these. The upward walk
 * finds the nearest ancestor package.json, which is the right one in
 * every case: the walk starts inside the unmask package directory and
 * stops before escaping it.
 */
function readPackageVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf-8")) as {
          version?: unknown;
        };
        if (typeof pkg.version === "string") return pkg.version;
      } catch {
        // Malformed JSON or read error — fall through to the parent.
        // Not expected in practice; the fallback is defensive.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return "0.0.0";
}

const pkgVersion = readPackageVersion();

const program = new Command();

program
  .name("unmask")
  .description("Scan a codebase for hardcoded secrets")
  .version(pkgVersion, "-v, --version");

program
  .command("scan")
  .description("Scan a directory for hardcoded secrets")
  .option(
    "-p, --path <dir>",
    "directory to scan (default: current working directory)",
  )
  .option("--concurrency <n>", "worker threads for scanning (default: 1)", "1")
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
  .option(
    "--staged",
    "scan staged files from the git index (for pre-commit hooks)",
  )
  .option("--quiet", "suppress output when the scan is clean")
  .action(async (opts: ScanCliOptions) => {
    const code = await runScan(opts, pkgVersion);
    process.exitCode = code;
  });

program
  .command("install")
  .description("Install the pre-commit hook in the current repository")
  .option(
    "-p, --path <dir>",
    "repository root (default: current working directory)",
  )
  .action(async (opts: InstallCliOptions) => {
    process.exitCode = await runInstall(opts);
  });

program
  .command("uninstall")
  .description("Remove the pre-commit hook")
  .option(
    "-p, --path <dir>",
    "repository root (default: current working directory)",
  )
  .action(async (opts: InstallCliOptions) => {
    process.exitCode = await runUninstall(opts);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`unmask: ${message}\n`);
  process.exitCode = 2;
});
