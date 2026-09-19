import { describe, it, expect, beforeEach, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises");

const { discoverFilesMock } = vi.hoisted(() => ({
  discoverFilesMock: vi.fn(),
}));

vi.mock("../../src/discovery/file-discovery", () => ({
  discoverFiles: discoverFilesMock,
}));

import { diskSource, toRelative } from "../../src/core/file-source";

beforeEach(() => {
  vol.reset();
  discoverFilesMock.mockReset();
});

describe("toRelative", () => {
  it("converts an absolute path under rootDir", () => {
    expect(toRelative("/repo/src/a.ts", "/repo")).toBe("src/a.ts");
  });

  it("returns a relative path unchanged (forward slashes)", () => {
    expect(toRelative("src/a.ts", "/repo")).toBe("src/a.ts");
  });

  it("normalizes backslashes on Windows", () => {
    // The split/join uses the platform separator; on POSIX this is a
    // no-op, on Windows it converts. Test asserts the invariant
    // (forward slashes out) rather than the mechanism.
    const result = toRelative("src\\a.ts", "/repo");
    expect(result).not.toContain("\\");
  });
});

describe("diskSource", () => {
  describe("list", () => {
    it("returns forward-slashed relative paths", () => {
      discoverFilesMock.mockReturnValue(["/repo/src/a.ts", "/repo/b.ts"]);
      const source = diskSource({ rootDir: "/repo" });

      expect(source.list()).toEqual(["src/a.ts", "b.ts"]);
    });

    it("passes discovery options through to discoverFiles", () => {
      discoverFilesMock.mockReturnValue([]);
      diskSource({
        rootDir: "/repo",
        discovery: { ignore: ["dist/**"] },
      }).list();

      expect(discoverFilesMock).toHaveBeenCalledWith("/repo", {
        ignore: ["dist/**"],
      });
    });

    it("passes an empty object when no discovery options are given", () => {
      discoverFilesMock.mockReturnValue([]);
      diskSource({ rootDir: "/repo" }).list();

      expect(discoverFilesMock).toHaveBeenCalledWith("/repo", {});
    });
  });

  describe("read", () => {
    it("reads a file relative to rootDir", async () => {
      vol.fromJSON({ "/repo/src/a.ts": "content" });
      const source = diskSource({ rootDir: "/repo" });

      expect(await source.read("src/a.ts")).toBe("content");
    });

    it("throws when the file does not exist", async () => {
      const source = diskSource({ rootDir: "/repo" });

      await expect(source.read("missing.ts")).rejects.toThrow();
    });
  });
});
