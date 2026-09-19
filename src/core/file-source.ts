/**
 * Where `scan()` gets its files and their content.
 *
 * Two implementations live in the codebase:
 *   - diskSource()      — walks the filesystem with fast-glob, reads with fs.
 *   - gitStagedSource() — reads the git index (src/git/staged-files.ts).
 *
 * The interface is intentionally minimal: list paths, read one path.
 * Everything else — filtering, scanning, verification — is scan-runner's
 * job and does not vary by source.
 *
 * The contract:
 *   - `list()` returns paths relative to the source's rootDir,
 *     forward-slashed, so downstream code has one path format to handle.
 *   - `read()` accepts a path returned by `list()` and returns its content.
 *     It may throw; the caller (scan-runner) records skips.
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import {
  discoverFiles,
  type DiscoverOptions,
} from "../discovery/file-discovery";

export interface FileSource {
  list(): string[];
  read(relPath: string): Promise<string>;
}

export interface DiskSourceOptions {
  rootDir: string;
  discovery?: DiscoverOptions;
}

export function diskSource(opts: DiskSourceOptions): FileSource {
  const { rootDir, discovery } = opts;

  return {
    list() {
      const absPaths = discoverFiles(rootDir, discovery ?? {});
      return absPaths.map((p) => toRelative(p, rootDir));
    },

    async read(relPath) {
      const abs = isAbsolute(relPath) ? relPath : join(rootDir, relPath);
      return readFile(abs, "utf-8");
    },
  };
}

/**
 * Convert a filesystem path to forward-slashed form relative to rootDir.
 * A no-op on POSIX; converts backslashes on Windows. Used only by
 * diskSource — the git source returns relative paths natively.
 */
export function toRelative(absPath: string, rootDir: string): string {
  const rel = isAbsolute(absPath) ? relative(rootDir, absPath) : absPath;
  return rel.split(sep).join("/");
}
