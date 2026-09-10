import * as fs from "fs";
import { hasHighEntropy } from "../detection/entropy";

export interface Pattern {
  id: string;
  name: string;
  provider: string;
  regex: string;
  flags: string;
  confidence: string;
  severity: string;
  entropyCheck: boolean;
}

export interface Finding {
  patternId: string;
  patternName: string;
  provider: string;
  severity: string;
  file: string;
  line: number;
  offset: number;
  fingerprint: string;
  match: string;
  context: string;
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
    typeof record.confidence === "string" &&
    typeof record.severity === "string" &&
    typeof record.entropyCheck === "boolean"
  );
}

function redact(value: string): string {
  return value.length ? "[REDACTED]" : "";
}

function fingerprint(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return `fp:${hash.toString(16).padStart(8, "0")}`;
}

/**
 * Load and parse regex patterns from a JSON file.
 */
export function loadPatterns(patternFile: string): Pattern[] {
  try {
    const content = fs.readFileSync(patternFile, "utf-8");
    const parsed = JSON.parse(content);

    if (!Array.isArray(parsed)) {
      throw new Error(
        "Patterns file must contain a JSON array of Pattern objects.",
      );
    }

    for (const [index, item] of parsed.entries()) {
      if (!isPattern(item)) {
        throw new Error(
          `Invalid Pattern at index ${index} in ${patternFile}: expected a valid Pattern object with all required fields and correct types.`,
        );
      }
    }

    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid Pattern")) {
      throw error;
    }
    throw new Error(`Failed to load patterns from ${patternFile}: ${error}`);
  }
}

/**
 * Scan a single file's content for secret patterns.
 * Returns findings with line numbers relative to the given content.
 */
export function scanContent(
  content: string,
  filePath: string,
  patterns: Pattern[],
): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split("\n");

  for (const pattern of patterns) {
    let flags = pattern.flags || "";
    if (!flags.includes("g")) flags += "g";
    const regex = new RegExp(pattern.regex, flags);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(line)) !== null) {
        // Safety: avoid infinite loop on zero-length matches
        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }

        // Entropy check
        if (pattern.entropyCheck) {
          const candidate = match[2];
          if (
            candidate === undefined ||
            candidate === "" ||
            candidate === null
          ) {
            continue;
          }
          if (!hasHighEntropy(candidate)) {
            continue;
          }
        }

        const rawMatch = match[0];
        const safeContext = line.trim();
        const redactedMatch = redact(rawMatch);
        findings.push({
          patternId: pattern.id,
          patternName: pattern.name,
          provider: pattern.provider,
          severity: pattern.severity,
          file: filePath,
          line: i + 1,
          offset: match.index,
          fingerprint: fingerprint(rawMatch),
          match: redactedMatch,
          context: safeContext.includes(rawMatch)
            ? safeContext.split(rawMatch).join(redactedMatch)
            : redact(safeContext),
        });
      }
    }
  }

  return findings;
}
