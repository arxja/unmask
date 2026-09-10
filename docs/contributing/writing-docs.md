---
title: Writing and maintaining docs
status: draft
last_updated: 2026-09-10
audience: contributor
---

# Writing and maintaining docs

How docs in this repository are organized, when they must change, and how to write one that stays accurate. Read [testing.md](testing.md) for the test-side equivalent.

This page exists because documentation that isn't maintained is worse than no documentation — it makes confident, wrong claims. The rules below are what keep `docs/` from drifting away from the code.

## The README contract

**`README.md` at the repository root is the architecture source of truth.** It is not a public-facing overview that happens to mention architecture; it is the authoritative record of what each module is responsible for and why.

The ordering is strict:

```text
README.md ──is the source──▶ docs/
▲ │
└────── if they disagree ──────┘
the README wins;
the doc is a bug
```

This means:

- **When a module's responsibility changes, the README changes first.** Not "in the same PR" — first. Then the docs follow it.
- **If a doc contradicts the README, the doc is wrong.** Don't patch the doc to match reality while leaving the README stale; that inverts the hierarchy and the drift gets worse.
- **A doc may describe code that the README says will move.** That's expected during active development. Mark it and move on — see [Describing deferred work](#describing-deferred-work).

## Section contracts

Each directory under `docs/` has one job. Putting a doc in the wrong section is the most common structural mistake, and it's the one that makes the set hard to navigate later.

| Section         | Contains                                                                                                                   | Does **not** contain                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `concepts/`     | Mental models, design rationale, "why does this exist." Read once to understand the system.                                | Signatures, options tables, API surface |
| `reference/`    | Exact behavior of one module: signatures, contracts, options, edge cases, limitations. Read to answer "what does this do." | Motivation, tutorials, multi-step tasks |
| `guides/`       | Task-oriented, step-by-step, written for users. Read to accomplish something.                                              | Design rationale, internals             |
| `contributing/` | How to work on the project: testing, docs, adding patterns, release process.                                               | Anything a user needs                   |
| `adr/`          | Point-in-time decisions. Immutable once accepted; superseded, never edited.                                                | Living documentation                    |
| `releases/`     | Changelog.                                                                                                                 | Everything else                         |

A doc can _open_ with motivation before getting to reference material — `reference/entropy.md` does exactly that, because Shannon entropy isn't common knowledge and the gate chain is unreadable without it. That's fine. What matters is where the **bulk** of the content lives.

If you're unsure: ask what the reader is trying to do. _Understand_ → concepts. _Look up_ → reference. _Accomplish_ → guides.

## Frontmatter contract

Every doc opens with YAML frontmatter. Missing fields break navigation and status tracking.

```yaml
title: Regex detection engine # required — matches the H1
status: experimental # required — draft | experimental | stable | deprecated
last_updated: 2026-09-10 # required — ISO date, update on every edit
audience: contributor # required — contributor | user | admin
since: unreleased # optional — version this describes
source: src/detection/regex-engine.ts # optional — the code this documents
depends_on: src/detection/entropy.ts # optional — modules this doc assumes
---
```

| Field                  | Meaning                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `status: draft`        | Being written. Expect gaps.                                                                                                |
| `status: experimental` | Describes working code whose behavior is not settled. **The default for anything in this repo right now.**                 |
| `status: stable`       | Behavior is settled and the docs are believed accurate. Flip to this only after the fixture corpus validates the behavior. |
| `status: deprecated`   | Superseded. Kept for history. Say what replaced it.                                                                        |

`last_updated` is not decoration. When it's six months old and the source file's git log is two weeks old, that's the signal to check whether the doc is still true.

## Which doc do I write?

Three destinations, and the choice is usually obvious once you ask the question.

```text
Is this a decision that future-you will ask "why did we do this?"
└─ yes → ADR (adr/NNNN-slug.md)

Is this "how do I use it" for someone who isn't modifying the source?
└─ yes → guides/ (audience: user)

Is this "how does it work / why is it built this way"?
├─ the mental model, no API → concepts/
└─ the module's exact behavior → reference/
```

**Don't split a module's docs across concepts/ and reference/ until it's earned.** A single doc in `reference/` with a conceptual preamble is correct for a module with one implementation. Split when a second implementation exists, or when the concept applies to more than one module — that's when the concept has independent value.

## When docs must change

This is the table to check before every PR. Find your change, update everything in the right column.

| If you changed…                                           | Update                                                 | Also                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| A module's **responsibility** or boundaries               | `README.md` **first**                                  | The module's `reference/` doc; `concepts/pipeline.md` if the pipeline shape changed |
| A module's **public API** (signature, export, type)       | That module's `reference/` doc                         | Every doc whose code examples call it                                               |
| A **default value** (threshold, option, constant)         | The options table in the relevant `reference/` doc     | Any `concepts/` doc that explains why that default exists                           |
| **`patterns.json`** format or a new pattern field         | `contributing/patterns.md` _(planned)_                 | `reference/regex-engine.md` — the capture-group contract                            |
| **Discovery ignore/include rules**                        | `reference/file-discovery.md`                          | `guides/getting-started.md` if user-visible                                         |
| The **capture-group contract**                            | `reference/regex-engine.md`                            | `contributing/patterns.md` _(planned)_; add or update a test                        |
| The **`Finding` shape** (any field added/removed/renamed) | The canonical-shape doc _(planned: `core/finding.md`)_ | Every consumer doc: reporters, git hook, Action                                     |
| **Redaction** behavior or its position in the pipeline    | `concepts/pipeline.md` (invariants section)            | Every reporter doc; add a regression test                                           |
| The **build order** or what's deferred                    | `README.md`                                            | `concepts/pipeline.md` (deferred table)                                             |
| A **design decision with tradeoffs**                      | New ADR in `adr/`                                      | Link it from the affected `reference/` doc                                          |
| **Testing conventions** or fixture layout                 | `contributing/testing.md`                              | —                                                                                   |
| **Module placement** (`X` moves to `core/`)               | `README.md` folder structure                           | The doc that currently documents it, and its `source:` frontmatter                  |

