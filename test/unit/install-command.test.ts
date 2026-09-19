import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  installHookMock,
  uninstallHookMock,
  isHookInstalledMock,
  HookInstallErrorMock,
} = vi.hoisted(() => {
  class HookInstallError extends Error {}
  return {
    installHookMock: vi.fn(),
    uninstallHookMock: vi.fn(),
    isHookInstalledMock: vi.fn(),
    HookInstallErrorMock: HookInstallError,
  };
});

vi.mock("../../src/git/hook-installer", () => ({
  installHook: installHookMock,
  uninstallHook: uninstallHookMock,
  isHookInstalled: isHookInstalledMock,
  HookInstallError: HookInstallErrorMock,
}));

import { runInstall, runUninstall } from "../../src/commands/install";

let stdout: string[] = [];
let stderr: string[] = [];

beforeEach(() => {
  installHookMock.mockReset();
  uninstallHookMock.mockReset();
  isHookInstalledMock.mockReset();
  stdout = [];
  stderr = [];

  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  });
});

describe("runInstall", () => {
  it("returns 0 on success", async () => {
    isHookInstalledMock.mockReturnValue(false);
    installHookMock.mockResolvedValue({
      path: "/repo/.git/hooks/pre-commit",
      chained: false,
    });

    const code = await runInstall({ path: "/repo" });

    expect(code).toBe(0);
    expect(stdout.join("")).toContain("installed pre-commit hook");
  });

  it("reports when a pre-existing hook was chained", async () => {
    isHookInstalledMock.mockReturnValue(false);
    installHookMock.mockResolvedValue({
      path: "/repo/.git/hooks/pre-commit",
      chained: true,
    });

    await runInstall({ path: "/repo" });

    expect(stdout.join("")).toContain("chained");
  });

  it("prints 'updating' when the hook is already installed", async () => {
    isHookInstalledMock.mockReturnValue(true);
    installHookMock.mockResolvedValue({
      path: "/repo/.git/hooks/pre-commit",
      chained: false,
    });

    await runInstall({ path: "/repo" });

    expect(stdout.join("")).toContain("already installed");
  });

  it("returns 2 and prints the message when HookInstallError is thrown", async () => {
    isHookInstalledMock.mockReturnValue(false);
    installHookMock.mockRejectedValue(
      new HookInstallErrorMock("not a git repository"),
    );

    const code = await runInstall({ path: "/repo" });

    expect(code).toBe(2);
    expect(stderr.join("")).toContain("not a git repository");
  });

  it("propagates non-HookInstallError errors", async () => {
    isHookInstalledMock.mockReturnValue(false);
    installHookMock.mockRejectedValue(new Error("unexpected"));

    await expect(runInstall({ path: "/repo" })).rejects.toThrow("unexpected");
  });
});

describe("runUninstall", () => {
  it("returns 0 when a hook is removed", async () => {
    isHookInstalledMock.mockReturnValue(true);
    uninstallHookMock.mockResolvedValue(undefined);

    const code = await runUninstall({ path: "/repo" });

    expect(code).toBe(0);
    expect(stdout.join("")).toContain("removed");
  });

  it("returns 0 when no hook is installed (idempotent)", async () => {
    isHookInstalledMock.mockReturnValue(false);

    const code = await runUninstall({ path: "/repo" });

    expect(code).toBe(0);
    expect(stdout.join("")).toContain("no hook installed");
    expect(uninstallHookMock).not.toHaveBeenCalled();
  });

  it("returns 2 when HookInstallError is thrown", async () => {
    isHookInstalledMock.mockReturnValue(true);
    uninstallHookMock.mockRejectedValue(
      new HookInstallErrorMock("hook was not installed by unmask"),
    );

    const code = await runUninstall({ path: "/repo" });

    expect(code).toBe(2);
    expect(stderr.join("")).toContain("not installed by unmask");
  });
});
