---
title: Entropy-based detection
status: experimental
since: unreleased
last_updated: 2026-09-10
audience: contributor
source: src/detection/entropy.ts
---

# Entropy-based detection

Regex patterns catch secrets that have a **known shape**. Entropy catches the ones that don't. This doc explains what entropy measures, why it can't stand alone, and how `entropy.ts` turns a single noisy number into a gated decision.

## Why entropy at all

Pattern matching is a whitelist. `AKIA[0-9A-Z]{16}` finds AWS keys because AWS publishes that format. The same approach works for `sk_live_…`, `ghp_…`, `xoxb-…` — every provider that documents a prefix gets a reliable rule.

It fails in two directions:

- **Unknown formats.** Internal tokens, self-issued JWTs, secrets from a provider nobody wrote a rule for, custom `DB_PASSWORD=` values. There is no prefix to match because there is no standard.
- **Generic blobs.** A 64-character hex string in a config file could be a secret, an API key, a signing salt, or a build hash. Regex has nothing to say about it.

What these have in common is that they *look random*. They were produced by a CSPRNG, so their characters are close to uniformly distributed with no structure a human would recognize. Human-authored strings — identifiers, comments, prose, config keys — are the opposite: heavy character reuse, limited alphabets, recognizable patterns like `aaaa` or `abcabc`.

Entropy is a numeric proxy for "how random does this look." It is format-agnostic, which is exactly what makes it complementary to regex and exactly what makes it dangerous on its own.

## What the number means

`shannonEntropy` returns **bits per symbol** — the average number of yes/no questions needed to guess the next character, given the character frequencies observed in the string itself.

```text
H = -Σ p(c) · log₂ p(c)
```

where `p(c)` is the frequency of character `c` within the string. A string where every character appears exactly once, drawn from a 64-symbol alphabet, scores `log₂(64) = 6` bits per symbol. A string of nothing but `a` scores 0.

Two properties matter for everything downstream:

- **The ceiling is `log₂(α)`**, where `α` is the number of *distinct* characters actually present. Entropy is maximized by a uniform distribution, so `H ≤ log₂(α)` always holds. This is what makes the ratio in gate 5 well-defined and bounded to `[0, 1]`.
- **It measures the string, not the language.** This is zero-order empirical entropy over the given input. It has no model of English, no model of JavaScript, no model of anything. A 200-character English paragraph and a 200-character random token can score in the same range. Structure has to be rejected by other gates, not by this one.

That second property is the whole reason `hasHighEntropy` is not just `shannonEntropy(s) > threshold`.

## Why one number isn't enough

Plenty of things in a real repository are high-entropy and are not secrets:

| Thing | Why it scores high |
|---|---|
| Lockfile integrity hashes | SHA-512 digests, uniformly distributed by design |
| Git SHAs | 40 hex characters, no structure |
| Minified JS | Dense, varied, no repetition |
| Base64 in source maps | Encoded binary |
| Test fixtures | Deliberately secret-shaped |
| Content hashes in build output | Same as lockfiles |

A raw entropy threshold either misses real secrets or drowns the user in hashes. Neither is acceptable, and the second is worse — a scanner that cries wolf gets uninstalled.

So `hasHighEntropy` is a **chain of cheap rejections ending in an entropy test**. Each gate eliminates a class of false positive that entropy alone cannot distinguish from a secret, and the gates are ordered cheapest-first so the expensive entropy computation only runs on strings that already survived everything else.

## The gate chain

Evaluated in order. First failure returns `false`.

### 1. Length — `str.length < minLength` (default 20)

Short strings carry too little information for any statistical signal to be meaningful. Below 20 characters, a "high entropy" verdict is noise. This also cheaply eliminates the vast majority of identifiers and config keys.

*Cost: O(1).*

### 2. Maximum run length — `maxRunLength(str) > maxRunLength` (default 4)

Rejects five or more identical consecutive characters.

Entropy alone can be fooled by padding. `aB3$dE5&aaaaaaaaaaaaaaaa` has a diverse prefix that inflates the score, but no real secret contains a five-character run. This gate catches the padding trick and, as a side effect, most placeholder values (`XXXXXXXXXXXXXXXX`, `00000000`).

