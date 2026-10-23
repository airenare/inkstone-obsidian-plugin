import { describe, expect, it } from "vitest";
import {
  fieldVisibility,
  noteFileBase,
  planCreation,
  type CreateRequest,
  type CreationPlan,
  type PlanContext,
} from "../src/createNoteLogic";
import type { SiteNote } from "../src/siteIndex";

const n = (path: string, fm: Record<string, unknown> = {}): SiteNote => ({
  path,
  fm,
});

function ctx(over: Partial<PlanContext> = {}): PlanContext {
  return {
    siteRel: "site",
    notes: [n("Home.md", { type: "homepage" })],
    exists: () => false,
    today: "2026-10-23",
    ...over,
  };
}

function ok(req: CreateRequest, c: PlanContext): CreationPlan {
  const r = planCreation(req, c);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.plan;
}

function err(req: CreateRequest, c: PlanContext): string {
  const r = planCreation(req, c);
  if (r.ok) throw new Error("expected an error");
  return r.error;
}

describe("noteFileBase", () => {
  it("drops filename-illegal characters and keeps the rest", () => {
    expect(noteFileBase('Plan: A "test"')).toEqual({
      ok: true,
      name: "Plan A test",
    });
    expect(noteFileBase("Café notes")).toEqual({
      ok: true,
      name: "Café notes",
    });
  });

  it("returns the sanitizer's reason", () => {
    const r = noteFileBase("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("Name can't be empty");
    const dot = noteFileBase(".hidden");
    expect(dot.ok).toBe(false);
    if (!dot.ok) expect(dot.reason).toBe("Name can't start with a dot");
  });
});

describe("planCreation: page and book", () => {
  it("quotes a title with a colon and quotes", () => {
    const plan = ok(
      { type: "page", name: 'Plan: A "test"', folder: "site" },
      ctx(),
    );
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0].path).toBe("site/Plan A test.md");
    expect(plan.files[0].content).toContain(
      'title: "Plan: A \\"test\\""',
    );
    expect(plan.files[0].content).toContain("website: true");
    expect(plan.files[0].content).toContain("date: 2026-10-23");
    expect(plan.openPath).toBe("site/Plan A test.md");
    expect(plan.warnings).toEqual([]);
    expect(plan.notices).toEqual([]);
  });

  it("refuses an existing target and plans nothing", () => {
    const r = planCreation(
      { type: "page", name: "About", folder: "site" },
      ctx({ exists: (p) => p === "site/About.md" }),
    );
    expect(r).toEqual({ ok: false, error: "site/About.md already exists." });
  });

  it("rejects an invalid name with the sanitizer's reason", () => {
    expect(err({ type: "page", name: "  ", folder: "site" }, ctx())).toBe(
      "Name can't be empty",
    );
  });

  it("refuses a folder outside the site", () => {
    expect(
      err({ type: "page", name: "A", folder: "elsewhere" }, ctx()),
    ).toMatch(/outside the site folder/);
  });

  it("works when the site folder is the vault root", () => {
    const plan = ok(
      { type: "page", name: "About", folder: "", navigation: true },
      ctx({ siteRel: "", notes: [] }),
    );
    expect(plan.files[0].path).toBe("About.md");
    expect(plan.files[0].content).toContain("menu_order: 1");
  });

  it("menu_order is max+1 across visible notes", () => {
    const notes = [
      n("Home.md", { type: "homepage" }),
      n("About.md", { menu_order: 2 }),
      n("blog/Deep.md", { menu_order: 7 }),
      n("Draft_RU.md", { menu_order: 4 }),
      n(".trash/Old.md", { menu_order: 99 }),
      n("templates/T.md", { menu_order: 50 }),
    ];
    const plan = ok(
      { type: "page", name: "Contact", folder: "site", navigation: true },
      ctx({ notes }),
    );
    expect(plan.files[0].content).toContain("menu_order: 8");
  });

  it("navigation off writes no menu_order", () => {
    const plan = ok(
      { type: "page", name: "Contact", folder: "site" },
      ctx(),
    );
    expect(plan.files[0].content).not.toContain("menu_order");
  });

  it("navigation on a page in blog/ writes no menu_order", () => {
    const plan = ok(
      { type: "page", name: "Post", folder: "site/blog", navigation: true },
      ctx(),
    );
    expect(plan.files[0].path).toBe("site/blog/Post.md");
    expect(plan.files[0].content).not.toContain("menu_order");
  });

  it("private page without a token is refused", () => {
    expect(
      err(
        { type: "page", name: "Secret", folder: "site", isPrivate: true },
        ctx(),
      ),
    ).toMatch(/token/i);
    expect(
      err(
        {
          type: "page",
          name: "Secret",
          folder: "site",
          isPrivate: true,
          token: "   ",
        },
        ctx(),
      ),
    ).toMatch(/token/i);
  });

  it("private page writes access_token, no website, no menu_order", () => {
    const plan = ok(
      {
        type: "page",
        name: "Secret",
        folder: "site",
        isPrivate: true,
        token: "abc123",
        navigation: true,
      },
      ctx(),
    );
    const c = plan.files[0].content;
    expect(c).toContain("access_token: abc123");
    expect(c).not.toContain("website");
    expect(c).not.toContain("menu_order");
  });

  it("book writes type book with tags and summary", () => {
    const plan = ok(
      {
        type: "book",
        name: "Dune",
        folder: "site/books",
        tags: ["scifi"],
        summary: "Sand: lots",
      },
      ctx(),
    );
    const c = plan.files[0].content;
    expect(c).toContain("type: book");
    expect(c).toContain("  - scifi");
    expect(c).toContain('summary: "Sand: lots"');
  });

  it("linkName only with insertLink", () => {
    const withLink = ok(
      {
        type: "page",
        name: 'Plan: A "test"',
        folder: "site",
        insertLink: true,
      },
      ctx(),
    );
    expect(withLink.linkName).toBe("Plan A test");
    const without = ok(
      { type: "page", name: "About", folder: "site" },
      ctx(),
    );
    expect(without.linkName).toBeUndefined();
  });
});

