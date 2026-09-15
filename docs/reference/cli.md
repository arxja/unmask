---
title: CLI
status: experimental
since: unreleased
last_updated: 2026-09-15
audience: user
source: bin/unmask.ts, src/commands/scan.ts
depends_on: src/commands/exit-code.ts, src/commands/merge-patterns.ts, src/config/load-config.ts
---

# CLI

The `unmask` binary. One subcommand in v1: `scan`. `install` and the git hook land in a later build-order step.

## `unmask scan`

Walks a directory, runs the built-in and custom patterns against every file, and reports findings.

```bash
unmask scan [options]
```

### Options

| Flag                    | Default             | Meaning                                                               |
| ----------------------- | ------------------- | --------------------------------------------------------------------- |
| `-p, --path <dir>`      | `.`                 | Directory to scan. Converted to an absolute path before use.          |
| `-f, --format <format>` | `terminal`          | `terminal` for human output, `json` for machine-readable.             |
| `-o, --output <file>`   | _(stdout)_          | Write output to a file. **Requires `--format=json`.**                 |
| `--fail-on <severity>`  | config, or `medium` | Minimum severity that produces exit code 1.                           |
| `--max-findings <n>`    | `50`                | Maximum findings to print in terminal format. `0` means unlimited.    |
| `--verbose`             | off                 | Print the masked source line under each finding.                      |
| `--no-color`            | auto                | Disable ANSI colors. Auto-detects `NO_COLOR`, `FORCE_COLOR`, and TTY. |

### Exit codes

| Code | Meaning                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------- |
| `0`  | Clean. No findings at or above `--fail-on`, no skipped files.                                                   |
| `1`  | At least one finding at or above `--fail-on`.                                                                   |
| `2`  | The scan was incomplete, or a startup error occurred (missing config, unreadable patterns file, invalid flags). |

**Precedence: findings beat skips.** If a scan produces a failing finding _and_ skipped files, the exit code is `1`. The "incomplete" signal (`2`) is only meaningful when the scan otherwise looks clean — otherwise a CI job would report "incomplete" and the operator would have no way to know there was a finding without reading the output.

**Startup errors produce exit code `2` and a message on stderr.** This includes:

- Unreadable or invalid `.unmaskrc`
- Missing `patterns.json` (or a custom patterns file that does not exist)
- Invalid `--format` or `--output` combination

The message format is `unmask: <description>`. One line, stderr, no stack trace.

### Output formats

**`terminal` (default).** Human-readable, one block per file, sorted by line. Honors `--max-findings`, `--verbose`, and color detection. The output shape is documented in [terminal reporter](./terminal-reporter.md).

**`json`.** A single JSON object written to stdout (or `--output`). Includes a `schemaVersion` field for consumers that persist the output. The output shape is documented in [JSON reporter](./json-reporter.md).

**`--output` requires `--format=json`.** Writing terminal output to a file would either embed ANSI escape codes (wrong for a file) or silently strip them (silently wrong). Failing fast on the combination is the honest behavior.

## Config resolution

`unmask` uses `cosmiconfig` to find a config file, searching from `--path` upward. Recognized names include `.unmaskrc`, `.unmaskrc.json`, `.unmaskrc.yaml`, `.unmaskrc.js`, `unmask.config.js`, and `unmask.config.ts`.

If no config file is found, defaults apply. See [config](./config.md) for the schema.

**`customPatterns` in a config file is resolved relative to `--path`, not the config file's directory.** A user running `unmask scan -p src/` from a repo root with a `.unmaskrc` at the root and `"customPatterns": "my-patterns.json"` will have the path resolved to `<repo>/src/my-patterns.json`. This matches the intuition that paths in a config file are relative to the scan, but it is a `[TODO]` to revisit if it causes confusion when configs are inherited from parent directories.

## Pattern merging

Built-in patterns load from `src/data/patterns.json`. Custom patterns from `customPatterns` (if set) load second. The merged list is built by `mergePatterns`:

- Patterns are identified by `id`.
- A custom pattern with the same `id` as a built-in **overrides** the built-in.
- A custom pattern with the same `id` as another custom pattern overrides the earlier one; the last definition wins.
- Every override is reported on stderr when `scan` starts:

```text
unmask: custom pattern "aws-access-key-id" overrides the built-in pattern of the same id
```

**The user is responsible for the correctness of a custom pattern that shadows a built-in.** `loadPatterns` validates that the regex compiles and the type fields are correct; it does not check that the pattern still detects the provider it names. A custom `aws-access-key-id` that accidentally matches the wrong format is not the tool's problem — the tool reports the override and moves on.

## Related

-   [Config](./config.md) — the file this CLI reads
-   [Finding and ScanResult](./finding.md) — the shape reporters receive
-   [Terminal reporter](./terminal-reporter.md) — the default output format
-   [JSON reporter](./json-reporter.md) — the machine-readable output format