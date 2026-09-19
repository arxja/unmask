import type { Node } from "@babel/types";
import { findNodePath, offsetFromLineColumn } from "../node-locator";
import type { Rule } from "../types";

/**
 * A string literal directly assigned to a variable whose name signals
 * it is a fixture — MOCK_, FAKE_, TEST_, DUMMY_, SAMPLE_, EXAMPLE_,
 * STUB_.
 *
 *   const MOCK_STRIPE_KEY = "sk_live_...";   → drop
 *   const stripeKey = "sk_live_...";          → keep
 *   const key = process.env.STRIPE_KEY;       → keep (no literal)
 *
 * Only the innermost VariableDeclarator in the ancestor path is
 * considered. A string nested inside a fixture-named object
 * (e.g. `const MOCK_CONFIG = { key: "..." }`) is still dropped,
 * because the innermost declarator is MOCK_CONFIG. But a string
 * assigned to an inner variable that happens to live under a
 * fixture-named outer variable is not:
 *
 *   const MOCK = (() => {
 *     const realKey = "AKIA...";   // inner declarator is `realKey`
 *     return realKey;
 *   })();
 *
 * The inner variable's name is what matters — the outer name is a
 * container, not an assignment.
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
  const declarator = findInnermostDeclarator(path);
  if (!declarator) return { action: "keep" };

  const name = declaratorName(declarator);
  if (!name) return { action: "keep" };

  if (FIXTURE_PATTERN.test(name)) {
    return {
      action: "drop",
      reason: `assigned to fixture variable "${name}"`,
    };
  }

  return { action: "keep" };
};

/**
 * Walk the ancestor path from innermost outward and return the first
 * VariableDeclarator. Returns undefined when no VariableDeclarator is
 * on the path.
 */
function findInnermostDeclarator(path: readonly Node[]): Node | undefined {
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].type === "VariableDeclarator") return path[i];
  }
  return undefined;
}

/**
 * Extract the identifier name from a VariableDeclarator's `id`, if the
 * id is a plain Identifier. Destructuring patterns (which have an
 * `ObjectPattern` or `ArrayPattern` id) return null.
 */
function declaratorName(node: Node): string | null {
  if (node.type !== "VariableDeclarator") return null;
  return node.id.type === "Identifier" ? node.id.name : null;
}
