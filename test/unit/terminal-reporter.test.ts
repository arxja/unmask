import { describe, it, expect } from "vitest";
import { TerminalReporter } from "../../src/report/terminal-reporter";
import type { Finding, ScanResult } from "../../src/core/finding";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    patternId: "p",
    patternName: "P",
    provider: "test",
    severity: "high",
    confidence: "high",
    file: "src/a.ts",
    line: 1,
    column: 1,
    masked: "ab••••••••yz",
    fingerprint: "fp0000000001",
    context: ["const x = 'ab••••••••yz'"],
    ...overrides,
  };
}

function result(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    findings: [],
    filesScanned: 0,
    filesSkipped: [],
    durationMs: 1,
    rootDir: "/root",
    version: "test",
    ...overrides,
  };
}

function capture(r: ScanResult, opts = {}): string {
  const chunks: string[] = [];
  const stream = {
    write: (s: string) => {
      chunks.push(s);
      return true;
    },
  } as unknown as NodeJS.WritableStream;

  new TerminalReporter({ stream, color: false, ...opts }).report(r);
  return chunks.join("");
}

describe("TerminalReporter", () => {
  describe("clean scan", () => {
    it("prints a single confirmation line", () => {
      const out = capture(result({ filesScanned: 41, durationMs: 171 }));
      expect(out).toMatch(/No secrets found/);
      expect(out).toMatch(/41 files/);
      expect(out).toMatch(/171ms/);
    });

    it("does not print the findings table", () => {
      const out = capture(result());
      expect(out).not.toContain("─");
    });
  });

  describe("findings", () => {
    it("groups findings under their file path", () => {
      const out = capture(
        result({
          findings: [
            finding({ file: "src/a.ts" }),
            finding({ file: "src/a.ts", line: 5 }),
          ],
          filesScanned: 2,
        }),
      );
      expect(out).toMatch(/src\/a\.ts/);
      // The file header appears once, not once per finding.
      expect(out.match(/src\/a\.ts/g)?.length).toBe(1);
    });

    it("sorts files alphabetically", () => {
      const out = capture(
        result({
          findings: [finding({ file: "z.ts" }), finding({ file: "a.ts" })],
        }),
      );
      const aIdx = out.indexOf("a.ts");
      const zIdx = out.indexOf("z.ts");
      expect(aIdx).toBeLessThan(zIdx);
    });

    it("annotates a fingerprint that appears in multiple files exactly once", () => {
      const out = capture(
        result({
          findings: [
            finding({ file: "a.ts", fingerprint: "same" }),
            finding({ file: "b.ts", fingerprint: "same" }),
            finding({ file: "c.ts", fingerprint: "same" }),
          ],
        }),
      );
      const annotations = out.match(/same secret also in/g) ?? [];
      expect(annotations).toHaveLength(1);
    });

    it("does not annotate a fingerprint that appears in only one file", () => {
      const out = capture(
        result({ findings: [finding({ fingerprint: "unique" })] }),
      );
      expect(out).not.toContain("same secret also in");
    });
  });

  describe("max-findings", () => {
    it("truncates at the limit and prints a remainder line", () => {
      const findings = Array.from({ length: 5 }, (_, i) =>
        finding({ file: `f${i}.ts`, line: i + 1 }),
      );
      const out = capture(result({ findings }), { maxFindings: 2 });
      expect(out).toMatch(/3 more findings/);
    });

    it("treats 0 as unlimited", () => {
      const findings = Array.from({ length: 5 }, (_, i) =>
        finding({ file: `f${i}.ts`, line: i + 1 }),
      );
      const out = capture(result({ findings }), { maxFindings: 0 });
      expect(out).not.toMatch(/more findings/);
    });
  });

  describe("color", () => {
    it("emits no ANSI escape codes when color is disabled", () => {
      const out = capture(result({ findings: [finding()] }), { color: false });
      // \u001b is the ANSI escape character.
      expect(out).not.toContain("\u001b");
    });
  });

  describe("redaction", () => {
    it("never emits a raw secret when the finding only carries a mask", () => {
      // The reporter's contract: it receives findings whose `masked` and
      // `context` fields are already redacted. This test asserts the
      // reporter does not somehow reintroduce a raw value — for example
      // by echoing the finding object or by formatting `patternName` in
      // a way that reconstructs the secret.
      const raw = "AKIAIOSFODNN7EXAMPLE";
      const out = capture(
        result({
          findings: [
            finding({
              masked: "AK••••••••LE",
              context: ["const k = 'AK••••••••LE'"],
            }),
          ],
        }),
      );
      expect(out).not.toContain(raw);
    });

    it("does not print `fingerprint` anywhere in the output", () => {
      // Fingerprints are a grouping key, not user-facing. Terminal output
      // groups by file, not by fingerprint, and the fingerprint itself is
      // not useful in a terminal.
      const out = capture(
        result({ findings: [finding({ fingerprint: "deadbeef0000" })] }),
      );
      expect(out).not.toContain("deadbeef0000");
    });
  });
});
