import { describe, it, expect, beforeEach, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs");
vi.mock("node:fs/promises");

const { spawnSyncMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawnSync: spawnSyncMock,
}));

import {
  installHook,
  uninstallHook,
  isHookInstalled,
  HookInstallError,
} from "../../src/git/hook-installer";

function setupGit(
  opts: { gitDir?: string; hooksPath?: string | null } = {},
): void {
  const gitDir = opts.gitDir ?? ".git";
  const hooksPath = opts.hooksPath ?? null;

  spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
    if (cmd !== "git") {
      return { status: 127, stdout: "", stderr: "command not found" };
    }

    if (args[0] === "rev-parse" && args[1] === "--git-dir") {
      return { status: 0, stdout: `${gitDir}\n`, stderr: "" };
    }

    if (
      args[0] === "config" &&
      args[1] === "--get" &&
      args[2] === "core.hooksPath"
    ) {
      if (hooksPath === null) {
        return { status: 1, stdout: "", stderr: "" };
      }
      return { status: 0, stdout: `${hooksPath}\n`, stderr: "" };
    }

    return { status: 1, stdout: "", stderr: "unexpected git command" };
  });
}

function setupNotARepo(): void {
  spawnSyncMock.mockImplementation(() => ({
    status: 128,
    stdout: "",
    stderr: "fatal: not a git repository",
  }));
}

async function readInstalledHook(path: string): Promise<{
  content: string;
  mode: number;
}> {
  const { promises: fsp } = await import("node:fs");
  const content = (await fsp.readFile(path, "utf-8")) as string;
  const stat = await fsp.stat(path);
  return { content, mode: stat.mode & 0o777 };
}

beforeEach(() => {
  vol.reset();
  spawnSyncMock.mockReset();
});

