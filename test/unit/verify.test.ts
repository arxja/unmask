import { describe, it, expect } from "vitest";
import { verifyFindings } from "../../src/verification/verify";
import type { Candidate } from "../../src/detection/regex-engine";
import type { Finding } from "../../src/core/finding";

function makeCandidate(
  overrides: Partial<Finding> = {},
  rawValue = "",
): Candidate {
  return {
    finding: {
      patternId: "p",
      patternName: "P",
      provider: "test",
      severity: "high",
      confidence: "high",
      file: "src/a.ts",
      line: 1,
      column: 1,
      masked: "ab••••••••yz",
      fingerprint: "fp123456789a",
      ...overrides,
    },
    rawValue,
  };
}

describe("verifyFindings", () => {
  it("returns an empty array for empty input without parsing", () => {
    expect(verifyFindings([], "const x = 1;", "test.ts")).toEqual([]);
  });

  it("drops findings whose value is a placeholder", () => {
    const candidates = [
      makeCandidate({ file: "src/a.ts" }, "your_api_key_here"),
    ];
    const result = verifyFindings(candidates, "", "src/a.ts");
    expect(result).toHaveLength(0);
  });

  it("adjusts severity for findings in test paths", () => {
    const candidates = [
      makeCandidate(
        { file: "test/foo.ts", severity: "critical" },
        "sk_live_abcdef",
      ),
    ];
    const result = verifyFindings(candidates, "", "test/foo.ts");
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("low");
  });

  it("keeps a finding that no rule matches", () => {
    const candidates = [
      makeCandidate(
        { file: "src/a.ts", line: 1, column: 1 },
        "sk_live_51H8xKqLmN9pQrStUvWxYz012",
      ),
    ];
    const result = verifyFindings(
      candidates,
      'const x = "sk_live_51H8xKqLmN9pQrStUvWxYz012";',
      "src/a.ts",
    );
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("high");
  });

  it("does not throw when the source is malformed", () => {
    const candidates = [makeCandidate()];
    expect(() =>
      verifyFindings(candidates, "const x = ((((", "src/a.ts"),
    ).not.toThrow();
  });

  it("does not drop findings when the file is not a supported language", () => {
    const candidates = [makeCandidate({ file: "config.json" })];
    const result = verifyFindings(candidates, '{"key":"value"}', "config.json");
    expect(result).toHaveLength(1);
  });

  it("returns a new Finding object when severity or confidence is adjusted", () => {
    // The original candidate's finding must not be mutated.
    const original = makeCandidate({ file: "test/foo.ts" }, "sk_live_abcdef");
    const originalSeverity = original.finding.severity;

    const result = verifyFindings([original], "", "test/foo.ts");

    expect(original.finding.severity).toBe(originalSeverity);
    expect(result[0].severity).toBe("low");
    expect(result[0]).not.toBe(original.finding);
  });
});
