import type { File, Node } from "@babel/types";

/**
 * Convert a 1-based (line, column) pair into a 0-based character offset
 * into `source`. Column is a character count within the line, not a
 * byte count.
 *
 * Returns -1 when the position is out of bounds.
 *
 * O(source length). Called once per finding. For a repo with a few
 * findings per file, this is negligible.
 */
export function offsetFromLineColumn(
  source: string,
  line: number,
  column: number,
): number {
  if (line < 1 || column < 1) return -1;

  let currentLine = 1;
  let lineStart = 0;

  for (let i = 0; i < source.length; i++) {
    if (currentLine === line) {
      const offset = lineStart + column - 1;
      return offset <= source.length ? offset : -1;
    }
    if (source.charCodeAt(i) === 10 /* \n */) {
      currentLine++;
      lineStart = i + 1;
    }
  }

  // Last line without a trailing newline.
  if (currentLine === line) {
    const offset = lineStart + column - 1;
    return offset <= source.length ? offset : -1;
  }

  return -1;
}

/**
 * Return the chain of AST nodes that contain `offset`, ordered from the
 * root (File) to the innermost node. The first element is always `File`
 * if the offset is within the file's range. When the offset lands on
 * whitespace between tokens, the chain stops at the deepest ancestor
 * whose children all miss the offset — typically `[File, Program]`.
 *
 * Rules that walk the returned chain looking for a specific node type
 * (MemberExpression, TemplateLiteral, VariableDeclarator) treat both
 * `[]` and `[File, Program]` identically: neither contains a match, so
 * the rule returns `keep`. The distinction is not load-bearing for any
 * current rule, but the chain is honest about what the AST contains.
 */
export function findNodePath(ast: File, offset: number): Node[] {
  const path: Node[] = [];
  let current: Node | undefined = ast;

  while (current) {
    if (!containsOffset(current, offset)) break;

    // Find the next child that contains the offset before committing
    // to adding the current node. If there is no child that contains
    // the offset and we're at the root, the offset lies on
    // whitespace between tokens and we should return an empty path.
    const next = firstChildContaining(current, offset);
    if (!next && path.length === 0) return [];

    path.push(current);
    if (!next) break;
    current = next;
  }

  return path;
}

function containsOffset(node: unknown, offset: number): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as { start?: number | null; end?: number | null };
  return (
    typeof n.start === "number" &&
    typeof n.end === "number" &&
    n.start <= offset &&
    offset < n.end
  );
}

function firstChildContaining(node: Node, offset: number): Node | undefined {
  for (const key of Object.keys(node)) {
    // `loc` and the range fields themselves are not children. Skipping
    // them prevents walking into SourceLocation objects, which have
    // their own start/end that would confuse the offset check.
    if (key === "loc" || key === "start" || key === "end") continue;
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (containsOffset(item, offset)) return item as Node;
      }
    } else if (containsOffset(value, offset)) {
      return value as Node;
    }
  }
  return undefined;
}