describe("installHook", () => {
  describe("fresh install", () => {
    it("writes a hook script with the unmask signature", async () => {
      setupGit();
      const result = await installHook("/repo");

      const { content } = await readInstalledHook(result.path);
      expect(content).toMatch(/^#!\/bin\/sh\n/);
      expect(content).toContain("# unmask pre-commit hook");
      expect(result.chained).toBe(false);
    });

    it("sets the executable bit", async () => {
      setupGit();
      const result = await installHook("/repo");

      const { mode } = await readInstalledHook(result.path);
      expect(mode & 0o111).toBe(0o111);
    });

    it("creates the hooks directory if it does not exist", async () => {
      setupGit();
      await installHook("/repo");

      expect(vol.existsSync("/repo/.git/hooks")).toBe(true);
    });

    it("installs at .git/hooks/pre-commit when git-dir is .git", async () => {
      setupGit({ gitDir: ".git" });
      const result = await installHook("/repo");

      expect(result.path).toBe("/repo/.git/hooks/pre-commit");
    });

    it("resolves an absolute git-dir", async () => {
      setupGit({ gitDir: "/elsewhere/.git" });
      const result = await installHook("/repo");

      expect(result.path).toBe("/elsewhere/.git/hooks/pre-commit");
    });

    describe("hook script content", () => {
      it("runs unmask scan --staged --quiet", async () => {
        setupGit();
        const result = await installHook("/repo");

        const { content } = await readInstalledHook(result.path);
        expect(content).toContain('"$BIN" scan --staged --quiet');
      });

      it("prefers a local install over a PATH lookup", async () => {
        setupGit();
        const result = await installHook("/repo");

        const { content } = await readInstalledHook(result.path);
        const localCheck = content.indexOf("node_modules/.bin/unmask");
        const pathCheck = content.indexOf("command -v unmask");
        expect(localCheck).toBeGreaterThan(-1);
        expect(pathCheck).toBeGreaterThan(-1);
        expect(localCheck).toBeLessThan(pathCheck);
      });

      it("exits 0 with a warning when unmask is not installed", async () => {
        setupGit();
        const result = await installHook("/repo");

        const { content } = await readInstalledHook(result.path);
        expect(content).toMatch(/not installed locally, skipping[\s\S]*exit 0/);
      });

      it("does not chain when there was no prior hook", async () => {
        setupGit();
        const result = await installHook("/repo");

        const { content } = await readInstalledHook(result.path);
        expect(content).not.toContain("pre-commit.unmask-original");
      });
    });
  });

  describe("re-install (hook already ours)", () => {
    it("overwrites without creating a backup", async () => {
      setupGit();
      await installHook("/repo");
      const result = await installHook("/repo");

      expect(result.chained).toBe(false);
      expect(
        vol.existsSync("/repo/.git/hooks/pre-commit.unmask-original"),
      ).toBe(false);
    });

    it("keeps the previous chained original in place", async () => {
      setupGit();
      vol.mkdirSync("/repo/.git/hooks", { recursive: true });
      vol.writeFileSync(
        "/repo/.git/hooks/pre-commit",
        "#!/bin/sh\necho prior\n",
      );

      await installHook("/repo");
      const result = await installHook("/repo");

      const { content } = await readInstalledHook(result.path);
      expect(content).toContain("pre-commit.unmask-original");
      expect(
        vol.existsSync("/repo/.git/hooks/pre-commit.unmask-original"),
      ).toBe(true);
      expect(result.chained).toBe(true);
    });
  });

  describe("chaining a foreign hook", () => {
    it("moves the existing hook to .unmask-original", async () => {
      setupGit();
      vol.mkdirSync("/repo/.git/hooks", { recursive: true });
      vol.writeFileSync("/repo/.git/hooks/pre-commit", "#!/bin/sh\necho hi\n");

      const result = await installHook("/repo");

      expect(result.chained).toBe(true);
      expect(
        vol.existsSync("/repo/.git/hooks/pre-commit.unmask-original"),
      ).toBe(true);
    });

    it("calls the original before the scan", async () => {
      setupGit();
      vol.mkdirSync("/repo/.git/hooks", { recursive: true });
      vol.writeFileSync("/repo/.git/hooks/pre-commit", "#!/bin/sh\necho hi\n");

      const result = await installHook("/repo");

      const { content } = await readInstalledHook(result.path);
      const originalIdx = content.indexOf("pre-commit.unmask-original");
      const scanIdx = content.indexOf('"$BIN" scan');
      expect(originalIdx).toBeLessThan(scanIdx);
    });

    it("propagates the original hook's failure", async () => {
      setupGit();
      vol.mkdirSync("/repo/.git/hooks", { recursive: true });
      vol.writeFileSync("/repo/.git/hooks/pre-commit", "#!/bin/sh\nexit 1\n");

      const result = await installHook("/repo");

      const { content } = await readInstalledHook(result.path);
      expect(content).toMatch(/ORIGINAL[\s\S]*\|\| exit \$\?/);
    });
  });

  describe("custom core.hooksPath", () => {
    it("refuses to install when core.hooksPath is set", async () => {
      setupGit({ hooksPath: ".husky" });

      await expect(installHook("/repo")).rejects.toBeInstanceOf(
        HookInstallError,
      );
    });

    it("names the configured path in the error message", async () => {
      setupGit({ hooksPath: "/custom/hooks" });

      await expect(installHook("/repo")).rejects.toThrow(/\/custom\/hooks/);
    });

    it("suggests how to resolve the conflict", async () => {
      setupGit({ hooksPath: ".husky" });

      await expect(installHook("/repo")).rejects.toThrow(
        /git config --unset core\.hooksPath/,
      );
    });

    it("does not write anything when refusing", async () => {
      setupGit({ hooksPath: ".husky" });

      await expect(installHook("/repo")).rejects.toThrow();

      expect(vol.existsSync("/repo/.git/hooks/pre-commit")).toBe(false);
    });
  });

  describe("when not in a git repository", () => {
    it("throws a HookInstallError", async () => {
      setupNotARepo();

      await expect(installHook("/repo")).rejects.toBeInstanceOf(
        HookInstallError,
      );
    });
  });
});

describe("uninstallHook", () => {
  it("removes the hook file", async () => {
    setupGit();
    await installHook("/repo");

    await uninstallHook("/repo");

    expect(vol.existsSync("/repo/.git/hooks/pre-commit")).toBe(false);
  });

  it("is a no-op when no hook is installed", async () => {
    setupGit();

    await expect(uninstallHook("/repo")).resolves.toBeUndefined();
  });

  it("restores a chained original", async () => {
    setupGit();
    vol.mkdirSync("/repo/.git/hooks", { recursive: true });
    vol.writeFileSync(
      "/repo/.git/hooks/pre-commit",
      "#!/bin/sh\necho original\n",
    );
    await installHook("/repo");

    await uninstallHook("/repo");

    const restored = vol.readFileSync(
      "/repo/.git/hooks/pre-commit",
      "utf-8",
    ) as string;
    expect(restored).toContain("echo original");
    expect(vol.existsSync("/repo/.git/hooks/pre-commit.unmask-original")).toBe(
      false,
    );
  });

  it("refuses to remove a foreign hook", async () => {
    setupGit();
    vol.mkdirSync("/repo/.git/hooks", { recursive: true });
    vol.writeFileSync(
      "/repo/.git/hooks/pre-commit",
      "#!/bin/sh\necho not ours\n",
    );

    await expect(uninstallHook("/repo")).rejects.toBeInstanceOf(
      HookInstallError,
    );

    expect(vol.existsSync("/repo/.git/hooks/pre-commit")).toBe(true);
  });
});

describe("isHookInstalled", () => {
  it("returns false when no hook exists", () => {
    setupGit();
    expect(isHookInstalled("/repo")).toBe(false);
  });

  it("returns true after an install", async () => {
    setupGit();
    await installHook("/repo");

    expect(isHookInstalled("/repo")).toBe(true);
  });

  it("returns false for a foreign hook", () => {
    setupGit();
    vol.mkdirSync("/repo/.git/hooks", { recursive: true });
    vol.writeFileSync(
      "/repo/.git/hooks/pre-commit",
      "#!/bin/sh\necho not ours\n",
    );

    expect(isHookInstalled("/repo")).toBe(false);
  });

  it("returns false for a foreign hook even if it mentions unmask in a comment", () => {
    setupGit();
    vol.mkdirSync("/repo/.git/hooks", { recursive: true });
    vol.writeFileSync(
      "/repo/.git/hooks/pre-commit",
      "#!/bin/sh\n# not installed by unmask, just mentioned\necho hi\n",
    );

    expect(isHookInstalled("/repo")).toBe(false);
  });
});
