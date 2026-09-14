import { SEVERITY_RANK, type Severity } from "../core/finding";
import type { ScanResult } from "../core/finding";

/**
 * Exit codes for `unmask scan`:
 *
 *   0 — clean. No findings at or above `failOn`, no skipped files.
 *   1 — findings at or above `failOn`.
 *   2 — incomplete scan. At least one file could not be read.
 *
 * Precedence: findings beat skips. If there are findings that should
 * fail CI, the CI fails with 1 even if files were also skipped. The
 * skipped-files signal is only meaningful when the scan otherwise
 * looks clean.
 */
export function exitCodeFor(result: ScanResult, failOn: Severity): number {
  const hasFailing = result.findings.some(
    (f) => SEVERITY_RANK[f.severity] <= SEVERITY_RANK[failOn],
  );
  if (hasFailing) return 1;
  if (result.filesSkipped.length > 0) return 2;
  return 0;
}
