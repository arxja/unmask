import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Fake Worker. Speaks the ToWorker/FromWorker protocol and produces
// deterministic results. Nothing about this is a real thread — the
// scheduler's job is message routing, and that is what we test.
//
// Behavior:
//   - Emits `ready` on the next tick after construction.
//   - On `task`: emits `result` (or `error`, if the path starts with
//     "err/") on the next tick.
//   - On `shutdown`: emits `exit` on the next tick.
//
// The `workers` array is exposed so tests can assert on spawn count.
// ---------------------------------------------------------------------------

const { workers } = vi.hoisted(() => {
  return { workers: [] as FakeWorker[] };
});

interface FakeWorker {
  listeners: Map<string, ((...args: unknown[]) => void)[]>;
  emit(event: string, ...args: unknown[]): void;
  postMessage(msg: { type: string; path?: string }): void;
}

vi.mock("node:worker_threads", () => {
  class FakeWorkerClass implements FakeWorker {
    listeners = new Map<string, ((...args: unknown[]) => void)[]>();

    constructor() {
      workers.push(this);
      setImmediate(() => this.emit("message", { type: "ready" }));
    }

    on(event: string, cb: (...args: unknown[]) => void): this {
      const arr = this.listeners.get(event) ?? [];
      arr.push(cb);
      this.listeners.set(event, arr);
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      for (const cb of this.listeners.get(event) ?? []) cb(...args);
    }

    postMessage(msg: { type: string; path?: string }): void {
      if (msg.type === "shutdown") {
        setImmediate(() => this.emit("exit", 0));
        return;
      }
      if (msg.type === "task" && msg.path !== undefined) {
        const isError = msg.path.startsWith("err/");
        setImmediate(() => {
          if (isError) {
            this.emit("message", {
              type: "error",
              path: msg.path,
              message: `simulated failure for ${msg.path}`,
            });
          } else {
            this.emit("message", {
              type: "result",
              path: msg.path,
              findings: [],
            });
          }
        });
      }
    }
  }

  return { Worker: FakeWorkerClass };
});

import { runPool } from "../../src/core/scheduler";

beforeEach(() => {
  workers.length = 0;
});

// ---------------------------------------------------------------------------

describe("runPool", () => {
  it("spawns the requested number of workers", async () => {
    await runPool(["a.ts"], {
      concurrency: 3,
      patterns: [],
      reader: { kind: "disk", rootDir: "/repo" },
    });

    expect(workers).toHaveLength(3);
  });

  it("produces exactly one result per path", async () => {
    const results = await runPool(["a.ts", "b.ts", "c.ts"], {
      concurrency: 2,
      patterns: [],
      reader: { kind: "disk", rootDir: "/repo" },
    });

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.path).sort()).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("distributes many paths across few workers without dropping any", async () => {
    const paths = Array.from({ length: 20 }, (_, i) => `f${i}.ts`);

    const results = await runPool(paths, {
      concurrency: 3,
      patterns: [],
      reader: { kind: "disk", rootDir: "/repo" },
    });

    expect(results).toHaveLength(20);
    expect(new Set(results.map((r) => r.path)).size).toBe(20);
  });

  it("reports a task error as a result with an error field", async () => {
    const results = await runPool(["ok.ts", "err/fail.ts"], {
      concurrency: 1,
      patterns: [],
      reader: { kind: "disk", rootDir: "/repo" },
    });

    expect(results).toHaveLength(2);

    const ok = results.find((r) => r.path === "ok.ts");
    expect(ok?.findings).toEqual([]);
    expect(ok?.error).toBeUndefined();

    const failed = results.find((r) => r.path === "err/fail.ts");
    expect(failed?.findings).toBeUndefined();
    expect(failed?.error).toMatch(/simulated failure/);
  });

  it("sends every path exactly once", async () => {
    // A path assigned to two workers would surface as a duplicate
    // entry. The scheduler tracks nextIndex per pool, not per worker.
    const results = await runPool(["x.ts", "y.ts", "z.ts"], {
      concurrency: 4,
      patterns: [],
      reader: { kind: "disk", rootDir: "/repo" },
    });

    const paths = results.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("throws when concurrency is less than 1", async () => {
    await expect(
      runPool([], {
        concurrency: 0,
        patterns: [],
        reader: { kind: "disk", rootDir: "/repo" },
      }),
    ).rejects.toThrow(/at least 1/);
  });
});
