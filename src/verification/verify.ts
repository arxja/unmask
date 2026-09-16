import type { Finding } from "../core/finding";
import type { Candidate } from "../detection/regex-engine";
import { createBabelParser, isSupportedFile, type Parser } from "./parsers";
import { RULES } from "./rules";
import type { VerificationContext } from "./types";

/**
 * Run every verification rule over a batch of candidates and return the
 * surviving findings. Applies the verdicts — drop, adjust severity,
 * adjust confidence — and discards the raw value.
 *
 * Parses the source at most once per call. If the file is not a
 * supported language or fails to parse, the AST is null and rules that
 * need it short-circuit to "keep".
 */
export function verifyFindings(
  candidates: Candidate[],
  source: string,
  filePath: string,
  parser: Parser = defaultParser,
): Finding[] {
  if (candidates.length === 0) return [];

  const ctx: VerificationContext = { ast: null, source, filePath };

  if (isSupportedFile(filePath)) {
    const result = parser.parse(source, filePath);
    ctx.ast = result.ast;
  }

  const survivors: Finding[] = [];

  for (const candidate of candidates) {
    const verdict = applyRules(candidate, ctx);
    if (verdict) survivors.push(verdict);
  }

  return survivors;
}

function applyRules(
  candidate: Candidate,
  ctx: VerificationContext,
): Finding | null {
  let severity = candidate.finding.severity;
  let confidence = candidate.finding.confidence;
  let adjusted = false;

  for (const { rule } of RULES) {
    const verdict = rule(candidate.finding, candidate.rawValue, ctx);

    switch (verdict.action) {
      case "keep":
        break;
      case "drop":
        return null;
      case "adjust":
        if (verdict.severity !== undefined) {
          severity = verdict.severity;
          adjusted = true;
        }
        if (verdict.confidence !== undefined) {
          confidence = verdict.confidence;
          adjusted = true;
        }
        break;
    }
  }

  if (!adjusted) return candidate.finding;
  return { ...candidate.finding, severity, confidence };
}

const defaultParser = createBabelParser();
