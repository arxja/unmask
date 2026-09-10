import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["bin/unmask.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  // NO banner option — pnpm handles the shim
});
