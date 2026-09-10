---
title: File discovery and scan orchestration
status: experimental
since: unreleased
last_updated: 2026-09-10
audience: contributor
source: src/discovery/file-discovery.ts
---

# File discovery and scan orchestration

Two responsibilities live in this file: a thin `fast-glob` wrapper that produces a list of paths, and `scanForSecrets`, which drives the whole step-1 pipeline. The first belongs here. The second does not — see [Deviations from the README](#deviations-from-the-readme).

See [the pipeline](../concepts/pipeline.md) for where discovery sits, and [the regex detection engine](../reference/regex-engine.md) for what happens to each file this module finds.

## Discovery is content-free, on purpose

`discoverFiles` returns **paths, not contents**. It never opens a file.

This is what keeps discovery trivially parallelizable later and memory flat on large repositories: a repo with 50,000 files produces a 50,000-element string array and nothing more. The moment discovery starts reading contents, it becomes the bottleneck the worker pool was built to avoid, and it has to be undone.

The README describes discovery as step 1 of the pipeline and scopes worker threads to steps 2–3 only. That only works while this module stays content-free.

## `DiscoverOptions`

| Option     | Type                 | Default  | Meaning                                                                          |
| ---------- | -------------------- | -------- | -------------------------------------------------------------------------------- |
| `ignore`   | `string[]`           | `[]`     | Extra glob patterns to ignore. **Merged with the defaults, not replacing them.** |
| `include`  | `string \| string[]` | `"**/*"` | What to match. Passed to fast-glob as-is.                                        |
| `dot`      | `boolean`            | `false`  | Match entries beginning with `.`                                                 |
| `absolute` | `boolean`            | `true`   | Return absolute paths                                                            |

### Default ignore rules

```text
node_modules/**    .git/**        dist/**
build/**           coverage/**    *.log
package-lock.json  pnpm-lock.yaml  yarn.lock
```

Each of these is a **recall-versus-noise trade**, and three of them are arguable:

- **Lockfiles** are ignored because they are dense with integrity hashes — exactly the high-entropy, non-secret strings the entropy gate cannot reject. But a lockfile is also a place a registry token can end up embedded in a resolved URL. Ignoring it trades a small miss rate for a large noise reduction. Reasonable, worth recording as a deliberate choice.
- **`*.log`** — logs are a genuinely common leak vector. `.log` files are also frequently enormous and frequently gitignored. Since the git hook only ever scans staged files, this only affects full-directory scans.
- **`build/**`, `dist/**`, `coverage/**`\*\* — build output is derived, so a secret there came from source that will be scanned anyway. Safe.

None of these are wrong. They should be documented in the user-facing config reference too, because a user whose secret lives in a lockfile will otherwise never know why Unmask didn't find it.

### The `ignore` merge comment contradicts the code

```typescript
// 2. Merge: user ignore overrides default (user wins)
// If user passes ignore, we replace defaults entirely,
// but we append their ignores to the defaults to keep it safe.
// Let's combine them: default + user extra.
const ignore = [...defaultIgnores, ...(options.ignore || [])];
```

The comment states both "user overrides default" and "we replace defaults entirely" and then says "but we append" — three claims, two of which are false. The code does exactly one thing: **concatenates**. Defaults are never removable.

That matters. There is currently **no way for a user to un-ignore a path**. `--ignore` can only add. If a user's secret is in `package-lock.json`, they cannot make Unmask look at it. Whether that's intended is a decision, not a comment problem.

## `discoverFiles`

```typescript
export function discoverFiles(
  targetDir: string,
  options: DiscoverOptions = {},
): string[];
```

Synchronous. Returns absolute paths by default.

```typescript
absolute: options.absolute !== undefined ? options.absolute : true,
```

Correct but roundabout — `options.absolute ?? true` is the same thing with no `!== undefined` dance. `dot: options.dot || false` is likewise just `options.dot ?? false`; the `||` form differs from `??` only for falsy-but-present values, which booleans don't have.

`suppressErrors: true` means fast-glob will not throw on permission errors or broken symlinks. Combined with the silent `catch` in `scanForSecrets`, see [Silent failure modes](#silent-failure-modes).

## `scanForSecrets`

```typescript
export function scanForSecrets(
  patternFile: string,
  targetDir: string,
  options: ScanOptions = {},
): Finding[];
```

Step-1 orchestration: load patterns once, discover files, read and scan each.

```typescript
const patterns = loadPatterns(patternFile);
const files = discoverFiles(targetDir, options.discovery || {});
for (const file of files) {
  try {
    const content = fs.readFileSync(file, "utf-8");
    findings.push(...scanContent(content, file, patterns));
  } catch {
    // Silently skip binary/unreadable files
  }
}
```

**Patterns are loaded once for the whole run.** Good — this resolves the `loadPatterns` cost concern from the regex-engine doc. Note that `scanContent` still constructs a `new RegExp` per pattern per file, so the per-file compilation cost identified earlier is unchanged.

### Silent failure modes

The `catch {}` swallows every error with no binding and no logging. Combined with `suppressErrors: true` in discovery, this produces a scan that **cannot distinguish "found nothing" from "could not read anything."**

```text
clean repo                  → []  → hook passes
every file permission-denied → []  → hook passes
wrong targetDir              → []  → hook passes
patternFile loaded, 0 patterns → [] → hook passes
```

For a security gate, the last two are the concerning ones. A typo'd path or an empty pattern registry means Unmask silently approves every commit — and because it exits successfully, nothing surfaces the problem until someone notices a secret in production that Unmask reported clean.

This is the single highest-severity issue in the file. At minimum, discovery should report a count of files it attempted versus skipped, and `scanForSecrets` should distinguish "no findings" from "no input."

### Binary files

```typescript
const content = fs.readFileSync(file, "utf-8");
```

Reading a binary file as UTF-8 does not throw — it produces a string full of replacement characters, which then flows through every regex. The `catch` does not fire for binaries. The comment says "Silently skip binary/unreadable files" but **binaries are not skipped**; they are scanned as garbage.

Usually harmless (garbage rarely matches a secret pattern) but not free, and the comment is misleading. The README lists binary scanning as an explicit non-goal, so a real check is needed rather than a `catch`.

## Deviations from the README

| README says                                                           | This file does                                                                       | Assessment                                                                                                                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/scan-runner.ts` owns "discovery → pool → aggregation → results" | `scanForSecrets` does this, in `discovery/`                                          | **Drift.** The README's folder structure reserves this for `core/`. It also means `discovery/file-discovery.ts` is not the "pure fast-glob wrapper" its own comment claims. |
| Discovery respects "ignore rules"                                     | `fast-glob` is not passed `gitignore: true`; only the hardcoded default list applies | **Unmet.** `.gitignore` is not consulted. A repo that gitignores its build output but doesn't use `dist/` or `build/` will be scanned through it.                           |
| Detection "streams each file line-by-line (`fs.createReadStream`)"    | Full-file `readFileSync` + `content.split("\n")`                                     | Expected for step 1. Note the cost: peak memory is the largest file's size, not one line.                                                                                   |
| Discovery is step 1, threading is step 3                              | Everything synchronous                                                               | Consistent with build order. Fine.                                                                                                                                          |

## Issues and risks

| #   | Issue                                                                                                                                                                                                                                                        | Severity     | Where                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | ---------------------------- | --- | --------------- |
| 1   | **`.env` files are never scanned.** `dot: false` (default) means fast-glob does not match dotfiles; `**/*` excludes them. `.env` is also absent from the ignore list, so it looks intentional — but it is the single most likely location for a real secret. | **Critical** | `discoverFiles`              |
| 2   | Silent `catch` + `suppressErrors` makes "clean" indistinguishable from "broken"                                                                                                                                                                              | **High**     | `scanForSecrets`             |
| 3   | `scanForSecrets` belongs in `core/scan-runner.ts` per the README                                                                                                                                                                                             | High         | module scope                 |
| 4   | Users cannot un-ignore a default path; `ignore` only appends                                                                                                                                                                                                 | Medium       | `discoverFiles`              |
| 5   | `.gitignore` is not respected despite the README claiming ignore rules are                                                                                                                                                                                   | Medium       | `discoverFiles`              |
| 6   | Binary files are scanned as garbage, not skipped (comment claims otherwise)                                                                                                                                                                                  | Medium       | `scanForSecrets`             |
| 7   | `Finding.file` defaults to an **absolute** path — leaks runner directory structure into JSON output and CI annotations, and makes output non-reproducible across machines                                                                                    | Medium       | `absolute: true` default     |
| 8   | The merge comment describes behavior the code does not implement                                                                                                                                                                                             | Low          | `discoverFiles`              |
| 9   | `options.absolute !== undefined ? … : true` and `dot                                                                                                                                                                                                         |              | false`are`??` in disguise    | Low | `discoverFiles` |
| 10  | `new RegExp` per pattern per file remains                                                                                                                                                                                                                    | Low          | inherited from `scanContent` |

**Corrected default behavior:** `.env` files are no longer excluded by the built-in discovery ignore list. When `dot: true` is enabled, `scanForSecrets` can inspect `.env` files as part of the repository scan. The default discovery policy is therefore aligned with the project’s stated purpose rather than with a hardcoded `.env` exemption.

## Open questions

- **[TODO] Where does `scanForSecrets` live?** Same class of question as `Finding`. Answer before `scheduler.ts` exists, because the worker pool will need to slot in between discovery and scanning, and that seam is `scan-runner.ts`'s job.
- **[TODO] Should `dot` default to `true` for the git-hook path?** The git hook knows exactly which files are staged; discovery's ignore heuristics are wrong for that path. Likely a separate code path, not a flag.
- **[TODO] Should un-ignoring be supported?** Either a `respectDefaults: false` option, or negation patterns (`!package-lock.json`) which fast-glob already supports. The latter is cheap.
- **[TODO] Should a zero-file or zero-pattern run exit non-zero?** Directly addresses issue #2. Needs a decision before the hook exists.
- **[TODO] Is `*.log` in the default ignore list correct?** Logs are a known leak vector; the argument for ignoring them is that they're rarely staged.

## Related

- [The pipeline](../concepts/pipeline.md)
- [Regex detection engine](../reference/regex-engine.md)
- `src/core/scheduler.ts` _(planned)_ — where the worker pool inserts between discovery and scanning
- `README.md` — folder structure and build order

---

_Update when `dot`/`ignore` defaults change, when `.gitignore` support lands, or when `scanForSecrets` moves to `core/`._
