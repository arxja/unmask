---
title: Verification
status: experimental
since: unreleased
last_updated: 2026-09-16
audience: contributor
source: src/verification/verify.ts
depends_on: src/verification/parsers/index.ts, src/verification/rules/index.ts, src/detection/regex-engine.ts
---

# Verification

Stage 2 of the pipeline. Runs after detection, only on files with at least one candidate. Reduces the false-positive rate by parsing the file and applying structural rules to each candidate.

## Why this stage exists

Detection is a regex match. It has no idea whether the matched text is a hardcoded secret, an environment-variable name, a placeholder from a README, or a fragment of a template literal. Every one of those matches the same pattern.

Verification is what distinguishes them. It parses the file once, then runs a small set of rules that each answer one question about a candidate:

- **Is this in a test path?** (`test-path`)
- **Is the value a placeholder?** (`placeholder-value`)
- **Is the position inside a `process.env.X` access?** (`env-reference`)
- **Is the position inside a template literal interpolation?** (`template-literal-value`)

The rules are deliberately narrow. A rule that guesses is worse than a rule that doesn't exist — a false drop is a missed leak.

## The candidate boundary

`scanContent` returns `Candidate[]`, not `Finding[]`:

```typescript
interface Candidate {
  finding: Finding;
  rawValue: string;
}
```

`rawValue` is the extracted secret — the same string that `redact(secret)` produced the mask for. It is available to verification rules and nowhere else. `verifyFindings` returns `Finding[]`; the raw value does not survive the call.

**This is the one place a raw secret exists in memory after `scanContent` returns.** The type system enforces the boundary: no field on `Finding` can carry a raw value, no reporter can access one, and no serialization path can include one. `verifyFindings` cannot be skipped without losing the type — the caller has no way to unwrap a `Candidate` except by calling `verifyFindings`.

## `verifyFindings`

```ts
export function verifyFindings(
  candidates: Candidate[],
  source: string,
  filePath: string,
  parser?: Parser,
): Finding[];
```

- **`candidates`** — the output of `scanContent` for one file.
- **`source`** — the exact string `scanContent` saw. Line/column in a `Finding` map to offsets in this string.
- **`filePath`** — matches `Finding.file`. Used by `test-path` and to select the parser's plugin set.
- **`parser`** — optional. Defaults to a module-level `@babel/parser` instance. Injected for tests.

Never throws. A parse failure produces `ast: null` in the context, which makes AST-dependent rules short-circuit to `keep`.

## The rule interface

```typescript
type Rule = (
  finding: Finding,
  rawValue: string,
  ctx: VerificationContext,
) => RuleVerdict;

type RuleVerdict =
  | { action: "keep" }
  | { action: "drop"; reason: string }
  | {
      action: "adjust";
      reason: string;
      severity?: Severity;
      confidence?: Confidence;
    };
```

**`keep`** — the finding is unmodified. Used by rules that could not decide either way, including any rule whose preconditions were not met (e.g. `env-reference` on a file with no AST).

**`drop`** — the finding is removed. Use only when the rule is certain the value is not a secret.

**`adjust`** — the finding survives with modified severity and/or confidence. Use when the rule can express doubt but not certainty. Both fields are optional; only specified ones change. Multiple `adjust` verdicts compose, last write wins per field.

**A rule must be pure.** No I/O, no mutation of the finding, no shared state. Rules are called in the order declared in `src/verification/rules/index.ts`. A `drop` short-circuits the rest of the chain for that finding.

## The rules

| Name                     | Action | What it detects                                                                                                                                                        |
| ------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test-path`              | adjust | File path matches a test, fixture, example, or mock pattern. Downgrades severity to `low`.                                                                             |
| `placeholder-value`      | drop   | Value contains a known placeholder substring (`YOUR_`, `CHANGEME`, `EXAMPLE`, …) or matches a placeholder shape (`<...>`, `${...}`, `${...}`, 8+ repeated characters). |
| `env-reference`          | drop   | Position falls inside a `process.env.X` or `import.meta.env.X` expression.                                                                                             |
| `template-literal-value` | drop   | Position falls inside an `${...}` interpolation of a template literal.                                                                                                 |
| `constant-alias`         | drop   | Position is inside a string literal assigned to a variable whose name contains a fixture marker — `MOCK`, `FAKE`, `TEST`, `DUMMY`, `SAMPLE`, `EXAMPLE`, `STUB`.        |

**Why `test-path` downgrades instead of dropping.** Test files can contain real leaks — a developer accidentally committing a production key into a test is exactly the kind of incident a secret scanner is for. Downgrading to `low` lets the CLI's `--fail-on` threshold decide whether that should fail CI, without hiding the finding.

**Why `placeholder-value` needs `rawValue`.** The masked value `AK••••••••LE` carries no information about whether the original string was a placeholder. Placeholder detection requires reading the value.

**Why `env-reference` and `template-literal-value` need the AST.** Both rules are about _structural context_ — the position is inside a particular kind of expression. That cannot be determined from text alone without re-parsing, which would be the AST. They walk the tree from the offset up to the root and check the ancestors.

## Parser

`src/verification/parsers/index.ts` exports a `Parser` interface and a `createBabelParser()` factory. The default parser handles `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts`. Other extensions are not parsed; AST-dependent rules short-circuit to `keep`, so an unparseable file still has its candidates run through the path- and value-based rules.

The parser uses `errorRecovery: true`, so a file with a syntax error in one place still produces an AST for the rest. When recovery fails entirely, `ast` is `null`.

## Limitations

- **No rule mutates `Finding.rawValue`** — the field does not exist. Rules that need the raw value receive it as an argument.
- **No scope analysis.** The `constant-alias` rule mentioned in the README is not implemented. It requires tracking a variable across statements, which is a bigger change than the current rule interface allows. Tracked as a `[TODO]`.
- **Rules do not see the pattern.** A rule cannot ask "which pattern produced this finding." If a future rule needs that — for example, to reject anything matched by `generic-high-entropy-secret` in a specific directory — the `Rule` signature needs a fourth argument.
- **Verification runs even when the file is unparseable.** AST-dependent rules short-circuit, but path- and value-based rules still run. This is intentional: an unparseable file's candidates should still be filtered by the rules that do not need the AST.
- **Performance is O(findings × rules) per file.** For a file with 100 findings and 4 rules, that is 400 rule calls. Each AST-dependent rule does one tree walk from offset to root, which is O(depth). Fine for realistic file sizes; the corpus benchmark will surface any pathological case.
- **`constant-alias` matches on variable name, not on alias relationships.** It catches `const MOCK_KEY = "..."` but not `const x = MOCK_KEY;`. Alias-relationship analysis requires tracking scope across statements and is a future rule.

## Related

- [Regex detection engine](./regex-engine.md) — the module that produces `Candidate`
- [Finding and ScanResult](./finding.md) — the shape `verifyFindings` returns
- [Scan runner](./scan-runner.md) — the caller
- `src/verification/rules/` — the rule implementations