describe("planCreation: homepage", () => {
  it("refuses a second root homepage", () => {
    expect(
      err({ type: "homepage", name: "Home", folder: "site" }, ctx()),
    ).toMatch(/already has a homepage/);
  });

  it("root homepage is Home.md with root fields", () => {
    const plan = ok(
      {
        type: "homepage",
        name: "My site",
        folder: "site",
        defaultTheme: "dark",
        showSearch: true,
        showTags: false,
        siteTitle: "ignored",
      },
      ctx({ notes: [] }),
    );
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0].path).toBe("site/Home.md");
    const c = plan.files[0].content;
    expect(c).toContain("type: homepage");
    expect(c).toContain("title: My site");
    expect(c).toContain("default_theme: dark");
    expect(c).toContain("show_search: true");
    expect(c).toContain("show_tags: false");
    expect(c).not.toContain("site_title");
    expect(c).not.toContain("language");
  });

  it("root homepage keeps a colon title and rejects an empty name", () => {
    const plan = ok(
      { type: "homepage", name: "Notes: misc", folder: "site/" },
      ctx({ notes: [] }),
    );
    expect(plan.files[0].path).toBe("site/Home.md");
    expect(plan.files[0].content).toContain('title: "Notes: misc"');
    expect(
      err({ type: "homepage", name: " ", folder: "site" }, ctx({ notes: [] })),
    ).toBe("Name can't be empty");
  });

  it("root homepage with ru plans the translations note too", () => {
    const plan = ok(
      { type: "homepage", name: "Сайт", folder: "site", language: "Ru" },
      ctx({ notes: [] }),
    );
    expect(plan.files.map((f) => f.path)).toEqual([
      "site/Home.md",
      "site/translations_RU.md",
    ]);
    expect(plan.files[0].content).toContain("language: ru");
    expect(plan.files[1].content).toContain("type: translations");
    expect(plan.files[1].content).toContain("lang: ru");
    expect(plan.openPath).toBe("site/Home.md");
    expect(plan.notices).toEqual([]);
  });

  it("reuses an existing ru translations note", () => {
    const notes = [n("RU strings.md", { type: "translations", lang: "ru" })];
    const plan = ok(
      { type: "homepage", name: "Сайт", folder: "site", language: "ru" },
      ctx({ notes }),
    );
    expect(plan.files.map((f) => f.path)).toEqual(["site/Home.md"]);
    expect(plan.notices).toHaveLength(1);
    expect(plan.notices[0]).toContain("site/RU strings.md");
    expect(plan.notices[0]).toMatch(/reus/i);
  });

  it("EN plans one file", () => {
    const plan = ok(
      { type: "homepage", name: "Site", folder: "site", language: "EN" },
      ctx({ notes: [] }),
    );
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0].content).toContain("language: en");
  });

  it("blank language writes no language key", () => {
    const plan = ok(
      { type: "homepage", name: "Site", folder: "site", language: "  " },
      ctx({ notes: [] }),
    );
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0].content).not.toContain("language");
  });

  it("rejects an invalid language", () => {
    expect(
      err(
        { type: "homepage", name: "Site", folder: "site", language: "r u" },
        ctx({ notes: [] }),
      ),
    ).toMatch(/language/i);
  });

  it("refuses when the translations note path exists", () => {
    const r = planCreation(
      { type: "homepage", name: "Site", folder: "site", language: "ru" },
      ctx({ notes: [], exists: (p) => p === "site/translations_RU.md" }),
    );
    expect(r).toEqual({
      ok: false,
      error: "site/translations_RU.md already exists.",
    });
  });

  it("root homepage when the site is the vault root", () => {
    const plan = ok(
      { type: "homepage", name: "Site", folder: "", language: "ru" },
      ctx({ siteRel: "", notes: [] }),
    );
    expect(plan.files.map((f) => f.path)).toEqual([
      "Home.md",
      "translations_RU.md",
    ]);
  });

  it("second root homepage refused when site is the vault root", () => {
    expect(
      err(
        { type: "homepage", name: "Site", folder: "" },
        ctx({ siteRel: "", notes: [n("Index.md", { type: "homepage" })] }),
      ),
    ).toMatch(/already has a homepage/);
  });

  it("secondary homepage uses the name and section fields", () => {
    const plan = ok(
      {
        type: "homepage",
        name: "Gallery",
        folder: "site/gallery",
        siteTitle: "My gallery",
        icon: "gallery/_attachments/icon.png",
        theme: "omarchy",
        navigation: true,
        language: "ru",
      },
      ctx(),
    );
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0].path).toBe("site/gallery/Gallery.md");
    const c = plan.files[0].content;
    expect(c).toContain("site_title: My gallery");
    expect(c).toContain("icon: gallery/_attachments/icon.png");
    expect(c).toContain("theme: omarchy");
    expect(c).toContain("nav_hidden: true");
    expect(c).not.toContain("language");
  });

  it("secondary homepage warns when the folder already has one", () => {
    const notes = [
      n("Home.md", { type: "homepage" }),
      n("gallery/Old.md", { type: "homepage" }),
    ];
    const plan = ok(
      { type: "homepage", name: "Gallery", folder: "site/gallery" },
      ctx({ notes }),
    );
    expect(plan.files).toHaveLength(1);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toMatch(/homepage/);
  });
});

