---
title: Regex detection engine
status: experimental
since: unreleased
last_updated: 2026-09-12
audience: contributor
source: src/detection/regex-engine.ts
depends_on: src/detection/entropy.ts, src/core/finding.ts, src/report/redact.ts
---

# Regex detection engine

Stage 1 of the pipeline. Runs every compiled pattern against every line of a file, applies the optional entropy gate, and emits candidates. Cheap by design — it is expected to over-report, and the AST stage downstream is what removes the survivors.

See [entropy-based detection](../concepts/entropy.md) for the gate chain this module calls into, and [the pipeline](../concepts/pipeline.md) for where this fits.

## The secret-extraction contract

**This is the most important thing on this page. It governs what gets entropy-checked, what gets fingerprinted, and what gets masked — three things a pattern author cannot see failing.**

The engine does not assume a specific capture-group index. It calls `extractSecret(match)`, which returns:

1. The **last non-empty capture group**, if the regex has any capture groups.
2. `match[0]` (the full match) if the regex has no capture groups, or if every capture group is `undefined` or the empty string.

```typescript
export function extractSecret(match: RegExpExecArray): string {
  if (match.length <= 1) return match[0];
  for (let i = match.length - 1; i >= 1; i--) {
    const g = match[i];
    if (g !== undefined && g !== "") return g;
  }
  return match[0];
}
```

The extracted secret is what `hasHighEntropy` receives, what `fingerprint` hashes, and what `redact` masks. `match[0]` — the full match including prefixes and delimiters — is never used for any of those three purposes.

### Why the last group, and not a fixed index

An earlier version of this module read `match[2]` directly. That worked for one pattern and silently misbehaved for every other:

| Pattern shape                             | What `match[2]` did before             | What `extractSecret` does now |
| ----------------------------------------- | -------------------------------------- | ----------------------------- |
| `AKIA[0-9A-Z]{16}` (zero groups)          | `undefined` → entropy silently skipped | Whole match — correct         |
| `(AKIA[0-9A-Z]{16})` (one group)          | `undefined` → entropy silently skipped | Group 1 — correct             |
| `(prefix)(secret)` (two groups)           | Group 2 — correct                      | Group 2 — correct             |
| `(prefix)(secret)(?:suffix)` (two groups) | Group 2 — correct                      | Group 2 — correct             |
| `(prefix)(mid)(secret)` (three groups)    | Wrong group                            | Group 3 — correct             |

The rule is simpler to state than a fixed index: **pattern authors put the secret last, and use `(?:…)` for everything that is not the secret.** A pattern that violates this convention is a bug in the pattern registry, not in the engine.

### The one way to get it wrong

A pattern with a **trailing capture group that can match a delimiter** will have that delimiter treated as the secret:

```regex
key\s*=\s*['"]([A-Za-z0-9]{16,})(['"]?)
```

If the closing quote is present, the last non-empty group is the quote, and entropy runs against a single character. The correct form uses a non-capturing group:

```regex
key\s*=\s*['"]([A-Za-z0-9]{16,})(?:['"]?)
```

**This failure is silent.** A pattern with a delimiter-catching trailing group produces zero findings — the same output as a pattern that matches nothing. Nothing logs, nothing throws. When you add a pattern, walk its capture groups by hand and confirm the last one is the value you intend to detect.

### Load-time validation — what is and is not checked

`loadPatterns` validates that each entry's regex **compiles**, using the same flags the scanner will use. That catches `([A-Z]+` (unbalanced paren) and `a{2,1}` (invalid quantifier) at startup, before any file is read.

It does **not** validate the capture-group contract. A pattern with `entropyCheck: true` and a single non-secret capture group loads and runs, and the entropy gate evaluates the wrong string. Whether to reject this at load time is an open question — see below.

## `extractSecret` — reference

```ts
export function extractSecret(match: RegExpExecArray): string;
```

**Input.** A `RegExpExecArray` — the result of `RegExp.prototype.exec` on a `g`\-flagged regex. `match[0]` is the full match; `match[1..n]` are capture groups, each `undefined` if the group did not participate in the match. `match.index` is the 0-based start offset.

**Output.** The last non-empty capture group, or `match[0]` if there are none. Never returns `undefined`; never returns `""` unless the whole match is empty (which `scanContent` guards against before calling).

**Why it lives here, not in `core/`:** the extraction rule is a property of the pattern format, and the pattern format is defined by this module. If a second detection stage ever needs the same rule, move it then.

## `fingerprint` — reference

```ts
export function fingerprint(secret: string): string;
```

Returns the first 12 hex characters of the SHA-256 digest of `secret`, encoded UTF-8.

**What it is for.** Stable identification of a secret across files. Two findings with the same fingerprint are treated by consumers as the same secret. Baseline files will store fingerprints to silence known findings without storing the values themselves.

