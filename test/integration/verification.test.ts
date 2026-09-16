import { describe, it, expect, beforeEach, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises");
vi.mock("../../src/discovery/file-discovery", () => ({
  discoverFiles: vi.fn(),
}));

import { discoverFiles } from "../../src/discovery/file-discovery";
import { scan } from "../../src/core/scan-runner";
import type { Pattern } from "../../src/detection/regex-engine";

const mockDiscover = vi.mocked(discoverFiles);

const stripePattern: Pattern = {
  id: "stripe-secret-key",
  name: "Stripe Secret Key",
  provider: "stripe",
  regex: "(sk_live_[A-Za-z0-9]{24,})",
  flags: "",
  confidence: "high",
  severity: "critical",
  entropyCheck: false,
};

beforeEach(() => {
  vol.reset();
  mockDiscover.mockReset();
});

describe("verification integration", () => {
  it("drops a finding whose value is a placeholder", async () => {
    vol.fromJSON({
      "/root/config.ts":
        'export const key = "sk_live_aaaaaaaaaaaaaaaaaaaaaaaa";',
    });
    mockDiscover.mockReturnValue(["/root/config.ts"]);

    // The pattern matches the placeholder by shape. The verification
    // rule drops it by content (the repeated 'a's).
    const result = await scan({
      rootDir: "/root",
      patterns: [stripePattern],
      version: "test",
    });

    expect(result.findings).toHaveLength(0);
    expect(result.filesScanned).toBe(1);
  });

  it("keeps a finding with a real-shaped secret outside test paths", async () => {
    vol.fromJSON({
      "/root/config.ts":
        'export const key = "sk_live_51H8xKqLmN9pQrStUvWxYz012345";',
    });
    mockDiscover.mockReturnValue(["/root/config.ts"]);

    const result = await scan({
      rootDir: "/root",
      patterns: [stripePattern],
      version: "test",
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("critical");
  });

  it("downgrades severity for findings in test paths", async () => {
    vol.fromJSON({
      "/root/test/foo.ts":
        'export const key = "sk_live_51H8xKqLmN9pQrStUvWxYz012345";',
    });
    mockDiscover.mockReturnValue(["/root/test/foo.ts"]);

    const result = await scan({
      rootDir: "/root",
      patterns: [stripePattern],
      version: "test",
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("low");
  });

  it("still finds secrets in unparseable files", async () => {
    // A JSON file — not a supported language for the parser.
    vol.fromJSON({
      "/root/config.json": '{"key": "sk_live_51H8xKqLmN9pQrStUvWxYz012345"}',
    });
    mockDiscover.mockReturnValue(["/root/config.json"]);

    const result = await scan({
      rootDir: "/root",
      patterns: [stripePattern],
      version: "test",
    });

    // Path-based rules still ran; the parse-sensitive rules did not.
    expect(result.findings).toHaveLength(1);
  });
});
