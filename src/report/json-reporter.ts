import { writeFileSync } from "node:fs";
import {
  compareFindings,
  type Reporter,
  type ScanResult,
  type Finding,
} from "../core/finding";

const SCHEMA_VERSION = 1;

export interface JsonReporterOptions {
  /** Pretty-print with 2-space indent. Default: true. */
  pretty?: boolean;
  /** Write to a file instead of a stream. */
  outFile?: string;
  /** Stream used when outFile is absent. Default: process.stdout. */
  stream?: NodeJS.WritableStream;
}

export class JsonReporter implements Reporter {
  private readonly pretty: boolean;
  private readonly outFile?: string;
  private readonly stream: NodeJS.WritableStream;

  constructor(opts: JsonReporterOptions = {}) {
    this.pretty = opts.pretty ?? true;
    this.outFile = opts.outFile;
    this.stream = opts.stream ?? process.stdout;
  }

  report(result: ScanResult): void {
    const payload = this.buildPayload(result);
    const json = this.pretty
      ? JSON.stringify(payload, null, 2)
      : JSON.stringify(payload);

    if (this.outFile) {
      writeFileSync(this.outFile, json + "\n", "utf8");
      return;
    }
    this.stream.write(json + "\n");
  }

  private buildPayload(result: ScanResult) {
    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
    const unique = new Set<string>();

    for (const f of result.findings) {
      bySeverity[f.severity]++;
      unique.add(f.fingerprint);
    }

    const orderedFindings = [...result.findings].sort(compareFindings);

    return {
      schemaVersion: SCHEMA_VERSION,
      tool: { name: "secret-detector", version: result.version },
      scannedAt: new Date().toISOString(),
      rootDir: result.rootDir,
      summary: {
        filesScanned: result.filesScanned,
        durationMs: result.durationMs,
        findings: result.findings.length,
        uniqueSecrets: unique.size,
        bySeverity,
      },
      findings: orderedFindings.map(serializeFinding),
    };
  }
}

/**
 * Explicit field list. Never spread a Finding — if a future version adds
 * a `raw` or `rawMatch` field for debugging, this serializer will not
 * accidentally include it.
 */
function serializeFinding(f: Finding) {
  return {
    patternId: f.patternId,
    patternName: f.patternName,
    provider: f.provider,
    severity: f.severity,
    confidence: f.confidence,
    file: f.file,
    line: f.line,
    column: f.column,
    masked: f.masked,
    context: f.context,
  };
}
