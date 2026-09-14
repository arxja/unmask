import fg from "fast-glob";

export interface DiscoverOptions {
  /**
   * Additional glob patterns to ignore.
   * Merged with sensible defaults (node_modules, .git, dist, etc.)
   */
  ignore?: string[];
  /**
   * Glob pattern for what to include. Defaults to all files.
   */
  include?: string | string[];
  /**
   * Include dotfiles (like .env, .eslintrc). Default: false.
   */
  dot?: boolean;
  /**
   * Return absolute paths. Default: true.
   */
  absolute?: boolean;
}

/**
 * Pure wrapper around fast-glob.
 * Handles merging of default ignore rules and user overrides.
 */
export function discoverFiles(
  targetDir: string,
  options: DiscoverOptions = {},
): string[] {
  // 1. Default ignore rules (sensible for most codebases)
  const defaultIgnores = [
    "node_modules/**",
    ".git/**",
    "dist/**",
    "build/**",
    "coverage/**",
    "*.log",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
  ];

  // 2. Merge: user ignore overrides default (user wins)
  // If user passes ignore, we replace defaults entirely,
  // but we append their ignores to the defaults to keep it safe.
  // Let's combine them: default + user extra.
  const ignore = [...defaultIgnores, ...(options.ignore || [])];

  // 3. Include pattern: default is everything
  const include = options.include || "**/*";

  // 4. Run fast-glob
  return fg.sync(include, {
    cwd: targetDir,
    ignore,
    absolute: options.absolute !== undefined ? options.absolute : true,
    dot: options.dot || false,
    onlyFiles: true,
    suppressErrors: true, // don't crash on permission errors
  });
}

export interface ScanOptions {
  /**
   * Passed directly to the discovery wrapper.
   */
  discovery?: DiscoverOptions;
}
