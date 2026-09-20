# Unmask

Unmask is a CLI that finds hardcoded secrets in a codebase before they reach Git. It runs a fast regex pass over every file, then an AST-based verification pass over only the files that produced a candidate — cutting the false positives that make most regex scanners get turned off after a week.

**Pure Node.js. TypeScript, strict mode. Two-stage pipeline.**

```text
file-discovery → [worker pool] → detection (regex) → verification (AST) → finding[] → report
                                                                             ↑
                                                             git/ (staged files, hook)
```

---

## Why

Every regex-only scanner drowns you in lockfile hashes, example keys from READMEs, and `process.env.API_KEY` references. Every AST-only scanner is too slow to run on a commit.

Unmask splits the difference. Detection is cheap and runs on everything. Verification is expensive and runs only where it needs to — on the files that actually produced a hit. The two stages are separate modules with a typed contract between them, and the contract is what makes the whole thing testable.

---

## Install

```bash
npm install -g unmask
```

Or run it locally without installing:

```bash
pnpm dlx unmask scan --path .
```

Requires Node.js 20 or later.

---

## Quick start

Scan the current directory:

```bash
unmask scan
```

Install a pre-commit hook so secrets can't be committed in the first place:

```bash
unmask install
```

That's it. The hook reads the git index (what a commit will record), not the working tree, so it catches exactly what `git commit` would have written.

---

## Commands

### `unmask scan`

Walk a directory, run the built-in and custom patterns against every file, and report findings.

```bash
unmask scan [options]
```

| Flag                    | Default            | Meaning                                                               |
| ----------------------- | ------------------ | --------------------------------------------------------------------- |
| `-p, --path <dir>`      | `.`                | Directory to scan.                                                    |
| `-f, --format <format>` | `terminal`         | `terminal` for human output, `json` for machine-readable.             |
| `-o, --output <file>`   | stdout             | Write output to a file. Requires `--format=json`.                     |
| `--fail-on <severity>`  | config or `medium` | Minimum severity that produces exit code `1`.                         |
| `--max-findings <n>`    | `50`               | Maximum findings to print in terminal format. `0` = unlimited.        |
| `--verbose`             | off                | Print the masked source line under each finding.                      |
| `--no-color`            | auto               | Disable ANSI colors. Auto-detects `NO_COLOR`, `FORCE_COLOR`, and TTY. |
| `--staged`              | off                | Read files from the git index instead of the working tree.            |
| `--quiet`               | off                | Suppress output when the scan is clean.                               |
| `--concurrency <n>`     | `1`                | Worker threads. Values >1 use a pool; output is identical.            |

### `unmask install`

Install the pre-commit hook in the current repository.

```bash
unmask install [--path <dir>]
```

If a pre-commit hook already exists (Husky, a shell script, anything), unmask renames it to `pre-commit.unmask-original` and chains it — the original runs first, and its failure aborts the commit before unmask runs.

If git is configured with a custom `core.hooksPath`, install refuses rather than writing a hook that git will ignore.

### `unmask uninstall`

Remove the pre-commit hook. Restores any chained original.

```bash
unmask uninstall [--path <dir>]
```

Refuses to remove a hook that unmask didn't install. Idempotent — running it when no hook exists succeeds.

---

## Exit codes

| Code | Meaning                                                       |
| ---- | ------------------------------------------------------------- |
| `0`  | Clean. No findings at or above `--fail-on`, no skipped files. |
| `1`  | Findings at or above `--fail-on`.                             |
| `2`  | Scan incomplete (files could not be read) or a startup error. |

**A scan that reads zero files and reports zero findings is not clean** — it exits with code `2`. CI should gate on this: an incomplete scan is a different failure mode from a clean one, and conflating them is how a scanner silently stops working.

---

## Configuration

Unmask looks for `.unmaskrc`, `.unmaskrc.json`, `.unmaskrc.yaml`, `unmask.config.js`, or `unmask.config.ts` starting from `--path` and walking up.

```json
{
  "ignore": ["test/**", "docs/**"],
  "include": ["src/**/*.ts"],
  "failOn": "high",
  "customPatterns": "./patterns.json"
}
```

| Field            | Type                                      | Default    | Meaning                                                                          |
| ---------------- | ----------------------------------------- | ---------- | -------------------------------------------------------------------------------- |
| `ignore`         | `string[]`                                | `[]`       | Additional glob patterns to ignore, on top of the discovery defaults.            |
| `include`        | `string[]`                                | `["**/*"]` | Glob patterns to include.                                                        |
| `failOn`         | `critical` \| `high` \| `medium` \| `low` | `medium`   | Minimum severity that produces exit code `1`. Overridden by `--fail-on`.         |
| `customPatterns` | `string`                                  | —          | Path to a JSON file with additional patterns. Relative to the scanned directory. |

