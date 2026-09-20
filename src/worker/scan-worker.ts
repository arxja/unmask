/**
 * Worker thread entry point. One instance per scheduler slot.
 *
 * Owns the full per-file lifecycle: read → detect → verify. The main
 * thread sends paths; the worker sends back findings or an error
 * reason. Nothing else crosses the boundary.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parentPort } from "node:worker_threads";

import { readStagedFile } from "../git/staged-files";
import { scanContent, type Pattern } from "../detection/regex-engine";
import { verifyFindings } from "../verification/verify";
import type { ReaderConfig } from "../core/file-source";
import type { FromWorker, ToWorker } from "./protocol";

if (!parentPort) {
  throw new Error("scan-worker must be run as a worker thread");
}

const port = parentPort;

let patterns: Pattern[] = [];
let reader: ReaderConfig | null = null;

port.on("message", (msg: ToWorker) => {
  switch (msg.type) {
    case "init":
      patterns = msg.patterns;
      reader = msg.reader;
      post({ type: "ready" });
      return;
    case "task":
      void handleTask(msg.path);
      return;
    case "shutdown":
      process.exit(0);
  }
});

async function handleTask(path: string): Promise<void> {
  if (!reader) {
    post({
      type: "error",
      path,
      message: "worker received a task before init",
    });
    return;
  }

  let content: string;
  try {
    content = await readSource(reader, path);
  } catch (error) {
    post({ type: "error", path, message: describeError(error) });
    return;
  }

  try {
    const candidates = scanContent(content, path, patterns);
    const findings =
      candidates.length > 0 ? verifyFindings(candidates, content, path) : [];
    post({ type: "result", path, findings });
  } catch (error) {
    post({
      type: "error",
      path,
      message: `scan failed: ${describeError(error)}`,
    });
  }
}

async function readSource(config: ReaderConfig, path: string): Promise<string> {
  switch (config.kind) {
    case "disk":
      return readFile(join(config.rootDir, path), "utf-8");
    case "git-staged":
      return readStagedFile(config.rootDir, path);
  }
}

function post(msg: FromWorker): void {
  port.postMessage(msg);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
