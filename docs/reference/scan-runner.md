---
title: Scan runner
status: experimental
since: unreleased
last_updated: 2026-09-13
audience: contributor
source: src/core/scan-runner.ts
depends_on: src/discovery/file-discovery.ts, src/detection/regex-engine.ts, src/core/finding.ts
---

# Scan runner

Orchestration for a single scan pass. Owns the lifecycle — discovery, per-file detection, aggregation — and the boundary between filesystem paths and the paths that appear in `Finding.file`.

Does not own pattern loading (the caller), progress UI (the CLI), or reporting (the CLI). It is an async function of its inputs with no state that survives a call.

## Why this module exists

The scanner has three phases that must happen in order with specific error handling:

1. **Discovery** returns a list of absolute paths.
2. **Detection** runs each file's content through `scanContent`, producing `Finding[]` per file.
3. **Aggregation** flattens those into a single `ScanResult`.

Each phase is its own module. Something has to sequence them and decide what happens when a file cannot be read, when a pattern throws, and how absolute paths become relative. That is this file's entire job.

Two decisions are made here and only here:

- **`rootDir` normalization.** Discovery returns absolute paths. `Finding.file` is relative. The conversion happens in `toRelative` and nowhere else. If a reporter ever displays an absolute path, the value came from somewhere other than this module.
- **Partial-failure policy.** A file that cannot be read, or that throws during scanning, is recorded in `filesSkipped` and the scan continues.

## `scan`

```typescript
export async function scan(input: ScanInput): Promise<ScanResult>;
```

Single entry point. Async by contract, not by necessity: the interior is currently a sequential loop of awaited reads, but the signature is the boundary that step 3 (worker pool) will swap behind. Callers `await` it in either version.

### `ScanInput`

```typescript
interface ScanInput {
  rootDir: string; // absolute path
  patterns: Pattern[]; // loaded and validated; see loadPatterns
  discovery?: DiscoverOptions;
  version: string; // echoed into ScanResult
}
```

**`rootDir` must be absolute.** Discovery resolves `cwd: rootDir` and returns absolute paths; `path.relative` assumes `rootDir` is absolute. A relative `rootDir` produces findings whose `file` fields are relative to an ambiguous base, which is a class of bug that surfaces as different output on different machines.

**`patterns` is the caller's responsibility.** This module does not call `loadPatterns`. Loading is a startup-time concern (fail before touching the filesystem), and separating it means tests can construct patterns inline without touching `patterns.json`.

**`version` is opaque.** The module does not read `package.json`, does not import anything from `bin/`, does not know what version is. It echoes the string into `ScanResult.version`.

### `ScanResult`

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

**`filesScanned` counts only files that were read and scanned successfully.** A file that produced zero findings is still counted. A clean file is scanned, not skipped.

**`filesSkipped` is disjoint from `filesScanned`.** The invariant is:

```text
filesScanned + filesSkipped.length === files.length
```

where `files.length` is the number of paths discovery returned. Every file is either fully processed or recorded with a reason. Never both, never neither.

**`durationMs` includes discovery.** It is measured from entry to return with `performance.now()`, not `Date.now()` — the former is monotonic and not subject to wall-clock adjustments (NTP, manual clock changes, DST).

### `SkippedFile`

```typescript
interface SkippedFile {
  path: string; // relative to rootDir, forward-slashed
  reason: string; // free-form, human-readable
}
```

`reason` is not a stable identifier. It may be an OS error message (`EACCES: permission denied`), a scan error (`scan failed: <message>`), or anything else the underlying call produced. Do not match on it in downstream code beyond `/^scan failed:/` if you must distinguish scan-time from read-time failures.

## The two phases

### Phase 1 — Discovery

```typescript
const files = discoverFiles(rootDir, input.discovery ?? {});
```

`discoverFiles` is synchronous and returns absolute paths. Its defaults (ignore rules, `onlyFiles: true`, `suppressErrors: true`) apply unless `ScanInput.discovery` overrides them.

