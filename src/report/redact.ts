/**
 * Secret redaction — single source of truth for masking sensitive values
 * before they reach any output.
 *
 * Consumers (current + planned):
 *   - detection/regex-engine    → mask before constructing a Finding
 *   - report/terminal-reporter  → defense-in-depth scrub of context
 *   - report/json-reporter      → defense-in-depth scrub of context
 *
 * Rules:
 *   1. Fixed-shape output — the mask must not reveal input length.
 *   2. Never emit bytes that could reconstruct the secret.
 *   3. Below MIN_VISIBLE, show nothing at all.
 */

export const MASK_CHAR = "•";
export const EDGE_KEEP = 2;
export const MASK_WIDTH = 8;
export const MIN_VISIBLE = 12;

/**
 * Mask a secret for display.
 *
 *   "AKIAIOSFODNN7EXAMPLE" -> "AK••••••••LE"
 *   "short"                -> "••••••••"
 *   ""                     -> ""
 */
export function redact(secret: string): string {
  if (!secret) return "";
  if (secret.length < MIN_VISIBLE) return MASK_CHAR.repeat(MASK_WIDTH);
  return (
    secret.slice(0, EDGE_KEEP) +
    MASK_CHAR.repeat(MASK_WIDTH) +
    secret.slice(-EDGE_KEEP)
  );
}

/**
 * Replace every literal occurrence of `secret` in `line` with its mask.
 * split/join keeps `secret` from being interpreted as a regex pattern.
 */
export function redactLine(line: string, secret: string): string {
  if (!secret) return line;
  return line.split(secret).join(redact(secret));
}
