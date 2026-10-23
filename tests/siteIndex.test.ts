import { describe, expect, it } from "vitest";
import {
  existingTranslations,
  hasRootHomepage,
  knownLanguages,
  menuOrders,
  sectionTypes,
  visibleNotes,
  type SiteNote,
} from "../src/siteIndex";

const n = (path: string, fm: Record<string, unknown> = {}): SiteNote => ({
  path,
  fm,
});

describe("visibleNotes", () => {
  it("drops hidden segments and top-level templates", () => {
    const notes = [
      n("a.md"),
      n(".obsidian/x.md"),
      n("blog/.hidden/y.md"),
      n("templates/t.md"),
      n("blog/templates/ok.md"),
    ];
    expect(visibleNotes(notes).map((x) => x.path)).toEqual([
      "a.md",
      "blog/templates/ok.md",
    ]);
  });
});

describe("hasRootHomepage", () => {
  it("detects only at the root", () => {
    expect(hasRootHomepage([n("Home.md", { type: "homepage" })])).toBe(true);
    expect(hasRootHomepage([n("blog/Home.md", { type: "homepage" })])).toBe(
      false,
    );
    expect(hasRootHomepage([n("a.md")])).toBe(false);
  });
});

describe("knownLanguages", () => {
  it("merges lang, filename suffix and root language", () => {
    const notes = [
      n("x.md", { lang: "ru" }),
      n("About_DE.md"),
      n("Home.md", { type: "homepage", language: "en" }),
      n("blog/Home.md", { type: "homepage", language: "fr" }),
      n("Notes_abc.md"),
    ];
    expect(knownLanguages(notes)).toEqual(["de", "en", "ru"]);
  });
  it("uses primary code of region tags", () => {
    expect(knownLanguages([n("a.md", { lang: "pt-BR" })])).toEqual(["pt"]);
  });
});

describe("menuOrders", () => {
  it("ignores non-numbers", () => {
    const notes = [
      n("a.md", { menu_order: 2 }),
      n("b.md", { menu_order: "3" }),
      n("c.md"),
      n("d/e.md", { menu_order: 5 }),
      n(".x/f.md", { menu_order: 9 }),
    ];
    expect(menuOrders(notes)).toEqual([2, 5]);
  });
});

describe("sectionTypes", () => {
  const notes = [
    n("Home.md", { type: "homepage" }),
    n("blog/Blog.md", { type: "listing" }),
    n("blog/p.md", { type: "page" }),
    n("blog/sub/Feed.md", { type: "feed" }),
  ];
  it("root", () => {
    expect(sectionTypes(notes, "")).toEqual(["homepage"]);
  });
  it("blog", () => {
    expect(sectionTypes(notes, "blog")).toEqual(["listing"]);
  });
});

describe("existingTranslations", () => {
  it("finds a matching translations note", () => {
    const notes = [
      n("t/ru.md", { type: "translations", lang: "ru" }),
      n("t/de.md", { type: "translations", lang: "de" }),
    ];
    expect(existingTranslations(notes, "RU")).toBe("t/ru.md");
    expect(existingTranslations(notes, "fr")).toBeNull();
  });
});
