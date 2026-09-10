import { describe, it, expect, beforeEach, vi } from "vitest";
import { vol } from "memfs";
import { scanContent, loadPatterns } from "../../src/detection/regex-engine";

vi.mock("node:fs");
vi.mock("node:fs/promises");

const patterns = [
  {
    id: "test-key",
    name: "Test Key",
    provider: "test",
    regex: "KEY_([A-Z]+)_([A-Za-z0-9]+)",
    flags: "",
    confidence: "high",
    severity: "critical",
    entropyCheck: false,
  },
];

describe("scanContent", () => {
  it("finds a pattern and returns line number", () => {
    const content = "line one\nKEY_ABC_xK9mP2qL8nR4tZ6w\nline three";
    const findings = scanContent(content, "fake.txt", patterns);

    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(2);
    expect(findings[0].match).toBe("KEY_ABC_xK9mP2qL8nR4tZ6w");
  });

  it("returns empty array when nothing matches", () => {
    const findings = scanContent("clean file", "fake.txt", patterns);
    expect(findings).toEqual([]);
  });

  describe("when entropyCheck is enabled", () => {
    const entropyPatterns = [{ ...patterns[0], entropyCheck: true }];

    it("rejects a match whose group-2 content has low entropy", () => {
      // group 2 = "AAAAAAAAAAAAAAA" (15 chars, entropy 0)
      const content = "KEY_ABC_AAAAAAAAAAAAAAA";
      const findings = scanContent(content, "fake.txt", entropyPatterns);
      expect(findings).toHaveLength(0);
    });

    it("accepts a match whose group-2 content has high entropy", () => {
      // group 2 = 32 distinct chars, entropy = log2(32) = 5 > 4.5
      const content = "KEY_ABC_xK9mP2qL8nR4tZ6wY3vB5cD7fG1hJ0sA";
      const findings = scanContent(content, "fake.txt", entropyPatterns);
      expect(findings).toHaveLength(1);
    });
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
    expect(result[0].id).toBe("test-key");
  });

  it("throws when the file is missing", () => {
    expect(() => loadPatterns("/missing.json")).toThrow(
      /Failed to load patterns/,
    );
  });
});