*Cost: O(n), single pass, no allocation.*

### 3. Alphabet floor — `new Set(str).size < minAlphabet` (default 8)

Rejects strings built from fewer than 8 distinct characters.

This is the highest-value gate for false positives. Real-world duplicates are often *low-alphabet*: `deadbeefdeadbeef…` uses 5 distinct characters, repeated hex patterns use even fewer. Meanwhile a genuine random token drawn from base64 or alphanumerics will almost always exceed 8 distinct characters at the 20+ character lengths that reach this gate.

*Cost: O(n) with a `Set` allocation.*

### 4. Character-class diversity (default `minClasses: 3`)

Counts how many of four classes appear: lowercase, uppercase, digit, and symbol (anything not `a-z`, `A-Z`, or `0-9` — note this includes `_`, `-`, and non-ASCII).

The requirement **relaxes for longer strings**:

```typescript
const requiredClasses =
  str.length >= 30 ? Math.min(o.minClasses, 2) : o.minClasses;
```

At ≥30 characters, only 2 classes are required. This exists for hex and base32 digests, which are legitimately 2-class (lowercase + digit) and would otherwise be rejected here before reaching an entropy test that could have cleared them. Below 30 characters, the full `minClasses` applies — a short string needs to demonstrate more variety to be credible.

*Cost: O(n), single pass, no allocation.*

### 5. Entropy density — two conditions, both must hold

```typescript
const entropy = shannonEntropy(str);
const ratio = entropy / Math.log2(alpha);
return entropy >= o.minBitsPerChar && ratio >= o.minEntropyRatio;
```

Two distinct checks:

- **`entropy >= minBitsPerChar` (default 3.0)** — an absolute floor. Guards against strings that pass the alphabet gate but are dominated by a few characters.
- **`ratio >= minEntropyRatio` (default 0.85)** — a *uniformity* check. `ratio` compares the string's entropy against the maximum achievable for its own alphabet (`log₂ α`). Since `α` is the observed distinct-character count, this asks "is this string using its alphabet evenly?" not "is this string drawn from a large alphabet?"

The ratio is the more interesting half. It rejects strings that clear the absolute floor by brute-forcing length while remaining lopsided. `0.85` means the string must be within 85% of perfectly uniform over the characters it actually uses.

Note the interaction at the low end: `minAlphabet` is 8, so `log₂ α = 3.0`, and a string at exactly 8 distinct characters needs `entropy = 3.0` to satisfy *both* conditions simultaneously — a perfectly uniform 8-symbol string. In practice, `minBitsPerChar` is the binding constraint for small alphabets and `minEntropyRatio` binds for larger ones.

*Cost: O(n) with a `Map` allocation.*

## Options and defaults

| Option | Type | Default | Gates | Meaning |
|---|---|---|---|---|
| `minLength` | `number` | `20` | 1 | Minimum string length in characters. |
| `maxRunLength` | `number` | `4` | 2 | Maximum allowed run of identical consecutive characters. Rejects at `> maxRunLength`. |
| `minAlphabet` | `number` | `8` | 3 | Minimum number of distinct characters. |
| `minClasses` | `number` | `3` | 4 | Required character classes. Relaxed to 2 when `length >= 30`. |
| `minBitsPerChar` | `number` | `3.0` | 5 | Absolute Shannon entropy floor, in bits per symbol. |
| `minEntropyRatio` | `number` | `0.85` | 5 | Required `entropy / log₂(alphabet)`, in `[0, 1]`. |

All options are optional; omitted values fall back to `DEFAULTS`. Partial overrides are safe — the merge is `{ ...DEFAULTS, ...opts }`.

## API

```typescript
export interface EntropyOptions {
  minLength?: number;
  minBitsPerChar?: number;
  minClasses?: number;
  minEntropyRatio?: number;
  maxRunLength?: number;
  minAlphabet?: number;
}

/** Shannon entropy in bits per symbol. Returns 0 for the empty string.
 *  Maximum possible value for a given input is log₂(distinct characters). */
export function shannonEntropy(str: string): number;

/** Runs the full gate chain. Returns true only if every gate passes. */
export function hasHighEntropy(str: string, opts?: EntropyOptions): boolean;
```

