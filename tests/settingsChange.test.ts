import { describe, expect, it } from "vitest";
import { serverSettingsChanged } from "../src/settingsChange";
import type { InkStoneSettings } from "../src/settings";

const base: InkStoneSettings = {
  siteFolder: "/site",
  inkstoneCheckout: "/inkstone",
  pythonPath: "",
  autoStartServer: false,
};

describe("serverSettingsChanged", () => {
  it("is false when nothing the server uses changed", () => {
    expect(serverSettingsChanged(base, { ...base })).toBe(false);
    expect(
      serverSettingsChanged(base, { ...base, autoStartServer: true }),
    ).toBe(false);
  });

  it("ignores surrounding whitespace", () => {
    expect(
      serverSettingsChanged(base, { ...base, siteFolder: " /site " }),
    ).toBe(false);
  });

  it("is true for the site folder, checkout or python path", () => {
    expect(serverSettingsChanged(base, { ...base, siteFolder: "/b" })).toBe(
      true,
    );
    expect(
      serverSettingsChanged(base, { ...base, inkstoneCheckout: "/i2" }),
    ).toBe(true);
    expect(serverSettingsChanged(base, { ...base, pythonPath: "/py" })).toBe(
      true,
    );
  });
});