**Discovery errors are suppressed, not surfaced.** `suppressErrors: true` means a directory that `fast-glob` cannot enter is silently skipped. Files under that directory will not appear in the returned list and will not appear in `filesSkipped` either — they were never discovered. If the caller needs to know which subtrees were unreadable, that requires a discovery-level change.

### Phase 2 — Per-file read and detect

For each path, in order:

1.  Convert the absolute path to a forward-slashed path relative to `rootDir`.
2.  Read the file with `readFile(absPath, 'utf-8')`. On failure, record in `filesSkipped` and continue.
3.  Call `scanContent(content, relPath, patterns)`. On failure, record in `filesSkipped` and continue.
4.  Append the returned findings to the accumulator and increment `filesScanned`.

**Sequential, not concurrent.** Each file is awaited before the next is read. Reading is I/O-bound but detection is CPU-bound and single-threaded, so overlapping reads with `Promise.all` would not meaningfully reduce wall time. Sequential is also trivially debuggable. The worker pool in step 3 replaces this loop; the surrounding structure does not change.

## Path normalization

```typescript
function toRelative(absPath: string, rootDir: string): string {
  const rel = isAbsolute(absPath) ? relative(rootDir, absPath) : absPath;
  return rel.split(sep).join("/");
}
```

Three steps:

**Defensive absolute check.** Discovery returns absolute paths by default, but `DiscoverOptions.absolute` can be set to `false`. `isAbsolute` handles both cases.

**`path.relative`.** Node's built-in. Does not throw if `absPath` is not under `rootDir`; it returns a `..`\-prefixed path, which is the correct behavior — a wrong `rootDir` is made visible rather than hidden.

**Forward-slash normalization.** `sep` is `"/"` on POSIX and `"\\"` on Windows. `split(sep).join("/")` is a no-op on POSIX and converts backslashes on Windows. This matters because JSON output from the same codebase must be byte-identical across platforms, and `Finding.file` values are read by tools that expect glob-shaped paths.

The conversion happens in exactly one place. Every consumer downstream sees forward slashes.

## Error handling

| Condition                      | Behavior                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `rootDir` does not exist       | Discovery returns `[]`. Scan returns zero findings. Not an error.                                                                        |
| Pattern list is empty          | Every file is read and scanned against zero patterns. Zero findings. Not an error.                                                       |
| A pattern's regex is malformed | Every file that reaches `scanContent` fails at `new RegExp(...)`. Each file is recorded in `filesSkipped` with `scan failed: <message>`. |
| A file cannot be read          | Recorded in `filesSkipped`, reason is the OS error message.                                                                              |
| `scanContent` throws           | Recorded in `filesSkipped`, reason is `scan failed: <message>`.                                                                          |

**Silent failure mode to know about.** If every file in a run is skipped, `ScanResult.findings` is empty, and a caller that does not inspect `filesSkipped` will report a clean scan. **The CLI is responsible for surfacing `filesSkipped.length > 0` to the user.** A reporter that ignores the field is a bug.

## Limitations

- **No concurrency.** Files are processed one at a time.
- **No progress reporting.** Long scans are silent.
- **No streaming.** Each file is fully read into memory as a string. Files significantly larger than memory will fail at the read and are recorded in `filesSkipped`. Line-streaming via `fs.createReadStream` arrives with the worker pool.
- **Discovery errors are suppressed, not surfaced.** Files under directories that `fast-glob` could not enter are missing from both `filesScanned` and `filesSkipped`.
- **`scanForSecrets` still exists in `src/discovery/file-discovery.ts`.** It is step-1 scaffolding that duplicates this module's job and swallows both read and scan errors. It should be deleted once the CLI uses `scan()` and no importers remain. **\[TODO: delete `scanForSecrets` when the CLI is wired up.\]**

## Related

- [Regex detection engine](https://./regex-engine.md) — the module this calls per file
- `src/core/finding.ts` — `Finding`, the element type of `ScanResult.findings`
- `src/discovery/file-discovery.ts` — the discovery phase
- [The pipeline](https://../concepts/pipeline.md) — where this stage sits
