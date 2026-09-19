/**
 * Corpus evaluation. Runs the full scan pipeline against each fixture in
 * test/fixtures/ and reports recall, precision, and the per-rule
 * rejection breakdown.
 *
 * Run with:
 *   pnpm tsx test/benchmark/corpus-eval.ts
 *   pnpm tsx test/benchmark/corpus-eval.ts --verbose   # list every fixture
 *
 * Exit codes:
 *   0 — all fixtures land where the manifests say they should.
 *   1 — at least one fixture failed its expectation.
 *   2 — the corpus could not be read (missing manifest, bad JSON).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadPatterns,
  scanContent,
  type Candidate,
} from "../../src/detection/regex-engine";
import { verifyFindings } from "../../src/verification/verify";
import { RULES } from "../../src/verification/rules";
import {
  createBabelParser,
  isSupportedFile,
} from "../../src/verification/parsers";
import type {
  RuleVerdict,
  VerificationContext,
} from "../../src/verification/types";
import type { Finding } from "../../src/core/finding";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..", "..");
const SECRETS_DIR = join(ROOT, "test", "fixtures", "secrets");
const FALSE_POSITIVES_DIR = join(ROOT, "test", "fixtures", "false-positives");
const PATTERNS_PATH = join(ROOT, "src", "data", "patterns.json");

// ---------------------------------------------------------------------------
// Manifest types
// ---------------------------------------------------------------------------

interface SecretFixtureSpec {
  expectsPatternId: string;
}
interface FalsePositiveFixtureSpec {
  rejectedBy: string;
}

interface Manifest<T> {
  version: number;
  description?: string;
  fixtures: Record<string, T>;
}

function readManifest<T>(dir: string): Manifest<T> {
  const path = join(dir, "manifest.json");
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Manifest<T>;
  } catch (error) {
    throw new CorpusError(`Failed to read ${path}: ${describeError(error)}`);
  }
}

class CorpusError extends Error {}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

type FixtureResult = PassResult | FailResult;

interface PassResult {
  kind: "pass";
  name: string;
  dir: "secrets" | "false-positives";
  detail: string;
}
interface FailResult {
  kind: "fail";
  name: string;
  dir: "secrets" | "false-positives";
  detail: string;
}

interface EvaluationSummary {
  secret: { total: number; passed: number; failed: FailResult[] };
  falsePositive: { total: number; passed: number; failed: FailResult[] };
  ruleRejections: Map<string, number>;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const verbose = process.argv.includes("--verbose");

  const patterns = loadPatterns(PATTERNS_PATH);
  const parser = createBabelParser();

  const secretManifest = readManifest<SecretFixtureSpec>(SECRETS_DIR);
  const fpManifest =
    readManifest<FalsePositiveFixtureSpec>(FALSE_POSITIVES_DIR);

  const summary: EvaluationSummary = {
    secret: { total: 0, passed: 0, failed: [] },
    falsePositive: { total: 0, passed: 0, failed: [] },
    ruleRejections: new Map(),
  };

  for (const [name, spec] of Object.entries(secretManifest.fixtures)) {
    summary.secret.total++;
    const result = evaluateSecretFixture(
      SECRETS_DIR,
      name,
      spec,
      patterns,
      parser,
      summary.ruleRejections,
    );
    if (result.kind === "pass") summary.secret.passed++;
    else summary.secret.failed.push(result);
  }

  for (const [name, spec] of Object.entries(fpManifest.fixtures)) {
    summary.falsePositive.total++;
    const result = evaluateFalsePositiveFixture(
      FALSE_POSITIVES_DIR,
      name,
      spec,
      patterns,
      parser,
      summary.ruleRejections,
    );
    if (result.kind === "pass") summary.falsePositive.passed++;
    else summary.falsePositive.failed.push(result);
  }

  printReport(summary, verbose);

  const anyFailed =
    summary.secret.failed.length > 0 || summary.falsePositive.failed.length > 0;
  process.exitCode = anyFailed ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Fixture evaluators
// ---------------------------------------------------------------------------

function evaluateSecretFixture(
  dir: string,
  name: string,
  spec: SecretFixtureSpec,
  patterns: ReturnType<typeof loadPatterns>,
  parser: ReturnType<typeof createBabelParser>,
  ruleRejections: Map<string, number>,
): FixtureResult {
  const filePath = join(dir, name);
  let source: string;
  try {
    source = readFileSync(filePath, "utf-8");
  } catch (error) {
    return {
      kind: "fail",
      name,
      dir: "secrets",
      detail: `unreadable: ${describeError(error)}`,
    };
  }

  const candidates = scanContent(source, name, patterns);
  const findings = verifyFindings(candidates, source, name, parser);

  if (findings.length !== 1) {
    return {
      kind: "fail",
      name,
      dir: "secrets",
      detail: `expected 1 finding, got ${findings.length}`,
    };
  }

  const actual = findings[0].patternId;
  if (actual !== spec.expectsPatternId) {
    return {
      kind: "fail",
      name,
      dir: "secrets",
      detail: `expected pattern "${spec.expectsPatternId}", got "${actual}"`,
    };
  }

  return { kind: "pass", name, dir: "secrets", detail: `matched ${actual}` };
}

function evaluateFalsePositiveFixture(
  dir: string,
  name: string,
  spec: FalsePositiveFixtureSpec,
  patterns: ReturnType<typeof loadPatterns>,
  parser: ReturnType<typeof createBabelParser>,
  ruleRejections: Map<string, number>,
): FixtureResult {
  const filePath = join(dir, name);
  let source: string;
  try {
    source = readFileSync(filePath, "utf-8");
  } catch (error) {
    return {
      kind: "fail",
      name,
      dir: "false-positives",
      detail: `unreadable: ${describeError(error)}`,
    };
  }

  const candidates = scanContent(source, name, patterns);
  const findings = verifyFindings(candidates, source, name, parser);

  if (findings.length > 0) {
    return {
      kind: "fail",
      name,
      dir: "false-positives",
      detail: `expected 0 findings, got ${findings.length} (first: ${findings[0].patternId})`,
    };
  }

  if (candidates.length === 0) {
    // The fixture does not exercise any rule — the pattern never matched.
    // That means the fixture is redundant or the pattern registry drifted.
    return {
      kind: "fail",
      name,
      dir: "false-positives",
      detail: `no candidate produced — the fixture does not exercise any rule`,
    };
  }

  const rejector = attributeRejection(candidates, source, name, parser);
  if (rejector === null) {
    return {
      kind: "fail",
      name,
      dir: "false-positives",
      detail: `candidate was produced but no rule rejected it — expected "${spec.rejectedBy}"`,
    };
  }

  ruleRejections.set(
    rejector,
    (ruleRejections.get(rejector) ?? 0) + candidates.length,
  );

  if (rejector !== spec.rejectedBy) {
    return {
      kind: "fail",
      name,
      dir: "false-positives",
      detail: `expected rule "${spec.rejectedBy}", got "${rejector}"`,
    };
  }

  return {
    kind: "pass",
    name,
    dir: "false-positives",
    detail: `rejected by ${rejector}`,
  };
}

/**
 * Re-run the rules against the candidates and find the first rule that
 * drops each one. Used for attribution, not for the pipeline.
 *
 * Returns the name of the rule that dropped, or null if none did.
 */
