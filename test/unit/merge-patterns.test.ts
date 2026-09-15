import { describe, it, expect } from "vitest";
import { mergePatterns } from "../../src/commands/merge-patterns";
import type { Pattern } from "../../src/detection/regex-engine";

function p(id: string, provider = "test"): Pattern {
  return {
    id,
    name: id,
    provider,
    regex: "x",
    flags: "",
    confidence: "high",
    severity: "high",
    entropyCheck: false,
  };
}

describe("mergePatterns", () => {
  describe("no conflicts", () => {
    it("returns built-ins followed by customs", () => {
      const { patterns, conflicts } = mergePatterns([p("a"), p("b")], [p("c")]);
      expect(patterns.map((x) => x.id)).toEqual(["a", "b", "c"]);
      expect(conflicts).toEqual([]);
    });

    it("returns built-ins unchanged when there are no customs", () => {
      const { patterns, conflicts } = mergePatterns([p("a")], []);
      expect(patterns.map((x) => x.id)).toEqual(["a"]);
      expect(conflicts).toEqual([]);
    });
  });

  describe("custom shadows built-in", () => {
    it("uses the custom pattern and records the conflict", () => {
      const builtin = [p("a"), p("b")];
      const custom = [p("a", "custom-provider")];

      const { patterns, conflicts } = mergePatterns(builtin, custom);

      expect(patterns).toHaveLength(2);
      const a = patterns.find((x) => x.id === "a")!;
      expect(a.provider).toBe("custom-provider");
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].id).toBe("a");
      expect(conflicts[0].shadowedSource).toBe("builtin");
      expect(conflicts[0].winner.provider).toBe("custom-provider");
    });

    it("preserves the built-in's position when overwritten", () => {
      // Insertion order: `a` was first, so the merged `a` is still first
      // even though its definition came from custom.
      const builtin = [p("a"), p("b")];
      const custom = [p("a", "custom-provider")];

      const { patterns } = mergePatterns(builtin, custom);
      expect(patterns.map((x) => x.id)).toEqual(["a", "b"]);
    });
  });

  describe("duplicate custom ids", () => {
    it("uses the last custom definition and records the conflict", () => {
      const custom = [p("a", "first"), p("a", "second")];
      const { patterns, conflicts } = mergePatterns([], custom);

      expect(patterns).toHaveLength(1);
      expect(patterns[0].provider).toBe("second");
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].shadowedSource).toBe("custom");
      expect(conflicts[0].winner.provider).toBe("second");
    });
  });

  it("does not mutate its inputs", () => {
    const builtin = [p("a")];
    const custom = [p("a", "custom-provider")];
    const builtinBefore = [...builtin];
    const customBefore = [...custom];

    mergePatterns(builtin, custom);

    expect(builtin).toEqual(builtinBefore);
    expect(custom).toEqual(customBefore);
  });
});
