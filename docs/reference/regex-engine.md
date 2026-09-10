---
title: Regex detection engine
status: experimental
since: unreleased
last_updated: 2026-09-10
audience: contributor
source: src/detection/regex-engine.ts
depends_on: src/detection/entropy.ts
---

# Regex detection engine

Stage 1 of the pipeline. Runs every compiled pattern against every line of a file, applies the optional entropy gate, and emits candidates. Cheap by design — it is expected to over-report, and the AST stage downstream is what removes the survivors.

See [entropy-based detection](../concepts/entropy.md) for the gate chain this module calls into, and [the pipeline](../concepts/pipeline.md) for where this fits.

## The capture-group contract

**This is the most important thing on this page and it is currently enforced only by convention.**

When a pattern sets `entropyCheck: true`, the engine runs the entropy gate against **`match[2]` — the second capture group**, not the full match and not group 1.

```typescript
if (pattern.entropyCheck && match[2]) {
  if (!hasHighEntropy(match[2])) {
    continue;
  }
}
```

The intent is clear: group 1 captures a prefix or delimiter, group 2 captures the secret value itself, and entropy is measured on the value rather than on the provider prefix. `match[0]` — the full match, including the prefix — would score differently and defeat the purpose.

Three consequences follow, and none of them are currently enforced or documented in the pattern registry:

| Situation                                                 | Behavior                                                                                                                                      |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Pattern has `< 2` capture groups and `entropyCheck: true` | `match[2]` is `undefined` → the `&&` short-circuits → **entropy is silently skipped**. The pattern behaves as if `entropyCheck` were `false`. |
| Pattern's group 2 captures fewer than 20 characters       | `hasHighEntropy` fails gate 1 unconditionally → **the pattern never produces a finding**. Silently dead.                                      |
| Pattern's group 2 is well-formed                          | Entropy runs as intended.                                                                                                                     |

Both failure modes are silent. Nothing logs, nothing throws, and the pattern registry has no way to express "this pattern requires a group-2 capture of at least 20 characters." A malformed pattern entry looks identical to a working one until someone notices a secret it should have caught.

**Recommended fix (not yet implemented):** validate at load time in `loadPatterns` — if `entropyCheck` is true, assert that the compiled regex has at least two capture groups, and warn or throw otherwise. This turns a silent failure into a startup error. Tracked in Open Questions.

## `scanContent` — walkthrough

```typescript
export function scanContent(
  content: string,
  filePath: string,
  patterns: Pattern[],
): Finding[];
```

Takes the full file contents as a string. Splits on `\n` and iterates **pattern-outer, line-inner**.

### Line splitting

`content.split("\n")` — LF only. Files with CRLF line endings will retain a trailing `\r` on every line. This affects `context` (`line.trim()` removes it) but not `line` numbering, so it is currently benign. Worth normalizing explicitly if Windows is a supported target.

### Global flag enforcement

```typescript
let flags = pattern.flags || "";
if (!flags.includes("g")) flags += "g";
```

The `g` flag is forced because the match loop relies on `regex.exec` advancing through the line. A pattern authored without `g` still works — the engine repairs it.

Note the interaction with a user-supplied `flags` string containing `g` elsewhere in a multi-char flag sequence (e.g. `"gi"` vs `"ig"`): `includes("g")` is correct in both cases, so this is safe. A flags string containing something like `"sg"` would also pass, which is fine.

### Match loop and the zero-length guard

```typescript
regex.lastIndex = 0;
while ((match = regex.exec(line)) !== null) {
  if (match.index === regex.lastIndex) {
    regex.lastIndex++;
  }
  // ...
}
```

`lastIndex` is reset per line, which is required — a `g`-flagged regex carries state across `exec` calls, and a partial match at end-of-line would otherwise corrupt the start position for the next line.

The zero-length guard prevents an infinite loop if a pattern can match the empty string (e.g. `(?:x)?`, or a quantifier like `a*` at a position where it matches nothing). Without it, `exec` returns a zero-length match at the same index forever. Correct and necessary.

### Entropy gate

Runs before the `Finding` is constructed, so rejected candidates never allocate. Ordering is right.

### Finding construction

```typescript
findings.push({
  patternId: pattern.id,
  patternName: pattern.name,
  provider: pattern.provider,
  severity: pattern.severity,
  file: filePath,
  line: i + 1,
  match: match[0],
  context: line.trim(),
});
```

- `line` is 1-indexed (`i + 1`), matching editor conventions.
- `match` holds **the full match, including the prefix** — deliberately different from the string entropy was measured on. A finding for an AWS key therefore contains `AKIA…`, not just the 16 random characters. This is the right choice for human readability and the wrong choice for anything that logs the finding verbatim. See Redaction below.
- `context` is the trimmed line. Trimming removes leading indentation, so two structurally identical lines at different nesting depths produce identical `context` values. Fine for display; not a stable identifier.
- **The raw secret is stored in plaintext on the `Finding` object.** Redaction is a downstream pass in `report/redact.ts`, consistent with the README. This means every `Finding` in memory — and anything that serializes one before redaction runs — contains the live secret.

## `loadPatterns`

```typescript
const content = fs.readFileSync(patternFile, "utf-8");
return JSON.parse(content) as Pattern[];
```

Reads synchronously and casts the parse result to `Pattern[]`.

