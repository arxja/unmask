import type { Node } from "@babel/types";
import { findNodePath, offsetFromLineColumn } from "../node-locator";
import type { Rule } from "../types";

/**
 * A string literal assigned to a variable whose name signals it is a
 * fixture — MOCK_, FAKE_, TEST_, DUMMY_, SAMPLE_, EXAMPLE_, STUB_.
 *
 *   const MOCK_STRIPE_KEY = "sk_live_...";   → drop
 *   const stripeKey = "sk_live_...";          → keep
 *   const key = process.env.STRIPE_KEY;       → keep (no literal)
 *
 * The check is anchored to the *variable name*, not to the value. The
 * value being MOCK-shaped is `placeholder-value`'s job. Two rules,
 * two signals, one purpose each.
 */

const FIXTURE_PREFIXES = [
  "MOCK",
  "FAKE",
  "TEST",
  "DUMMY",
  "SAMPLE",
  "EXAMPLE",
  "STUB",
];

const FIXTURE_PATTERN = new RegExp(
  `(^|_)(${FIXTURE_PREFIXES.join("|")})(_|$)`,
  "i",
);

export const constantAliasRule: Rule = (finding, _rawValue, ctx) => {
  if (!ctx.ast) return { action: "keep" };

  const offset = offsetFromLineColumn(ctx.source, finding.line, finding.column);
  if (offset < 0) return { action: "keep" };

  const path = findNodePath(ctx.ast, offset);

  for (const node of path) {
    if (node.type !== "VariableDeclarator") continue;
    const name = declaratorName(node);
    if (!name) continue;

    if (FIXTURE_PATTERN.test(name)) {
      return {
        action: "drop",
        reason: `assigned to fixture variable "${name}"`,
      };
    }
  }

  return { action: "keep" };
};

/**
 * Extract the identifier name from a VariableDeclarator's `id`, if the
 * id is a plain Identifier. Destructuring patterns (which have an
 * `ObjectPattern` or `ArrayPattern` id) return null.
 */
function declaratorName(node: Node): string | null {
  if (node.type !== "VariableDeclarator") return null;
  return node.id.type === "Identifier" ? node.id.name : null;
}
