export interface EntropyOptions {
  minLength?: number;
  minBitsPerChar?: number;
  minClasses?: number;
  minEntropyRatio?: number;
  maxRunLength?: number;
  minAlphabet?: number;
}

const DEFAULTS: Required<EntropyOptions> = {
  minLength: 20,
  minBitsPerChar: 3.0,
  minClasses: 3,
  minEntropyRatio: 0.85,
  maxRunLength: 4,
  minAlphabet: 8,
};

/** Shannon entropy in bits per symbol. Max = log2(alphabet). */
export function shannonEntropy(str: string): number {
  if (str.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of str) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  const n = str.length;
  let h = 0;
  for (const count of freq.values()) {
    const p = count / n;
    h -= p * Math.log2(p);
  }
  return h;
}

function countClasses(str: string): number {
  let lower = false,
    upper = false,
    digit = false,
    symbol = false;
  for (const ch of str) {
    if (ch >= "a" && ch <= "z") lower = true;
    else if (ch >= "A" && ch <= "Z") upper = true;
    else if (ch >= "0" && ch <= "9") digit = true;
    else symbol = true;
  }
  return +lower + +upper + +digit + +symbol;
}

function maxRunLength(str: string): number {
  let max = 1,
    cur = 1;
  for (let i = 1; i < str.length; i++) {
    cur = str[i] === str[i - 1] ? cur + 1 : 1;
    if (cur > max) max = cur;
  }
  return max;
}

export function hasHighEntropy(
  str: string,
  opts: EntropyOptions = {},
): boolean {
  const o = { ...DEFAULTS, ...opts };

  // 1. Length gate.
  if (str.length < o.minLength) return false;

  // 2. Reject runs (entropy alone can be fooled by "aB3$aaaaa...").
  if (maxRunLength(str) > o.maxRunLength) return false;

  // 3. Alphabet floor — reject strings that reuse only a handful of symbols.
  const alpha = new Set(str).size;
  if (alpha < o.minAlphabet) return false;

  // 4. Class diversity. Long strings are usually hex/base32 digests
  //    (2 classes: lowercase + digit); short strings need more.
  const requiredClasses =
    str.length >= 30 ? Math.min(o.minClasses, 2) : o.minClasses;
  if (countClasses(str) < requiredClasses) return false;

  // 5. Entropy density. `entropy` is already bits-per-symbol.
  const entropy = shannonEntropy(str);
  const ratio = entropy / Math.log2(alpha);
  return entropy >= o.minBitsPerChar && ratio >= o.minEntropyRatio;
}