**The cast is not validation.** `JSON.parse` returns `any`; the `as Pattern[]` assertion tells TypeScript to stop checking. A registry entry missing `regex`, or with `flags` as a number, or with `entropyCheck` as the string `"true"`, will load without complaint and fail at match time — or fail silently, per the capture-group contract above.

The README's TypeScript notes call for typing at the load boundary:

> `patterns.json` stays plain JSON, not authored in TS — it's static data. Type it at the load boundary: `const patterns: Pattern[] = loadPatterns()`.

That annotation is satisfied, but the _runtime_ boundary is not. `loadPatterns` is where schema validation belongs — either hand-rolled field checks or a schema library. Until then, `patterns.json` is trusted input, which is a problem because it is a file contributors are expected to edit.

Errors are wrapped with the file path, which is good. Note the `catch (error)` binding is `unknown` under `strict`, so the template literal relies on `Error`'s `toString`. That works but won't surface a stack or a cause chain.

## Deviations from the README

The README is the architecture source of truth. Three things in this file diverge from it. These are not necessarily bugs — build order step 1 explicitly calls for a naive single-threaded scan — but they should be deliberate and recorded.

| README says                                                        | This file does                                                                            | Assessment                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Canonical `Finding` lives in `src/core/finding.ts`                 | `Finding` is declared in `regex-engine.ts`                                                | **Drift.** The README's decision table is explicit that the canonical shape is shared by every reporter. When `core/finding.ts` lands, this declaration must move and every importer updated. Currently `Finding` has no `confidence` field even though `Pattern` carries one. |
| Detection "streams each file line-by-line (`fs.createReadStream`)" | `scanContent` takes a full string; `loadPatterns` is synchronous                          | **Expected for step 1.** Streaming arrives with the worker pool in step 3. Worth a `[TODO]` rather than a fix.                                                                                                                                                                 |
| Detection uses "compiled regex patterns"                           | `new RegExp(...)` is constructed inside `scanContent`, i.e. once per pattern **per file** | **Drift with a cost.** For _N_ files and _M_ patterns this is _N×M_ compilations. Compilation should move to a `preparePatterns()` step run once. Low priority now, will matter on real repos.                                                                                 |
| `Finding` is "read by every consumer"                              | Consumers do not exist yet                                                                | No action; noting that `confidence` is currently write-only dead data.                                                                                                                                                                                                         |

## Issues and risks

| #   | Issue                                                              | Severity | Where                        |
| --- | ------------------------------------------------------------------ | -------- | ---------------------------- |
| 1   | Silent skip when `entropyCheck: true` and `< 2` capture groups     | **High** | `scanContent`                |
| 2   | Silent death when group 2 is shorter than `minLength` (default 20) | **High** | `scanContent` ↔ `entropy.ts` |
| 3   | `JSON.parse(...) as Pattern[]` performs no runtime validation      | **High** | `loadPatterns`               |
| 4   | `Finding` declared here instead of `core/finding.ts`               | Medium   | module scope                 |
| 5   | `new RegExp` per pattern per file                                  | Medium   | `scanContent`                |
| 6   | `confidence` on `Pattern` is never read or propagated              | Medium   | `Pattern` / `Finding`        |
| 7   | Raw secret stored unredacted on every `Finding`                    | Medium   | `scanContent`                |
| 8   | `severity` / `confidence` typed as `string`, not unions            | Low      | interfaces                   |
| 9   | CRLF input leaves `\r` on lines                                    | Low      | line splitting               |

## Type review

Both interfaces use `string` where a closed union would catch typos at compile time:

```typescript
confidence: string; // should be: "high" | "medium" | "low"
severity: string; // should be: "critical" | "high" | "medium" | "low" | "info"
```

A registry entry with `severity: "highh"` compiles, loads, and flows all the way to a reporter before anything notices. Given that severity will eventually drive the git hook's exit code and the Action's annotation level, this is worth fixing before consumers exist.

`flags` is likewise `string` — accepting `RegExp`'s own flag union or `""` would be tighter, but the engine mutates it (appending `g`) so a plain `string` is defensible.

## Open questions

- **[TODO] Where does `Finding` live?** The README says `src/core/finding.ts`. This module says otherwise. Decide before a second consumer exists, because the cost of moving it grows with each importer.
- **[TODO] Validation strategy for `loadPatterns`.** Hand-rolled guards, or a schema library? The README's config section already commits to schema-validated config (`config/schema.ts`), so there may be one dependency serving both.
- **[TODO] Should the capture-group contract be validated at load time?** Recommended above. If yes, decide whether a violation is a hard error or a warning-with-pattern-id.
- **[TODO] Should `match` be redacted at construction rather than at report time?** Redacting early means a `Finding` can be logged safely by anyone, at the cost of losing the value before any consumer that legitimately needs it. The README's position is redact-before-output; this question is whether that boundary is late enough.

## Related

- [Entropy-based detection](../concepts/entropy.md) — the gate called from the match loop
- [The pipeline](../concepts/pipeline.md) — how this stage connects to discovery and verification
- `src/data/patterns.json` — the registry this module loads
- `README.md` — architectural decision table and folder structure

---

_Update this page when the capture-group contract changes, when validation lands in `loadPatterns`, or when `Finding` moves._
