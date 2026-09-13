import { describe, it, expect, beforeEach, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises");
vi.mock("../../src/discovery/file-discovery", () => ({
  discoverFiles: vi.fn(),
}));

import { discoverFiles } from "../../src/discovery/file-discovery";
import { scan } from "../../src/core/scan-runner";
import type { Pattern } from "../../src/detection/regex-engine";

const mockDiscover = vi.mocked(discoverFiles);

const testPattern: Pattern = {
  id: "test-key",
  name: "Test Key",
  provider: "test",
  regex: "KEY_([A-Z]+)_([A-Za-z0-9]+)",
  flags: "",
  confidence: "high",
  severity: "critical",
  entropyCheck: false,
};

function baseInput(
  overrides: Partial<Parameters<typeof scan>[0]> = {},
): Parameters<typeof scan>[0] {
  return {
    rootDir: "/root",
    patterns: [testPattern],
    version: "test",
    ...overrides,
  };
}

beforeEach(() => {
  vol.reset();
  mockDiscover.mockReset();
});

describe("scan", () => {
  describe("happy path", () => {
    it("returns findings from files that match", async () => {
      vol.fromJSON({
        "/root/a.ts": "const x = 'KEY_ABC_xK9mP2qL8nR4tZ6w';",
      });
      mockDiscover.mockReturnValue(["/root/a.ts"]);

      const result = await scan(baseInput());

      expect(result.findings).toHaveLength(1);
      expect(result.filesScanned).toBe(1);
      expect(result.filesSkipped).toEqual([]);
    });

    it("counts files with zero findings as scanned, not skipped", async () => {
      vol.fromJSON({ "/root/clean.ts": "no secrets here" });
      mockDiscover.mockReturnValue(["/root/clean.ts"]);

      const result = await scan(baseInput());

      expect(result.findings).toHaveLength(0);
      expect(result.filesScanned).toBe(1);
      expect(result.filesSkipped).toEqual([]);
    });

    it("returns an empty result when discovery finds nothing", async () => {
      mockDiscover.mockReturnValue([]);

      const result = await scan(baseInput());

      expect(result.findings).toEqual([]);
      expect(result.filesScanned).toBe(0);
      expect(result.filesSkipped).toEqual([]);
    });
  });

  describe("path normalization", () => {
    it("emits finding paths relative to rootDir", async () => {
      vol.fromJSON({
        "/root/src/deep/a.ts": "KEY_ABC_xK9mP2qL8nR4tZ6w",
      });
      mockDiscover.mockReturnValue(["/root/src/deep/a.ts"]);

      const result = await scan(baseInput());

      expect(result.findings[0].file).toBe("src/deep/a.ts");
    });

    it("emits skipped paths relative to rootDir", async () => {
      // File absent from vol → readFile throws ENOENT.
      mockDiscover.mockReturnValue(["/root/src/missing.ts"]);

      const result = await scan(baseInput());

      expect(result.filesSkipped[0].path).toBe("src/missing.ts");
    });
  });

  describe("result metadata", () => {
    it("echoes rootDir and version unchanged", async () => {
      mockDiscover.mockReturnValue([]);

      const result = await scan(baseInput({ version: "9.9.9" }));

      expect(result.rootDir).toBe("/root");
      expect(result.version).toBe("9.9.9");
    });

    it("reports durationMs as a non-negative integer", async () => {
      mockDiscover.mockReturnValue([]);

      const result = await scan(baseInput());

      expect(Number.isInteger(result.durationMs)).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("partial failure", () => {
    it("records an unreadable file and continues scanning the rest", async () => {
      vol.fromJSON({
        "/root/good.ts": "KEY_ABC_xK9mP2qL8nR4tZ6w",
      });
      mockDiscover.mockReturnValue(["/root/good.ts", "/root/bad.ts"]);

      const result = await scan(baseInput());

      expect(result.findings).toHaveLength(1);
      expect(result.filesScanned).toBe(1);
      expect(result.filesSkipped).toHaveLength(1);
      expect(result.filesSkipped[0].path).toBe("bad.ts");
    });

    it("keeps filesScanned and filesSkipped disjoint", async () => {
      vol.fromJSON({ "/root/good.ts": "clean" });
      mockDiscover.mockReturnValue(["/root/good.ts", "/root/missing.ts"]);

      const result = await scan(baseInput());

      // The invariant: every discovered file is accounted for exactly once.
      expect(result.filesScanned + result.filesSkipped.length).toBe(2);
    });

    it("records a scan-time failure without aborting the run", async () => {
      vol.fromJSON({
        "/root/a.ts": "content",
        "/root/b.ts": "KEY_ABC_xK9mP2qL8nR4tZ6w",
      });
      mockDiscover.mockReturnValue(["/root/a.ts", "/root/b.ts"]);

      // Bypass loadPatterns and pass a malformed regex directly. `new RegExp`
      // inside scanContent throws, exercising the scan-time catch branch.
      const badPatterns: Pattern[] = [{ ...testPattern, regex: "KEY_([A-Z]+" }];

      const result = await scan(baseInput({ patterns: badPatterns }));

      expect(result.filesScanned).toBe(0);
      expect(result.filesSkipped).toHaveLength(2);
      expect(result.filesSkipped[0].reason).toMatch(/^scan failed:/);
    });

    it("does not skip a file when the file is clean", async () => {
      vol.fromJSON({ "/root/clean.ts": "nothing to see" });
      mockDiscover.mockReturnValue(["/root/clean.ts"]);

      const result = await scan(baseInput());

      // Regression guard: a clean file must never land in filesSkipped.
      // If the implementation moves filesScanned++ above the scanContent
      // try block, this test starts failing.
      expect(result.filesSkipped).toEqual([]);
    });
  });
});
