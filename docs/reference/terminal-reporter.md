---
title: Terminal reporter
status: experimental
since: unreleased
last_updated: 2026-09-15
audience: contributor
source: src/report/terminal-reporter.ts
depends_on: src/core/finding.ts
---

# Terminal reporter

The default output format for `unmask scan`. Prints a `ScanResult` for human reading.

## Output shape

For a scan with findings:

```text
✖ 6 secrets found in 5 files

src/config/db.ts
12:24 critical aws AK••••••••LE
14:08 high generic Bearer ••••••••
⤷ same secret also in: src/worker.ts:71, src/cron.ts:12

────────────────────────────────────────────────────
6 findings · 3 unique · 41 files · 171ms
```

For a clean scan:

```text
✔ No secrets found · 41 files · 171ms
```

If `ScanResult.filesSkipped` is non-empty, a warning line appears after the summary. The full list of skipped files requires `--verbose`.

## Layout rules

**Grouped by file.** Findings are grouped under their `Finding.file`, files sorted A–Z, findings sorted within each file by line, then column, then severity. This is `compareByLocation` from `core/finding.ts`.

**Columns.** Each finding is one line with three fixed-width fields: location (`line:column`), severity, provider. Location is right-aligned; severity is left-aligned and padded to 8; provider is left-aligned and padded to a width computed from the longest provider name in the run, capped at 12 characters.

**Padding happens before coloring.** ANSI escape sequences count as characters in string length. `chalk.red(s.padEnd(8))` produces the correct column width; `chalk.red(s).padEnd(8)` produces a line that is 8 + (4 escape characters × 2) wide. The reporter applies padding to the raw string, then wraps it in color.

## Cross-file dedup — the `⤷` annotation

When the same `fingerprint` appears in more than one file, the first occurrence is annotated:

```text
⤷ same secret also in: src/worker.ts:71, src/cron.ts:12
```

The annotation is printed **once per fingerprint**, on the first finding encountered in the sorted order. A `printed: Set<string>` guards against repetition. The purpose is to surface "this secret is in N files" without flooding the output with N identical annotations.

The list of other files is not sorted — it comes from the order findings were encountered. In practice, findings from the same `ScanResult` are already grouped by file, so the order is stable. A future improvement is to sort the "also in" list for readability.

## `max-findings`

Defaults to `50`. When the number of printed findings would exceed the limit, the reporter stops printing findings, prints a summary line (`… N more findings (use --max-findings=0)`), and continues to the footer. `--max-findings=0` disables the limit.

The limit counts findings **across all files**, not per file. A repository with 200 findings in 20 files prints the first 50 findings by file order, then the summary. The `filesScanned` and duration in the footer still reflect the whole scan.

## Color detection

The reporter uses `chalk`. Auto-detection order:

1. If the constructor's `color` option is explicitly `true` or `false`, use that.
2. If `NO_COLOR` is set in the environment, disable color.
3. If `FORCE_COLOR === "1"`, enable color.
4. If the output stream is a TTY, enable color. Otherwise disable.

**[TODO] `NO_COLOR` beats `FORCE_COLOR` here.** The conventions suggest `FORCE_COLOR` should win when both are set — it is the more explicit intent. This is a small behavioral question with no right answer; flagging it so it does not get silently changed.

## Redaction

The reporter does not call `redact`. Findings arrive with `Finding.masked` already set — the scanner redacts at construction. `Finding.context` is also already redacted.

**The reporter never handles a raw secret.** The only field on `Finding` that could carry one is `masked`, and by contract it does not.

## Related

- [Finding and ScanResult](./finding.md) — the shape this reporter receives
- [JSON reporter](./json-reporter.md) — the alternative format
- [CLI](./cli.md) — how the reporter is selected
- `src/report/redact.ts` — the masking function applied upstream

---
