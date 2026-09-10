import { describe, it, expect } from "vitest";
import { hasHighEntropy } from "../../src/detection/entropy";

describe("hasHighEntropy", () => {
  describe("length gate", () => {
    it("rejects strings shorter than the minimum length", () => {
      expect(hasHighEntropy("abs")).toBe(false);
      expect(hasHighEntropy("1234567")).toBe(false);
      expect(hasHighEntropy("xK9$mP2qL8nR")).toBe(false); // 12 chars
    });

    it("rejects strings just below the default minimum (20)", () => {
      expect(hasHighEntropy("aB3$xY7!qW9#eR2@tU5")).toBe(false); // 19
    });

    it("honors a custom minLength option", () => {
      expect(
        hasHighEntropy("xK9$mP2qL8nR", { minLength: 8, minBitsPerChar: 3.0 }),
      ).toBe(true);
      expect(hasHighEntropy("xK9$mP2qL8nR", { minLength: 20 })).toBe(false);
    });
  });

  describe("character class diversity", () => {
    it("rejects single-class strings even if long", () => {
      expect(hasHighEntropy("abcdefghijklmnopqrst")).toBe(false);
      expect(hasHighEntropy("ABCDEFGHIJKLMNOPQRST")).toBe(false);
      expect(hasHighEntropy("12345678901234567890")).toBe(false);
    });

    it("rejects two-class strings below the default threshold of 3", () => {
      expect(hasHighEntropy("aBcDeFgHiJkLmNoPqRsT")).toBe(false);
      expect(hasHighEntropy("a1b2c3d4e5f6g7h8i9j0")).toBe(false);
    });

    it("honors a custom minClasses option", () => {
      expect(
        hasHighEntropy("a1b2c3d4e5f6g7h8i9j0k1l2m3", { minClasses: 2 }),
      ).toBe(true);
    });
  });

  describe("repetition", () => {
    it("rejects single-character repeats", () => {
      expect(hasHighEntropy("aaaaaaaaaaaa")).toBe(false);
      expect(hasHighEntropy("aaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
    });

    it("rejects two-character alternating patterns", () => {
      expect(hasHighEntropy("abababababab")).toBe(false);
      expect(hasHighEntropy("abababababababababababab")).toBe(false);
    });

    it("rejects long runs inside otherwise-diverse strings", () => {
      expect(hasHighEntropy("aB3$aaaaaXy7!qW9#eR2@")).toBe(false);
    });

    it("accepts strings with short runs (<= 4)", () => {
      expect(hasHighEntropy("aB3$aaaXy7!qW9#eR2@tU5mN")).toBe(true);
    });
  });

  describe("alphabet size", () => {
    it("rejects strings whose alphabet is too small", () => {
      expect(hasHighEntropy("abcabcabcabcabcabcabcabc")).toBe(false);
    });

    it("accepts hex strings (observed alphabet can be < 16)", () => {
      expect(hasHighEntropy("d41d8cd98f00b204e9800998ecf8427e")).toBe(true);
    });

    it("accepts base64-style strings", () => {
      expect(hasHighEntropy("SGVsbG8gV29ybGQhIFRoaXMgaXMgYmFzZTY0IQ==")).toBe(
        true,
      );
    });
  });

  describe("entropy density", () => {
    it("rejects skewed distributions even when long", () => {
      expect(hasHighEntropy("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab1")).toBe(false);
    });

    it("accepts uniformly distributed random strings", () => {
      expect(hasHighEntropy("Kj8#mQ2$vX9!pL4@nR7%tY1^wZ6&bC3*")).toBe(true);
    });

    it("honors a custom minBitsPerChar option", () => {
      const s = "Kj8#mQ2$vX9!pL4@nR7%tY1^wZ6&bC3*"; // entropy ≈ 5.0
      expect(hasHighEntropy(s, { minBitsPerChar: 4.0 })).toBe(true);
      expect(hasHighEntropy(s, { minBitsPerChar: 5.5 })).toBe(false);
    });
  });

  describe("real-shaped secrets", () => {
    it("accepts a GitHub personal access token", () => {
      expect(hasHighEntropy("ghp_16C7e42F292c6912E7710c838347Ae178B4a")).toBe(
        true,
      );
    });

    it("accepts an MD5 hash", () => {
      expect(hasHighEntropy("d41d8cd98f00b204e9800998ecf8427e")).toBe(true);
    });

    it("accepts a SHA-256 hash", () => {
      expect(
        hasHighEntropy(
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        ),
      ).toBe(true);
    });

    it("accepts a JWT-ish segment", () => {
      expect(
        hasHighEntropy(
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0",
        ),
      ).toBe(true);
    });
  });

  describe("dictionary-like words", () => {
    it("rejects common single words", () => {
      expect(hasHighEntropy("password")).toBe(false);
      expect(hasHighEntropy("helloworld")).toBe(false);
    });

    it("rejects short natural-language phrases", () => {
      expect(hasHighEntropy("correcthorsebattery")).toBe(false);
    });

    it("rejects words with only a couple of classes", () => {
      expect(hasHighEntropy("PasswordPassword123")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      expect(hasHighEntropy("")).toBe(false);
    });

    it("handles whitespace-only strings", () => {
      expect(hasHighEntropy("                    ")).toBe(false);
    });

    it("handles unicode", () => {
      expect(hasHighEntropy("🔐🔑🛡️🔒🎯🚀🌟💡🧩🎨")).toBe(false);
    });

    it("is deterministic", () => {
      const input = "xK9$mP2qL8nR7@wZ1!";
      expect(hasHighEntropy(input)).toBe(hasHighEntropy(input));
    });
  });

  describe("option overrides", () => {
    it("supports a fully permissive configuration", () => {
      expect(
        hasHighEntropy("xK9$mP2qL8nR", {
          minLength: 8,
          minBitsPerChar: 2.5,
          minClasses: 3,
          minEntropyRatio: 0.7,
        }),
      ).toBe(true);
    });

    it("supports a fully strict configuration", () => {
      expect(hasHighEntropy("xK9$mP2qL8nR7@wZ1!bC4&", { minLength: 32 })).toBe(
        false,
      );
    });
  });
});
