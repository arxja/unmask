/**
 * Canonical finding types for the whole tool.
 *
 * Import graph:
 *   detection/*      →  produces Finding
 *   verification/*   →  enriches Finding (confidence, false-positive filtering)
 *   core/scan-runner →  aggregates into ScanResult
 *   report/*         →  consumes ScanResult
 *
 * This file imports nothing from the project. That is deliberate: it is
 * the boundary type, and everything else depends on it. Do not add
 * imports here.
 *
 * Invariants:
 *   - `masked` is already redacted. There is no `raw` field by design.
 *   - `file` is relative to ScanResult.rootDir.
 *   - `line` and `column` are 1-based (editor convention).
 */

// ---------------------------------------------------------------------------
// Enumerations — derive types from arrays so the runtime and the type
// system can never drift.
// ---------------------------------------------------------------------------

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export const CONFIDENCES = ["high", "medium", "low"] as const;

export type Severity = (typeof SEVERITIES)[number];
export type Confidence = (typeof CONFIDENCES)[number];

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function isSeverity(value: unknown): value is Severity {
  return (
    typeof value === "string" &&
    (SEVERITIES as readonly string[]).includes(value)
  );
}

export function isConfidence(value: unknown): value is Confidence {
  return (
    typeof value === "string" &&
    (CONFIDENCES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export interface Finding {
  patternId: string;
  patternName: string;
  provider: string;
  severity: Severity;
  confidence: Confidence;
  /** Path relative to ScanResult.rootDir. */
  file: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  /** Masked secret. Never the raw value. */
  masked: string;
  /** SHA-256 of the extracted secret, truncated. Stable across runs. */
  fingerprint: string;
  /** Source line(s) with the secret masked. Absent if not captured. */
  context?: string[];
}

export interface SkippedFile {
  /** Path relative to ScanInput.rootDir, forward-slashed. */
  path: string;
  /** Human-readable reason. Free-form; do not parse. */
  reason: string;
}

export interface ScanResult {
  findings: Finding[];
  /** Files read and scanned successfully. Includes files with 0 findings. */
  filesScanned: number;
  /** Files that could not be read or scanned. Disjoint from filesScanned. */
  filesSkipped: SkippedFile[];
  durationMs: number;
  rootDir: string;
  version: string;
}

export interface Reporter {
  report(result: ScanResult): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Canonical ordering — one source of truth so every reporter produces
// the same order for the same input.
// ---------------------------------------------------------------------------

/**
 * Flat ordering used for cross-file summaries and JSON output:
 * severity (desc) → file (A–Z) → line → column.
 */
export function compareFindings(a: Finding, b: Finding): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    a.file.localeCompare(b.file) ||
    a.line - b.line ||
    a.column - b.column
  );
}

/**
 * Within-file ordering used when a reporter groups findings by file:
 * line → column → severity. Reads top-to-bottom like the source file.
 */
export function compareByLocation(a: Finding, b: Finding): number {
  return (
    a.line - b.line ||
    a.column - b.column ||
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  );
}
