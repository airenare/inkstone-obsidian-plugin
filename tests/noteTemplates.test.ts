import { describe, expect, it } from "vitest";
import {
  buildNote,
  buildTranslations,
  buildVariant,
  generateToken,
  renderFrontmatter,
  todayIso,
  yamlString,
} from "../src/noteTemplates";
import { TRANSLATION_KEYS } from "../src/translationStrings";

describe("yamlString", () => {
  it("quotes and escapes special strings", () => {
    expect(yamlString('Plan: A "test"')).toBe('"Plan: A \\"test\\""');
    expect(yamlString("")).toBe('""');
    expect(yamlString("-x")).toBe('"-x"');
    expect(yamlString("x ")).toBe('"x "');
    expect(yamlString("{day}")).toBe('"{day}"');
  });
  it("leaves plain strings alone", () => {
    expect(yamlString("Plain title")).toBe("Plain title");
    expect(yamlString("3 ways to cook")).toBe("3 ways to cook");
    expect(yamlString("Yesterday")).toBe("Yesterday");
  });
  it("quotes YAML 1.1 booleans and null, any case", () => {
    for (const w of [
      "yes", "No", "ON", "off", "y", "N", "true", "False", "null", "NULL", "~",
    ]) {
      expect(yamlString(w)).toBe(`"${w}"`);
    }
  });
  it("quotes numbers of every YAML flavor", () => {
    for (const n of [
      "2026", "1234", "0", "3.14", "1_000", "0x1F", "0o17", "0b101",
      "1e5", "1.5e-3", ".5", ".inf", ".NaN", "+1", "1.",
    ]) {
      expect(yamlString(n)).toBe(`"${n}"`);
    }
  });
  it("quotes anything that starts like a date", () => {
    expect(yamlString("2026-10-23")).toBe('"2026-10-23"');
    expect(yamlString("2026-10-23 notes")).toBe('"2026-10-23 notes"');
  });
  it("escapes newlines, carriage returns and tabs", () => {
    expect(yamlString("a\nb")).toBe('"a\\nb"');
    expect(yamlString("one\ntwo")).toBe('"one\\ntwo"');
    expect(yamlString("one\ntwo\r\tthree")).toBe(
      '"one\\ntwo\\r\\tthree"',
    );
  });
});

describe("renderFrontmatter", () => {
  it("skips undefined and renders arrays", () => {
    expect(
      renderFrontmatter([
        ["a", "x"],
        ["b", undefined],
        ["c", true],
        ["d", 3],
        ["tags", ["one", "two"]],
      ]),
    ).toBe("---\na: x\nc: true\nd: 3\ntags:\n  - one\n  - two\n---\n");
  });
});

describe("generateToken", () => {
  it("returns 22 url-safe chars, different each time", () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(generateToken()).not.toBe(a);
  });
  it("accepts a random source", () => {
    const t = generateToken((n) => new Uint8Array(n).fill(255));
    expect(t).toBe("_____________________w");
  });
});

describe("todayIso", () => {
  it("formats local date", () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("buildNote", () => {
  it("private page uses access_token and no website", () => {
    const s = buildNote({
      type: "page",
      title: "Hi",
      date: "2026-10-23",
      privateToken: "abc",
    });
    expect(s).toContain("access_token: abc");
    expect(s).not.toContain("website");
    expect(s).not.toContain("type:");
  });
  it("public page has website and optional fields in order", () => {
    const s = buildNote({
      type: "page",
      title: "Hi",
      date: "2026-10-23",
      tags: ["a"],
      summary: "S",
      menuOrder: 2,
    });
    expect(s).toBe(
      "---\nwebsite: true\ntitle: Hi\ndate: 2026-10-23\ntags:\n  - a\n" +
        "summary: S\nmenu_order: 2\n---\n",
    );
  });
  it("quotes risky values but keeps date bare", () => {
    const s = buildNote({
      type: "page",
      title: "2026",
      date: "2026-10-23",
      tags: ["true", "plain"],
      summary: "Line one\nLine two",
      privateToken: "1234",
    });
    expect(s).toBe(
      '---\ntitle: "2026"\ndate: 2026-10-23\ntags:\n  - "true"\n' +
        '  - plain\nsummary: "Line one\\nLine two"\n' +
        'access_token: "1234"\n---\n',
    );
  });
  it("book writes type", () => {
    const s = buildNote({ type: "book", title: "B", date: "2026-10-23" });
    expect(s).toContain("type: book");
  });
  it("root homepage", () => {
    const s = buildNote({
      type: "homepage",
      title: "Home",
      root: true,
      language: "ru",
      siteTitle: "ignored",
    });
    expect(s).toContain("language: ru");
    expect(s).not.toContain("site_title");
  });
  it("secondary homepage", () => {
    const s = buildNote({
      type: "homepage",
      title: "Sec",
      root: false,
      language: "ru",
      siteTitle: "Site",
    });
    expect(s).toContain("site_title: Site");
    expect(s).not.toContain("language");
  });
  it("listing nav_hidden", () => {
    const s = buildNote({ type: "listing", title: "L", navHidden: true });
    expect(s).toBe(
      "---\nwebsite: true\ntype: listing\ntitle: L\nnav_hidden: true\n---\n",
    );
  });
});

describe("buildVariant", () => {
  it("drops object-valued fields instead of stringifying them", () => {
    let s = "";
    expect(() => {
      s = buildVariant(
        { title: { a: "b" }, summary: { c: 1 }, slug: "t" },
        "ru",
      );
    }).not.toThrow();
    expect(s).toBe("---\nslug: t\nlang: ru\n---\n");
  });

  it("keeps only primitive array items", () => {
    const s = buildVariant(
      { tags: ["a", 2, true, { x: 1 }, null, ["n"]] },
      "ru",
    );
    expect(s).toBe(
      '---\ntags:\n  - a\n  - "2"\n  - "true"\nlang: ru\n---\n',
    );
  });

  it("writes a source date bare", () => {
    expect(buildVariant({ date: "2026-10-23" }, "ru")).toBe(
      "---\ndate: 2026-10-23\nlang: ru\n---\n",
    );
    expect(buildVariant({ date: new Date(2026, 0, 5) }, "ru")).toBe(
      "---\ndate: 2026-01-05\nlang: ru\n---\n",
    );
  });

  it("keeps allowed keys and appends lang", () => {
    const s = buildVariant(
      {
        website: true,
        title: "T",
        slug: "t",
        tags: ["x"],
        menu_order: 1,
        featured: true,
        access_token: "z",
      },
      "ru",
    );
    expect(s).toBe(
      "---\nwebsite: true\ntitle: T\nslug: t\ntags:\n  - x\nlang: ru\n---\n",
    );
  });
});

describe("buildTranslations", () => {
  it("ru has Russian values once per key", () => {
    const s = buildTranslations("ru");
    expect(s).toContain("type: translations\nlang: ru\n---\n\n```yaml\n");
    expect(s).toContain("Search: Поиск");
    for (const k of ["Updated", "All tags", "min read"]) {
      const re = new RegExp(`^"?${k}"?:`, "gm");
      expect(s.match(re)?.length).toBe(1);
    }
  });
  it("other languages list empty keys", () => {
    const s = buildTranslations("fr");
    expect(TRANSLATION_KEYS).toContain("date_format");
    for (const k of TRANSLATION_KEYS) {
      expect(s).toContain(`${k}: ""`);
    }
  });
});
