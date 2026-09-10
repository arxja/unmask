---
title: Unmask documentation
status: draft
last_updated: 2026-09-10
---

# Unmask documentation

> ⚠️ Unmask is under active development. APIs, configuration, and behavior may change without notice. Features marked `experimental` are not production-ready.

Unmask is a Node.js CLI that scans a codebase for hardcoded secrets before they reach Git. The current implementation performs discovery and regex/entropy detection over every file. AST-based verification is planned for build-order step 2, and the worker pool is planned for step 3; neither is part of the current scan path.

## Start here

| If you want to…                              | Read                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| Understand how Unmask works                  | [The pipeline](concepts/pipeline.md)                                           |
| Know why entropy is used and how it is gated | [Entropy-based detection](reference/entropy.md)                                |
| Run Unmask on a project                      | [Getting started](guides/getting-started.md) _(not yet written)_               |
| Add or modify a detection pattern            | [Regex detection engine](reference/regex-engine.md) + `src/data/patterns.json` |
| Contribute                                   | `README.md` (architecture source of truth)                                     |
| Want to add or edit documentation            | [Writing and maintaining docs](contributing/writing-docs.md)                   |

## How this documentation is organized

| Section         | Contains                                                                |
| --------------- | ----------------------------------------------------------------------- |
| `concepts/`     | Mental models and design rationale. No API surface.                     |
| `reference/`    | Exact behavior of a module: signatures, contracts, options, edge cases. |
| `guides/`       | Task-oriented, step-by-step. Written for users.                         |
| `adr/`          | Point-in-time decision records. Immutable once accepted.                |
| `releases/`     | Changelog.                                                              |
| `contributing/` | Contributing guides                                                     |

## Documentation conventions

- **`README.md` at the repo root is the architecture source of truth.** If a module's responsibility changes, the README changes first. Everything here follows it; where docs and README disagree, the README wins and the doc is a bug.
- Docs are written **alongside the feature**, in the same PR.
- Unknowns are marked `[TODO]` rather than guessed.
- `status` frontmatter is one of: `draft`, `experimental`, `stable`, `deprecated`.
- Docs targeting contributors declare `audience: contributor`; user-facing docs declare `audience: user`.

## Status legend

| Status         | Meaning                                                   |
| -------------- | --------------------------------------------------------- |
| `draft`        | Being written. Expect gaps.                               |
| `experimental` | Describes working code whose behavior is not yet settled. |
| `stable`       | Behavior is settled and the docs are believed accurate.   |
| `deprecated`   | Superseded. Kept for history.                             |
