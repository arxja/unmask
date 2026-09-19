import { describe, it, expect, beforeEach, vi } from "vitest";

const { listMock, readMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  readMock: vi.fn(),
}));

vi.mock("../../src/git/staged-files", () => ({
  gitStagedSource: () => ({
    list: listMock,
    read: readMock,
  }),
}));

import { scan } from "../../src/core/scan-runner";
import { gitStagedSource } from "../../src/git/staged-files";
import type { Pattern } from "../../src/detection/regex-engine";

const awsPattern: Pattern = {
  id: "aws-access-key-id",
  name: "AWS Access Key ID",
  provider: "aws",
  regex: "(AKIA[0-9A-Z]{16})",
  flags: "",
  confidence: "high",
  severity: "critical",
  entropyCheck: false,
};

beforeEach(() => {
  listMock.mockReset();
  readMock.mockReset();
});

describe("staged scan", () => {
  it("reads content from the source, not from disk", async () => {
    listMock.mockReturnValue(["src/config.ts"]);
    readMock.mockResolvedValue('const k = "AKIA1234567890ABCDEF";');

    const result = await scan({
      rootDir: "/repo",
      patterns: [awsPattern],
      version: "test",
      source: gitStagedSource({ rootDir: "/repo" }),
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].file).toBe("src/config.ts");
    expect(readMock).toHaveBeenCalledWith("src/config.ts");
  });

  it("records a skip when read throws", async () => {
    listMock.mockReturnValue(["src/missing.ts"]);
    readMock.mockRejectedValue(new Error("path does not exist in index"));

    const result = await scan({
      rootDir: "/repo",
      patterns: [awsPattern],
      version: "test",
      source: gitStagedSource({ rootDir: "/repo" }),
    });

    expect(result.findings).toEqual([]);
    expect(result.filesScanned).toBe(0);
    expect(result.filesSkipped).toHaveLength(1);
    expect(result.filesSkipped[0].path).toBe("src/missing.ts");
  });

  it("does not touch the filesystem when a source is provided", async () => {
    // diskSource is not constructed, and discoverFiles is not called.
    // This test does not mock file-discovery, so if scan-runner tried
    // to use disk, it would hit real fs and likely fail.
    listMock.mockReturnValue([]);
    readMock.mockResolvedValue("");

    const result = await scan({
      rootDir: "/repo",
      patterns: [awsPattern],
      version: "test",
      source: gitStagedSource({ rootDir: "/repo" }),
    });

    expect(result.filesScanned).toBe(0);
  });
});
