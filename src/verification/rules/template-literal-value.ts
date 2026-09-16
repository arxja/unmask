import { findNodePath, offsetFromLineColumn } from "../node-locator";
import type { Rule } from "../types";

/**
 * A finding whose position falls inside an `${...}` interpolation of a
 * template literal is a false positive: the "secret" is a fragment of a
 * composed string, not a hardcoded value.
 *
 *   `https://api.example.com/?key=${API_KEY}`   — drop (interpolation)
 *   `sk_live_abcdefghijklmnopqrstuvwxyz`        — keep (static literal)
 *
 * The distinction is whether the position is in a `TemplateElement`
 * (the literal text part) or in one of the template's `expressions`
 * (the `${...}` parts). Babel models both under a `TemplateLiteral`
 * node, so the check is against which child subtree the offset falls
 * into.
 */

export const templateLiteralValueRule: Rule = (finding, _rawValue, ctx) => {
  if (!ctx.ast) return { action: "keep" };

  const offset = offsetFromLineColumn(ctx.source, finding.line, finding.column);
  if (offset < 0) return { action: "keep" };

  const path = findNodePath(ctx.ast, offset);

  // Innermost node. If it is a TemplateElement, the position is in the
  // static text of a template literal — that is a real string.
  const innermost = path[path.length - 1];
  if (!innermost || innermost.type === "TemplateElement") {
    return { action: "keep" };
  }

  // Any TemplateLiteral ancestor with expressions means the position is
  // in an interpolation, not the static text.
  for (const node of path) {
    if (node.type === "TemplateLiteral" && node.expressions.length > 0) {
      return {
        action: "drop",
        reason: "value is inside a template literal interpolation",
      };
    }
  }

  return { action: "keep" };
};
