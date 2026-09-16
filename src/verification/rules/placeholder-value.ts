import type { Rule } from "../types";

/**
 * Placeholder values — the strings docs use to say "put your key here".
 * These have the right length and shape to match a secret pattern but
 * are obviously not credentials.
 *
 * This rule is the reason `rawValue` exists in the verification phase.
 * It cannot be expressed against `Finding.masked`, which only carries
 * the redacted form.
 *
 * The check is substring-based and case-insensitive on a curated list.
 * It is intentionally conservative: a false drop is a missed leak,
 * which is worse than a false keep.
 */

const PLACEHOLDER_SUBSTRINGS = [
  "YOUR_",
  "YOUR-",
  "MY_",
  "MY-",
  "_HERE",
  "-HERE",
  "GOES_HERE",
  "GOES-HERE",
  "REPLACE_ME",
  "REPLACE-ME",
  "CHANGEME",
  "CHANGE_ME",
  "CHANGE-ME",
  "PLACEHOLDER",
  "NOT_A_REAL",
  "NOT-A-REAL",
  "DUMMY",
  "SAMPLE",
  "EXAMPLE",
  "TODO",
  "FIXME",
];

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^<.*>$/, // <YOUR_KEY_HERE>
  /^\$\{.*\}$/, // ${API_KEY}
  /^\{\{.*\}\}$/, // {{API_KEY}}
  /^x{8,}$/i, // xxxxxxxxxx
  /^0{8,}$/, // 00000000
  /(.)\1{7,}/, // 8+ repetitions of the same character anywhere in the value
];

export const placeholderValueRule: Rule = (_finding, rawValue) => {
  const trimmed = rawValue.trim();

  for (const marker of PLACEHOLDER_SUBSTRINGS) {
    if (trimmed.toUpperCase().includes(marker)) {
      return {
        action: "drop",
        reason: `value contains placeholder marker "${marker}"`,
      };
    }
  }

  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        action: "drop",
        reason: `value matches a placeholder shape`,
      };
    }
  }

  return { action: "keep" };
};
