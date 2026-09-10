---
title: Testing
status: draft
last_updated: 2026-09-10
audience: contributor
---

# Testing

What Unmask tests, what it doesn't, and where each kind of test lives.

## The shape of testing in this project

Unmask has one metric that matters more than coverage: **the false-positive rate on a real corpus**. A scanner that misses secrets is bad; a scanner that reports lockfile hashes as secrets is worse, because it gets turned off. So testing here is organized around that, not around line coverage.

Three tiers, in order of arrival:

| Tier               | Location          | Purpose                                                                              | Status                                 |
| ------------------ | ----------------- | ------------------------------------------------------------------------------------ | -------------------------------------- |
| Unit               | `test/unit/`      | One module's behavior in isolation. Every gate, every branch, every option override. | Present                                |
| Corpus / benchmark | `test/benchmark/` | Measures actual false-positive rate against labeled fixtures.                        | Planned (build order step 2)           |
| Integration        | _(none yet)_      | End-to-end: `scanForSecrets` over a real directory tree.                             | Deferred until `scan-runner.ts` exists |

There is deliberately no integration tier yet. `scanForSecrets` is step-1 scaffolding that will move; writing integration tests against it now means rewriting them when `core/scan-runner.ts` lands.

## Running tests

```bash
npx vitest # watch mode
npx vitest run # single pass, for CI
npx vitest run test/unit/entropy.test.ts # one file
```

`tsx` is the dev runtime for the CLI; `vitest` handles its own TS transform. No build step is required to run tests.

## Directory layout

```text
test/
├── fixtures/
│ ├── secrets/ # known real-shaped secrets (fake, correct format)
│ └── false-positives/ # process.env usage, placeholders, test/example files
├── unit/
│ ├── entropy.test.ts
│ ├── regex-engine.test.ts
│ └── file-discovery.test.ts
└── benchmark/
└── corpus-eval.ts # measures actual false-positive rate against fixtures
```

`__mocks__/` at the repository root holds module mocks that apply across the suite.

## Mocking conventions

### `fs` — memfs, not hand-rolled stubs

Anything that reads or writes files goes through `memfs`. This keeps tests hermetic (no temp directories, no cleanup, no platform path differences) and keeps fixture content inline where the reader can see it.

Two files wire this up globally:

```javascript
// __mocks__/fs.cjs
const { fs } = require("memfs");
module.exports = fs;

// __mocks__/fs/promises.cjs
const { fs } = require("memfs");
module.exports = fs.promises;
```

A test that touches the filesystem calls `vi.mock("node:fs")` (and `vi.mock("node:fs/promises")` if needed), then populates the virtual filesystem:

```typescript
vi.mock("node:fs");
vi.mock("node:fs/promises");

beforeEach(() => vol.reset());

vol.fromJSON({ "/patterns.json": JSON.stringify(patterns) });
```

`vol.reset()` in `beforeEach` is required. Without it, files written by one test leak into the next.

### `fast-glob` — direct `vi.fn()` mock

`fast-glob` is mocked per-file, not globally, because only one module uses it and the mock needs to be inspectable:

```typescript
vi.mock("fast-glob", () => ({
  default: { sync: vi.fn().mockReturnValue([]) },
}));

const mockSync = vi.mocked(fg.sync);
```

Tests then assert on the arguments passed to `fg.sync` rather than on its return value — discovery's job is producing correct _options_, and the file list is fast-glob's problem.

When asserting on call arguments, use the `lastCall()` helper pattern from `file-discovery.test.ts` rather than `expect(mockSync).toHaveBeenCalledWith(...)` when only some fields matter. `toHaveBeenCalledWith` requires an exact match and breaks the moment an unrelated option is added.

## Writing tests for a new module

