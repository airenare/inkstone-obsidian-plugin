import { describe, expect, it } from "vitest";
import {
  depthOf,
  folderLabel,
  siteSettingFor,
  sortFolders,
} from "../src/vaultFolders";

const root = { path: "/", isRoot: true };
const f = (path: string) => ({ path, isRoot: false });

describe("vault folder helpers", () => {
  it("stores the vault root as '.', never '/' (which means the disk root)", () => {
    expect(siteSettingFor(root)).toBe(".");
  });

  it("stores other folders as their vault-relative path", () => {
    expect(siteSettingFor(f("Sites/blog"))).toBe("Sites/blog");
  });

  it("measures depth: root 0, top-level 1, nested 2+", () => {
    expect(depthOf(root)).toBe(0);
    expect(depthOf(f("Sites"))).toBe(1);
    expect(depthOf(f("Sites/blog"))).toBe(2);
    expect(depthOf(f("a/b/c"))).toBe(3);
  });

  it("labels the root and uses the last segment otherwise", () => {
    expect(folderLabel(root)).toBe("Vault root");
    expect(folderLabel(f("Sites/blog"))).toBe("blog");
  });

  it("sorts like a tree: root first, parents before children, case-insensitive", () => {
    const sorted = sortFolders([
      f("zeta"),
      f("Sites/blog"),
      f("sites"),
      root,
      f("Alpha/b"),
      f("alpha"),
    ]).map((x) => x.path);
    expect(sorted).toEqual(["/", "alpha", "Alpha/b", "sites", "Sites/blog", "zeta"]);
  });

  it("handles non-ASCII folder names", () => {
    expect(depthOf(f("Сайт/Блог"))).toBe(2);
    expect(folderLabel(f("Сайт/Блог"))).toBe("Блог");
  });
});
