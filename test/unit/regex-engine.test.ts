import { describe, it, expect, beforeEach } from "vitest";
import { scanContent } from "../../src/detection/regex-engine";
import { vi } from "vitest";
import { vol } from "memfs";
import { loadPatterns } from "../../src/detection/regex-engine";

vi.mock("node:fs");
vi.mock("node:fs/promises");

const patterns = [
  {
    id: "aws-key",
    name: "AWS Access Key",
    provider: "aws",
    regex: "AKIA[0-9A-Z]{16}",
    flags: "",
    confidence: "high",
    severity: "critical",
    entropyCheck: false,
  },
];

describe("scanContent", () => {
  it("finds a pattern and returns line number", () => {
    const content = "line one\nAKIAIOSFODNN7EXAMPLE\nline three";
    const findings = scanContent(content, "fake.txt", patterns);

    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(2);
    expect(findings[0].match).toBe("AKIAIOSFODNN7EXAMPLE");
  });

  it("returns empty array when nothing matches", () => {
    const findings = scanContent("clean file", "fake.txt", patterns);
    expect(findings).toEqual([]);
  });

  it("rejects a pattern match with low entropy when entropyCheck is enabled", () => {
    const entropyPatterns = [{ ...patterns[0], entropyCheck: true }];
    // 20 chars, matches AKIA[0-9A-Z]{16}, no runs > 4,
    // alphabet = {A,B,C,1,2,3} = 6 distinct (still < 8... need more)
    const content = "AKIABCABCABCABCABC1";
    const findings = scanContent(content, "fake.txt", entropyPatterns);
    expect(findings).toHaveLength(0);
  });
});

describe("loadPatterns", () => {
  beforeEach(() => vol.reset());

  it("parses a valid pattern file", () => {
    vol.fromJSON({
      "/patterns.json": JSON.stringify(patterns),
    });

    const result = loadPatterns("/patterns.json");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("aws-key");
  });

  it("throws when the file is missing", () => {
    expect(() => loadPatterns("/missing.json")).toThrow(
      /Failed to load patterns/,
    );
  });
});