1. **One `describe` per public export.** Nest one level for each option, gate, or branch.
2. **One assertion per behavior.** A test that asserts three gates passed is three tests wearing a trenchcoat.
3. **Name the failure mode, not the input.** `rejects strings shorter than the minimum length` is better than `handles short strings`.
4. **If a test claims to cover a specific gate, only that gate may be able to reject the input.** This is the single most common mistake in the current suite — see [Known test smells](#known-test-smells) below.
5. **Option overrides get their own test.** Any `opts` field a caller can pass should have a test that flips it and asserts the observable difference.

### Test smells to avoid

**Passing at an earlier gate than the test claims.** `hasHighEntropy` evaluates gates in order: length → run length → alphabet → classes → entropy. A test in a `describe("entropy density")` block whose input fails at the run-length gate is not testing entropy density.

To check: walk the input through the gate chain by hand. If more than one gate could reject it, either the test is imprecise or the input is wrong.

**Asserting a negative that has multiple causes.** `expect(findings).toHaveLength(0)` is only meaningful if exactly one code path can produce that result. If both "regex didn't match" and "entropy rejected the match" lead to zero findings, the assertion doesn't distinguish them — and the test will keep passing if one path breaks.

## The fixture corpus

_(Planned — build order step 2.)_

The corpus is the project's actual differentiator and its contents are a judgement call, not a mechanical collection. Two directories with different contracts:

**`test/fixtures/secrets/`** — files containing secret-shaped strings that a correct scanner _must_ report. Every entry here is a real provider format with a fake value. Adding a new pattern to `patterns.json` without a matching fixture here is incomplete work: there is no other mechanism that would catch a pattern that silently never matches.

**`test/fixtures/false-positives/`** — files containing secret-shaped strings that a correct scanner _must not_ report. These are the hard cases: `process.env` references, template-literal placeholders, test files that intentionally contain example keys, constant aliasing, `.env.example` files. Every false positive caught in the wild belongs here as a new fixture, or it will come back.

`corpus-eval.ts` reports, per run:

- true positives / total secret fixtures (recall)
- false positives / total clean fixtures (precision)
- which gate or rule was responsible for each rejection

A change that improves recall by one fixture while introducing ten false positives is a net loss, and the corpus is the only thing that can say so.

### Adding a fixture

1. Put the file under the appropriate directory.
2. For a secret fixture: confirm the format matches a real provider's specification. A fake AWS key that doesn't satisfy `AKIA[0-9A-Z]{16}` proves nothing.
3. For a false-positive fixture: add a comment at the top naming the _rule_ that should reject it — `process.env`, `placeholder`, `test-path`, `constant-alias`, or `entropy`.
4. Run `corpus-eval.ts` and confirm the fixture lands where expected. A fixture that doesn't change the score is either redundant or wrong.

## What not to test

- **Internal helper functions** (`countClasses`, `maxRunLength`, `shannonEntropy` beyond its public contract). They are exercised through `hasHighEntropy`; testing them separately pins implementation details.
- **fast-glob's behavior.** Assert on the options Unmask passes, not on what fast-glob returns.
- **Report formatting.** Terminal output, colors, and column layout are cosmetic and will churn. Test the `Finding` shape.
- **Anything that needs a build.** If a test requires `dist/`, it belongs in a separate integration suite, which doesn't exist yet.

## Coverage philosophy

Line coverage is not the target. The tests that matter are the ones that would fail if a decision in the source changed. Three categories are non-negotiable and should be treated as regressions if they break:

- **Redaction.** Once `report/redact.ts` exists, a test must assert that no secret value appears in any reporter's output.
- **The capture-group contract.** Once load-time validation lands, a test must assert that `entropyCheck: true` on a pattern with fewer than two capture groups is rejected at load.
- **Gate ordering.** A test must assert that a string failing multiple gates reports the _first_ one. This is what makes the existing gate tests meaningful.

Everything else is best-effort.

## Known test smells

Current suite, tracked so they don't quietly persist:

| File                   | Test                                          | Issue                                                                                                                                                            |
| ---------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `regex-engine.test.ts` | `rejects a pattern match with low entropy`    | `KEY_ABC_AAAAAAAAAAAAAAA` matches the two-group pattern, but group 2 is only 15 characters long, so it is rejected by the length gate before entropy evaluation. |
| `entropy.test.ts`      | `rejects two-character alternating patterns`  | `abababababab` is 12 chars; fails at the length gate, never reaches the run-length gate.                                                                         |
| `entropy.test.ts`      | `rejects skewed distributions even when long` | Input has a 32-character run; fails at the run-length gate, never reaches entropy density.                                                                       |
| `entropy.test.ts`      | `rejects words with only a couple of classes` | `PasswordPassword123` is 19 chars; fails at length, never reaches class diversity.                                                                               |

None of these are urgent. All of them are the same mistake and worth fixing in one pass when the corpus lands.

## Related

- [The pipeline](../concepts/pipeline.md)
- [Entropy-based detection](../concepts/entropy.md)
- `test/benchmark/corpus-eval.ts` — the measurement tool this doc is built around
