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
  match: string;
  context: string;
}

/**
 * Load and parse regex patterns from a JSON file.
 */
export function loadPatterns(patternFile: string): Pattern[] {
  try {
    const content = fs.readFileSync(patternFile, "utf-8");
    return JSON.parse(content) as Pattern[];
  } catch (error) {
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
        if (pattern.entropyCheck && match[2]) {
          if (!hasHighEntropy(match[2])) {
            continue;
          }
        }

        findings.push({
          patternId: pattern.id,
          patternName: pattern.name,
          provider: pattern.provider,
          severity: pattern.severity,
          file: filePath,
          line: i + 1,
          match: match[0],
          context: line.trim(),
        });
      }
    }
  }

  return findings;
}
