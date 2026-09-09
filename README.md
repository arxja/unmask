# Unmask — API Secret Scanner

Pure Node.js CLI that scans a codebase for hardcoded secrets before they hit Git. Two-stage pipeline: fast regex detection over every file, then AST-based verification (only on files with a hit) to cut false positives.

> This README is the architecture source of truth. Update it when a module's responsibility changes — it exists so mid-project decisions don't get lost.

**Language:** TypeScript, strict mode, from day one. `tsx` for dev iteration (no compile step while building), `tsc`/`tsup` for the published build. See [TypeScript notes](#typescript-notes) below.

---

## Pipeline

```
file-discovery → [worker pool] → detection (regex) → verification (AST) → finding[] → report
                                                                              ↑
                                                              git/ (staged files, hook)
```

1. **Discovery** — `fast-glob` walks the repo, respecting ignore rules. Produces a file path list, not contents.
2. **Detection (cheap, runs on every file)** — streams each file line-by-line (`fs.createReadStream`), runs compiled regex patterns + entropy scoring. Any hit produces a candidate.
3. **Verification (expensive, runs only on files with ≥1 candidate)** — parses the file to an AST (Acorn for JS, Babel/acorn-typescript for TS), walks to the enclosing node of each candidate, and applies false-positive rules (`process.env` reference, template literal placeholder, test/fixture path, constant aliasing).
4. **Finding** — every surviving candidate becomes a canonical `Finding` object (see `src/core/finding.ts`). All consumers (terminal, JSON, git hook exit code, GitHub Action annotation) read from this shape — never format ad hoc per consumer.
5. **Report** — terminal (chalk/ora), JSON (CI), always passed through `redact.ts` before anything is printed or logged.

Parallelism (worker threads) applies to steps 2–3 only — I/O in step 1 doesn't need threading.

---

## Key architectural decisions (and why)

| Decision                                                                     | Why                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript, strict mode                                                      | `Finding` is a shared contract read by every consumer (terminal/JSON/hook/Action) — a typed interface catches shape drift at compile time instead of in someone's CI. AST node shapes (Acorn/Babel) are deep and easy to misuse untyped. Worker `postMessage` payloads are a serialization boundary worth typing. |
| Persistent worker pool + shared task queue, not per-file spawn               | Spawn cost (10–50ms) makes per-file spawning slower than single-threaded for typical repos. Pool pulls from a queue so workers self-balance instead of sitting idle on an uneven fixed batch.                                                                                                                     |
| Detection and verification are separate modules, not one blended worker step | Keeps the worker file thin (orchestration only); each stage independently testable/benchmarkable.                                                                                                                                                                                                                 |
| Pluggable parser interface (`verification/parsers/index.ts`)                 | Acorn alone can't parse TypeScript. Parser choice must be swappable without touching the false-positive rules that consume the AST. A `Parser` interface makes this a type-checked refactor later, not a hope-it-works one.                                                                                       |
| Canonical `Finding` shape shared by all reporters                            | Prevents terminal/JSON/CI output from drifting out of sync as new fields get added.                                                                                                                                                                                                                               |
| Redaction is a separate, mandatory pass before any output                    | A scanner that prints the leaked key in CI logs defeats its own purpose.                                                                                                                                                                                                                                          |
| Git "read staged state" and "install hook" are separate files                | Different responsibilities (reading git state vs. writing to `.git/hooks/`); install must detect/chain existing hooks (Husky etc.) rather than clobber them.                                                                                                                                                      |
| Config resolved once, validated against a schema                             | `.unmaskrc` / `unmask.config.ts` drive ignore paths, custom patterns, severity thresholds — needed early since false-positive tuning and test fixtures depend on it.                                                                                                                                              |
| Node as primary runtime, Bun compatibility opportunistic                     | CI runners and global npm installs assume Node; `worker_threads`/AST libs are Node-native. Bun-specific optimizations (e.g. `Bun.file().stream()`) are a v2 consideration, gated behind a runtime check, not a v1 dependency.                                                                                     |

---

## Folder structure (temp)

```
unmask/
├── bin/
│   └── unmask.ts                 # shebang entry; parses argv, dispatches to commands/
│
├── src/
│   ├── commands/
│   │   ├── scan.ts               # `unmask scan`
│   │   └── install.ts            # `unmask install`
│   │
│   ├── core/
│   │   ├── scheduler.ts          # persistent worker pool + shared task queue
│   │   ├── scan-runner.ts        # discovery → pool → aggregation → results
│   │   └── finding.ts            # canonical Finding interface/type
│   │
│   ├── discovery/
│   │   └── file-discovery.ts     # fast-glob wrapper, ignore rules
│   │
│   ├── detection/
│   │   ├── regex-engine.ts       # compiled patterns, line-stream matching
│   │   └── entropy.ts            # Shannon entropy secondary signal
│   │
│   ├── verification/
│   │   ├── parsers/
│   │   │   ├── index.ts          # Parser interface + selection by extension
│   │   │   ├── js-parser.ts      # Acorn
│   │   │   └── ts-parser.ts      # acorn-typescript / @babel/parser + TS plugin
│   │   └── false-positive-rules.ts
│   │
│   ├── worker/
│   │   └── scan-worker.ts        # worker_threads entry point
│   │
│   ├── git/
│   │   ├── staged-files.ts       # git diff --cached, git show :path
│   │   └── hook-installer.ts     # writes/chains pre-commit hook
│   │
│   ├── config/
│   │   ├── load-config.ts
│   │   └── schema.ts
│   │
│   ├── report/
│   │   ├── terminal-reporter.ts
│   │   ├── json-reporter.ts
│   │   └── redact.ts             # masks secret values before any output
│   │
│   └── data/
│       └── patterns.json         # provider regex registry (plain JSON, typed on load)
│
├── action/
│   ├── action.yml                # composite action
│   └── entrypoint.ts             # only if a composite step alone isn't enough
│
├── test/
│   ├── fixtures/
│   │   ├── secrets/              # known real-shaped secrets (fake, correct format)
│   │   └── false-positives/      # process.env usage, placeholders, test/example files
│   ├── unit/
│   └── benchmark/
│       └── corpus-eval.ts        # measures actual false-positive rate against fixtures
│
├── dist/                         # compiled output (gitignored)
├── .unmaskrc.example
├── unmask.config.example.ts
├── tsconfig.json
├── package.json
└── README.md
```

---

## TypeScript notes

- **`patterns.json` stays plain JSON**, not authored in TS — it's static data. Type it at the load boundary: `const patterns: Pattern[] = loadPatterns()`.
- **Worker file paths point at compiled output, not source.** `new Worker(new URL('../../dist/worker/scan-worker.js', import.meta.url))` — decide `tsconfig`'s `outDir` layout before wiring up `scheduler.ts`, since scheduler code hardcodes this path.
- **Strict mode from day one.** Retrofitting `strict: true` after the AST/false-positive logic is written is far more painful than starting with it — that logic is exactly where `any`-typed AST nodes hide bugs.
- Module target: ESM (`"module": "NodeNext"` or `"ESNext"` depending on bundler choice) — cleaner interop with fast-glob, Acorn, Babel, all of which support ESM natively.
- Dev loop: `tsx bin/unmask.ts scan --path .` — no build step while iterating. Add the `tsc`/`tsup` build only once you're packaging for npm publish.

---

## Build order

1. **Discovery + regex registry + naive single-threaded scan**, end to end, no threads, no AST. Get a working CLI that finds _something_ and prints it.
2. **AST-based false-positive filtering**, validated against `test/fixtures/` and measured by `test/benchmark/corpus-eval.ts`. This is the product's actual differentiator — don't skip building the corpus.
3. **Worker thread pool**, only after profiling shows detection+verification is actually CPU-bound on a real repo. Don't thread before you've measured.
4. **Git hook + GitHub Action**, last — both are thin wrappers around the same `scan-runner.ts`.

---

## Non-goals (for now)

- Scanning binary files, images, or archives
- Secret _rotation_ or remediation — Unmask detects, it doesn't fix
- Historical git blame / full-history scanning (v1 is staged/working-tree only)
