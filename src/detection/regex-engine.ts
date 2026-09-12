import * as fs from "node:fs";
import { createHash } from "node:crypto";
import { hasHighEntropy } from "./entropy";
import { redact, redactLine } from "../report/redact";
import {
  type Confidence,
  type Finding,
  type Severity,
  isConfidence,
  isSeverity,
} from "../core/finding";

export interface Pattern {
  id: string;
  name: string;
  provider: string;
  regex: string;
  flags: string;
  confidence: Confidence;
  severity: Severity;
  entropyCheck: boolean;
}

const REQUIRED_PATTERN_FIELDS = [
  "id",
  "name",
  "provider",
  "regex",
  "flags",
  "confidence",
  "severity",
  "entropyCheck",
] as const;

function isPattern(value: unknown): value is Pattern {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    REQUIRED_PATTERN_FIELDS.every((field) => field in record) &&
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.provider === "string" &&
    typeof record.regex === "string" &&
    typeof record.flags === "string" &&
    isConfidence(record.confidence) &&
    isSeverity(record.severity) &&
    typeof record.entropyCheck === "boolean"
  );
}

/**
 * The last non-empty capture group is the secret. If the regex has no
 * capture groups, the whole match is treated as the secret.
 *
 * Pattern authors must use (?:...) for grouping they don't want treated
 * as the secret.
 */
export function extractSecret(match: RegExpExecArray): string {
  if (match.length <= 1) return match[0];
  for (let i = match.length - 1; i >= 1; i--) {
    const g = match[i];
    if (g !== undefined && g !== "") return g;
  }
  return match[0];
}

/**
 * Stable identifier for a secret, used for cross-file dedup and (later)
 * baseline files. SHA-256 truncated to 48 bits — collision-safe at tool
 * scale, and fast enough to call per finding.
 */
export function fingerprint(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex").slice(0, 12);
}

/**
 * Load and validate patterns from a JSON file.
 * Fails loudly on the first invalid pattern — including patterns whose
 * regex does not compile, so we never discover that mid-scan.
 */
export function loadPatterns(patternFile: string): Pattern[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(patternFile, "utf-8"));
  } catch (error) {
    throw new Error(`Failed to load patterns from ${patternFile}: ${error}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      "Patterns file must contain a JSON array of Pattern objects.",
    );
  }

  for (const [index, item] of parsed.entries()) {
    if (!isPattern(item)) {
      throw new Error(
        `Invalid Pattern at index ${index} in ${patternFile}: ` +
          `expected a valid Pattern object with all required fields and correct types.`,
      );
    }

    // Validate that the regex compiles with the same flags the scanner
    // will use. `g` is forced on so validation matches runtime behavior.
    const flags = item.flags.includes("g") ? item.flags : `${item.flags}g`;
    try {
      new RegExp(item.regex, flags);
    } catch (error) {
      throw new Error(
        `Invalid Pattern at index ${index} in ${patternFile}: ` +
          `regex failed to compile — ${(error as Error).message}`,
      );
    }
  }

  return parsed;
}

/**
 * Scan one file's content.
 *
 * Caller contract: `filePath` must already be relative to the scan's
 * rootDir. Normalization happens in core/scan-runner, not here, so this
 * function stays pure and easy to test.
 */
export function scanContent(
  content: string,
  filePath: string,
  patterns: Pattern[],
): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split("\n");

  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g")
      ? pattern.flags
      : `${pattern.flags}g`;
    const regex = new RegExp(pattern.regex, flags);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(line)) !== null) {
        if (match[0].length === 0) {
          regex.lastIndex++;
          continue;
        }

        const secret = extractSecret(match);

        if (pattern.entropyCheck && !hasHighEntropy(secret)) {
          continue;
        }

        findings.push({
          patternId: pattern.id,
          patternName: pattern.name,
          provider: pattern.provider,
          severity: pattern.severity,
          confidence: pattern.confidence,
          file: filePath,
          line: i + 1,
          column: match.index + 1,
          fingerprint: fingerprint(secret),
          masked: redact(secret),
          context: [redactLine(line, secret).trim()],
        });
      }
    }
  }

  return findings;
}
