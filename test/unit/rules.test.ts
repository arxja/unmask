import { describe, it, expect } from "vitest";
import { createBabelParser } from "../../src/verification/parsers";
import { envReferenceRule } from "../../src/verification/rules/env-reference";
import { placeholderValueRule } from "../../src/verification/rules/placeholder-value";
import { templateLiteralValueRule } from "../../src/verification/rules/template-literal-value";
import { testPathRule } from "../../src/verification/rules/test-path";
import type { Finding } from "../../src/core/finding";
import type { VerificationContext } from "../../src/verification/types";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    patternId: "p",
    patternName: "P",
    provider: "test",
    severity: "high",
    confidence: "high",
    file: "src/a.ts",
    line: 1,
    column: 1,
    masked: "ab••••••••yz",
    fingerprint: "fp123456789a",
    ...overrides,
  };
}

const parser = createBabelParser();

function ctxFor(source: string, filePath = "src/a.ts"): VerificationContext {
  const { ast } = parser.parse(source, filePath);
  return { ast, source, filePath };
}

describe("testPathRule", () => {
  const ctx = ctxFor("", "");

  it.each([
    "test/foo.ts",
    "src/__tests__/foo.ts",
    "src/foo.test.ts",
    "src/foo.spec.ts",
    "fixtures/example.ts",
    ".env.example",
    ".env.sample",
  ])("adjusts severity for %s", (file) => {
    const v = testPathRule(makeFinding({ file }), "", ctx);
    expect(v.action).toBe("adjust");
    if (v.action === "adjust") expect(v.severity).toBe("low");
  });

  it.each(["src/index.ts", "src/api/client.ts", "lib/util.js"])(
    "keeps %s",
    (file) => {
      const v = testPathRule(makeFinding({ file }), "", ctx);
      expect(v.action).toBe("keep");
    },
  );
});

describe("placeholderValueRule", () => {
  const ctx = ctxFor("", "");

  it.each([
    "your_api_key_here",
    "YOUR_API_KEY_HERE",
    "changeme",
    "CHANGEME",
    "xxxxxxxxxxxxxxxx",
    "0000000000000000",
    "aaaaaaaaaaaaaaaa",
    "<INSERT_KEY>",
    "${API_KEY}",
    "{{API_KEY}}",
    "AKIAIOSFODNN7EXAMPLE", // AWS docs example key
  ])("drops placeholder %s", (value) => {
    const v = placeholderValueRule(makeFinding(), value, ctx);
    expect(v.action).toBe("drop");
  });

  it.each([
    "sk_live_51H8xKqLmN9pQrStUvWxYz012",
    "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
    "aB3$xY9zQ2wV8nM5kL",
  ])("keeps %s", (value) => {
    const v = placeholderValueRule(makeFinding(), value, ctx);
    expect(v.action).toBe("keep");
  });
});

describe("envReferenceRule", () => {
  it("drops a finding inside process.env.X", () => {
    const src = "const x = process.env.SECRET_KEY;";
    // Position of "SECRET_KEY" (column 24).
    const finding = makeFinding({ line: 1, column: 24 });
    const v = envReferenceRule(finding, "SECRET_KEY", ctxFor(src));
    expect(v.action).toBe("drop");
  });

  it("drops a finding inside import.meta.env.X", () => {
    const src = "const x = import.meta.env.SECRET_KEY;";
    const finding = makeFinding({ line: 1, column: 29 });
    const v = envReferenceRule(finding, "SECRET_KEY", ctxFor(src));
    expect(v.action).toBe("drop");
  });

  it("keeps a finding on a plain string literal", () => {
    const src = 'const key = "sk_live_abcdef1234567890";';
    const finding = makeFinding({ line: 1, column: 14 });
    const v = envReferenceRule(
      finding,
      "sk_live_abcdef1234567890",
      ctxFor(src),
    );
    expect(v.action).toBe("keep");
  });

  it("keeps when there is no AST", () => {
    const finding = makeFinding({ column: 1 });
    const v = envReferenceRule(finding, "", {
      ast: null,
      source: "",
      filePath: "",
    });
    expect(v.action).toBe("keep");
  });
});

describe("templateLiteralValueRule", () => {
  it("drops a finding inside a template interpolation", () => {
    const src =
      "const url = `https://api.example.com/?key=${process.env.KEY}`;";
    const column = src.indexOf("process") + 1;
    const finding = makeFinding({ line: 1, column });
    const v = templateLiteralValueRule(finding, "process", ctxFor(src));
    expect(v.action).toBe("drop");
  });

  it("keeps a finding on the static text of a template literal", () => {
    const src = "const key = `sk_live_abcdef1234567890`;";
    // Position of "sk_live_..." (column 15).
    const finding = makeFinding({ line: 1, column: 15 });
    const v = templateLiteralValueRule(
      finding,
      "sk_live_abcdef1234567890",
      ctxFor(src),
    );
    expect(v.action).toBe("keep");
  });

  it("keeps when there is no AST", () => {
    const finding = makeFinding();
    const v = templateLiteralValueRule(finding, "", {
      ast: null,
      source: "",
      filePath: "",
    });
    expect(v.action).toBe("keep");
  });
});
