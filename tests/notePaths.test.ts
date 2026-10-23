import { describe, expect, it } from "vitest";
import {
  isEnglish,
  joinVaultPath,
  navKind,
  nextMenuOrder,
  normalizeLang,
  relativeToSite,
  sanitizeName,
  variantBaseName,
} from "../src/notePaths";

describe("sanitizeName", () => {
  it("rejects each forbidden character", () => {
    for (const ch of "\\/:*?\"<>|#^[]".split("")) {
      expect(sanitizeName(`a${ch}b`).ok).toBe(false);
    }
  });
  it("rejects empty, leading dot and trailing dot or space", () => {
    expect(sanitizeName("  ").ok).toBe(false);
    expect(sanitizeName(".hidden").ok).toBe(false);
    expect(sanitizeName("name. ").ok).toBe(false);
    expect(sanitizeName("name.").ok).toBe(false);
  });
  it("gives a reason", () => {
    const r = sanitizeName("a/b");
    expect(!r.ok && r.reason.length > 0).toBe(true);
  });
  it("accepts and trims Unicode and spaces", () => {
    expect(sanitizeName("  Мой пост 2 ")).toEqual({
      ok: true,
      name: "Мой пост 2",
    });
  });
});

describe("normalizeLang", () => {
  it("normalizes case", () => {
    expect(normalizeLang("EN")).toBe("en");
    expect(normalizeLang("Ru")).toBe("ru");
    expect(normalizeLang("pt-br")).toBe("pt-br");
    expect(normalizeLang("pt-BR")).toBe("pt-BR");
    expect(normalizeLang("PT-BR")).toBe("pt-BR");
    expect(normalizeLang(" ru ")).toBe("ru");
  });
  it("rejects invalid input", () => {
    expect(normalizeLang("")).toBeNull();
    expect(normalizeLang("r")).toBeNull();
    expect(normalizeLang("english")).toBeNull();
  });
});

describe("isEnglish", () => {
  it("checks the primary subtag", () => {
    expect(isEnglish("en")).toBe(true);
    expect(isEnglish("en-US")).toBe(true);
    expect(isEnglish("ru")).toBe(false);
  });
});

describe("variantBaseName", () => {
  it("uses suffix for two-letter codes", () => {
    expect(variantBaseName("About", "ru")).toBe("About_RU");
  });
  it("uses parentheses otherwise", () => {
    expect(variantBaseName("About", "pt-BR")).toBe("About (pt-BR)");
    expect(variantBaseName("About", "fil")).toBe("About (fil)");
  });
});

describe("joinVaultPath", () => {
  it("collapses slashes and empties", () => {
    expect(joinVaultPath("a/", "/b", "")).toBe("a/b");
    expect(joinVaultPath("", "", "x y/", "Пост.md")).toBe("x y/Пост.md");
    expect(joinVaultPath("")).toBe("");
    expect(joinVaultPath("a//b/", "c///")).toBe("a/b/c");
  });
});

describe("relativeToSite", () => {
  it("returns the relative path", () => {
    expect(relativeToSite("site/blog/x.md", "site")).toBe("blog/x.md");
    expect(relativeToSite("my site/x.md", "my site/")).toBe("x.md");
  });
  it("returns null outside the site", () => {
    expect(relativeToSite("other/x.md", "site")).toBeNull();
    expect(relativeToSite("site2/x.md", "site")).toBeNull();
  });
  it("handles the vault-root site", () => {
    expect(relativeToSite("x.md", "")).toBe("x.md");
    expect(relativeToSite("a/b.md", "")).toBe("a/b.md");
  });
  it("handles the site folder itself", () => {
    expect(relativeToSite("site", "site")).toBe("");
  });
});

describe("navKind", () => {
  it("pins pages and books at the site root", () => {
    expect(navKind("page", "")).toBe("menu_order");
    expect(navKind("book", "")).toBe("menu_order");
    expect(navKind("page", "blog")).toBe("none");
    expect(navKind("book", "a/b")).toBe("none");
  });
  it("hides sections one level below the root", () => {
    expect(navKind("listing", "blog")).toBe("nav_hidden");
    expect(navKind("feed", "Мой раздел")).toBe("nav_hidden");
    expect(navKind("homepage", "blog")).toBe("nav_hidden");
    expect(navKind("listing", "blog/")).toBe("nav_hidden");
  });
  it("ignores other depths", () => {
    expect(navKind("listing", "")).toBe("none");
    expect(navKind("feed", "a/b")).toBe("none");
    expect(navKind("homepage", "")).toBe("none");
    expect(navKind("homepage", "a/b")).toBe("none");
  });
});

describe("nextMenuOrder", () => {
  it("returns max plus one", () => {
    expect(nextMenuOrder([])).toBe(1);
    expect(nextMenuOrder([3, 1])).toBe(4);
  });
});