`countClasses` and `maxRunLength` are module-private. If either needs to be consumed elsewhere, promote it deliberately rather than reimplementing the logic at the call site.

## Worked examples

Against the defaults, ignoring the `[TODO]` in Open Questions below:

| Input | Result | Decided by |
|---|---|---|
| `sk_live_4eC39HqLyjWDarjtT1zdp7dc` | pass | All gates clear; ~26 distinct chars, 3 classes, no long runs. |
| `process.env.API_KEY` | fail | Gate 1 — 19 characters. |
| `AAAAAAAAAAAAAAAAAAAAAAAA` | fail | Gate 2 — run of 24. |
| `abcabcabcabcabcabcabcabc` | fail | Gate 3 — alphabet of 3. |
| `deadbeefdeadbeefdeadbeefdeadbeef` | fail | Gate 3 — alphabet of 5. |
| SHA-256 hex digest (64 chars) | pass | Survives every gate. See Limitations. |
| `aB3$dE5&` repeated 3× | pass | Survives every gate. See Limitations. |

The last two rows are the honest picture: the gate chain raises the bar substantially, it does not make entropy a classifier. Rejecting those cases is the AST verification stage's job, and in some cases the ignore rules'.

## Tuning

The defaults are tuned for **recall over precision** — this stage is meant to produce candidates, and the expensive AST stage is what removes the survivors. Loosening these further trades accuracy for noise; tightening them starts losing real secrets.

Raising `minEntropyRatio` toward 0.95 is the most aggressive single change available and will start rejecting short tokens that happen to have slightly uneven character distributions. Raising `minBitsPerChar` above 3.5 begins rejecting legitimate short hex secrets.

`minAlphabet` and `maxRunLength` are the two knobs with the best precision-per-unit-of-recall. If false positives are a problem, raise `minAlphabet` first.

Per-project overrides belong in `.unmaskrc` / `unmask.config.ts` (see `config/schema.ts`), not in edits to `DEFAULTS` — the defaults are a shared baseline across every project Unmask runs in.

## Limitations

- **Periodic repetition is not detected.** A string that repeats a diverse short pattern — `aB3$dE5&aB3$dE5&aB3$dE5&` — has a uniform distribution over its 8 distinct characters, passes every gate, and scores `ratio = 1.0`. Entropy is order-independent by construction; it cannot see periodicity. This is a known gap and the clearest argument for keeping verification downstream of detection rather than folding the two together.
- **Long hex digests pass.** A 64-character SHA-256 digest clears all five gates. Lockfile integrity hashes, content hashes, and build artifacts will produce findings unless the path is ignored.
- **`countClasses` treats all non-alphanumerics as one class.** `_`, `-`, `$`, and `€` are indistinguishable to gate 4. This is intentional — it keeps the gate cheap and the class count stable across encodings — but it means gate 4 is a coarse signal.
- **Entropy is zero-order.** It has no model of repetition at a distance, no model of language, and no model of code structure. Everything above is a consequence of that.
- **Tuning is empirical.** The defaults were chosen against reasoning, not against a measured corpus. `test/benchmark/corpus-eval.ts` (build order step 2) is what turns these into defensible numbers. Until that exists, treat every constant here as provisional.

## Open questions

- **[TODO: confirm] What string is passed to `hasHighEntropy`?** The signature accepts any string, and the gate thresholds only make sense once the answer is fixed. Two possibilities: (a) the full line as read from the stream, or (b) a candidate token extracted by `regex-engine.ts` before entropy is consulted. These are not equivalent — a full line of source code is longer, lower-entropy, and multi-class, which shifts the effective behavior of every gate. `regex-engine.ts` must document which contract it honors.
- **[TODO] Should periodicity be a gate?** A cheap check for a repeating substring of length ≤ half the input would close the gap in Limitations without touching the entropy math. Not scheduled; noting it so the gap is deliberate rather than forgotten.

## Related

- `src/detection/regex-engine.ts` — the primary detection stage; entropy is the secondary signal
- `src/verification/false-positive-rules.ts` — the stage that removes what this module cannot
- `README.md` — pipeline overview and the architectural decision table