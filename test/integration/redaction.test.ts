import { describe, it, expect, beforeEach, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises");
vi.mock("../../src/discovery/file-discovery", () => ({
  discoverFiles: vi.fn(),
}));

import { discoverFiles } from "../../src/discovery/file-discovery";
import { scan } from "../../src/core/scan-runner";
import { TerminalReporter } from "../../src/report/terminal-reporter";
import { JsonReporter } from "../../src/report/json-reporter";
import type { Pattern } from "../../src/detection/regex-engine";

const mockDiscover = vi.mocked(discoverFiles);

const awsPattern: Pattern = {
  id: "aws-access-key-id",
  name: "AWS Access Key ID",
  provider: "aws",
  regex: "(AKIA[0-9A-Z]{16})",
  flags: "",
  confidence: "high",
  severity: "critical",
  entropyCheck: false,
};

// A real-shaped key. Not a real credential — the format is what matters.
const RAW_SECRET = "AKIAIOSFODNN7EXAMPLE";

function captureStream() {
  const chunks: string[] = [];
  return {
    stream: {
      write: (s: string) => {
        chunks.push(s);
        return true;
      },
    } as unknown as NodeJS.WritableStream,
    read: () => chunks.join(""),
  };
}

beforeEach(() => {
  vol.reset();
  mockDiscover.mockReset();
});

describe("redaction across the pipeline", () => {
  it("terminal output does not contain the raw secret", async () => {
    vol.fromJSON({
      "/root/config.ts": `export const awsKey = "${RAW_SECRET}";`,
    });
    mockDiscover.mockReturnValue(["/root/config.ts"]);

    const result = await scan({
      rootDir: "/root",
      patterns: [awsPattern],
      version: "test",
    });

    const { stream, read } = captureStream();
    new TerminalReporter({ stream, color: false, verbose: true }).report(
      result,
    );

    expect(read()).not.toContain(RAW_SECRET);
    // Sanity: something was reported.
    expect(read()).toMatch(/aws/);
  });

  it("JSON output does not contain the raw secret", async () => {
    vol.fromJSON({
      "/root/config.ts": `export const awsKey = "${RAW_SECRET}";`,
    });
    mockDiscover.mockReturnValue(["/root/config.ts"]);

    const result = await scan({
      rootDir: "/root",
      patterns: [awsPattern],
      version: "test",
    });

    const { stream, read } = captureStream();
    new JsonReporter({ pretty: false, stream }).report(result);

    const serialized = read();
    expect(serialized).not.toContain(RAW_SECRET);
    expect(JSON.parse(serialized).findings).toHaveLength(1);
  });
});
