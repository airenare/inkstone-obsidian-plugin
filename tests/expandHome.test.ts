import { describe, expect, it } from "vitest";
import { expandHome, expandSettingsPaths, resolveSiteFolder } from "../src/paths";
import type { InkStoneSettings } from "../src/settings";

describe("expandHome", () => {
  it("expands a bare tilde and tilde-slash paths", () => {
    expect(expandHome("~", "/Users/a")).toBe("/Users/a");
    expect(expandHome("~/GitHubRepos/InkStone", "/Users/a")).toBe(
      "/Users/a/GitHubRepos/InkStone",
    );
  });

  it("expands tilde-backslash on Windows-style input", () => {
    expect(expandHome("~\\repos\\ink", "C:\\Users\\a")).toBe(
      "C:\\Users\\a\\repos\\ink",
    );
  });

  it("leaves other paths alone, including ~user and mid-path tildes", () => {
    expect(expandHome("/abs/~/x", "/Users/a")).toBe("/abs/~/x");
    expect(expandHome("~bob/x", "/Users/a")).toBe("~bob/x");
    expect(expandHome("rel/path", "/Users/a")).toBe("rel/path");
    expect(expandHome("", "/Users/a")).toBe("");
  });

  it("trims before expanding", () => {
    expect(expandHome("  ~/x ", "/Users/a")).toBe("/Users/a/x");
  });
});

describe("expandSettingsPaths", () => {
  it("expands site folder, checkout and python path only", () => {
    const s: InkStoneSettings = {
      siteFolder: "~/site",
      inkstoneCheckout: "~/InkStone",
      pythonPath: "~/InkStone/.venv/bin/python3",
      autoStartServer: true,
    };
    expect(expandSettingsPaths(s, "/Users/a")).toEqual({
      siteFolder: "/Users/a/site",
      inkstoneCheckout: "/Users/a/InkStone",
      pythonPath: "/Users/a/InkStone/.venv/bin/python3",
      autoStartServer: true,
    });
  });
});

describe("resolveSiteFolder with ~", () => {
  it("treats ~/x as absolute under the home directory", () => {
    expect(resolveSiteFolder("~/site", null, "darwin", "/Users/a")).toBe(
      "/Users/a/site",
    );
  });
});
