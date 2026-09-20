import type { Finding } from "../core/finding";
import type { ReaderConfig } from "../core/file-source";
import type { Pattern } from "../detection/regex-engine";

/**
 * Message contract between the scheduler (main thread) and scan workers.
 * Both sides import these types; neither assumes a shape the other
 * doesn't produce.
 *
 * Lifecycle:
 *   main → worker:  init     (once, immediately after spawn)
 *   worker → main:  ready    (once, after init)
 *   main → worker:  task     (one at a time)
 *   worker → main:  result | error
 *   ...
 *   main → worker:  shutdown (when the queue is empty)
 */

export type ToWorker =
  | { type: "init"; patterns: Pattern[]; reader: ReaderConfig }
  | { type: "task"; path: string }
  | { type: "shutdown" };

export type FromWorker =
  | { type: "ready" }
  | { type: "result"; path: string; findings: Finding[] }
  | { type: "error"; path: string; message: string };
