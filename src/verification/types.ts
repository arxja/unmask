import type { File } from "@babel/types";
import type { Confidence, Finding, Severity } from "../core/finding";

/**
 * What a rule returns. There is no "maybe" — a rule either keeps the
 * finding, drops it, or adjusts its severity/confidence.
 *
 *   keep    — the finding survives unmodified.
 *   drop    — the finding is discarded. Use only when the rule is
 *             certain the value is not a secret.
 *   adjust  — the finding survives with modified severity and/or
 *             confidence. Use when the rule can express doubt but not
 *             certainty. Both fields are optional; only the specified
 *             ones change.
 *
 * Multiple adjust verdicts compose: each one overrides the previously
 * set field. A drop anywhere in the chain is terminal.
 */

export type RuleVerdict =
  | { action: "keep" }
  | { action: "drop"; reason: string }
  | {
      action: "adjust";
      reason: string;
      severity?: Severity;
      confidence?: Confidence;
    };

/**
 * What every rule receives. Rules are pure: no I/O, no mutation of
 * inputs, no side effects.
 *
 * `ast` is null when the file could not be parsed or when its extension
 * is not a supported language. Rules that need the AST must handle this
 * and return `keep` (an unverifiable finding must not be dropped).
 *
 * `source` is the exact string `scanContent` saw, so line/column from a
 * Finding map to offsets in this string.
 */

export interface VerificationContext {
  ast: File | null;
  source: string;
  filePath: string;
}

/**
 * A rule is a pure function from (finding, raw secret, context) to a
 * verdict. The raw value is passed as a separate argument, not stored on
 * the Finding — it is available to rules and nowhere else.
 */

export type Rule = (
  finding: Finding,
  rawValue: string,
  ctx: VerificationContext,
) => RuleVerdict;

/** A rule plus its name, for logs and corpus-eval output. */
export interface NamedRule {
  name: string;
  rule: Rule;
}
