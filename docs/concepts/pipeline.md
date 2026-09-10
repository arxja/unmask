---
title: The pipeline
status: draft
since: unreleased
last_updated: 2026-09-10
audience: contributor
---

# The pipeline

Unmask currently scans for secrets in a single detection pass with a different cost profile than later verification work. The architecture is intentionally staged so the current discovery + regex/entropy path is the working implementation, while AST verification and the worker pool remain planned follow-on steps.

## The problem the split solves

A secret scanner has to satisfy two demands that pull in opposite directions:

- **Find everything.** A scanner that misses a live AWS key is worse than useless, because it produced false confidence.
- **Report nothing that isn't real.** A scanner that flags every hash in a lockfile gets uninstalled within a day. Nothing downstream — not the git hook, not the CI gate — survives a noisy tool.

Pattern matching alone satisfies the first and fails the second. A raw entropy threshold alone satisfies neither well. The current implementation is a single detection pass:

**Current stage — detection.** Cheap, runs on every file. High recall, knowingly noisy. Regex patterns plus an entropy gate produce _candidates_.

**Planned stage 2 — verification.** Expensive work that will run only on files that produced at least one candidate. It will parse the file to an AST, locate the enclosing node of each candidate, and apply false-positive rules — `process.env` references, template-literal placeholders, test and fixture paths, constant aliasing.

**Planned stage 3 — worker pool.** Parallel execution for the later staged pipeline once profiling shows it is needed; it is not part of the current implementation.

The gate between the current pass and the future verification step is the point: **the expensive work is scoped to files that already look interesting.** A repository where nothing matches pays only the cost of the current detection pass.

## Flow

```text
file-discovery → detection (regex + entropy) → finding[] → report
↑
planned: verification (AST) → worker pool

git/ (staged files, hook)
```

| Step            | Cost                   | Scope                        | Module                                              |
| --------------- | ---------------------- | ---------------------------- | --------------------------------------------------- |
| 1. Discovery    | Cheap I/O              | Every file in the repo       | `discovery/file-discovery.ts`                       |
| 2. Detection    | Cheap CPU              | Every file                   | `detection/regex-engine.ts`, `detection/entropy.ts` |
| 2. Verification | Planned, expensive CPU | Only files with ≥1 candidate | `verification/`                                     |
| 3. Worker pool  | Planned parallelism    | Discovery + scan stages      | `core/scheduler.ts` _(planned)_                     |
| 4. Finding      | —                      | Every surviving candidate    | `core/finding.ts`                                   |
| 5. Report       | Cheap                  | Every finding                | `report/`                                           |

**Discovery** walks the repo with `fast-glob`, respecting ignore rules, and produces a **list of paths — not contents**. Keeping discovery content-free is what makes it trivially parallelizable later and keeps memory flat on large repos.

**Detection** streams each file line-by-line, applies compiled patterns and entropy scoring. See [entropy-based detection](entropy.md) for the gate chain. Any hit produces a candidate.

**Verification** is where precision is bought. It parses the file, walks to the enclosing AST node of each candidate, and applies rules that no regex can express — "this string is a reference to an environment variable," "this literal is inside a template placeholder," "this file is a test fixture." This stage is the product's differentiator; anyone can grep.

**Finding** normalizes every survivor into one canonical shape. See below.

**Report** renders that shape. Terminal, JSON, git hook exit code, and GitHub Action annotation all read the same object.

## Canonical `Finding`

Every surviving candidate becomes a `Finding`. All consumers read from this shape and **never format ad hoc per consumer**. The reason is drift: the moment the terminal reporter and the JSON reporter each decide what a finding looks like, adding a field to one and not the other becomes a silent bug in CI.

```text
Finding is the shared contract:
terminal reporter ─┐
JSON reporter │
git hook exit code ├──→ Finding
GitHub Action │
(future consumers) ─┘
```

## Two invariants

These are not style preferences. Breaking either one is a bug in the product, not a formatting issue.

**Redaction is a mandatory pass before any output.** `report/redact.ts` runs before anything is printed or logged, on every path. A scanner that prints the leaked key into CI logs has published the secret to a wider audience than the original commit would have. This is why redaction is a separate module rather than a method on the reporter — it must be impossible to render a finding without passing through it.

**Detection and verification stay separate modules.** The worker file orchestrates; it does not implement. Each stage must remain independently testable and benchmarkable. Folding them into one blended worker step would make the false-positive rate impossible to measure in isolation — and false-positive rate is the metric this project lives or dies on.

## What is deliberately deferred

The build order is not arbitrary. Each step produces something measurable before the next one adds cost.

| Step | Deliverable                                                      | Why here                                                                                                                     |
| ---- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1    | Discovery + regex + naive single-threaded scan                   | A working CLI that finds _something_. Proves the pipeline shape end to end.                                                  |
| 2    | AST false-positive filtering + fixture corpus + `corpus-eval.ts` | **Planned.** The differentiator. The corpus is what turns tuning constants into defensible numbers.                          |
| 3    | Worker thread pool                                               | **Planned.** Only after profiling proves detection+verification is CPU-bound on a real repo. Do not thread before measuring. |
| 4    | Git hook + GitHub Action                                         | Thin wrappers over `scan-runner.ts`. Nothing new to design; they consume step 1's output.                                    |

Parallelism, when it arrives, applies to steps 2–3 only. Discovery is I/O-bound and does not need threads.

## Related

- [Entropy-based detection](entropy.md) — the gate inside stage 1
- [Regex detection engine](../reference/regex-engine.md) — stage 1's implementation
- `README.md` — full architectural decision table
