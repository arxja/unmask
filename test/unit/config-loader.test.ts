import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cosmiconfig } from "cosmiconfig";
import { configLoader } from "../../src/config/load-config";
import { ConfigSchema } from "../../src/config/schema";

vi.mock("cosmiconfig", () => ({
  cosmiconfig: vi.fn(),
}));

const mockedCosmiconfig = vi.mocked(cosmiconfig);

/** Helper: build a fake explorer whose search() resolves to `result`. */
function fakeExplorer(result: unknown) {
  return { search: vi.fn().mockResolvedValue(result) };
}

describe("configLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // silence the console.error inside the catch block
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns schema defaults when no config file is found", async () => {
    mockedCosmiconfig.mockReturnValue(fakeExplorer(null) as any);

    const config = await configLoader();

    expect(config).toEqual(ConfigSchema.parse({}));
  });

  it("returns schema defaults when the config file is empty", async () => {
    mockedCosmiconfig.mockReturnValue(
      fakeExplorer({ isEmpty: true, config: undefined }) as any,
    );

    const config = await configLoader();

    expect(config).toEqual(ConfigSchema.parse({}));
  });

  it("returns the validated config when a valid file is found", async () => {
    const raw = { ignore: ["dist/**"], customPatterns: "patterns.json" };
    mockedCosmiconfig.mockReturnValue(
      fakeExplorer({ isEmpty: false, config: raw }) as any,
    );

    const config = await configLoader();

    expect(config).toEqual(raw);
  });

  it("throws when the file contents fail schema validation", async () => {
    mockedCosmiconfig.mockReturnValue(
      fakeExplorer({ isEmpty: false, config: { ignore: [1] } }) as any,
    );

    await expect(configLoader()).rejects.toThrow();
  });

  it("forwards searchFrom to explorer.search()", async () => {
    const explorer = fakeExplorer(null);
    mockedCosmiconfig.mockReturnValue(explorer as any);

    await configLoader("/some/dir");

    expect(explorer.search).toHaveBeenCalledWith("/some/dir");
  });

  it("propagates errors thrown by cosmiconfig", async () => {
    const explorer = {
      search: vi.fn().mockRejectedValue(new Error("boom")),
    };
    mockedCosmiconfig.mockReturnValue(explorer as any);

    await expect(configLoader()).rejects.toThrow("boom");
  });
});
