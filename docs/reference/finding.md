---
title: Finding and ScanResult
status: experimental
since: unreleased
last_updated: 2026-09-15
audience: contributor
source: src/core/finding.ts
depends_on: src/report/redact.ts
---

# Finding and ScanResult

The shared contract between every producer and every consumer in the pipeline. `detection/` produces `Finding` objects; `core/scan-runner.ts` aggregates them into a `ScanResult`; every reporter consumes the `ScanResult`.

This module imports nothing from the project. It is the leaf of the dependency graph, and that is deliberate: if a circular import ever appears, the first thing to check is whether something in this file gained a project import it should not have.

## `Finding`

```typescript
interface Finding {
  patternId: string;
  patternName: string;
  provider: string;
  severity: Severity;
  confidence: Confidence;
  file: string;
  line: number;
  column: number;
  masked: string;
  fingerprint: string;
  context?: string[];
}
```

| Field         | Meaning                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------ | --------------------------------------------- |
| `patternId`   | The `id` of the pattern that produced this finding. Matches the entry in `patterns.json`.       |
| `patternName` | Human-readable name, copied from the pattern. Not an identifier; two patterns may share a name. |
| `provider`    | Short provider label (`aws`, `github`, `stripe`, `generic`). Sortable; used in terminal output. |
| `severity`    | `"critical" \\                                                                                  | "high" \\   | "medium" \\                                                        | "low"`. Drives exit codes and terminal color. |
| `confidence`  | `"high" \\                                                                                      | "medium" \\ | "low"`. Not yet consumed; reserved for the AST verification stage. |
| `file`        | Path relative to `ScanResult.rootDir`, forward-slashed on every platform.                       |
| `line`        | 1-based.                                                                                        |
| `column`      | 1-based. Column of the match start within the line, not within the file.                        |
| `masked`      | The redacted secret. **Never the raw value.** See Redaction.                                    |
| `fingerprint` | SHA-256 of the extracted secret, first 12 hex characters. Stable across runs and platforms.     |
| `context`     | Zero or one source line(s), with the secret already masked. Absent if not captured.             |

**Invariant: `file` is relative and forward-slashed.** The conversion happens once, in `core/scan-runner.ts`'s `toRelative`. Every consumer downstream — terminal, JSON, git hook, GitHub Action — sees paths in the same shape, on every platform. If a reporter ever receives an absolute path or a backslash, the value came from somewhere other than `scan-runner`.

**Invariant: `masked` is never the raw secret.** The scanner calls `redact(secret)` when constructing the finding. No consumer ever sees the value. This is why reporters do not import `report/redact.ts` for the `masked` field — it is already masked when they receive it. (Reporters do import `redact` for scrubbing context if they need to, but the field they receive is pre-masked.)

**Silent failure mode to know about: an empty `context` array is indistinguishable from an absent one.** The field is optional; a producer that could not capture context may omit it or pass `[]`, and consumers must handle both. In v1 the scanner always passes a one-element array, but the contract allows both forms.

## Enumerations

```typescript
const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const CONFIDENCES = ["high", "medium", "low"] as const;

type Severity = (typeof SEVERITIES)[number];
type Confidence = (typeof CONFIDENCES)[number];
```

he arrays are the runtime representation; the types are derived from them. Adding a severity to the array updates the type, the validator, the rank map, and any CLI parser simultaneously. There is no second list to keep in sync.

`isSeverity` and `isConfidence` are runtime validators used at the pattern-load boundary. A `patterns.json` entry with `severity: "sev:critical"` is rejected at load, not at reporter time.

## `SEVERITY_RANK`

```typescript
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};
```

Ascending numerical rank where a **lower number is more severe**. Every comparator and every threshold check depends on this direction.

The direction is inverted from what "rank" usually implies. `critical` being `0` means `severityRank(a) < severityRank(b)` reads as "a is more severe than b" — a comparison that reads like a natural language phrase but uses a `less than`. When adding a consumer, keep the direction consistent; a comparison done in the other direction will pass tests silently until it fails in production with the wrong exit code.

## Ordering comparators

```typescript
function compareFindings(a: Finding, b: Finding): number;
function compareByLocation(a: Finding, b: Finding): number;
```

Both satisfy `Array.prototype.sort`'s comparator contract: negative means `a` first, positive means `b` first, zero means unchanged.

| Comparator          | Order                           | Used by                                     |
| ------------------- | ------------------------------- | ------------------------------------------- |
| `compareFindings`   | severity → file → line → column | JSON output, cross-file summaries           |
| `compareByLocation` | line → column → severity        | Terminal output, which groups by file first |

`compareFindings` sorts by severity first so the top of the JSON output is the most severe finding in the scan, regardless of file. `compareByLocation` sorts by line first so a developer reading the terminal output reads the file top-to-bottom, with severity as a tiebreaker within a line.

**`sort` mutates in place.** Both comparators are pure, but `Array.prototype.sort` is not. Callers must copy before sorting (`[...findings].sort(compareFindings)`) or accept the mutation.

## `ScanResult`

```typescript
interface ScanResult {
  findings: Finding[];
  filesScanned: number;
  filesSkipped: SkippedFile[];
  durationMs: number;
  rootDir: string;
  version: string;
}
```

| Field          | Meaning                                                                                 |
| -------------- | --------------------------------------------------------------------------------------- |
| `findings`     | Aggregated findings from every file in the scan. Unsorted — the consumer decides order. |
| `filesScanned` | Files read and scanned successfully. Includes files with zero findings.                 |
| `filesSkipped` | Files that could not be read or scanned. Disjoint from `filesScanned`.                  |
| `durationMs`   | Wall time of the scan, from discovery to return.                                        |
| `rootDir`      | Absolute path that every `Finding.file` is relative to.                                 |
| `version`      | Opaque string. The CLI sets it to the tool's version; tests set it to `"test"`.         |

**Invariant:**

```text
filesScanned + filesSkipped.length === <files returned by discovery>
```

Every discovered file is either fully processed or recorded with a reason. Never both, never neither. This invariant is why `filesScanned++` sits inside the scan try-block in `scan-runner.ts` — a file that throws mid-scan lands in `filesSkipped` and not in `filesScanned`.

**Silent failure mode to know about: a scan with zero findings and non-empty `filesSkipped` is not clean.** Every file could have been skipped and the result would look identical to a genuinely clean scan from the `findings` array alone. Reporters must check `filesSkipped.length`; the CLI must return exit code 2 in that case. See [scan runner](./scan-runner.md) for the aggregation rules and [CLI](./cli.md) for the exit-code policy.

## `Reporter`

```typescript

interface Reporter {
  report(result: ScanResult): void | Promise<void\>;
}
```

The return type acknowledges that a reporter _may_ be async — writing to a remote API, streaming to a file that needs an `await` — but usually is not. Callers should `await` the result regardless of the concrete reporter to remain future-proof.

## Related

- [Scan runner](./scan-runner.md) — the module that produces `ScanResult`
- [Regex detection engine](./regex-engine.md) — the module that produces `Finding`
- [CLI](./cli.md) — exit-code policy driven by `severity` and `filesSkipped`
- `src/report/redact.ts` — the masking function called before `Finding.masked` is set