**Why SHA-256 and not a 32-bit hash.** An earlier version used `hash * 31 + charCode`, which is not collision-resistant. At ten thousand findings, the birthday bound makes a collision likely, and a collision produces a **false claim that two different secrets are the same secret** — a security-relevant lie that a fingerprint-based baseline would act on. 48 bits of SHA-256 makes this impossible in practice.

**Why truncation is safe.** The fingerprint is a deduplication key, not a secret store. Someone who has the fingerprint but not the secret learns nothing usable — brute-forcing a 48-bit space over real secret entropy is infeasible, and the goal is not to protect the fingerprint itself. If a future feature ever treats fingerprints as sensitive, this decision needs revisiting.

## `scanContent` — walkthrough

```ts
export function scanContent(
  content: string,
  filePath: string,
  patterns: Pattern[],
): Finding[];
```

Takes the full file contents as a string. Splits on `\n` and iterates **pattern-outer, line-inner**.

**Caller contract.** `filePath` must already be relative to the scan's `rootDir`. Normalization is the scan-runner's job, not this module's, so `scanContent` stays a pure function of its inputs.

### Line splitting

`content.split("\n")` — LF only. Files with CRLF line endings retain a trailing `\r` on every line. This does not affect `line` numbering or `column`, and the `\r` is stripped by the `.trim()` in the context construction. Normalizing explicitly is a low-priority cleanup.

### Global flag enforcement

```ts
const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
```

The `g` flag is required for the match loop, which relies on `regex.exec` advancing through the line. A pattern authored without `g` still works — the engine repairs it. `includes("g")` is correct for `"gi"`, `"ig"`, and `"sg"` — flag order is irrelevant and extra flags pass through unchanged.

### Match loop and the zero-length guard

```ts
regex.lastIndex = 0;
while ((match = regex.exec(line)) !== null) {
  if (match[0].length === 0) {
    regex.lastIndex++;
    continue;
  }
  // ...
}
```

`lastIndex` is reset per line. A `g`\-flagged regex carries state across `exec` calls, and a partial match at end-of-line would otherwise corrupt the start position for the next line.

The zero-length guard prevents an infinite loop when a pattern can match the empty string (e.g. `(?:x)?`, or `a*` at a position where it matches nothing). Without it, `exec` returns a zero-length match at the same index indefinitely. The guard advances `lastIndex` and skips the iteration before any finding is constructed — an empty match is never a finding.

### Entropy gate

Runs on the extracted secret, before the `Finding` is constructed. Rejected candidates never allocate.

```typescript
const secret \= extractSecret(match);
if (pattern.entropyCheck && !hasHighEntropy(secret)) {
continue;
}
```

A pattern with `entropyCheck: true` whose extracted secret is shorter than `entropy.minLength` (default 20) produces zero findings. This is not a bug — it is the gate working as designed — but it means a pattern author who expects a 16-character secret to be caught will see nothing and no error. **The pattern registry has no way to express "this secret is expected to be shorter than 20 characters";** if a legitimate short secret needs detection, `entropyCheck` must be `false` on that pattern.

### Finding construction

```typescript
findings.push({
patternId: pattern.id,
patternName: pattern.name,
provider: pattern.provider,
severity: pattern.severity,
confidence: pattern.confidence,
file: filePath,
line: i + 1,
column: match.index + 1,
fingerprint: fingerprint(secret),
masked: redact(secret),
context: \[redactLine(line, secret).trim()\],
});
```

Every field that could carry a secret value is derived from the extracted secret and passed through `report/redact.ts`:

- `masked` is `redact(secret)` — the fixed-width mask, never the raw value. **The raw secret is not stored on the `Finding`.** This is a deliberate change from earlier versions and it is what makes the finding safe to serialize, log, or hand to any reporter without a second redaction pass.
- `fingerprint` is SHA-256 of `secret`, not of `match[0]`. The same secret captured under different variable names produces the same fingerprint.
- `context` is `redactLine(line, secret).trim()`. The raw line is scrubbed of the secret before trimming, so a context line can never contain the value even when the source line does. A one-element array today; the shape is `string[]` so a future verification pass can append enclosing-statement context without changing consumers.
- `line` is 1-based (`i + 1`), matching editor conventions.
- `column` is 1-based (`match.index + 1`), matching editor conventions. It is the column of the match start within the line, not within the file.

### Returned `Finding` shape

Defined in `src/core/finding.ts`, imported here. The engine is a producer of findings; it does not own their shape. See `core/finding.md` _(planned)_ for the canonical definition and the ordering comparators reporters use.

## `loadPatterns`

```typescript
export function loadPatterns(patternFile: string): Pattern\[\];
```

Reads the JSON pattern registry, validates each entry structurally, and verifies that every `regex` compiles under the flags the scanner will use. Throws on the first invalid entry with the index and the reason.

### Validation is two-phase

