import { describe, it, expect } from "vitest";
import {
  offsetFromLineColumn,
  findNodePath,
} from "../../src/verification/node-locator";
import { createBabelParser } from "../../src/verification/parsers";

describe("offsetFromLineColumn", () => {
  const src = "one\ntwo\nthree";

  it("returns 0 for the start of the file", () => {
    expect(offsetFromLineColumn(src, 1, 1)).toBe(0);
  });

  it("accounts for multi-line offsets", () => {
    // "two" starts at offset 4.
    expect(offsetFromLineColumn(src, 2, 1)).toBe(4);
  });

  it("accounts for column offsets", () => {
    // Line 2, column 3 → 'o' in "two" → offset 6.
    expect(offsetFromLineColumn(src, 2, 3)).toBe(6);
  });

  it("handles a last line without a trailing newline", () => {
    expect(offsetFromLineColumn(src, 3, 1)).toBe(8);
  });

  it("returns -1 for out-of-range line", () => {
    expect(offsetFromLineColumn(src, 99, 1)).toBe(-1);
  });

  it("returns -1 for zero or negative input", () => {
    expect(offsetFromLineColumn(src, 0, 1)).toBe(-1);
    expect(offsetFromLineColumn(src, 1, 0)).toBe(-1);
  });
});

describe("findNodePath", () => {
  const parser = createBabelParser();

  it("returns the chain from File to the innermost node", () => {
    const src = "const x = 1;";
    const { ast } = parser.parse(src, "test.ts");
    if (!ast) throw new Error("expected AST");

    // Position of '1' at column 11.
    const offset = offsetFromLineColumn(src, 1, 11);
    const path = findNodePath(ast, offset);

    expect(path.length).toBeGreaterThan(1);
    expect(path[0].type).toBe("File");
    expect(path[path.length - 1].type).toBe("NumericLiteral");
  });

  it("returns only File and Program for an offset on whitespace between tokens", () => {
    const src = "   \nconst x = 1;";
    const { ast } = parser.parse(src, "test.ts");
    if (!ast) throw new Error("expected AST");

    const path = findNodePath(ast, 1);
    expect(path.map((n) => n.type)).toEqual(["File", "Program"]);
  });
});
