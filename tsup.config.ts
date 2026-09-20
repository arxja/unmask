import { defineConfig } from "tsup";
import { copyFile, mkdir } from "node:fs/promises";

export default defineConfig({
  // Object form: keys are output paths (extension appended), values are
  // source paths. This decouples the compiled location from the source
  // tree, which we need because tsup preserves entry paths verbatim but
  // flattens non-entry imports.
  //
  // Before: dist/bin/unmask.js (entry) + dist/src/worker/scan-worker.js
  //         (entry, src/ preserved) + dist/core/scheduler.js
  //         (non-entry, src/ stripped)
  // After:  dist/bin/unmask.js + dist/worker/scan-worker.js +
  //         dist/core/scheduler.js — all consistent, sibling directories
  //         as in the source tree.
  entry: {
    "bin/unmask": "bin/unmask.ts",
    "worker/scan-worker": "src/worker/scan-worker.ts",
  },
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  tsconfig: "./tsconfig.build.json",
  splitting: false,
  external: [
    "fast-glob",
    "simple-git",
    "chalk",
    "commander",
    "cosmiconfig",
    "zod",
    "ora",
    "@babel/parser",
    "@babel/types",
  ],
  onSuccess: async () => {
    await mkdir("dist/data", { recursive: true });
    await copyFile("src/data/patterns.json", "dist/data/patterns.json");
  },
});