### Custom patterns

Custom patterns are loaded after the built-in registry and merged by `id`. A custom pattern with the same `id` as a built-in **overrides** it, and a message is printed on stderr when the scan starts.

The pattern format is the same as the built-in registry:

```json
{
  "id": "my-service-token",
  "name": "My Service Token",
  "provider": "myservice",
  "regex": "(mst_[A-Za-z0-9]{32})",
  "flags": "",
  "confidence": "high",
  "severity": "critical",
  "entropyCheck": false
}
```

**The last non-empty capture group is treated as the secret.** If your pattern has multiple groups, the last one must be the value you want to detect. Use `(?:...)` for any grouping you don't want treated as the secret.

---

## How it works

### 1. Discovery

`fast-glob` walks the repo, respecting the built-in ignore list (`node_modules`, `.git`, lockfiles) plus whatever `ignore` adds. Discovery returns paths, not contents.

### 2. Detection

For each file, every compiled pattern runs line-by-line. A match produces a `Candidate` — the finding plus the raw secret value. The raw value exists only in the interval between detection and verification; it never lands on a `Finding`.

If a pattern has `entropyCheck: true`, the extracted secret must pass a Shannon entropy gate before a candidate is produced. This is what filters out the low-entropy garbage that shape-matches a pattern.

### 3. Verification

Only files that produced at least one candidate get parsed to an AST (`@babel/parser`). The AST powers a small set of false-positive rules:

| Rule                | Verdict | What it detects                                                                                                                                           |
| ------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test-path`         | adjust  | File path matches a test, fixture, example, or mock pattern. Downgrades severity to `low`.                                                                |
| `placeholder-value` | drop    | Value contains a known placeholder marker (`YOUR_`, `CHANGEME`, `EXAMPLE`, …) or matches a placeholder shape (`<...>`, `${...}`, 8+ repeated characters). |
| `constant-alias`    | drop    | Value is assigned to a variable whose innermost declaration has a fixture-style name (`MOCK_`, `FAKE_`, `TEST_`, …).                                      |
| `env-reference`     | drop    | Value falls inside a `process.env.X` or `import.meta.env.X` expression.                                                                                   |

A `drop` verdict removes the candidate. An `adjust` verdict lowers severity so `--fail-on` decides whether it's worth failing the build over. Rules never mutate findings; they return a verdict and the runner applies it.

### 4. Finding

Every surviving candidate becomes a canonical `Finding` object. All consumers — terminal reporter, JSON reporter, git hook exit code, GitHub Action annotation — read from this one shape.

**`Finding.masked` is the only secret-derived field on the object.** The raw value is gone by the time a `Finding` exists. Redaction happens at construction, not at output, which means no reporter can leak what it never sees.

### 5. Report

Terminal output for humans, JSON for CI. Both consume the same `ScanResult` shape.

### Parallelism

The worker pool parallelizes detection and verification. Discovery is I/O-bound and runs on the main thread. The pool is **opt-in** (`--concurrency > 1`) because worker spawn cost dominates on small repos — a 45-file repo is faster single-threaded.

---

## GitHub Action

A composite action is available under `action/`. It runs `unmask scan`, emits PR annotations at the file and line of each finding, and fails the job based on `--fail-on`.

```yaml
- uses: actions/checkout@v4

- name: Install unmask
  run: npm install -g unmask

- uses: ./.github/actions/unmask
  with:
    fail-on: high
```

See `action/README.md` for inputs and outputs.

---

## Architecture

```text
src/
├── commands/         CLI subcommands (scan, install, uninstall)
├── core/
│   ├── finding.ts        canonical Finding/ScanResult types + comparators
│   ├── file-source.ts    FileSource abstraction (disk | git-staged)
│   ├── scan-runner.ts    orchestration: list → read → detect → verify → aggregate
│   └── scheduler.ts      persistent worker pool
├── detection/
│   ├── regex-engine.ts   pattern loading, line-by-line matching, extraction
│   └── entropy.ts        Shannon entropy gate
├── verification/
│   ├── verify.ts         rule pipeline
│   ├── node-locator.ts   offset → enclosing AST node
│   ├── parsers/          @babel/parser wrapper
│   ├── rules/            one file per false-positive rule
│   └── types.ts          Rule / VerificationContext interfaces
├── discovery/
│   └── file-discovery.ts fast-glob wrapper
├── worker/
│   ├── protocol.ts       ToWorker / FromWorker message types
│   └── scan-worker.ts    worker thread entry point
├── git/
│   ├── staged-files.ts   read from the git index
│   └── hook-installer.ts install/uninstall the pre-commit hook
├── config/
│   ├── schema.ts         zod schema
│   └── load-config.ts    cosmiconfig loader
├── report/
│   ├── redact.ts         masking (single source of truth)
│   ├── terminal-reporter.ts
│   └── json-reporter.ts
└── data/
    └── patterns.json     built-in provider registry
