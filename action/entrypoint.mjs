#!/usr/bin/env node
/**
 * Entrypoint for the Unmask GitHub Action.
 *
 * Responsibilities:
 *   1. Run `unmask scan` with the inputs configured by the workflow.
 *   2. Read the JSON output the scan produced.
 *   3. Emit a GitHub annotation for every finding and every skipped file.
 *   4. Set the step outputs.
 *   5. Propagate the scan's exit code as the action's exit code.
 *
 * Plain JavaScript, no build step. The composite action invokes this
 * file with `node`, which is available on every GitHub-hosted runner.
 *
 * This script does not import `@actions/core` or `@actions/exec`.
 * Those libraries abstract over the workflow commands and the
 * GITHUB_OUTPUT file, but the abstractions are small enough that the
 * direct usage is clearer and avoids a bundling step.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

const SEVERITY_TO_COMMAND = {
  critical: "error",
  high: "error",
  medium: "warning",
  low: "notice",
};

const EXIT_CLEAN = 0;
const EXIT_FINDINGS = 1;
const EXIT_INCOMPLETE = 2;

function main() {
  const scanPath = process.env.INPUT_PATH || ".";
  const failOn = process.env.INPUT_FAIL_ON || "medium";
  const annotations = process.env.INPUT_ANNOTATIONS !== "false";
  const outputFile = process.env.INPUT_OUTPUT_FILE || "unmask-results.json";
  const absoluteOutput = resolve(process.cwd(), outputFile);

  // 1. Run the scan. `execFileSync` throws when the child exits nonzero;
  //    we catch and inspect. The scan's own exit codes are meaningful
  //    and we do not want to treat them as failures-to-run.
  let scanExitCode = EXIT_CLEAN;
  try {
    execFileSync(
      "unmask",
      [
        "scan",
        "--path",
        scanPath,
        "--fail-on",
        failOn,
        "--format=json",
        "--output",
        outputFile,
      ],
      { stdio: "inherit" },
    );
  } catch (error) {
    scanExitCode = typeof error.status === "number" ? error.status : 1;

    if (scanExitCode !== EXIT_FINDINGS && scanExitCode !== EXIT_INCOMPLETE) {
      // 0, 1, 2 are the CLI's documented exit codes. Anything else
      // means the process did not reach its own error handling —
      // missing binary, SIGKILL, segfault. Surface the raw error.
      emit("error", null, `unmask failed to run: ${error.message}`);
      process.exit(scanExitCode);
    }
    // EXIT_FINDINGS and EXIT_INCOMPLETE are expected states that still
    // produce a JSON file. Fall through and process it.
  }

  // 2. Read the JSON. If the scan exited abnormally but still wrote a
  //    file (exit 1 or 2 do), we get useful data. If it did not, we
  //    cannot continue.
  if (!existsSync(absoluteOutput)) {
    emit("error", null, `unmask did not write its output to ${absoluteOutput}`);
    process.exit(EXIT_INCOMPLETE);
  }

  let result;
  try {
    result = JSON.parse(readFileSync(absoluteOutput, "utf-8"));
  } catch (error) {
    emit("error", null, `Failed to parse ${absoluteOutput}: ${error.message}`);
    process.exit(EXIT_INCOMPLETE);
  }

  // 3. Emit annotations and skipped-file warnings.
  if (annotations) {
    for (const finding of result.findings) {
      emitAnnotation(finding);
    }
    for (const skip of result.skipped) {
      // Skipped files are not findings, but they are not nothing
      // either. A warning is the right level — the user should notice,
      // but the commit is not blocked just for an unreadable file.
      emit("warning", null, `Could not scan ${skip.path}: ${skip.reason}`);
    }
  }

  // 4. Set step outputs. The runner exposes these to the workflow via
  //    ${{ steps.<id>.outputs.<name> }} and to the action's own
  //    outputs: block.
  setOutput("findings", result.summary.findings);
  setOutput("unique-secrets", result.summary.uniqueSecrets);
  setOutput("files-scanned", result.summary.filesScanned);
  setOutput("files-skipped", result.summary.filesSkipped);

  // 5. One-line summary in the workflow log. Kept short so it doesn't
  //    drown out the annotations.
  console.log(
    `unmask: ${result.summary.findings} findings ` +
      `(${result.summary.uniqueSecrets} unique) ` +
      `across ${result.summary.filesScanned} files ` +
      `in ${result.summary.durationMs}ms`,
  );

  // 6. Propagate the scan's exit code. The workflow author decides
  //    whether a failure here should fail the job via `continue-on-error`
  //    or by letting it propagate.
  process.exit(scanExitCode);
}

// ---------------------------------------------------------------------------

function emitAnnotation(finding) {
  const command = SEVERITY_TO_COMMAND[finding.severity] || "warning";
  const message = `[${finding.provider}] ${finding.patternName} — ${finding.masked}`;
  emit(command, finding, message);
}

/**
 * Emit a workflow command. When `finding` is null, the command has no
 * file/line/col properties and applies to the whole step.
 */
function emit(command, finding, message) {
  const props = [];
  if (finding) {
    props.push(`file=${finding.file}`);
    props.push(`line=${finding.line}`);
    props.push(`col=${finding.column}`);
  }
  const propsStr = props.length > 0 ? ` ${props.join(",")}` : "";
  // The property block is followed by `::` and the message body.
  // Message body uses its own escaping (see escapeData); the property
  // block does not, because the values we put in it — file paths from
  // the scanner — contain no `,`, `:`, `%`, `\r`, or `\n`.
  console.log(`::${command}${propsStr}::${escapeData(message)}`);
}

/**
 * Escape a message body for a workflow command.
 * https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#about-workflow-commands
 */
function escapeData(value) {
  return String(value)
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

/**
 * Write a step output. The modern mechanism is appending `key=value\n`
 * to the file referenced by `GITHUB_OUTPUT`. The `::set-output` command
 * is deprecated.
 */
function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  appendFileSync(file, `${name}=${value}\n`);
}

main();
