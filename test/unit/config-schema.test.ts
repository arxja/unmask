import { ConfigSchema } from "../../src/config/schema";
import { describe, it, expect } from "vitest";

describe("configSchema", () => {
  it("validates a full config", () => {
    const valid = {
      ignore: ["mySecretes.txt", "secretes.ts"],
      customPatterns: "@/src/data/myPatterns.json",
    };

    expect(() => ConfigSchema.parse(valid)).not.toThrow();
  });

  it("rejects empty configurations", () => {
    const invalid = {
      ignore: [],
      customPatterns: "",
    };

    expect(() => ConfigSchema.parse(invalid)).toThrow();
  });

  it("rejects invalid config", () => {
    const invalid = {
      ignore: ["mySecretes.txt", 1],
      customPatterns: 25,
    };

    expect(() => ConfigSchema.parse(invalid)).toThrow();
  });
});
