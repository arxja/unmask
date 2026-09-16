import type { NamedRule } from "../types";
import { envReferenceRule } from "./env-reference";
import { placeholderValueRule } from "./placeholder-value";
import { templateLiteralValueRule } from "./template-literal-value";
import { testPathRule } from "./test-path";

/**
 * The order rules run in. Order matters when rules interact: an earlier
 * drop short-circuits the chain for that finding, and adjust verdicts
 * compose left to right.
 *
 * Cheapest rules first. Path-based and value-based rules do not need
 * the AST, so they run before AST-based rules — a finding that is
 * dropped on path alone never pays for the tree walk.
 */
export const RULES: readonly NamedRule[] = [
  { name: "test-path", rule: testPathRule },
  { name: "placeholder-value", rule: placeholderValueRule },
  { name: "env-reference", rule: envReferenceRule },
  { name: "template-literal-value", rule: templateLiteralValueRule },
];