```

### Key decisions

**Redaction at construction, not at output.** `Finding.masked` is the only secret-derived field. Reporters don't import `redact`; they can't leak what they don't receive. This is a stronger guarantee than "redact before printing" and it's enforced by the type system — there is no field on `Finding` that can hold a raw value.

**The `Candidate` boundary.** Rules need the raw secret to detect placeholders. `scanContent` returns `Candidate[]` (finding + raw value); `verifyFindings` returns `Finding[]`. The raw value exists only in that interval.

**One parser, not two.** `@babel/parser` handles both JavaScript and TypeScript with plugin flags. One AST shape, no cross-parser normalization, fewer moving parts.

**Rules return a verdict, not a boolean.** `keep | drop | adjust` — rules that can't be certain can downgrade instead of deciding. Multiple `adjust` verdicts compose; a `drop` is terminal.

**Custom patterns shadow built-ins by `id`.** Users can override a pattern whose regex doesn't fit their codebase. Conflicts are reported on stderr so accidental shadowing is visible.

**Worker pool is opt-in.** Default `--concurrency` is `1`. Workers cost 10–50ms each to spawn, and on a small repo that exceeds the work. Threading is a scale tool, not a default.

**Git hook reads the index, not the working tree.** A developer can have a secret on disk that's unstaged — that's not what `git commit` will record. `git show :path` is the ground truth for what a commit contains.

---

## Development

### Setup

```bash
pnpm install
```

### Run tests

```bash
pnpm test              # watch mode
pnpm test -- run       # single pass
```

### Run the corpus

The corpus measures recall and precision against labeled fixtures under `test/fixtures/`.

```bash
pnpm corpus
```

Output reports total recall, precision, and a per-rule rejection breakdown. A rule that rejects zero fixtures is dead weight. A rule that rejects everything is suspicious.

### Build

```bash
pnpm build
node dist/bin/unmask.js scan --path .
```

The build produces `dist/bin/unmask.js`, `dist/worker/scan-worker.js`, and `dist/data/patterns.json`. The worker must be a separate file at a known location — `resolveWorkerPath` computes it from the scheduler's own `import.meta.url`.

### Dev loop

Run from source with `tsx` — no build step:

```bash
pnpm tsx bin/unmask.ts scan --path .
```

---

## Limitations

- **No streaming.** Files are read fully into memory as strings. Files significantly larger than memory will fail at the read and be recorded in `filesSkipped`.
- **No submodule scanning.** `git diff --cached` reports a submodule as a single entry; files inside it are not scanned by the hook.
- **`test-path` downgrades rather than drops.** A committed secret can leak from a test file as easily as from source. Downgrading lets the CLI's `--fail-on` threshold decide whether it fails the build, without hiding the finding.
- **`constant-alias` matches on variable name, not alias relationships.** It catches `const MOCK_KEY = "..."` but not `const x = MOCK_KEY;`. Full alias analysis requires scope tracking across statements.
- **`template-literal-value` is written but unregistered.** No pattern in the current registry produces a candidate that would trigger it. It ships when a pattern that matches a bare identifier or URL fragment lands.
- **Windows path resolution for the hook is imperfect.** The hook script checks `node_modules/.bin/unmask`, which is the POSIX path. On Windows with Git Bash or WSL it works; a native Windows git install may require a manual adjustment.
- **The GitHub Action does not install unmask.** A prior step in the workflow is responsible. The action assumes the binary is on `PATH`.

---

## Non-goals

- **Scanning binary files, images, or archives.** Unmask scans text.
- **Secret rotation or remediation.** Unmask detects, it doesn't fix.
- **Historical git history scanning.** v1 is staged/working-tree only.
- **SARIF output.** The JSON reporter is the canonical machine-readable format. SARIF is a different feature.

---

## License

MIT - Arash Jafari 2026
