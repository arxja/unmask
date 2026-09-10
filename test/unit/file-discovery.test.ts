import { describe, it, expect, vi, beforeEach } from "vitest";
import fg from "fast-glob";
import { discoverFiles } from "../../src/discovery/file-discovery";

vi.mock("fast-glob", () => ({
  default: { sync: vi.fn().mockReturnValue([]) },
}));

const mockSync = vi.mocked(fg.sync);

type FgCall = Parameters<typeof fg.sync>;
type FgOptions = NonNullable<FgCall[1]>;

function lastCall(): [FgCall[0], FgOptions] {
  const call = mockSync.mock.calls.at(-1);
  if (!call || !call[1])
    throw new Error("fast-glob was never called with options");
  return [call[0], call[1]];
}

describe("discoverFiles", () => {
  beforeEach(() => {
    mockSync.mockClear();
    mockSync.mockReturnValue([]);
  });

  it("includes default ignore patterns", () => {
    discoverFiles("/some/dir");

    expect(mockSync).toHaveBeenCalledWith(
      "**/*",
      expect.objectContaining({
        cwd: "/some/dir",
        ignore: expect.arrayContaining([
          "node_modules/**",
          ".git/**",
          "dist/**",
        ]),
      }),
    );
  });

  it("appends user ignore patterns to defaults", () => {
    discoverFiles("/some/dir", { ignore: ["*.tmp"] });

    const [, opts] = lastCall();
    expect(opts.ignore).toContain("*.tmp");
    expect(opts.ignore).toContain("node_modules/**");
  });

  it("respects the dot option", () => {
    discoverFiles("/some/dir", { dot: true });
    const [, opts] = lastCall();
    expect(opts.dot).toBe(true);
  });
});