describe("planCreation: listing and feed", () => {
  it("listing in a top-level folder hides from navigation", () => {
    const plan = ok(
      {
        type: "listing",
        name: "Blog",
        folder: "site/blog",
        navigation: true,
      },
      ctx(),
    );
    expect(plan.files[0].path).toBe("site/blog/Blog.md");
    expect(plan.files[0].content).toContain("type: listing");
    expect(plan.files[0].content).toContain("nav_hidden: true");
    expect(plan.warnings).toEqual([]);
  });

  it("feed deeper than top level ignores navigation", () => {
    const plan = ok(
      {
        type: "feed",
        name: "Arts",
        folder: "site/gallery/arts",
        navigation: true,
      },
      ctx(),
    );
    expect(plan.files[0].content).toContain("type: feed");
    expect(plan.files[0].content).not.toContain("nav_hidden");
  });

  it("warns, not errors, on a second listing in a folder", () => {
    const notes = [
      n("Home.md", { type: "homepage" }),
      n("blog/Blog.md", { type: "listing" }),
      n("blog/Stream.md", { type: "feed" }),
    ];
    const plan = ok(
      { type: "listing", name: "Posts", folder: "site/blog" },
      ctx({ notes }),
    );
    expect(plan.files).toHaveLength(1);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toMatch(/listing/);
    const feed = ok(
      { type: "feed", name: "Stream2", folder: "site/blog" },
      ctx({ notes }),
    );
    expect(feed.warnings).toHaveLength(1);
    const other = ok(
      { type: "listing", name: "Posts", folder: "site/news" },
      ctx({ notes }),
    );
    expect(other.warnings).toEqual([]);
  });

  it("vault-root site: listing in blog/ hides from navigation", () => {
    const plan = ok(
      { type: "listing", name: "Blog", folder: "blog", navigation: true },
      ctx({ siteRel: "" }),
    );
    expect(plan.files[0].path).toBe("blog/Blog.md");
    expect(plan.files[0].content).toContain("nav_hidden: true");
  });
});

