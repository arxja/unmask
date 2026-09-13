/**
 * Scan orchestration.
 *
 * Owns the lifecycle: discovery → detection → aggregation.
 * Owns the boundary: absolute paths become rootDir-relative, forward-slashed.
 * Owns the failure policy: per-file errors are recorded, not thrown.
 *
 * Does not own: pattern loading (caller), progress UI (CLI), reporting (CLI).
 *
 * Sequential by design for v1. Step 3 replaces the interior with a worker
 * pool; the signature does not change.
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { performance } from "node:perf_hooks";

import {
  discoverFiles,
  type DiscoverOptions,
} from "../discovery/file-discovery";
import { scanContent, type Pattern } from "../detection/regex-engine";
import type { Finding, ScanResult, SkippedFile } from "./finding";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ScanInput {
  /** Absolute path to the directory being scanned. */
  rootDir: string;
  /** Loaded and validated patterns. See loadPatterns. */
  patterns: Pattern[];
  /** Passed to discovery. Defaults apply if omitted. */
  discovery?: DiscoverOptions;
  /** Echoed into ScanResult. The CLI decides what this string means. */
  version: string;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function scan(input: ScanInput): Promise<ScanResult> {
  const start = performance.now();
  const { rootDir, patterns, version } = input;

  const files = discoverFiles(rootDir, input.discovery ?? {});

  const findings: Finding[] = [];
  const filesSkipped: SkippedFile[] = [];
  let filesScanned = 0;

  for (const absPath of files) {
    const relPath = toRelative(absPath, rootDir);

    let content: string;
    try {
      content = await readFile(absPath, "utf-8");
    } catch (error) {
      filesSkipped.push({ path: relPath, reason: describeError(error) });
      continue;
    }

    try {
      findings.push(...scanContent(content, relPath, patterns));
      filesScanned++;
    } catch (error) {
      // A scan-time failure is a bug in a pattern (malformed regex,
      // catastrophic backtracking), not a property of the file. Record
      // it and move on so one bad pattern does not abort the run.
      filesSkipped.push({
        path: relPath,
        reason: `scan failed: ${describeError(error)}`,
      });
    }
  }
  return {
    findings,
    filesScanned,
    filesSkipped,
    durationMs: Math.round(performance.now() - start),
    rootDir,
    version,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Discovery returns absolute paths. Everything downstream of scan-runner
 * uses forward-slashed paths relative to rootDir so that JSON output is
 * byte-identical across platforms and glob-shaped paths work on Windows.
 *
 * `sep` is "/" on POSIX and "\\" on Windows. split/join is a no-op on POSIX.
 */

function toRelative(absPath: string, rootDir: string): string {
  const rel = isAbsolute(absPath) ? relative(rootDir, absPath) : absPath;
  return rel.split(sep).join("/");
}

/**
 * `catch (error)` binds `unknown` under strict mode. Normalize to a string
 * without assuming the thrown value is an Error.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
