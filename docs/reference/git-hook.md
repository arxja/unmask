---
title: Git hook
status: experimental
since: unreleased
last_updated: 2026-09-19
audience: user
source: src/git/hook-installer.ts, src/git/staged-files.ts
depends_on: src/core/file-source.ts, src/commands/install.ts
---

# Git hook

A pre-commit hook that scans staged files for secrets before a commit is recorded. Installed and removed through the CLI.

See [CLI](./cli.md) for the commands that manage it, and [File source](./scan-runner.md#file-source) for how the hook feeds into the scanner.

## What the hook reads

**The git index, not the working tree.**

When a developer runs `git add file.ts`, git copies the file's content into the index — the staging area. What `git commit` records is the index, not the file on disk. If the file on disk changes between `git add` and `git commit`, the commit records the index version, not the newer working-tree version.

A pre-commit scanner that reads from disk can therefore miss a secret that is about to be committed (the file was edited after staging), or block a commit for a secret that is not going to be recorded (the file was cleaned up after staging). The only source that matches what `git commit` will record is the index.

The hook reads the index through two git commands:

- `git diff --cached --name-only --diff-filter=ACMR -z` — lists staged files, excluding deletions.
- `git show :path` — reads the index content of one file.

`git show :path` uses the `:path` syntax to mean "read from the index, not from a commit." Without the colon, git interprets `path` as a revision name and fails.

## Installation

```bash
unmask install [--path <dir>]
```

Writes a hook script to the repository's hooks directory. The install is idempotent — running it again overwrites the previous hook with the same content. It prints a message on stderr if a pre-existing hook was chained (see below).

The install refuses to proceed if git is configured with a custom `core.hooksPath`. That setting tells git to look for hooks in a different directory than `.git/hooks/`, and it is how Husky and similar tools work. Writing to `.git/hooks/` in that case would produce a hook that git never runs. The error names the configured path and suggests two resolutions: add the scan to the manager's config manually, or unset `core.hooksPath` and retry.

The install also refuses if the target directory is not inside a git repository.

## Uninstallation

```bash
unmask uninstall \[\--path <dir\>\]
```

Removes the hook. If the hook was chained over an existing one, the original hook is restored to its place.

The uninstall is idempotent — running it when no hook is installed succeeds and prints "no hook installed."

**The uninstall refuses to remove a hook that unmask did not install.** The hook file is identified by a signature line (`# unmask pre-commit hook`). If the file does not contain that line, uninstall assumes the user replaced unmask's hook with their own and does nothing.

## Chaining

When install encounters an existing pre-commit hook that unmask did not write, it:

1.  Renames the existing hook to `pre-commit.unmask-original`.
2.  Writes a new hook that runs the original first, then runs the scan.

The original hook's exit code short-circuits the scan. If the original hook fails, the commit is aborted and unmask never runs. This matches the convention that pre-existing hooks retain their priority.

On a subsequent re-install, if a `.unmask-original` exists, it is still chained — the file is not overwritten, and the newly written script still calls it. This is what makes install idempotent without losing a previously chained hook.

## The hook script

The installed script is POSIX `sh`. It has three responsibilities:

1.  If a `.unmask-original` exists, run it and exit with its code on failure.
2.  Locate the unmask binary. Prefer `node_modules/.bin/unmask` (a local install); fall back to `command -v unmask` (a global install).
3.  Run `unmask scan --staged --quiet` and exit with its code.

If neither binary location resolves, the script prints a warning to stderr and exits `0`. **A missing unmask does not block the commit.** A developer who has not installed the tool should not be prevented from committing.

## Limitations

- **Windows path resolution.** The script checks `node_modules/.bin/unmask`, which is the POSIX path. On Windows, a local install creates `node_modules/.bin/unmask.cmd`, and the POSIX check does not find it. The script falls back to `command -v unmask`, which works if the tool is installed globally but not if it is only local. The hook works on Windows through Git Bash or WSL; a native Windows git install may require manual adjustment of the hook script.
- **Submodules.** `git diff --cached` reports a submodule change as a single entry (the submodule directory), not a recursive listing. `git show :submodule` returns a gitlink, not file content, and the read fails. Files inside submodules are not scanned by the hook. Scanning a submodule requires running unmask in that submodule separately.
- **File modes and symlinks.** The hook scans content, not mode bits or symlink targets. A secret encoded in a symlink target is not detected.
- **Filenames with unusual characters.** The `-z` flag to `git diff` produces NUL-separated output, which handles filenames containing newlines and spaces correctly. Filenames containing NUL bytes are not possible on POSIX and are out of scope.
- **`core.hooksPath` environments.** The install refuses to proceed rather than installing a hook git would ignore. There is no automatic detection of specific hook managers (Husky, lefthook); the user adds unmask to their manager's config manually.

## Related

- [CLI](./cli.md) — the commands that install and use the hook
- [Scan runner](./scan-runner.md) — the module the hook invokes
- [File source](./scan-runner.md#file-source) — how the git index becomes a file list
