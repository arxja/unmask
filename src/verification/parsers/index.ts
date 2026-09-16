import { extname } from "node:path";
import { parse, type ParserOptions } from "@babel/parser";
import type { File } from "@babel/types";

export interface ParseError {
  message: string;
  line: number;
  column: number;
}

export interface ParseResult {
  /** Null when parsing failed hard enough that no AST is usable. */
  ast: File | null;
  /** Non-fatal errors collected during error-recovery parsing. */
  errors: ParseError[];
}

/**
 * Parses source into a Babel AST. Must not throw — all failures are
 * returned in the result. Callers that need an AST handle `ast === null`
 * themselves.
 */

export interface Parser {
  parse(source: string, filePath: string): ParseResult;
}

const SUPPORTED_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
]);

export function isSupportedFile(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(extname(filePath).toLowerCase());
}

/**
 * Babel plugins required to parse a given file. Plugins are additive:
 * `decorators-legacy` is included for every file because decorators
 * appear in both JS and TS codebases (Angular, NestJS, MobX).
 *
 * `.tsx` gets `typescript` AND `jsx` — the two are compatible only in
 * that combination, and it disambiguates `<T>` type assertions from JSX
 * tags.
 */

function pluginsFor(filePath: string): ParserOptions["plugins"] {
  const ext = extname(filePath).toLowerCase();
  const plugins: NonNullable<ParserOptions["plugins"]> = ["decorators-legacy"];

  switch (ext) {
    case ".ts":
    case ".mts":
    case ".cts":
      plugins.push("typescript");
      break;
    case ".tsx":
      plugins.push("typescript", "jsx");
      break;
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      plugins.push("jsx");
      break;
  }

  return plugins;
}

export function createBabelParser(): Parser {
  return {
    parse(source, filePath) {
      try {
        const ast = parse(source, {
          // "unambiguous" lets Babel decide between script and module
          // based on content. Correct for a scanner that sees both.
          sourceType: "unambiguous",
          plugins: pluginsFor(filePath),
          // Collect errors instead of throwing on the first one. A file
          // with a syntax error in one place can still have a parsable
          // AST for the rest.
          errorRecovery: true,
          // These are common in partial code (snippets, templates) and
          // Babel otherwise rejects them.
          allowReturnOutsideFunction: true,
          allowAwaitOutsideFunction: true,
          allowSuperOutsideMethod: true,
          // Attach `start`/`end` character offsets to every node. The
          // node locator depends on these.
          ranges: true,
        });

        const errors: ParseError[] = (ast.errors ?? []).map((err) => ({
          message: err.message,
          line: err.loc?.line ?? 0,
          column: err.loc?.column ?? 0,
        }));
        return { ast, errors };
      } catch (error) {
        // Error recovery was disabled or failed entirely. No AST is
        // usable. Report the error and return null — verification rules
        // that need the AST will short-circuit to "keep".
        const e = error as {
          message?: string;
          loc?: { line?: number; column?: number };
        };
        return {
          ast: null,
          errors: [
            {
              message: e.message ?? String(error),
              line: e.loc?.line ?? 0,
              column: e.loc?.column ?? 0,
            },
          ],
        };
      }
    },
  };
}
