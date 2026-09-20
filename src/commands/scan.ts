import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { configLoader } from "../config/load-config";
import { loadPatterns, type Pattern } from "../detection/regex-engine";
import { scan } from "../core/scan-runner";
import type { Severity } from "../core/finding";
import { TerminalReporter } from "../report/terminal-reporter";
import { JsonReporter } from "../report/json-reporter";
import { gitStagedSource } from "../git/staged-files";
import { mergePatterns, type PatternConflict } from "./merge-patterns";
import { exitCodeFor } from "./exit-code";

export interface ScanCliOptions {
  path?: string;
  format?: string;
  output?: string;
  failOn?: Severity;
  maxFindings?: string;
  verbose?: boolean;
  color?: boolean;
  /** Read from the git index instead of the working tree. */
  staged?: boolean;
  /** Suppress output when the scan is clean. */
  quiet?: boolean;
  /** Worker threads for the scan. Passed through to scan(). */
  concurrency?: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILTIN_PATTERNS_PATH = resolve(HERE, "../data/patterns.json");
const DEFAULT_CONCURRENCY = 1;

export async function runScan(
  opts: ScanCliOptions,
  version = "0.0.0",
): Promise<number> {
  const rootDir = resolve(opts.path ?? ".");
  const format = opts.format ?? "terminal";

  if (format !== "terminal" && format !== "json") {
    throw new Error(`--format must be "terminal" or "json" (got "${format}")`);
  }
  if (opts.output && format !== "json") {
    throw new Error("--output requires --format=json");
  }

  const config = await configLoader(rootDir);
  const failOn: Severity = opts.failOn ?? config.failOn ?? "medium";
  const concurrency = parseConcurrency(opts.concurrency);

  const builtin = loadPatterns(BUILTIN_PATTERNS_PATH);
  const custom = config.customPatterns
    ? loadPatterns(resolve(rootDir, config.customPatterns))
    : [];

  const { patterns, conflicts } = mergePatterns(builtin, custom);
  if (!opts.quiet) reportConflicts(conflicts);

  // When --staged is set, files come from the git index. Otherwise the
  // disk source (the default in scan-runner) is used. The two are
  // mutually exclusive by construction: we either pass a source or we
  // don't.
  const source = opts.staged
    ? gitStagedSource({
        rootDir,
        ignore: config.ignore,
        include: config.include,
      })
    : undefined;

  const result = await scan({
    rootDir,
    patterns,
    discovery: { ignore: config.ignore, include: config.include },
    version,
    source,
    concurrency,
  });

  // --quiet: print nothing only when the scan is genuinely clean. A
  // scan with skipped files has an exit code of 2 and the user should
  // see why, so we suppress only when there are no findings AND no
  // skipped files.
  if (
    opts.quiet &&
    result.findings.length === 0 &&
    result.filesSkipped.length === 0
  ) {
    return 0;
  }

  const reporter = pickReporter(opts, format);
  await reporter.report(result);

  if (opts.output) {
    process.stderr.write(
      `unmask: ${result.findings.length} finding(s) → ${opts.output}\n`,
    );
  }

  return exitCodeFor(result, failOn);
}

// ... rest of file unchanged (pickReporter, parseCount, reportConflicts) ...

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function pickReporter(opts: ScanCliOptions, format: string) {
  if (format === "json") {
    return new JsonReporter({
      outFile: opts.output,
      pretty: !opts.output,
    });
  }
  return new TerminalReporter({
    // commander default for --no-color is `true`; convert back to
    // undefined so the reporter's auto-detection applies when the user
    // did not pass the flag either way.
    color: opts.color === false ? false : undefined,
    maxFindings: parseCount(opts.maxFindings, 50),
    verbose: opts.verbose,
  });
}

function parseCount(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(
      `--max-findings must be a non-negative integer (got "${raw}")`,
    );
  }
  return n;
}

function parseConcurrency(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_CONCURRENCY;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`--concurrency must be a positive integer (got "${raw}")`);
  }
  return n;
}

function reportConflicts(conflicts: readonly PatternConflict[]): void {
  for (const c of conflicts) {
    if (c.shadowedSource === "builtin") {
      process.stderr.write(
        `unmask: custom pattern "${c.id}" overrides the built-in pattern of the same id\n`,
      );
    } else {
      process.stderr.write(
        `unmask: duplicate custom pattern id "${c.id}" — the last definition is used\n`,
      );
    }
  }
}
