import type { Reporter, ScanResult, Finding, Severity } from "../core/finding";
import { compareByLocation } from "../core/finding";

// ---------------------------------------------------------------------------
// ANSI helpers — dep-free, respects NO_COLOR and TTY detection.
// ---------------------------------------------------------------------------

interface Ansi {
  red: (s: string) => string;
  yellow: (s: string) => string;
  blue: (s: string) => string;
  gray: (s: string) => string;
  bold: (s: string) => string;
  dim: (s: string) => string;
}

const NO_ANSI: Ansi = {
  red: (s) => s,
  yellow: (s) => s,
  blue: (s) => s,
  gray: (s) => s,
  bold: (s) => s,
  dim: (s) => s,
};

function makeAnsi(enabled: boolean): Ansi {
  if (!enabled) return NO_ANSI;
  const w = (code: number) => (s: string) => `\x1b[${code}m${s}\x1b[0m`;
  return {
    red: w(31),
    yellow: w(33),
    blue: w(34),
    gray: w(90),
    bold: w(1),
    dim: w(2),
  };
}

function decideColor(
  force: boolean | undefined,
  stream: NodeJS.WritableStream,
): boolean {
  if (force !== undefined) return force;
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === "1") return true;
  return "isTTY" in stream && stream.isTTY === true;
}

function severityColor(sev: Severity, c: Ansi) {
  switch (sev) {
    case "critical":
    case "high":
      return c.red;
    case "medium":
      return c.yellow;
    case "low":
      return c.blue;
  }
}

// ---------------------------------------------------------------------------
// Reporter
// ---------------------------------------------------------------------------

export interface TerminalReporterOptions {
  stream?: NodeJS.WritableStream;
  /** Force color on/off. Undefined = auto-detect. */
  color?: boolean;
  /** 0 = unlimited. Default 50. */
  maxFindings?: number;
  /** Print the (already-redacted) context line under each finding. */
  verbose?: boolean;
}

export class TerminalReporter implements Reporter {
  private readonly stream: NodeJS.WritableStream;
  private readonly color: boolean;
  private readonly maxFindings: number;
  private readonly verbose: boolean;

  constructor(opts: TerminalReporterOptions = {}) {
    this.stream = opts.stream ?? process.stdout;
    this.color = decideColor(opts.color, this.stream);
    this.maxFindings = opts.maxFindings ?? 50;
    this.verbose = opts.verbose ?? false;
  }

  report(result: ScanResult): void {
    const c = makeAnsi(this.color);
    const n = result.findings.length;

    // ---- clean run ----
    if (n === 0) {
      this.stream.write(
        `\n  ${c.bold("✔ No secrets found")} ` +
          `${c.gray(`· ${result.filesScanned} files · ${result.durationMs}ms`)}\n\n`,
      );
      return;
    }

    // ---- group & sort ----
    const byFile = groupByFile(result.findings);

    // Fingerprints appearing in more than one file — for the "also in"
    // annotation. Computed once, up front.
    const filesByFingerprint = new Map<string, Set<string>>();
    for (const f of result.findings) {
      let s = filesByFingerprint.get(f.fingerprint);
      if (!s) filesByFingerprint.set(f.fingerprint, (s = new Set()));
      s.add(f.file);
    }

    // ---- header ----
    this.stream.write(
      `\n  ${c.bold(`✖ ${n} secret${n === 1 ? "" : "s"} found`)} ` +
        `${c.gray(`in ${byFile.size} file${byFile.size === 1 ? "" : "s"}`)}\n`,
    );

    // ---- body ----
    const providerWidth = computeProviderWidth(result.findings);
    const printed = new Set<string>(); // fingerprints we've already annotated
    let count = 0;
    const limit = this.maxFindings;

    outer: for (const [file, findings] of byFile) {
      this.stream.write(`\n  ${c.bold(file)}\n`);

      for (const f of findings) {
        if (limit > 0 && count >= limit) {
          const rest = n - count;
          this.stream.write(
            `\n  ${c.gray(`… ${rest} more finding${rest === 1 ? "" : "s"} (use --max-findings=0)`)}\n`,
          );
          break outer;
        }

        this.printFinding(f, providerWidth, c, filesByFingerprint, printed);
        count++;
      }
    }

    // ---- footer ----
    const unique = filesByFingerprint.size;
    this.stream.write(`\n  ${c.gray("─".repeat(52))}\n`);
    this.stream.write(
      `  ${c.gray(
        `${n} finding${n === 1 ? "" : "s"} · ${unique} unique · ` +
          `${result.filesScanned} files · ${result.durationMs}ms`,
      )}\n\n`,
    );
  }

  private printFinding(
    f: Finding,
    providerWidth: number,
    c: Ansi,
    filesByFingerprint: Map<string, Set<string>>,
    printed: Set<string>,
  ): void {
    const color = severityColor(f.severity, c);
    const loc = `${String(f.line).padStart(4)}:${String(f.column).padStart(3)}`;
    const sev = color(f.severity.padEnd(8)); // pad BEFORE coloring
    const prov = padOrTruncate(f.provider, providerWidth);

    this.stream.write(
      `    ${c.gray(loc)}  ${sev}  ${c.dim(prov)}  ${f.masked}\n`,
    );

    // "also in" annotation — only on the first finding of each fingerprint,
    // so a secret caught in 5 files doesn't produce 5 identical lines.
    const allFiles = filesByFingerprint.get(f.fingerprint);
    if (allFiles && allFiles.size > 1 && !printed.has(f.fingerprint)) {
      printed.add(f.fingerprint);
      const others = [...allFiles].filter((x) => x !== f.file);
      this.stream.write(
        `        ${c.gray(`⤷ same secret also in: ${others.join(", ")}`)}\n`,
      );
    }

    if (this.verbose && f.context?.length) {
      for (const line of f.context) {
        this.stream.write(`        ${c.gray(line)}\n`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Group by file; sort files A–Z; sort within file by line, then severity. */
function groupByFile(findings: Finding[]): Map<string, Finding[]> {
  const map = new Map<string, Finding[]>();
  for (const f of findings) {
    let arr = map.get(f.file);
    if (!arr) map.set(f.file, (arr = []));
    arr.push(f);
  }
  for (const arr of map.values()) {
    arr.sort(compareByLocation);
  }
  return new Map([...map].sort(([a], [b]) => a.localeCompare(b)));
}

/** Provider column is at most 12 chars; shorter names still align. */
function computeProviderWidth(findings: Finding[]): number {
  let w = 8;
  for (const f of findings) w = Math.max(w, f.provider.length);
  return Math.min(w, 12);
}

function padOrTruncate(s: string, width: number): string {
  if (s.length > width) return s.slice(0, width - 1) + "…";
  return s.padEnd(width);
}
