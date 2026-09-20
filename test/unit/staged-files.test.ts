import { describe, it, expect, beforeEach, vi } from "vitest";

const { spawnSyncMock, showMock, simpleGitCtorMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(),
  showMock: vi.fn(),
  simpleGitCtorMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawnSync: spawnSyncMock,
}));

vi.mock("simple-git", () => ({
  default: (opts: unknown) => {
    simpleGitCtorMock(opts);
    return { show: showMock };
  },
}));

import { gitStagedSource } from "../../src/git/staged-files";

function stagePaths(...paths: string[]): void {
  spawnSyncMock.mockReturnValueOnce({
    status: 0,
    stdout: paths.map((p) => `${p}\0`).join(""),
    stderr: "",
  });
}

function gitFails(stderr = "fatal: not a git repository"): void {
  spawnSyncMock.mockReturnValueOnce({
    status: 128,
    stdout: "",
    stderr,
  });
}

beforeEach(() => {
  spawnSyncMock.mockReset();
  showMock.mockReset();
  simpleGitCtorMock.mockReset();
});

describe("gitStagedSource", () => {
  describe("constructor", () => {
    it("does not construct simple-git until read is called", () => {
      gitStagedSource({ rootDir: "/repo" });
      // Construction is lazy: list() uses spawnSync, and simple-git is
      // only needed for read().
      expect(simpleGitCtorMock).not.toHaveBeenCalled();
    });
  });

  describe("list", () => {
    it("runs git diff --cached with the correct arguments", () => {
      stagePaths("a.ts");
      gitStagedSource({ rootDir: "/repo" }).list();

      expect(spawnSyncMock).toHaveBeenCalledTimes(1);
      const [cmd, args, opts] = spawnSyncMock.mock.calls[0];
      expect(cmd).toBe("git");
      expect(args).toEqual([
        "diff",
        "--cached",
        "--name-only",
        "--diff-filter=ACMR",
        "-z",
      ]);
      expect((opts as { cwd: string }).cwd).toBe("/repo");
    });

    it("splits NUL-separated output into paths", () => {
      stagePaths("src/a.ts", "src/b.ts", "README.md");
      const paths = gitStagedSource({ rootDir: "/repo" }).list();

      expect(paths).toEqual(["src/a.ts", "src/b.ts", "README.md"]);
    });

    it("handles paths containing spaces", () => {
      stagePaths("my dir/a b.ts");
      const paths = gitStagedSource({ rootDir: "/repo" }).list();

      expect(paths).toEqual(["my dir/a b.ts"]);
    });

    it("returns an empty array when nothing is staged", () => {
      spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: "", stderr: "" });
      const paths = gitStagedSource({ rootDir: "/repo" }).list();

      expect(paths).toEqual([]);
    });

    it("throws when git diff fails", () => {
      gitFails("fatal: not a git repository");
      const source = gitStagedSource({ rootDir: "/repo" });

      expect(() => source.list()).toThrow(/not a git repository/);
    });

    it("caches the list across calls", () => {
      stagePaths("a.ts", "b.ts");
      const source = gitStagedSource({ rootDir: "/repo" });

      source.list();
      source.list();
      source.list();

      expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    });

    describe("include patterns", () => {
      it("filters to files matching an include pattern", () => {
        stagePaths("src/a.ts", "src/b.js", "README.md");
        const source = gitStagedSource({
          rootDir: "/repo",
          include: ["src/**/*.ts"],
        });

        expect(source.list()).toEqual(["src/a.ts"]);
      });

      it("returns nothing when no files match the include pattern", () => {
        stagePaths("src/a.ts");
        const source = gitStagedSource({
          rootDir: "/repo",
          include: ["test/**/*.ts"],
        });

        expect(source.list()).toEqual([]);
      });

      it("defaults to including all files", () => {
        stagePaths("src/a.ts", "docs/readme.md", "package.json");
        const paths = gitStagedSource({ rootDir: "/repo" }).list();

        expect(paths).toHaveLength(3);
      });
    });

    describe("ignore patterns", () => {
      it("excludes files matching an ignore pattern", () => {
        stagePaths("src/a.ts", "src/a.test.ts", "package.json");
        const source = gitStagedSource({
          rootDir: "/repo",
          ignore: ["**/*.test.ts"],
        });

        expect(source.list()).toEqual(["src/a.ts", "package.json"]);
      });

      it("applies ignore after include", () => {
        stagePaths("src/a.ts", "src/b.ts", "src/c.test.ts");
        const source = gitStagedSource({
          rootDir: "/repo",
          include: ["src/**/*"],
          ignore: ["**/*.test.ts"],
        });

        expect(source.list()).toEqual(["src/a.ts", "src/b.ts"]);
      });
    });
  });

  describe("read", () => {
    it("calls git show with the colon-prefixed path", async () => {
      showMock.mockResolvedValue("file content");
      const source = gitStagedSource({ rootDir: "/repo" });

      const content = await source.read("src/a.ts");

      expect(showMock).toHaveBeenCalledWith([":src/a.ts"]);
      expect(content).toBe("file content");
    });

    it("propagates errors from git show", async () => {
      showMock.mockRejectedValue(new Error("path does not exist in index"));
      const source = gitStagedSource({ rootDir: "/repo" });

      await expect(source.read("missing.ts")).rejects.toThrow(
        /does not exist in index/,
      );
    });
  });
});
