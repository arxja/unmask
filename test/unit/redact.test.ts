import { describe, it, expect } from "vitest";
import {
  redact,
  redactLine,
  MASK_CHAR,
  EDGE_KEEP,
  MASK_WIDTH,
  MIN_VISIBLE,
} from "../../src/report/redact";

// A secret long enough to hit the visible-edges branch.
const LONG_SECRET = "AKIAIOSFODNN7EXAMPLE"; // 20 chars

describe("redact", () => {
  describe("when the input is empty", () => {
    it("returns the empty string", () => {
      expect(redact("")).toBe("");
    });
  });

  describe("when the input is shorter than MIN_VISIBLE", () => {
    it("returns a fixed-width mask with no visible characters", () => {
      expect(redact("short")).toBe(MASK_CHAR.repeat(MASK_WIDTH));
    });

    it("does not reveal the input length", () => {
      // Two very different lengths must produce the same output width.
      const a = redact("ab");
      const b = redact("abcdefghijk"); // 11 chars, just under MIN_VISIBLE
      expect(a.length).toBe(b.length);
      expect(a).toBe(b);
    });
  });

  describe("when the input reaches MIN_VISIBLE", () => {
    it("preserves exactly EDGE_KEEP characters at the start", () => {
      expect(redact(LONG_SECRET).slice(0, EDGE_KEEP)).toBe(
        LONG_SECRET.slice(0, EDGE_KEEP),
      );
    });

    it("preserves exactly EDGE_KEEP characters at the end", () => {
      expect(redact(LONG_SECRET).slice(-EDGE_KEEP)).toBe(
        LONG_SECRET.slice(-EDGE_KEEP),
      );
    });

    it("replaces the middle with a fixed-width mask", () => {
      expect(redact(LONG_SECRET)).toBe(
        LONG_SECRET.slice(0, EDGE_KEEP) +
          MASK_CHAR.repeat(MASK_WIDTH) +
          LONG_SECRET.slice(-EDGE_KEEP),
      );
    });

    it("produces fixed-width output regardless of input length", () => {
      // The whole point of the fixed mask width: no length side-channel.
      const short = redact("abcdefghijkl"); // 12 chars, MIN_VISIBLE
      const long = redact("a".repeat(200));
      expect(short.length).toBe(long.length);
    });

    it("never contains the full secret as a substring", () => {
      // Coverage philosophy: redaction is non-negotiable. This is the
      // property that matters — not the specific mask shape.
      expect(redact(LONG_SECRET)).not.toContain(LONG_SECRET);
    });
  });
});

describe("redactLine", () => {
  it("returns the line unchanged when the secret is empty", () => {
    const line = "const x = something;";
    expect(redactLine(line, "")).toBe(line);
  });

  it("returns the line unchanged when the secret is not present", () => {
    const line = "const x = something;";
    expect(redactLine(line, "not-there")).toBe(line);
  });

  it("masks every occurrence of the secret", () => {
    const secret = "AKIAIOSFODNN7EXAMPLE";
    const line = `a=${secret}&b=${secret}`;
    const out = redactLine(line, secret);
    expect(out).not.toContain(secret);
    // Twice replaced → two masks in the output.
    expect(out.split(redact(secret))).toHaveLength(3);
  });

  it("masks only the exact secret substring, not neighbouring text", () => {
    const secret = "abcdefghijkl";
    const line = `prefix:${secret}:suffix`;
    expect(redactLine(line, secret)).toBe(`prefix:${redact(secret)}:suffix`);
  });

  it("does not interpret the secret as a regex pattern", () => {
    // A regex-based implementation would treat `.` as "any char" and
    // mask the wrong substring (or crash on unescaped brackets).
    const secret = "a.b[c]";
    const line = `x=${secret}&y=zzz`;
    const out = redactLine(line, secret);
    expect(out).toBe(`x=${redact(secret)}&y=zzz`);
  });
});

describe("constants", () => {
  it("keeps the mask wider than the visible edges so length is hidden", () => {
    // Guards against a future edit that sets MASK_WIDTH below
    // 2 * EDGE_KEEP, which would make short masked outputs shorter
    // than tall ones and reintroduce a length side-channel.
    expect(MASK_WIDTH).toBeGreaterThanOrEqual(2 * EDGE_KEEP);
  });

  it("keeps MIN_VISIBLE above the edge budget so a mask is always visible", () => {
    expect(MIN_VISIBLE).toBeGreaterThan(2 * EDGE_KEEP);
  });
});
