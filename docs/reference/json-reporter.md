---
title: JSON reporter
status: experimental
since: unreleased
last_updated: 2026-09-15
audience: contributor
source: src/report/json-reporter.ts
depends_on: src/core/finding.ts
---

# JSON reporter

Machine-readable output for `unmask scan --format=json`. Writes a single JSON object to stdout, or to a file if `--output` is set.

## Schema

```json
{
  "schemaVersion": 1,
  "tool": { "name": "unmask", "version": "1.0.0" },
  "scannedAt": "2026-09-14T10:23:11.482Z",
  "rootDir": "/abs/path/to/repo",
  "summary": {
    "filesScanned": 41,
    "filesSkipped": 0,
    "durationMs": 171,
    "findings": 6,
    "uniqueSecrets": 3,
    "bySeverity": { "critical": 4, "high": 2, "medium": 0, "low": 0 }
  },
  "findings": [
    /* ... */
  ],
  "skipped": []
}
```

### Top-level fields

| Field           | Meaning                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| `schemaVersion` | Integer. Bump on any breaking change to this document's structure. Consumers should key on it.                     |
| `tool`          | `{ name, version }`. The name is always `"unmask"`; the version is echoed from `ScanResult.version`.               |
| `scannedAt`     | ISO 8601 timestamp of when the payload was built. Not the start of the scan — see `durationMs` for the run length. |
| `rootDir`       | Absolute path that every `Finding.file` is relative to.                                                            |
| `summary`       | Counters. See below.                                                                                               |
| `findings`      | The findings array, sorted by `compareFindings` (severity → file → line → column).                                 |
| `skipped`       | Files that could not be read or scanned. See [scan runner](./scan-runner.md) for why this matters.                 |

### `summary`

| Field           | Meaning                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `filesScanned`  | Files read and scanned successfully. Includes files with zero findings.                                                                                |
| `filesSkipped`  | Length of the top-level `skipped` array. Present so a consumer can detect an incomplete scan without walking the findings.                             |
| `durationMs`    | Wall time of the scan in milliseconds.                                                                                                                 |
| `findings`      | Total finding count. Equal to `findings.length`.                                                                                                       |
| `uniqueSecrets` | Number of distinct `fingerprint` values across all findings. This is not the same as `findings.length` when the same secret appears in multiple files. |
| `bySeverity`    | Count per severity. Every severity key is present, even at zero.                                                                                       |

### `findings[]`

Each element is a serialized `Finding`. The field list is **explicit**, not a spread — see the Redaction note below.

| Field         | Type                               |
| ------------- | ---------------------------------- | --------- |
| `patternId`   | string                             |
| `patternName` | string                             |
| `provider`    | string                             |
| `severity`    | string                             |
| `confidence`  | string                             |
| `file`        | string (relative, forward-slashed) |
| `line`        | number (1-based)                   |
| `column`      | number (1-based)                   |
| `masked`      | string                             |
| `fingerprint` | string (12 hex chars)              |
| `context`     | string\\[\\] \\                    | undefined |

### `skipped[]`

Each element is `{ path: string, reason: string }`. `reason` is human-readable and not stable across versions; do not parse it.

## Sorting and mutation

`findings` is sorted by `compareFindings` before serialization. The sort operates on a **copy** — the caller's `ScanResult.findings` array is not mutated. Callers that reuse a `ScanResult` after passing it to this reporter get their original array order back.

## Redaction

The reporter does not call `redact`. Findings arrive with `masked` and `context` already redacted — the scanner handles this at construction. See [Finding](./finding.md).

`serializeFinding` uses an **explicit field list** rather than spreading `Finding`. This is the reporter's last line of defense against a future field being added to `Finding` that carries a raw value (a `raw`, a `rawMatch`, a `debugContext`). With a spread, such a field would silently appear in JSON output. With an explicit list, it does not.

## Writing to a file

When `--output` is set, the reporter writes the JSON to that path with `writeFileSync`. The file ends with a newline. When `--output` is unset, the JSON is written to the configured stream (default: `process.stdout`) followed by a newline.

**`--output` requires `--format=json`.** The CLI validates this; the reporter itself does not. A caller that constructs a `JsonReporter` with `outFile` set is responsible for the choice.

## Related

- [Finding and ScanResult](./finding.md) — the shape this reporter serializes
- [Terminal reporter](./terminal-reporter.md) — the alternative format
- [CLI](./cli.md) — how the reporter is selected
- [Scan runner](./scan-runner.md) — where `filesSkipped` originates