**If nothing in the right column changed, you probably didn't need a doc edit.** The inverse is the real risk: a change that _should_ have updated three docs and updated none.

### The three-way check

Before pushing, run this against each doc you touched:

1. **Is the README still true?** If your change affected a module's stated responsibility, the README is now wrong and everything downstream of it is wrong too.
2. **Does every code example still run?** Examples are the fastest-rotting part of any doc. If you can't test it, mark it as pseudo-code.
3. **Is there a `[TODO]` you can now resolve?** Answering an existing TODO is the highest-value doc edit available.

## Adding a new doc

**Add a doc when a reader has a question that no existing doc answers.** Not when a module gets long.

Checklist:

- [ ] One of the section contracts above describes it cleanly. If it's ambiguous, it's probably two docs.
- [ ] No existing doc already covers it. Search before writing — a duplicate that disagrees with the original is worse than a gap.
- [ ] Frontmatter is complete, `last_updated` is today.
- [ ] It's linked from `docs/README.md` (the "Start here" table or the sections table).
- [ ] Anything it depends on is linked in a `## Related` section at the bottom.
- [ ] `status: experimental` unless you have a reason for `stable`.

## Editing an existing doc

- **Update `last_updated`.** Every time. It's the only staleness signal.
- **Don't silently delete a limitation.** If a known gap is fixed, say so and move the note to a changelog if one exists. Quietly removing it loses the record that it was ever a concern.
- **Preserve resolved TODOs as decisions.** When `[TODO]` becomes an answer, replace it with the answer, not with silence. The fact that a question existed is useful.
- **Keep the `source:` frontmatter honest.** If a doc now describes code in a different file, fix the path.

## Retiring a doc

Set `status: deprecated`, add a line at the top naming what replaced it, and leave it. Don't delete — git history is not a substitute for a reader who has the old doc bookmarked or who is reading an older release.

## Writing conventions

**Describe what is, not what will be.** During active development it's tempting to write the doc for the finished system. Don't. Describe the code as it exists today, and mark deferrals explicitly with a `[TODO]` or a "Deferred" note. A doc that describes unwritten behavior is indistinguishable from a doc that's wrong.

**Mark unknowns, never guess.** `[TODO: confirm X]` is always better than a plausible-sounding invention. Every `[TODO]` in the current doc set marks a real open decision — that's the system working.

**Present tense, active voice.** "The engine forces the `g` flag" — not "the `g` flag will be forced" or "the `g` flag is forced by the engine."

**Second person for guides, third person for reference.** Guides say "you"; reference describes the code.

**One term per concept.** If the code calls it a _candidate_, docs call it a candidate, not a _hit_ or a _match_. Renaming a concept mid-doc is the fastest way to make a reader think there are two of them.

**No "simply," "just," "obviously," or "of course."** If it were obvious, the doc wouldn't exist.

**Code blocks must be runnable or labeled.** Real commands get `bash`, real code gets `typescript`, illustrative structure gets `text` and lives in a block that a reader can't mistake for copy-pasteable. If an example is pseudo-code, say so in a comment.

**Explain the why behind every constant.** `minBitsPerChar: 3.0` is meaningless without "this is the absolute floor that guards against strings dominated by a few characters." Numbers without rationale get changed arbitrarily.

**Flag silent failure modes loudly.** If something fails without an error — the capture-group contract is the current example — say so in bold and explain the consequence. Those are the only bugs docs can catch before tests do.

**Document limitations honestly.** A `## Limitations` section that admits a gap is more useful than one that doesn't exist. Every reader who hits the gap will otherwise assume it's their mistake.

## Describing deferred work

This project is built incrementally, and the docs describe each step accurately rather than describing the target. That means docs will regularly describe code that is expected to move or be replaced.

Use this pattern:

```markdown
| README says                     | This file does                              | Assessment                                                  |
| ------------------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| `core/scan-runner.ts` owns this | `scanForSecrets` does this, in `discovery/` | **Drift.** Expected for step 1; recorded in Open Questions. |
```

A **Deviations from the README** table is the right tool when the divergence is deliberate and temporary. It records the gap without pretending it isn't there, and it makes the intended destination explicit so the next person knows where things are going.

The rule: **describe the gap, don't hide it and don't fix the README to match the interim state.** The README describes the target architecture; the doc describes the current code and flags where they differ.

## Pre-PR doc audit

Run this before pushing anything that touches `src/`.

- [ ] Checked the [change → doc table](#when-docs-must-change). Every row that applies has been handled.
- [ ] `README.md` still describes each module's responsibility accurately.
- [ ] Cross-references resolve. Moving or renaming a doc means updating every inbound link — grep for the old path.
- [ ] `docs/README.md` links to any new doc.
- [ ] `last_updated` bumped on every doc edited.
- [ ] Any `[TODO]` that's now answerable has been answered.
- [ ] Code examples match the current source. If you can't verify one, mark it pseudo-code.
- [ ] New `## Limitations` entries added for any gap you introduced.

Docs are written **alongside** the feature, in the same PR. A follow-up PR to write docs is a PR that never gets opened.

## Related

- [Testing](testing.md) — the test-side conventions
- [The pipeline](../concepts/pipeline.md) — the mental model these docs describe
- `docs/README.md` — section index and status legend
- `README.md` — architecture source of truth
