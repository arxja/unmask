import type { Rule } from "../types";

/**
 * Findings in test, fixture, example, and mock paths are common sources
 * of noise. Test files contain real-shaped secrets by design.
 *
 * This rule does NOT drop findings — a committed secret can leak from a
 * test file as easily as from source, and dropping it would hide real
 * leaks. It downgrades severity, which lets the CLI's `--fail-on`
 * threshold decide what to do about it.
 *
 * Severity is downgraded, not confidence, because severity is what the
 * exit-code policy reads. Confidence is a signal for humans.
 */

const TEST_PATH_PATTERNS: RegExp[] = [
  /(^|\/)tests?\//i,
  /(^|\/)__tests__\//i,
  /(^|\/)specs?\//i,
  /(^|\/)fixtures?\//i,
  /(^|\/)mocks?\//i,
  /\.test\.[cm]?[jt]sx?$/i,
  /\.spec\.[cm]?[jt]sx?$/i,
  /\.example$/i,
  /\.sample$/i,
  /(^|\/)\.env\.example$/i,
  /(^|\/)\.env\.sample$/i,
];

export const testPathRule: Rule = (finding) => {
  if (!TEST_PATH_PATTERNS.some((re) => re.test(finding.file))) {
    return { action: "keep" };
  }
  return {
    action: "adjust",
    reason: "file path matches a test/fixture pattern",
    severity: "low",
  };
};
