/**
 * Scan orchestration.
 *
 * Owns the lifecycle: list → read → detect → verify → aggregate.
 * Owns the boundary: absolute paths become rootDir-relative.
 * Owns the failure policy: per-file errors are recorded, not thrown.
 *
 * Does not own: pattern loading (caller), progress UI (CLI), reporting (CLI).
 *
 * Sequential by design for v1. Step 3 replaces the interior with a worker
 * pool; the signature does not change.
 */

import { performance } from "node:perf_hooks";

import { diskSource, type FileSource } from "./file-source";
import { runPool } from "./scheduler";
import { scanContent, type Pattern } from "../detection/regex-engine";
import { verifyFindings } from "../verification/verify";
import type { Finding } from "./finding";
import type { DiscoverOptions } from "../discovery/file-discovery";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ScanInput {
  /** Absolute path to the directory being scanned. */
  rootDir: string;
  /** Loaded and validated patterns. */
  patterns: Pattern[];
  /** Passed to diskSource. Ignored when `source` is set. */
  discovery?: DiscoverOptions;
  /** Echoed into ScanResult. The CLI decides what this string means. */
  version: string;
  /**
   * Where files come from. Defaults to the filesystem rooted at rootDir.
   * Set to a git source for pre-commit scans. When set, `discovery` is
   * ignored — the source owns its own filtering.
   */
  source?: FileSource;
  /**
   * Worker threads for the scan. `1` (default) runs single-threaded on
   * the main thread. Values >1 spawn a pool. Output is identical either
   * way — only wall time changes.
   */
  concurrency?: number;
}

export interface SkippedFile {
  path: string;
  reason: string;
}

export interface ScanResult {
  findings: Finding[];
  filesScanned: number;
  filesSkipped: SkippedFile[];
  durationMs: number;
  rootDir: string;
  version: string;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function scan(input: ScanInput): Promise<ScanResult> {
  const start = performance.now();
  const { rootDir, patterns, version } = input;
  const concurrency = input.concurrency ?? 1;

  const source =
    input.source ?? diskSource({ rootDir, discovery: input.discovery });

  const paths = source.list();
  const findings: Finding[] = [];
  const filesSkipped: SkippedFile[] = [];
  let filesScanned = 0;

  if (concurrency > 1) {
    const results = await runPool(paths, {
      concurrency,
      patterns,
      reader: source.readerConfig,
    });

    for (const r of results) {
      if (r.findings !== undefined) {
        findings.push(...r.findings);
        filesScanned++;
      } else if (r.error !== undefined) {
        filesSkipped.push({ path: r.path, reason: r.error });
      }
    }
  } else {
    for (const relPath of paths) {
      let content: string;
      try {
        content = await source.read(relPath);
      } catch (error) {
        filesSkipped.push({ path: relPath, reason: describeError(error) });
        continue;
      }

      try {
        const candidates = scanContent(content, relPath, patterns);
        const verified =
          candidates.length > 0
            ? verifyFindings(candidates, content, relPath)
            : [];
        findings.push(...verified);
        filesScanned++;
      } catch (error) {
        filesSkipped.push({
          path: relPath,
          reason: `scan failed: ${describeError(error)}`,
        });
      }
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

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
