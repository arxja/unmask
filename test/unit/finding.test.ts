import { describe, it, expect } from "vitest";
import {
  SEVERITIES,
  CONFIDENCES,
  SEVERITY_RANK,
  isSeverity,
  isConfidence,
  compareFindings,
  compareByLocation,
  type Finding,
  type Severity,
} from "../../src/core/finding";

const baseFinding: Finding = {
  patternId: "p",
  patternName: "P",
  provider: "test",
  severity: "high",
  confidence: "high",
  file: "src/a.ts",
  line: 1,
  column: 1,
  masked: "ab••••••••yz",
  fingerprint: "abc123def456",
};

function f(overrides: Partial<Finding> = {}): Finding {
  return { ...baseFinding, ...overrides };
}

// ---------------------------------------------------------------------------
// Runtime validators
// ---------------------------------------------------------------------------

describe("isSeverity", () => {
  it.each(SEVERITIES)("accepts %s", (value) => {
    expect(isSeverity(value)).toBe(true);
  });

  it.each([
    ["unknown string", "sev:high"],
    ["wrong case", "HIGH"],
    ["empty", ""],
    ["non-string", 42],
    ["null", null],
    ["undefined", undefined],
  ])("rejects %s", (_label, value) => {
    expect(isSeverity(value)).toBe(false);
  });
});

describe("isConfidence", () => {
  it.each(CONFIDENCES)("accepts %s", (value) => {
    expect(isConfidence(value)).toBe(true);
  });

  it.each([
    ["unknown string", "very-high"],
    ["wrong case", "High"],
    ["empty", ""],
    ["non-string", false],
    ["null", null],
  ])("rejects %s", (_label, value) => {
    expect(isConfidence(value)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SEVERITY_RANK — the invariant every comparator relies on
// ---------------------------------------------------------------------------

describe("SEVERITY_RANK", () => {
  it("orders critical before high before medium before low", () => {
    expect(SEVERITY_RANK.critical).toBeLessThan(SEVERITY_RANK.high);
    expect(SEVERITY_RANK.high).toBeLessThan(SEVERITY_RANK.medium);
    expect(SEVERITY_RANK.medium).toBeLessThan(SEVERITY_RANK.low);
  });

  it("assigns a rank to every severity", () => {
    for (const s of SEVERITIES) {
      expect(SEVERITY_RANK[s]).toBeTypeOf("number");
    }
  });
});

// ---------------------------------------------------------------------------
// compareFindings — flat order: severity desc → file → line → column
// ---------------------------------------------------------------------------

describe("compareFindings", () => {
  it("sorts more severe findings first", () => {
    const sorted = [
      f({ severity: "low" }),
      f({ severity: "critical" }),
      f({ severity: "medium" }),
    ].sort(compareFindings);

    expect(sorted.map((x) => x.severity)).toEqual([
      "critical",
      "medium",
      "low",
    ]);
  });

  it("breaks severity ties by file name (A–Z)", () => {
    const sorted = [
      f({ file: "src/z.ts" }),
      f({ file: "src/a.ts" }),
      f({ file: "src/m.ts" }),
    ].sort(compareFindings);

    expect(sorted.map((x) => x.file)).toEqual([
      "src/a.ts",
      "src/m.ts",
      "src/z.ts",
    ]);
  });

  it("breaks file ties by line", () => {
    const sorted = [
      f({ file: "src/a.ts", line: 30 }),
      f({ file: "src/a.ts", line: 10 }),
      f({ file: "src/a.ts", line: 20 }),
    ].sort(compareFindings);

    expect(sorted.map((x) => x.line)).toEqual([10, 20, 30]);
  });

  it("breaks line ties by column", () => {
    const sorted = [
      f({ line: 5, column: 30 }),
      f({ line: 5, column: 10 }),
      f({ line: 5, column: 20 }),
    ].sort(compareFindings);

    expect(sorted.map((x) => x.column)).toEqual([10, 20, 30]);
  });

  it("is a total order — identical findings compare equal", () => {
    const a = f();
    const b = f();
    expect(compareFindings(a, b)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// compareByLocation — within-file order: line → column → severity
// ---------------------------------------------------------------------------

describe("compareByLocation", () => {
  it("sorts by line before severity", () => {
    // A low-severity finding on line 1 must come before a critical on
    // line 2, because the developer reads the file top-to-bottom.
    const sorted = [
      f({ line: 2, severity: "critical" }),
      f({ line: 1, severity: "low" }),
    ].sort(compareByLocation);

    expect(sorted.map((x) => x.line)).toEqual([1, 2]);
  });

  it("breaks line ties by column", () => {
    const sorted = [
      f({ line: 5, column: 30 }),
      f({ line: 5, column: 10 }),
    ].sort(compareByLocation);

    expect(sorted.map((x) => x.column)).toEqual([10, 30]);
  });

  it("breaks column ties by severity", () => {
    const sorted = [
      f({ line: 1, column: 1, severity: "low" }),
      f({ line: 1, column: 1, severity: "critical" }),
      f({ line: 1, column: 1, severity: "medium" }),
    ].sort(compareByLocation);

    expect(sorted.map((x) => x.severity)).toEqual([
      "critical",
      "medium",
      "low",
    ]);
  });

  it("does not order by file — that is the caller's job", () => {
    // If callers accidentally use compareByLocation across files, the
    // order is unspecified beyond line/column. This test documents the
    // contract: the function is only meaningful within a single file.
    const a = f({ file: "src/a.ts", line: 5 });
    const b = f({ file: "src/z.ts", line: 5 });
    // Both at line 5, column 1, same severity → compare equal.
    expect(compareByLocation(a, b)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Severity array/type consistency
// ---------------------------------------------------------------------------

describe("SEVERITIES", () => {
  it("contains all and only the Severity members", () => {
    // Compile-time guard: the array must be assignable to Severity[].
    const asTyped: readonly Severity[] = SEVERITIES;
    expect(asTyped).toHaveLength(4);
  });

  it("is in descending severity order", () => {
    // Some reporters may iterate SEVERITIES directly for column order;
    // keeping the array sorted is cheaper than sorting at runtime.
    for (let i = 1; i < SEVERITIES.length; i++) {
      expect(SEVERITY_RANK[SEVERITIES[i - 1]]).toBeLessThan(
        SEVERITY_RANK[SEVERITIES[i]],
      );
    }
  });
});
