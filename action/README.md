# Unmask secret scanner action

Scan a repository for hardcoded secrets on every push or pull request.

## Usage

The action requires `unmask` to be available on the runner's `PATH`.
Install it in a prior step:

```yaml
name: Secrets
on: [push, pull_request]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install unmask
        run: npm install -g unmask@latest

      - uses: ./.github/actions/unmask
        with:
          fail-on: high
```

When a finding is at or above `fail-on`, the action fails the job. Findings  
are annotated directly on the pull request at the file and line where  
the secret was detected.

## Inputs

| Name          | Default               | Description                                |
| ------------- | --------------------- | ------------------------------------------ |
| `path`        | `.`                   | Directory to scan.                         |
| `fail-on`     | `medium`              | `critical`, `high`, `medium`, or `low`.    |
| `annotations` | `true`                | Set to `false` to suppress PR annotations. |
| `output-file` | `unmask-results.json` | Where to write the JSON result.            |

## Outputs

| Name             | Description                              |
| ---------------- | ---------------------------------------- |
| `findings`       | Total findings.                          |
| `unique-secrets` | Distinct secrets (by fingerprint).       |
| `files-scanned`  | Files read and scanned.                  |
| `files-skipped`  | Files that could not be read or scanned. |

## Using the output

```yaml
- uses: ./.github/actions/unmask
  id: scan

- run: |
    echo "Found ${{ steps.scan.outputs.findings }} findings"
    echo "Across ${{ steps.scan.outputs.files-scanned }} files"
```

## Not failing the job

Set `continue-on-error: true` if you want the scan to run without blocking:

```yaml
- uses: ./.github/actions/unmask
  continue-on-error: true
```