describe("planCreation: translations", () => {
  it("lands in the site root regardless of folder", () => {
    const plan = ok(
      {
        type: "translations",
        name: "",
        folder: "site/blog",
        language: "pt-BR",
        insertLink: true,
      },
      ctx(),
    );
    expect(plan.files.map((f) => f.path)).toEqual([
      "site/translations_PT-BR.md",
    ]);
    expect(plan.files[0].content).toContain("lang: pt-BR");
    expect(plan.openPath).toBe("site/translations_PT-BR.md");
    expect(plan.linkName).toBeUndefined();
  });

  it("refuses an existing translations file", () => {
    expect(
      err(
        { type: "translations", name: "", folder: "site", language: "ru" },
        ctx({ exists: (p) => p === "site/translations_RU.md" }),
      ),
    ).toBe("site/translations_RU.md already exists.");
  });

  it("refuses when another note already holds that language", () => {
    const notes = [n("ru.md", { type: "translations", lang: "ru" })];
    expect(
      err(
        { type: "translations", name: "", folder: "site", language: "RU" },
        ctx({ notes }),
      ),
    ).toMatch(/site\/ru\.md/);
  });

  it("requires a language", () => {
    expect(
      err({ type: "translations", name: "", folder: "site" }, ctx()),
    ).toMatch(/language/i);
  });
});

describe("planCreation: variant", () => {
  const about = {
    path: "site/About.md",
    fm: { website: true, title: "About", menu_order: 2, tags: ["me"] },
  };

  it("About.md + ru → About_RU.md with lang and translations", () => {
    const plan = ok(
      {
        type: "variant",
        name: "",
        folder: "",
        language: "ru",
        variantSource: about,
        alsoTranslations: true,
        insertLink: true,
      },
      ctx(),
    );
    expect(plan.files.map((f) => f.path)).toEqual([
      "site/About_RU.md",
      "site/translations_RU.md",
    ]);
    const c = plan.files[0].content;
    expect(c).toContain("lang: ru");
    expect(c).toContain("title: About");
    expect(c).not.toContain("menu_order");
    expect(plan.openPath).toBe("site/About_RU.md");
    expect(plan.linkName).toBe("About_RU");
  });

  it("without alsoTranslations plans one file", () => {
    const plan = ok(
      {
        type: "variant",
        name: "",
        folder: "",
        language: "ru",
        variantSource: about,
      },
      ctx(),
    );
    expect(plan.files).toHaveLength(1);
  });

  it("reuses an existing translations note", () => {
    const notes = [n("translations_RU.md", { type: "translations", lang: "ru" })];
    const plan = ok(
      {
        type: "variant",
        name: "",
        folder: "",
        language: "ru",
        variantSource: about,
        alsoTranslations: true,
      },
      ctx({ notes }),
    );
    expect(plan.files.map((f) => f.path)).toEqual(["site/About_RU.md"]);
    expect(plan.notices[0]).toMatch(/reus/i);
  });

  it("English variant needs no translations note", () => {
    const plan = ok(
      {
        type: "variant",
        name: "",
        folder: "",
        language: "en",
        variantSource: { path: "site/blog/Пост.md", fm: { title: "Пост" } },
        alsoTranslations: true,
      },
      ctx(),
    );
    expect(plan.files.map((f) => f.path)).toEqual(["site/blog/Пост_EN.md"]);
  });

  it("non two-letter codes use Name (code).md", () => {
    const plan = ok(
      {
        type: "variant",
        name: "",
        folder: "",
        language: "PT-BR",
        variantSource: { path: "site/blog/Name.md", fm: { title: "Name" } },
      },
      ctx(),
    );
    expect(plan.files[0].path).toBe("site/blog/Name (pt-BR).md");
    expect(plan.files[0].content).toContain("lang: pt-BR");
    expect(plan.files[0].content).not.toContain("website");
  });

  it("refuses an existing variant", () => {
    expect(
      err(
        {
          type: "variant",
          name: "",
          folder: "",
          language: "ru",
          variantSource: about,
          alsoTranslations: true,
        },
        ctx({ exists: (p) => p === "site/About_RU.md" }),
      ),
    ).toBe("site/About_RU.md already exists.");
  });

  it("needs a source inside the site", () => {
    expect(
      err(
        { type: "variant", name: "", folder: "", language: "ru" },
        ctx(),
      ),
    ).toMatch(/note/i);
    expect(
      err(
        {
          type: "variant",
          name: "",
          folder: "",
          language: "ru",
          variantSource: { path: "other/About.md", fm: {} },
        },
        ctx(),
      ),
    ).toMatch(/outside the site folder/);
  });

  it("vault-root site variant", () => {
    const plan = ok(
      {
        type: "variant",
        name: "",
        folder: "",
        language: "ru",
        variantSource: { path: "About.md", fm: { title: "About" } },
        alsoTranslations: true,
      },
      ctx({ siteRel: "" }),
    );
    expect(plan.files.map((f) => f.path)).toEqual([
      "About_RU.md",
      "translations_RU.md",
    ]);
  });
});

