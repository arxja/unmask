/**
 * `unmask install` and `unmask uninstall` command handlers.
 *
 * Thin wrappers around src/git/hook-installer.ts. The installer throws
 * HookInstallError for user-facing conditions ("not a git repo", custom
 * hooksPath); this module converts those to messages and exit codes.
 * Anything else propagates and hits the top-level handler in bin.
 */

import { resolve } from "node:path";
import {
  HookInstallError,
  installHook,
  isHookInstalled,
  uninstallHook,
} from "../git/hook-installer";

export interface InstallCliOptions {
  path?: string;
}

export async function runInstall(opts: InstallCliOptions): Promise<number> {
  const rootDir = resolve(opts.path ?? ".");

  try {
    if (isHookInstalled(rootDir)) {
      process.stdout.write("unmask: hook already installed, updating\n");
    }

    const result = await installHook(rootDir);

    process.stdout.write(
      `unmask: installed pre-commit hook at ${result.path}\n`,
    );
    if (result.chained) {
      process.stdout.write(
        "unmask: a pre-existing hook was chained and will run first\n",
      );
    }
    return 0;
  } catch (error) {
    if (error instanceof HookInstallError) {
      process.stderr.write(`unmask: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

export async function runUninstall(opts: InstallCliOptions): Promise<number> {
  const rootDir = resolve(opts.path ?? ".");

  try {
    if (!isHookInstalled(rootDir)) {
      process.stdout.write("unmask: no hook installed\n");
      return 0;
    }

    await uninstallHook(rootDir);
    process.stdout.write("unmask: pre-commit hook removed\n");
    return 0;
  } catch (error) {
    if (error instanceof HookInstallError) {
      process.stderr.write(`unmask: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}
