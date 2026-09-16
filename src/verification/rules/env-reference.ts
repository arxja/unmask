import type { Node } from "@babel/types";
import { findNodePath, offsetFromLineColumn } from "../node-locator";
import type { Rule } from "../types";

/**
 * A finding whose position falls inside a `process.env.X` or
 * `import.meta.env.X` expression is a false positive: the matched text
 * is the name of an environment variable, not a hardcoded value.
 *
 * Environment variable access is the correct pattern, not a leak.
 */

export const envReferenceRule: Rule = (finding, _rawValue, ctx) => {
  if (!ctx.ast) return { action: "keep" };

  const offset = offsetFromLineColumn(ctx.source, finding.line, finding.column);
  if (offset < 0) return { action: "keep" };

  const path = findNodePath(ctx.ast, offset);

  for (const node of path) {
    if (node.type !== "MemberExpression") continue;
    if (isEnvAccess(node)) {
      return {
        action: "drop",
        reason: "value is inside an environment-variable reference",
      };
    }
  }

  return { action: "keep" };
};

/**
 * True for `process.env.X` and `import.meta.env.X`.
 */
function isEnvAccess(node: Node): boolean {
  if (node.type !== "MemberExpression") return false;

  const { object } = node;

  // `process.env`
  if (
    object.type === "MemberExpression" &&
    object.object.type === "Identifier" &&
    object.object.name === "process" &&
    object.property.type === "Identifier" &&
    object.property.name === "env"
  ) {
    return true;
  }

  // `import.meta.env`
  if (
    object.type === "MemberExpression" &&
    object.object.type === "MetaProperty" &&
    object.object.meta.name === "import" &&
    object.object.property.name === "meta" &&
    object.property.type === "Identifier" &&
    object.property.name === "env"
  ) {
    return true;
  }

  return false;
}
