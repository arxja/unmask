import { describe, it, expect, beforeEach, vi } from "vitest";
import { vol } from "memfs";
import {
  scanContent,
  loadPatterns,
  type Pattern,
} from "../../src/detection/regex-engine";
import { JsonReporter } from "../../src/report/json-reporter";

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

describe("scanContent", () => {
  it("finds a pattern and returns 1-based line and column", () => {
    const content = "line one\nKEY_ABC_xK9mP2qL8nR4tZ6w\nline three";
    const findings = scanContent(content, "fake.txt", patterns);

    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(2);
    expect(findings[0].column).toBe(1);
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].confidence).toBe("high");
  });

  it("masks the extracted secret, not the whole match", () => {
    const [f] = scanContent("KEY_ABC_xK9mP2qL8nR4tZ6w", "fake.txt", patterns);

    // extractSecret → "xK9mP2qL8nR4tZ6w" (last non-empty capture group)
    // redact()      → 2 chars + 8 dots + 2 chars
    expect(f.masked).toBe("xK••••••••6w");
  });

  it("produces a 12-char hex fingerprint", () => {
    const [f] = scanContent("KEY_ABC_xK9mP2qL8nR4tZ6w", "fake.txt", patterns);
    expect(f.fingerprint).toMatch(/^[0-9a-f]{12}$/);
  });

  it("produces the same fingerprint for the same secret in different contexts", () => {
    const a = scanContent("KEY_ABC_xK9mP2qL8nR4tZ6w", "a.ts", patterns)[0];
    const b = scanContent("KEY_XYZ_xK9mP2qL8nR4tZ6w", "b.ts", patterns)[0];

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
    const findings = scanContent(content, "fake.txt", multiPattern);

    expect(findings).toHaveLength(2);
    for (const finding of findings) {
      expect(finding.context?.[0]).not.toContain("abc12345");
      expect(finding.context?.[0]).not.toContain("xK9mP2qL8nR4tZ6w");
      expect(finding.context?.[0]).toContain("•");
    }
  });

  it("returns an empty array when nothing matches", () => {
    const findings = scanContent("clean file", "fake.txt", patterns);
    expect(findings).toEqual([]);
  });

  describe("extractSecret heuristic", () => {
    it("uses the whole match when the pattern has no capture groups", () => {
      const noGroups = [{ ...patterns[0], regex: "KEY_[A-Z]+_[A-Za-z0-9]+" }];
      const [f] = scanContent("KEY_ABC_xK9mP2qL8nR4tZ6w", "f.ts", noGroups);

      // Whole match is 23 chars → 2 + 8 dots + 2
      expect(f.masked).toBe("KE••••••••6w");
    });

    it("uses the last non-empty group, ignoring non-participating ones", () => {
      const trailing = [
        { ...patterns[0], regex: "KEY_([A-Z]+)_([A-Za-z0-9]+)(?:\\s|$)" },
      ];
      const [f] = scanContent("KEY_ABC_xK9mP2qL8nR4tZ6w", "f.ts", trailing);

      expect(f.masked).toBe("xK••••••••6w");
    });
  });

  describe("when entropyCheck is enabled", () => {
    const entropyPatterns = [{ ...patterns[0], entropyCheck: true }];

    it("rejects a match whose extracted secret has low entropy", () => {
      // Extracted secret = "AAAAAAAAAAAAAAA" (15 chars, entropy 0)
      const content = "KEY_ABC_AAAAAAAAAAAAAAA";
      const findings = scanContent(content, "fake.txt", entropyPatterns);
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

      expect(scanContent("KEY_ABC", "fake.txt", [missingGroupPattern])).toEqual(
        [],
      );
      expect(scanContent("KEY_ABC_", "fake.txt", [emptyGroupPattern])).toEqual(
        [],
      );
    });

    it("accepts a match whose extracted secret has high entropy", () => {
      const content = "KEY_ABC_xK9mP2qL8nR4tZ6wY3vB5cD7fG1hJ0sA";
      const findings = scanContent(content, "fake.txt", entropyPatterns);
      expect(findings).toHaveLength(1);
    });
  });
});

describe("JsonReporter", () => {
  it("omits fingerprint from serialized findings and sorts a copy of findings", () => {
    const original = [
      {
        patternId: "low",
        patternName: "Low",
        provider: "test",
        severity: "low",
        confidence: "high",
        file: "z.ts",
        line: 2,
        column: 1,
        masked: "zz••••••••zz",
        fingerprint: "fffaaa111bbb",
        context: ["z"],
      },
      {
        patternId: "crit",
        patternName: "Critical",
        provider: "test",
        severity: "critical",
        confidence: "high",
        file: "a.ts",
        line: 1,
        column: 1,
        masked: "aa••••••••aa",
        fingerprint: "aaa111bbb222",
        context: ["a"],
      },
    ] as const;

    const stream = { write: vi.fn() };
    const reporter = new JsonReporter({ pretty: false, stream: stream as any });

    reporter.report({
      findings: [...original],
      filesScanned: 2,
      durationMs: 4,
      rootDir: ".",
      version: "1.0.0",
    });

    const payload = JSON.parse(stream.write.mock.calls[0][0]);

    expect(payload.findings.map((f: { file: string }) => f.file)).toEqual([
      "a.ts",
      "z.ts",
    ]);
    expect(payload.findings[0]).not.toHaveProperty("fingerprint");
    expect(payload.findings[1]).not.toHaveProperty("fingerprint");
    expect(original.map((f) => f.file)).toEqual(["z.ts", "a.ts"]);
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