**Phase 1 — structural.** `isPattern` checks that every required field is present and has the right primitive type. `severity` and `confidence` are validated against the closed unions exported by `core/finding.ts` (`isSeverity`, `isConfidence`), not merely checked for being strings. A registry entry with `severity: "sev:crit"` is rejected at load.

**Phase 2 — regex compilation.** The pattern's regex is compiled once with the `g` flag forced, and the result is discarded. This is a parse check, not a use — it catches malformed regexes before any file is read. Without it, an invalid pattern only fails on the first matching attempt, potentially hundreds of files into a scan.

### What is still not validated

- **Capture-group count** relative to `entropyCheck`. See the extraction contract above.
- **Provider-to-pattern-ID consistency.** Nothing checks that a pattern with `provider: "aws"` follows AWS's format.
- **Duplicate pattern IDs.** Two entries with the same `id` load successfully; only the first is ever distinguishable in a report.

The registry is a file contributors edit, and the current validation is a floor, not a ceiling.

## Deviations from the README

The README is the architecture source of truth. Two items in this file diverge from it.

| README says                                                        | This file does                                                                            | Assessment                                                                                                                                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detection "streams each file line-by-line (`fs.createReadStream`)" | `scanContent` takes a full string; `loadPatterns` is synchronous                          | **Expected for step 1.** Streaming arrives with the worker pool in step 3.                                                                                          |
| Detection uses "compiled regex patterns"                           | `new RegExp(...)` is constructed inside `scanContent`, i.e. once per pattern **per file** | **Drift with a cost.** For _N_ files and _M_ patterns this is _N×M_ compilations. Compilation should move to a `preparePatterns()` step run once. Low priority now. |

The `Finding`\-location and type-union items from the previous revision of this doc are resolved — `Finding` now lives in `core/finding.ts` and is imported here, and `Pattern.severity` / `Pattern.confidence` are the unions from that module.

## Issues and risks

| #   | Issue                                                                        | Severity | Where                        |
| --- | ---------------------------------------------------------------------------- | -------- | ---------------------------- |
| 1   | Trailing delimiter capture group silently misdirects extraction              | **High** | `extractSecret` contract     |
| 2   | Extracted secret shorter than `entropy.minLength` → zero findings, no signal | **High** | `scanContent` ↔ `entropy.ts` |
| 3   | `new RegExp` per pattern per file                                            | Medium   | `scanContent`                |
| 4   | Capture-group contract not enforced at load time                             | Medium   | `loadPatterns`               |
| 5   | CRLF input leaves `\\r` on lines (benign today)                              | Low      | line splitting               |

## Resolved decisions

These questions were open in earlier revisions and are now answered. Kept here because the reasoning is worth more than the answer.

| Question                                           | Resolution                                                                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where does `Finding` live?                         | `src/core/finding.ts`, imported by every producer and consumer. Resolved when the reporters were designed.                                                           |
| Should `mask` be redacted at construction?         | Yes. `Finding.masked` is the only secret-derived string on the object, and it is always the redacted form. No consumer ever sees a raw value. Resolved 2026-09-12.   |
| Validation strategy for `loadPatterns`?            | Hand-rolled guards using the type predicates from `core/finding.ts`. No schema library. Resolved 2026-09-12.                                                         |
| Should `severity` / `confidence` be closed unions? | Yes. `Severity` and `Confidence` are declared in `core/finding.ts` as `as const` arrays with derived types, and validated at the load boundary. Resolved 2026-09-12. |
| Was `match[2]` the right capture-group convention? | No. Replaced by `extractSecret` and the last-non-empty-group rule. Resolved 2026-09-12.                                                                              |
| Was the 32-bit fingerprint sufficient?             | No. Replaced by truncated SHA-256 of the extracted secret. Resolved 2026-09-12.                                                                                      |

## Open questions

- **\[TODO\] Should the capture-group contract be enforced at load time?** A pattern with `entropyCheck: true` whose last non-empty capture group does not exist, or is likely a delimiter, is difficult to detect statically — the regex does not declare its intent. Options: require an explicit `secretGroup` field on patterns that set `entropyCheck`, or document the rule and accept the silent failure mode. The former adds registry complexity; the latter is what exists today.
- **\[TODO\] Should `hasHighEntropy` accept a per-pattern length override?** The default `minLength: 20` is a global floor. A provider whose secrets are legitimately 12–19 characters cannot use `entropyCheck`. Either the option moves to the pattern, or the gate is bypassed for those providers.

## Related

- [Entropy-based detection](entropy.md) — the gate called from the match loop
- [The pipeline](../concepts//pipeline.md) — how this stage connects to discovery and verification
- `src/core/finding.ts` — the canonical `Finding` shape and ordering comparators
- `src/report/redact.ts` — the masking function called for every finding
- `src/data/patterns.json` — the registry this module loads
- `README.md` — architectural decision table and folder structure
