import { describe, expect, it } from "vitest";
import { resolveSiteFolder } from "../src/paths";

describe("resolveSiteFolder", () => {
  it("uses an absolute posix path as is", () => {
    expect(resolveSiteFolder("/srv/site", "/vault", "darwin")).toBe(
      "/srv/site",
    );
    expect(resolveSiteFolder("/srv/site/", null, "linux")).toBe("/srv/site");
  });

  it("resolves a relative path against the vault", () => {
    expect(resolveSiteFolder("site", "/vault", "darwin")).toBe("/vault/site");
    expect(resolveSiteFolder("./a/b", "/vault/", "linux")).toBe(
      "/vault/a/b",
    );
  });

  it("handles .. segments", () => {
    expect(resolveSiteFolder("../other", "/home/x/vault", "darwin")).toBe(
      "/home/x/other",
    );
    expect(resolveSiteFolder("/srv/a/../b", null, "linux")).toBe("/srv/b");
  });

  it("returns null for an empty or blank setting", () => {
    expect(resolveSiteFolder("", "/vault", "darwin")).toBeNull();
    expect(resolveSiteFolder("   ", "/vault", "win32")).toBeNull();
  });

  it("returns null for a relative path without a vault base", () => {
    expect(resolveSiteFolder("site", null, "darwin")).toBeNull();
    expect(resolveSiteFolder("site", "", "darwin")).toBeNull();
    expect(resolveSiteFolder("site", "relative/vault", "linux")).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(resolveSiteFolder("  /srv/site  ", null, "darwin")).toBe(
      "/srv/site",
    );
  });

  it("uses Windows drive and UNC paths as is", () => {
    expect(resolveSiteFolder("C:\\Notes\\site\\", "D:\\v", "win32")).toBe(
      "C:\\Notes\\site",
    );
    expect(resolveSiteFolder("C:/Notes/site", null, "win32")).toBe(
      "C:\\Notes\\site",
    );
    expect(resolveSiteFolder("\\\\server\\share\\site", null, "win32")).toBe(
      "\\\\server\\share\\site",
    );
  });

  it("resolves Windows relative paths against the vault", () => {
    expect(resolveSiteFolder("site", "D:\\Vault", "win32")).toBe(
      "D:\\Vault\\site",
    );
    expect(resolveSiteFolder("..\\other", "D:\\Vault", "win32")).toBe(
      "D:\\other",
    );
    // Rooted without a drive: the vault's drive.
    expect(resolveSiteFolder("\\site", "D:\\Vault", "win32")).toBe(
      "D:\\site",
    );
  });

  it("refuses Windows paths that would depend on the cwd", () => {
    expect(resolveSiteFolder("C:site", "D:\\Vault", "win32")).toBeNull();
    expect(resolveSiteFolder("site", null, "win32")).toBeNull();
    expect(resolveSiteFolder("site", "Vault", "win32")).toBeNull();
  });
});
