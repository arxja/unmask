import type { Pattern } from "../detection/regex-engine";

export interface PatternConflict {
  id: string;
  /** The pattern that will NOT be used. */
  shadowed: Pattern;
  /** Where the shadowed pattern came from. */
  shadowedSource: "builtin" | "custom";
  /** The pattern that WILL be used. */
  winner: Pattern;
}

export interface MergeResult {
  patterns: Pattern[];
  conflicts: PatternConflict[];
}

/**
 * Merge two pattern registries. Custom patterns win on id collision.
 *
 * Ids are the identity of a pattern. Two patterns with the same id are
 * "the same pattern" from the engine's perspective, and this function
 * decides which definition survives. It does not validate the winning
 * pattern's regex or semantics — that is loadPatterns' job, and it runs
 * before this function is called.
 */
export function mergePatterns(
  builtin: readonly Pattern[],
  custom: readonly Pattern[],
): MergeResult {
  const byId = new Map<
    string,
    { pattern: Pattern; source: "builtin" | "custom" }
  >();

  const conflicts: PatternConflict[] = [];

  for (const p of builtin) {
    byId.set(p.id, { pattern: p, source: "builtin" });
  }

  for (const p of custom) {
    const existing = byId.get(p.id);
    if (existing) {
      conflicts.push({
        id: p.id,
        shadowed: existing.pattern,
        shadowedSource: existing.source,
        winner: p,
      });
    }
    byId.set(p.id, { pattern: p, source: "custom" });
  }

  return {
    patterns: [...byId.values()].map((v) => v.pattern),
    conflicts,
  };
}
