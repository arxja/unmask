import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock runPool. This file tests scan-runner's handling of TaskResult[],
// not the pool's internals (those are covered by scheduler.test.ts).
// ---------------------------------------------------------------------------

const { runPoolMock } = vi.hoisted(() => ({
  runPoolMock: vi.fn(),
}));

vi.mock("../../src/core/scheduler", () => ({
  runPool: runPoolMock,
}));

import { scan } from "../../src/core/scan-runner";
import type { FileSource } from "../../src/core/file-source";
import type { Finding } from "../../src/core/finding";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
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
    fingerprint: "fp0000000001",
    ...overrides,
  };
}

/** A source whose list() returns an empty array. The pool is mocked, so
 *  the paths do not matter — only the TaskResult[] the pool returns. */
const emptySource: FileSource = {
  list: () => [],
  read: async () => "",
  readerConfig: { kind: "disk", rootDir: "/repo" },
};

beforeEach(() => {
  runPoolMock.mockReset();
});

// ---------------------------------------------------------------------------

describe("scan with concurrency > 1", () => {
  it("routes through the pool and assembles findings", async () => {
    runPoolMock.mockResolvedValue([
      { path: "a.ts", findings: [makeFinding({ file: "a.ts" })] },
      {
        path: "b.ts",
        findings: [
          makeFinding({ file: "b.ts", line: 1 }),
          makeFinding({ file: "b.ts", line: 2 }),
        ],
      },
      { path: "c.ts", findings: [] },
    ]);

    const result = await scan({
      rootDir: "/repo",
      patterns: [],
      version: "test",
      source: emptySource,
      concurrency: 4,
    });

    expect(result.findings).toHaveLength(3);
    expect(result.filesScanned).toBe(3);
    expect(result.filesSkipped).toEqual([]);
    expect(runPoolMock).toHaveBeenCalledOnce();
  });

  it("counts error results as skipped, not as findings", async () => {
    runPoolMock.mockResolvedValue([
      { path: "a.ts", error: "read failed: EACCES" },
      { path: "b.ts", findings: [] },
    ]);

    const result = await scan({
      rootDir: "/repo",
      patterns: [],
      version: "test",
      source: emptySource,
      concurrency: 2,
    });

    expect(result.findings).toEqual([]);
    expect(result.filesScanned).toBe(1);
    expect(result.filesSkipped).toHaveLength(1);
    expect(result.filesSkipped[0].path).toBe("a.ts");
    expect(result.filesSkipped[0].reason).toMatch(/EACCES/);
  });

  it("passes the source's reader config to the pool", async () => {
    runPoolMock.mockResolvedValue([]);

    await scan({
      rootDir: "/repo",
      patterns: [],
      version: "test",
      source: {
        list: () => [],
        read: async () => "",
        readerConfig: { kind: "git-staged", rootDir: "/repo" },
      },
      concurrency: 2,
    });

    expect(runPoolMock).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        reader: { kind: "git-staged", rootDir: "/repo" },
      }),
    );
  });

  it("propagates the concurrency value to the pool", async () => {
    runPoolMock.mockResolvedValue([]);

    await scan({
      rootDir: "/repo",
      patterns: [],
      version: "test",
      source: emptySource,
      concurrency: 7,
    });

    expect(runPoolMock).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ concurrency: 7 }),
    );
  });

  it("does not touch the pool when concurrency is 1 or unset", async () => {
    // The single-threaded path is exercised by existing scan-runner
    // tests. Here we only assert the pool is not invoked.
    await scan({
      rootDir: "/repo",
      patterns: [],
      version: "test",
      source: emptySource,
    });

    expect(runPoolMock).not.toHaveBeenCalled();
  });
});