describe("fieldVisibility", () => {
  const base = { folder: "site" };

  it("page at the site root", () => {
    expect(fieldVisibility("page", base, "site", true)).toEqual({
      name: true,
      folder: false,
      location: true,
      private: true,
      token: false,
      navigation: "add",
      language: false,
      homepageRoot: false,
      homepageSection: false,
      insertLink: true,
    });
  });

  it("private book in a subfolder", () => {
    const v = fieldVisibility(
      "book",
      { folder: "site/books", isPrivate: true },
      "site",
      false,
    );
    expect(v.private).toBe(true);
    expect(v.token).toBe(true);
    expect(v.navigation).toBe("none");
    expect(v.location).toBe(true);
    expect(v.insertLink).toBe(false);
  });

  it("private page at the root hides navigation", () => {
    const v = fieldVisibility(
      "page",
      { folder: "site", isPrivate: true },
      "site",
      true,
    );
    expect(v.navigation).toBe("none");
  });

  it("listing and feed", () => {
    for (const t of ["listing", "feed"] as const) {
      const top = fieldVisibility(t, { folder: "site/blog" }, "site", true);
      expect(top).toEqual({
        name: true,
        folder: true,
        location: false,
        private: false,
        token: false,
        navigation: "hide",
        language: false,
        homepageRoot: false,
        homepageSection: false,
        insertLink: true,
      });
      expect(
        fieldVisibility(t, { folder: "site/a/b" }, "site", true).navigation,
      ).toBe("none");
      expect(
        fieldVisibility(t, { folder: "site" }, "site", true).navigation,
      ).toBe("none");
    }
  });

  it("root homepage", () => {
    expect(fieldVisibility("homepage", base, "site", true)).toEqual({
      name: true,
      folder: true,
      location: false,
      private: false,
      token: false,
      navigation: "none",
      language: true,
      homepageRoot: true,
      homepageSection: false,
      insertLink: true,
    });
  });

  it("secondary homepage", () => {
    const v = fieldVisibility(
      "homepage",
      { folder: "site/gallery" },
      "site",
      true,
    );
    expect(v.homepageRoot).toBe(false);
    expect(v.homepageSection).toBe(true);
    expect(v.navigation).toBe("hide");
    expect(v.language).toBe(false);
    expect(v.private).toBe(false);
  });

  it("translations", () => {
    expect(fieldVisibility("translations", base, "site", true)).toEqual({
      name: false,
      folder: false,
      location: false,
      private: false,
      token: false,
      navigation: "none",
      language: true,
      homepageRoot: false,
      homepageSection: false,
      insertLink: false,
    });
  });

  it("variant", () => {
    expect(fieldVisibility("variant", base, "site", true)).toEqual({
      name: false,
      folder: false,
      location: false,
      private: false,
      token: false,
      navigation: "none",
      language: true,
      homepageRoot: false,
      homepageSection: false,
      insertLink: true,
    });
  });

  it("vault-root site", () => {
    expect(
      fieldVisibility("page", { folder: "" }, "", true).navigation,
    ).toBe("add");
    expect(
      fieldVisibility("listing", { folder: "blog" }, "", true).navigation,
    ).toBe("hide");
    expect(fieldVisibility("homepage", { folder: "" }, "", true).homepageRoot)
      .toBe(true);
  });

  it("folder outside the site shows no navigation", () => {
    expect(
      fieldVisibility("page", { folder: "other" }, "site", true).navigation,
    ).toBe("none");
  });
});