function attributeRejection(
  candidates: Candidate[],
  source: string,
  filePath: string,
  parser: ReturnType<typeof createBabelParser>,
): string | null {
  const ctx: VerificationContext = {
    ast: null,
    source,
    filePath,
  };
  if (isSupportedFile(filePath)) {
    ctx.ast = parser.parse(source, filePath).ast;
  }

  for (const candidate of candidates) {
    let dropped = false;
    for (const { name, rule } of RULES) {
      const verdict: RuleVerdict = rule(
        candidate.finding,
        candidate.rawValue,
        ctx,
      );
      if (verdict.action === "drop") {
        dropped = true;
        // Record the rule that fired for the FIRST candidate that
        // dropped. If multiple candidates produce different rejectors,
        // the fixture is genuinely ambiguous — worth flagging.
        if (candidates.indexOf(candidate) === 0) return name;
      }
    }
    if (!dropped) return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printReport(summary: EvaluationSummary, verbose: boolean): void {
  const lines: string[] = [];

  lines.push("");
  lines.push(
    `  corpus: ${summary.secret.total} secret fixtures · ${summary.falsePositive.total} false-positive fixtures`,
  );
  lines.push("");

  // Recall.
  const recall =
    summary.secret.total > 0
      ? (summary.secret.passed / summary.secret.total) * 100
      : 0;
  lines.push(
    `  recall:    ${summary.secret.passed}/${summary.secret.total}` +
      `  (${recall.toFixed(1)}%)` +
      (summary.secret.failed.length > 0
        ? `  — ${summary.secret.failed.length} missed`
        : ""),
  );

  // Precision.
  const precision =
    summary.falsePositive.total > 0
      ? (summary.falsePositive.passed / summary.falsePositive.total) * 100
      : 0;
  lines.push(
    `  precision: ${summary.falsePositive.passed}/${summary.falsePositive.total}` +
      `  (${precision.toFixed(1)}%)` +
      (summary.falsePositive.failed.length > 0
        ? `  — ${summary.falsePositive.failed.length} false positives`
        : ""),
  );
  lines.push("");

  // Failures.
  const allFailed = [...summary.secret.failed, ...summary.falsePositive.failed];
  if (allFailed.length > 0) {
    lines.push("  failures:");
    for (const f of allFailed) {
      lines.push(`    ${f.dir}/${f.name}`);
      lines.push(`      ${f.detail}`);
    }
    lines.push("");
  }

  // Per-rule rejection counts.
  if (summary.ruleRejections.size > 0) {
    lines.push("  by rejection rule:");
    const sorted = [...summary.ruleRejections.entries()].sort(
      (a, b) => b[1] - a[1],
    );
    for (const [name, count] of sorted) {
      lines.push(`    ${name.padEnd(24)} ${count}`);
    }
    lines.push("");
  }

  if (verbose) {
    lines.push("  all fixtures:");
    for (const f of [
      ...summary.secret.failed,
      ...summary.falsePositive.failed,
    ]) {
      lines.push(`    ✖ ${f.dir}/${f.name}: ${f.detail}`);
    }
    lines.push("");
  }

  process.stdout.write(lines.join("\n") + "\n");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((error: unknown) => {
  process.stderr.write(`corpus-eval: ${describeError(error)}\n`);
  process.exitCode = 2;
});
