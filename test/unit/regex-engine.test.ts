import { describe, it, expect, beforeEach, vi } from "vitest";
import { vol } from "memfs";
import {
  scanContent,
  loadPatterns,
  type Pattern,
} from "../../src/detection/regex-engine";
import type { Finding } from "../../src/core/finding";

vi.mock("node:fs");
vi.mock("node:fs/promises");

const patterns: Pattern[] = [
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

/**
 * scanContent returns Candidate[] (finding + rawValue). Tests that
 * assert on the Finding shape unwrap here rather than repeating
 * `.finding` at every call site.
 */
function scanned(
  content: string,
  filePath: string,
  patterns: Pattern[],
): Finding[] {
  return scanContent(content, filePath, patterns).map((c) => c.finding);
}

describe("scanContent", () => {
  it("finds a pattern and returns 1-based line and column", () => {
    const content = "line one\nKEY_ABC_xK9mP2qL8nR4tZ6w\nline three";
    const findings = scanned(content, "fake.txt", patterns);

    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(2);
    expect(findings[0].column).toBe(1);
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].confidence).toBe("high");
  });

  it("masks the extracted secret, not the whole match", () => {
    const [f] = scanned("KEY_ABC_xK9mP2qL8nR4tZ6w", "fake.txt", patterns);

    // extractSecret → "xK9mP2qL8nR4tZ6w" (last non-empty capture group)
    // redact()      → 2 chars + 8 dots + 2 chars
    expect(f.masked).toBe("xK••••••••6w");
  });

  it("produces a 12-char hex fingerprint", () => {
    const [f] = scanned("KEY_ABC_xK9mP2qL8nR4tZ6w", "fake.txt", patterns);
    expect(f.fingerprint).toMatch(/^[0-9a-f]{12}$/);
  });

  it("produces the same fingerprint for the same secret in different contexts", () => {
    const a = scanned("KEY_ABC_xK9mP2qL8nR4tZ6w", "a.ts", patterns)[0];
    const b = scanned("KEY_XYZ_xK9mP2qL8nR4tZ6w", "b.ts", patterns)[0];

    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.masked).toBe(b.masked);
  });

  it("redacts every detected secret on the same line before storing context", () => {
    const multiPattern = [
      {
        ...patterns[0],
        id: "token",
        name: "Token",
        regex: "TOKEN=([A-Za-z0-9]+)",
      },
      {
        ...patterns[0],
        id: "key",
        name: "Key",
        regex: "KEY_([A-Z]+)_([A-Za-z0-9]+)",
      },
    ];

    const content = "TOKEN=abc12345 KEY_ABC_xK9mP2qL8nR4tZ6w";
    const findings = scanned(content, "fake.txt", multiPattern);

    expect(findings).toHaveLength(2);
    for (const finding of findings) {
      expect(finding.context?.[0]).not.toContain("abc12345");
      expect(finding.context?.[0]).not.toContain("xK9mP2qL8nR4tZ6w");
      expect(finding.context?.[0]).toContain("•");
    }
  });

  it("returns an empty array when nothing matches", () => {
    const findings = scanned("clean file", "fake.txt", patterns);
    expect(findings).toEqual([]);
  });

  describe("candidate shape", () => {
    it("wraps each finding with the raw value that produced it", () => {
      const candidates = scanContent(
        "KEY_ABC_xK9mP2qL8nR4tZ6w",
        "fake.txt",
        patterns,
      );

      expect(candidates).toHaveLength(1);
      const [c] = candidates;

      expect(c.finding.masked).toBe("xK••••••••6w");
      expect(c.finding.fingerprint).toMatch(/^[0-9a-f]{12}$/);
      expect(c.finding.line).toBe(1);
      expect(c.finding.column).toBe(1);

      // The raw value is the last non-empty capture group — the same
      // string redact() was called with.
      expect(c.rawValue).toBe("xK9mP2qL8nR4tZ6w");
    });

    it("does not leak the raw value into the finding", () => {
      // Regression guard for the Candidate boundary: no field on
      // Finding may carry the raw secret. If a future change adds
      // `raw` or `rawMatch` to Finding, this test fails before any
      // reporter can be built on top of the leak.
      const raw = "xK9mP2qL8nR4tZ6w";
      const [c] = scanContent("KEY_ABC_xK9mP2qL8nR4tZ6w", "f.ts", patterns);

      expect(JSON.stringify(c.finding)).not.toContain(raw);
      for (const value of Object.values(c.finding)) {
        expect(value).not.toBe(raw);
      }
    });

    it("returns an empty array when nothing matches", () => {
      expect(scanContent("clean file", "fake.txt", patterns)).toEqual([]);
    });
  });

  describe("extractSecret heuristic", () => {
    it("uses the whole match when the pattern has no capture groups", () => {
      const noGroups = [{ ...patterns[0], regex: "KEY_[A-Z]+_[A-Za-z0-9]+" }];
      const [f] = scanned("KEY_ABC_xK9mP2qL8nR4tZ6w", "f.ts", noGroups);

      // Whole match is 23 chars → 2 + 8 dots + 2
      expect(f.masked).toBe("KE••••••••6w");
    });

    it("uses the last non-empty group, ignoring non-participating ones", () => {
      const trailing = [
        { ...patterns[0], regex: "KEY_([A-Z]+)_([A-Za-z0-9]+)(?:\\s|$)" },
      ];
      const [f] = scanned("KEY_ABC_xK9mP2qL8nR4tZ6w", "f.ts", trailing);

      expect(f.masked).toBe("xK••••••••6w");
    });
  });

  describe("when entropyCheck is enabled", () => {
    const entropyPatterns = [{ ...patterns[0], entropyCheck: true }];

    it("rejects a match whose extracted secret has low entropy", () => {
      // Extracted secret = "AAAAAAAAAAAAAAA" (15 chars, entropy 0).
      // Note: this is caught by the minLength gate, not the entropy
      // gate. The testing doc flags this as a known smell — a
      // correctly-isolated entropy-density test needs a 20+ char
      // value that clears length, runs, alphabet, and classes.
      const content = "KEY_ABC_AAAAAAAAAAAAAAA";
      const findings = scanned(content, "fake.txt", entropyPatterns);
      expect(findings).toHaveLength(0);
    });

    it("rejects when the extracted secret is too short to clear minLength", () => {
      // No group 2 → falls back to group 1 ("ABC"), which fails the
      // entropy minLength gate (20).
      const missingGroupPattern = {
        ...patterns[0],
        regex: "KEY_([A-Z]+)(?:_([A-Za-z0-9]+))?",
        entropyCheck: true,
      };
      // Empty group 2 → same fallback, same rejection.
      const emptyGroupPattern = {
        ...patterns[0],
        regex: "KEY_([A-Z]+)_([A-Za-z0-9]*)",
        entropyCheck: true,
      };

      expect(scanned("KEY_ABC", "fake.txt", [missingGroupPattern])).toEqual([]);
      expect(scanned("KEY_ABC_", "fake.txt", [emptyGroupPattern])).toEqual([]);
    });

    it("accepts a match whose extracted secret has high entropy", () => {
      const content = "KEY_ABC_xK9mP2qL8nR4tZ6wY3vB5cD7fG1hJ0sA";
      const findings = scanned(content, "fake.txt", entropyPatterns);
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

  it("rejects malformed pattern payloads", () => {
    vol.fromJSON({
      "/bad-patterns.json": JSON.stringify([{ id: "missing-fields" }]),
    });

    expect(() => loadPatterns("/bad-patterns.json")).toThrow(
      /Pattern.*invalid|valid Pattern/,
    );
  });

  it("rejects patterns with an invalid severity or confidence", () => {
    vol.fromJSON({
      "/bad-severity.json": JSON.stringify([
        { ...patterns[0], severity: "sev:critical" },
      ]),
    });
    vol.fromJSON({
      "/bad-confidence.json": JSON.stringify([
        { ...patterns[0], confidence: "very-high" },
      ]),
    });

    expect(() => loadPatterns("/bad-severity.json")).toThrow(/valid Pattern/);
    expect(() => loadPatterns("/bad-confidence.json")).toThrow(/valid Pattern/);
  });

  it("rejects patterns whose regex does not compile", () => {
    vol.fromJSON({
      "/bad-regex.json": JSON.stringify([
        { ...patterns[0], regex: "KEY_([A-Z]+" },
      ]),
    });

    expect(() => loadPatterns("/bad-regex.json")).toThrow(
      /regex failed to compile/,
    );
  });

  it("throws when the file is missing", () => {
    expect(() => loadPatterns("/missing.json")).toThrow(
      /Failed to load patterns/,
    );
  });
});
