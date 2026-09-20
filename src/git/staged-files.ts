import { spawnSync } from "node:child_process";
import simpleGit from "simple-git";
import { matchesGlob } from "node:path";
import type { FileSource } from "../core/file-source";

export interface GitStagedSourceOptions {
  rootDir: string;
  ignore?: readonly string[];
  include?: readonly string[];
}

/**
 * Read one file from the git index. Standalone — usable without
 * constructing a FileSource. The worker calls this directly.
 */
export async function readStagedFile(
  rootDir: string,
  path: string,
): Promise<string> {
  return simpleGit({ baseDir: rootDir }).show([`:${path}`]);
}

export function gitStagedSource(opts: GitStagedSourceOptions): FileSource {
  const ignore = opts.ignore ?? [];
  const include = opts.include ?? ["**/*"];

  let cachedList: string[] | null = null;

  return {
    list() {
      if (cachedList) return cachedList;
      cachedList = listStagedFilesSync(opts.rootDir, ignore, include);
      return cachedList;
    },

    read(relPath) {
      return readStagedFile(opts.rootDir, relPath);
    },

    readerConfig: { kind: "git-staged", rootDir: opts.rootDir },
  };
}

function listStagedFilesSync(
  rootDir: string,
  ignore: readonly string[],
  include: readonly string[],
): string[] {
  const result = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
    { cwd: rootDir, encoding: "utf-8" },
  );

  if (result.status !== 0) {
    throw new Error(
      `git diff --cached failed: ${result.stderr?.trim() || "unknown error"}`,
    );
  }

  const paths = result.stdout.split("\0").filter((p) => p.length > 0);
  return paths.filter((p) => matchesAny(p, include, ignore));
}

function matchesAny(
  path: string,
  include: readonly string[],
  ignore: readonly string[],
): boolean {
  if (!include.some((pattern) => matchesGlob(path, pattern))) return false;
  if (ignore.some((pattern) => matchesGlob(path, pattern))) return false;
  return true;
}
