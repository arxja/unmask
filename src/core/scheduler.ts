/**
 * Persistent worker pool.
 *
 * Spawns `concurrency` workers at start, sends each `init` once, then
 * feeds paths one at a time. A worker that finishes its task
 * immediately receives the next path from the shared queue. When the
 * queue empties, every worker gets `shutdown` and the pool resolves.
 *
 * The scheduler never reads files, never runs detection, never touches
 * the filesystem. It only routes messages.
 */

import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import type { Finding } from "./finding";
import type { ReaderConfig } from "./file-source";
import type { Pattern } from "../detection/regex-engine";
import type { FromWorker, ToWorker } from "../worker/protocol";

export interface TaskResult {
  path: string;
  /** Present on success. May be empty. */
  findings?: Finding[];
  /** Present on skip. Exactly one of findings/error is set. */
  error?: string;
}

export interface SchedulerOptions {
  concurrency: number;
  patterns: Pattern[];
  reader: ReaderConfig;
}

export async function runPool(
  paths: readonly string[],
  opts: SchedulerOptions,
): Promise<TaskResult[]> {
  if (opts.concurrency < 1) {
    throw new Error("concurrency must be at least 1");
  }
  const scheduler = new Scheduler(opts);
  return scheduler.run(paths);
}

class Scheduler {
  private paths: readonly string[] = [];
  private nextIndex = 0;
  private readonly workers: Worker[] = [];
  private readonly results: TaskResult[] = [];
  private readonly inFlight = new Map<Worker, string>();
  private exited = 0;
  private resolveDone!: () => void;
  private readonly done: Promise<void>;

  private readonly startupErrors: Error[] = [];

  constructor(private readonly opts: SchedulerOptions) {
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
  }

  async run(paths: readonly string[]): Promise<TaskResult[]> {
    this.paths = paths;

    for (let i = 0; i < this.opts.concurrency; i++) {
      this.spawn();
    }

    await this.done;

    if (this.startupErrors.length > 0) {
      const first = this.startupErrors[0];
      const more =
        this.startupErrors.length > 1
          ? ` (and ${this.startupErrors.length - 1} more)`
          : "";
      throw new Error(`worker pool failed to start: ${first.message}${more}`);
    }

    return this.results;
  }

  private spawn(): void {
    const worker = new Worker(resolveWorkerPath(), {
      execArgv: process.execArgv,
    });

    worker.on("message", (msg: FromWorker) => this.onMessage(worker, msg));
    worker.on("error", (err: Error) => this.onError(worker, err));
    worker.on("exit", () => this.onExit());

    worker.postMessage({
      type: "init",
      patterns: this.opts.patterns,
      reader: this.opts.reader,
    } satisfies ToWorker);

    this.workers.push(worker);
  }

  private dispatch(worker: Worker): void {
    if (this.nextIndex >= this.paths.length) {
      worker.postMessage({ type: "shutdown" } satisfies ToWorker);
      return;
    }
    const path = this.paths[this.nextIndex++];
    this.inFlight.set(worker, path);
    worker.postMessage({ type: "task", path } satisfies ToWorker);
  }

  private onMessage(worker: Worker, msg: FromWorker): void {
    switch (msg.type) {
      case "ready":
        // Worker is set up. Give it its first path.
        this.dispatch(worker);
        return;
      case "result":
        this.inFlight.delete(worker);
        this.results.push({ path: msg.path, findings: msg.findings });
        this.dispatch(worker);
        return;
      case "error":
        this.inFlight.delete(worker);
        this.results.push({ path: msg.path, error: msg.message });
        this.dispatch(worker);
        return;
    }
  }

  private onError(worker: Worker, err: Error): void {
    const path = this.inFlight.get(worker);

    // A worker that crashes before its first `task` is a startup
    // failure — wrong file path, syntax error, missing module. That is
    // a bug in the build or the pool, not a property of any file being
    // scanned. Surface it loudly instead of dropping it.
    if (path === undefined) {
      this.startupErrors.push(err);
      return;
    }

    this.results.push({ path, error: `worker crashed: ${err.message}` });
    this.inFlight.delete(worker);
  }

  private onExit(): void {
    this.exited++;
    if (this.exited === this.workers.length) {
      this.resolveDone();
    }
  }
}

/**
 * The worker file is a sibling of the scheduler under `dist/` after a
 * build, and a sibling under `src/worker/` in dev. `extname` picks the
 * right extension so the same code path works in both.
 */
function resolveWorkerPath(): string {
  const here = fileURLToPath(import.meta.url);
  const ext = extname(here); // ".ts" in dev, ".js" after build
  return join(dirname(here), "..", "worker", `scan-worker${ext}`);
}
