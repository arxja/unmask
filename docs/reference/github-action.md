---
title: GitHub Action
status: experimental
since: unreleased
last_updated: 2026-09-20
audience: user
source: action/action.yml, action/entrypoint.mjs
depends_on: src/report/json-reporter.ts, src/commands/scan.ts
---

# GitHub Action

A composite action that runs `unmask scan` in a GitHub Actions workflow, emits PR annotations, and fails the job when findings meet the configured severity.

The action is a thin wrapper. It does not reimplement detection, verification, or reporting — it invokes the CLI and processes the JSON the CLI already produces.

## Requirements

`unmask` must be on the runner's `PATH` before the action runs. The action does not install the tool.

The action assumes:

- Node.js is available. GitHub-hosted runners include it; self-hosted runners may not.
- The repository is checked out. The action scans files relative to the working directory.

## Inputs

| Input         | Type                                      | Default               | Description                                                                      |
| ------------- | ----------------------------------------- | --------------------- | -------------------------------------------------------------------------------- |
| `path`        | string                                    | `.`                   | Directory to scan, relative to the working directory.                            |
| `fail-on`     | `critical` \| `high` \| `medium` \| `low` | `medium`              | Minimum severity that fails the action.                                          |
| `annotations` | boolean string                            | `true`                | Emit PR annotations for findings and skipped files. Set to `"false"` to disable. |
| `output-file` | string                                    | `unmask-results.json` | Where to write the JSON result. Relative to the working directory.               |

## Outputs

| Output           | Description                              |
| ---------------- | ---------------------------------------- |
| `findings`       | Total finding count.                     |
| `unique-secrets` | Number of distinct fingerprints.         |
| `files-scanned`  | Files read and scanned successfully.     |
| `files-skipped`  | Files that could not be read or scanned. |

## Behavior

1. Runs `unmask scan --format=json --output=<output-file>` with the configured `path` and `fail-on`.
2. Reads the JSON file the scan produced.
3. For each finding, emits a GitHub workflow command at the file and line of the finding. The command level (`error`, `warning`, `notice`) is derived from the finding's severity.
4. For each skipped file, emits a `::warning` with the path and reason.
5. Sets the step outputs from the scan's summary.
6. Exits with the scan's exit code.

The scan writes its JSON even when it exits with code 1 (findings) or 2 (incomplete). The action reads the file in those cases; it only aborts before reading when the process fails to start.

### Annotations

| Finding severity | Workflow command |
| ---------------- | ---------------- |
| `critical`       | `::error`        |
| `high`           | `::error`        |
| `medium`         | `::warning`      |
| `low`            | `::notice`       |

Annotations appear inline on the Files Changed tab of a pull request and in the Checks tab of the workflow run.

The annotation message is `[provider] pattern name — masked`, where `masked` is the redacted form the CLI already produces. The action never sees a raw secret.

### Exit codes

The action exits with the exit code of `unmask scan`:

| Code | Meaning                                                                   |
| ---- | ------------------------------------------------------------------------- |
| `0`  | Clean. No findings at or above `fail-on`, no skipped files.               |
| `1`  | Findings at or above `fail-on`.                                           |
| `2`  | The scan was incomplete — at least one file could not be read or scanned. |

A non-zero exit fails the job unless the workflow author sets `continue-on-error: true` on the step.

## Skipped files are surfaced

The action emits a `::warning` for every skipped file even when there are no findings. **A scan that could not read files is not clean.** A workflow that only checks `steps.scan.outputs.findings` would report success on a scan where every file failed to read and no findings were produced. The `files-skipped` output is available to workflows that want to gate on it explicitly.

## Limitations

- **The action does not install `unmask`.** A prior step in the workflow is responsible. This is deliberate: it keeps the action a thin wrapper and lets the workflow control the version.
- **No inline PR comments.** Annotations appear as check annotations but not as review comments. Posting review comments requires the `pull-requests: write` permission and a GitHub API call. Deferred.
- **No SARIF upload.** Findings are not written in SARIF format, so they do not appear in the Security tab's code scanning view. The JSON output is the canonical machine-readable format; SARIF is a separate reporter.
- **No caching of the JSON output.** The file the action writes is left in place. Workflows that upload it as an artifact can do so in a subsequent step.
- **`action/entrypoint.mjs` is plain JavaScript, not TypeScript.** It runs directly on the runner without a build step. Type checking of this file is not part of the project's `tsc` run.

## Related

- [CLI](./cli.md) — the commands the action invokes
- [JSON reporter](./json-reporter.md) — the output format the action parses
- [Git hook](./git-hook.md) — the alternative integration, for local commits
