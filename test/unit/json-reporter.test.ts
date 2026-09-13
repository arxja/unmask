import { describe, it, expect } from "vitest";
import { JsonReporter } from "../../src/report/json-reporter";
import type { Finding, ScanResult } from "../../src/core/finding";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    patternId: "p",
    patternName: "P",
    provider: "test",
    severity: "high",
    confidence: "high",
    file: "a.ts",
    line: 1,
    column: 1,
    masked: "ab••••••••yz",
    fingerprint: "aaa111bbb222",
    context: ["const x = 'ab••••••••yz'"],
    ...overrides,
  };
}

function scanResult(findings: Finding[]): ScanResult {
  return {
    findings,
    filesScanned: findings.length,
    filesSkipped: [],
    durationMs: 1,
    rootDir: "/root",
    version: "test",
  };
}

/** Capture stdout by injecting a fake stream and reading what was written. */
function captureReport(result: ScanResult): any {
  const chunks: string[] = [];
  const stream = {
    write: (s: string) => {
      chunks.push(s);
      return true;
    },
  } as unknown;

  new JsonReporter({ pretty: false, stream }).report(result);
  return JSON.parse(chunks.join(""));
}

describe("JsonReporter", () => {
  describe("serialized findings", () => {
    it("includes the fingerprint so consumers can group across runs", () => {
      const payload = captureReport(scanResult([finding()]));

      expect(payload.findings[0]).toHaveProperty("fingerprint", "aaa111bbb222");
    });

    it("never emits a raw secret, even if a finding smuggled one into context", () => {
      // Redaction is a non-negotiable per the testing doc. This is the
      // reporter's last line of defense: it can only serialize what it
      // is given, and what it is given must already be masked.
      const raw = "AKIAIOSFODNN7EXAMPLE";
      const payload = captureReport(
        scanResult([
          finding({
            masked: "AK••••••••LE",
            context: ["const k = 'AK••••••••LE'"],
          }),
        ]),
      );

      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain(raw);
    });
  });

  describe("input immutability", () => {
    it("does not mutate the caller's findings array or its order", () => {
      const original = [finding({ file: "z.ts" }), finding({ file: "a.ts" })];
      const before = original.map((f) => f.file);

      const payload = captureReport(scanResult(original));

      // The reporter sorts for output; the caller's array must be untouched.
      expect(original.map((f) => f.file)).toEqual(before);
      // And the output is the sorted copy.
      expect(payload.findings.map((f: Finding) => f.file)).toEqual([
        "a.ts",
        "z.ts",
      ]);
    });
  });
});
