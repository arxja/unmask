---
title: Config
status: experimental
since: unreleased
last_updated: 2026-09-15
audience: user
source: src/config/schema.ts, src/config/load-config.ts
depends_on: src/core/finding.ts
---

# Config

The `.unmaskrc` file (or an equivalent) that customizes a scan.

Loaded with `cosmiconfig` and validated with `zod`. A missing config file is not an error — defaults apply. A config file that fails validation is an error: it exits with code 2 and a single message on stderr.

## File locations

`cosmiconfig` searches from the scan's `--path` upward. Recognized names:

- `.unmaskrc` (JSON or YAML)
- `.unmaskrc.json`
- `.unmaskrc.yaml`, `.unmaskrc.yml`
- `.unmaskrc.js`, `.unmaskrc.cjs`
- `unmask.config.js`, `unmask.config.cjs`
- `unmask.config.ts` (requires a TS runtime; `tsx` provides one during development)

The first match wins. Config files in parent directories are found by the upward search — useful for monorepos with a shared config.

## Schema

```typescript
interface Config {
  ignore?: string[];
  include?: string[];
  failOn?: Severity;
  customPatterns?: string;
}
```

---

title: Config
status: experimental
since: unreleased
last_updated: 2026-09-14
audience: user
source: src/config/schema.ts, src/config/load-config.ts
depends_on: src/core/finding.ts

---

# Config

The `.unmaskrc` file (or an equivalent) that customizes a scan.

Loaded with `cosmiconfig` and validated with `zod`. A missing config file is not an error — defaults apply. A config file that fails validation is an error: it exits with code 2 and a single message on stderr.

## File locations

`cosmiconfig` searches from the scan's `--path` upward. Recognized names:

- `.unmaskrc` (JSON or YAML)
- `.unmaskrc.json`
- `.unmaskrc.yaml`, `.unmaskrc.yml`
- `.unmaskrc.js`, `.unmaskrc.cjs`
- `unmask.config.js`, `unmask.config.cjs`
- `unmask.config.ts` (requires a TS runtime; `tsx` provides one during development)

The first match wins. Config files in parent directories are found by the upward search — useful for monorepos with a shared config.

## Schema

```typescript
interface Config {
  ignore?: string[];
  include?: string[];
  failOn?: Severity;
  customPatterns?: string;
}
```

| Field            | Type           | Default    | Meaning                                                                              |
| ---------------- | -------------- | ---------- | ------------------------------------------------------------------------------------ | ------ | ---------- | ---------------------------------------------------------------------- |
| `ignore`         | `string[]`     | `[]`       | Additional glob patterns to ignore, on top of the discovery defaults.                |
| `include`        | `string[]`     | `["**/*"]` | Glob patterns to include. Replaces the default when set.                             |
| `failOn`         | `"critical" \\ | "high" \\  | "medium" \\                                                                          | "low"` | `"medium"` | Minimum severity that produces exit code 1. Overridden by `--fail-on`. |
| `customPatterns` | `string`       | _(unset)_  | Path to a JSON file containing additional patterns. Relative to the scan's `--path`. |

## `ignore`

Additive to the discovery defaults. The defaults are:

```text
node_modules/**  .git/**  dist/**  build/**  coverage/**
*.log  package-lock.json  pnpm-lock.yaml  yarn.lock
```

`ignore` **appends** to this list; it does not replace it. A user who wants to ignore `node_modules` does not need to specify it — it is already ignored.

To whitelist a directory that is ignored by default (rare), pass a negative glob like `!node_modules/some-package/**`. fast-glob supports this; the ordering rules are fast-glob's, not Unmask's.

## `include`

Replaces the default `["**/*"]`. A config that sets `"include": ["src/**/*.ts"]` scans only TypeScript files under `src/`.

**Setting `include` does not implicitly exclude other files from being read.** A path that matches an include pattern is scanned; a path that matches neither `include` nor `ignore` is not scanned. Getting this wrong produces a scan that finds nothing and reports success — see the terminal reporter's zero-findings output, which will say "No secrets found" for a directory the include pattern excluded.

## `failOn`

The severity threshold for exit code 1. A finding whose severity is **at least as severe as** `failOn` triggers a failure. So `failOn: "high"` fails on `critical` and `high` findings, but not on `medium` or `low`.

The `--fail-on` CLI flag takes precedence over the config value. The precedence order is: flag → config → hardcoded default (`"medium"`).

**`failOn` does not affect what is reported.** Every finding, at every severity, is reported. `failOn` only decides whether the process exits with `0` or `1`.

## `customPatterns`

A path to a JSON file with an array of pattern objects in the same shape as `src/data/patterns.json`.

**The path is resolved relative to the scan's `--path`, not the config file's location.** This matches the intuition that config values are relative to what you asked to scan, but is a `[TODO]` to revisit — a config inherited from a parent directory, with a `customPatterns` reference, will look for the file in a place that might surprise the user.

Custom patterns are loaded after built-in patterns and merged by `id`. See [CLI](./cli.md#pattern-merging) for the merge rules. Custom patterns with the same `id` as a built-in override it; a message is printed on stderr.

## Limitations

- **No way to disable a built-in pattern without replacing it.** A user who wants to turn off `generic-high-entropy-secret` cannot; they can only override it with a custom pattern of the same `id` that matches nothing (a regex like `(?!)`). A future `disabled: string[]` field is the natural fix; not shipped in v1.
- **No per-provider overrides.** Severity and confidence are properties of a pattern, not of a provider. A user who wants all AWS findings downgraded must override each AWS pattern.
- **No environment variable substitution in config.** A config file cannot reference `$HOME` or any other variable. Paths are literal strings.
- **A `.ts` config file executes on load.** `cosmiconfig` requires a TypeScript loader for `.ts` config files. Unmask does not bundle one; the user runs through `tsx` or a tool that provides one. A broken `.ts` config produces a runtime error, not a validation error.

## Related

- [CLI](./cli.md) — the command that reads this config
- [Finding and ScanResult](./finding.md) — the shape `failOn` compares against
- `src/data/patterns.json` — the built-in pattern registry
