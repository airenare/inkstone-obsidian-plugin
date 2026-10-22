import { describe, expect, it } from "vitest";
import {
  decideEditorTarget,
  decidePreviewTarget,
  displayUrl,
  siteRelativePath,
  vaultPathForSiteFile,
} from "../src/previewLogic";
import { SourceMap, type SourceEntry } from "../src/sourceMap";

const published: SourceEntry = {
  file: "blog/post.md",
  url: "/blog/post",
  published: true,
  private: false,
};
const spaced: SourceEntry = {
  file: "blog/My Post.md",
  url: "/blog/my post",
  published: true,
  private: false,
};
const priv: SourceEntry = {
  file: "secret.md",
  url: "/secret",
  published: false,
  private: true,
  has_own_token: false,
};
const unpublishedListing: SourceEntry = {
  file: "drafts/index.md",
  url: null,
  published: false,
  private: false,
};
const unpublishedWithUrl: SourceEntry = {
  file: "odd.md",
  url: "/odd",
  published: false,
  private: false,
};

describe("decidePreviewTarget", () => {
  it("returns the url of a published note", () => {
    expect(decidePreviewTarget(published, false)).toEqual({
      kind: "url",
      url: "/blog/post",
    });
  });

  it("does not add the token to published notes in owner view", () => {
    expect(decidePreviewTarget(published, true, "abc")).toEqual({
      kind: "url",
      url: "/blog/post",
    });
  });

  it("percent-encodes the path once", () => {
    expect(decidePreviewTarget(spaced, false)).toEqual({
      kind: "url",
      url: "/blog/my%20post",
    });
    const enc = { ...spaced, url: "/blog/my%20post" };
    expect(decidePreviewTarget(enc, false)).toEqual({
      kind: "url",
      url: "/blog/my%20post",
    });
  });

  it("unpublished note -> unpublished", () => {
    expect(decidePreviewTarget(unpublishedListing, false)).toEqual({
      kind: "unpublished",
    });
    expect(decidePreviewTarget(unpublishedListing, true, "abc")).toEqual({
      kind: "unpublished",
    });
    expect(decidePreviewTarget(unpublishedWithUrl, true, "abc")).toEqual({
      kind: "unpublished",
    });
  });

  it("missing entry -> not-found", () => {
    expect(decidePreviewTarget(undefined, false)).toEqual({
      kind: "not-found",
    });
  });

  it("private note, owner view off -> placeholder url without token", () => {
    expect(decidePreviewTarget(priv, false, "abc")).toEqual({
      kind: "url",
      url: "/secret",
    });
  });

  it("private note, owner view on -> url gets ?token=", () => {
    expect(decidePreviewTarget(priv, true, "abc")).toEqual({
      kind: "url",
      url: "/secret?token=abc",
    });
  });

  it("private note, owner view on but no token -> plain url", () => {
    expect(decidePreviewTarget(priv, true)).toEqual({
      kind: "url",
      url: "/secret",
    });
  });

  it("encodes the token", () => {
    expect(decidePreviewTarget(priv, true, "a&b")).toEqual({
      kind: "url",
      url: "/secret?token=a%26b",
    });
  });
});

describe("decideEditorTarget", () => {
  const map = new SourceMap([
    published,
    spaced,
    priv,
    unpublishedWithUrl,
    { file: "index.md", url: "/", published: true, private: false },
    {
      file: "blog/Привет_RU.md",
      url: "/blog/privet/ru",
      published: true,
      private: false,
    },
  ]);

  it("opens a published note by path or local url", () => {
    expect(decideEditorTarget("/blog/post", map)).toEqual({
      kind: "open",
      file: "blog/post.md",
    });
    expect(
      decideEditorTarget("http://127.0.0.1:5123/blog/post?x=1#h", map),
    ).toEqual({ kind: "open", file: "blog/post.md" });
    expect(decideEditorTarget("http://localhost:5123/blog/post", map)).toEqual(
      { kind: "open", file: "blog/post.md" },
    );
  });

  it("opens encoded, root and language-variant urls", () => {
    expect(decideEditorTarget("/blog/my%20post", map)).toEqual({
      kind: "open",
      file: "blog/My Post.md",
    });
    expect(decideEditorTarget("http://127.0.0.1:5123/", map)).toEqual({
      kind: "open",
      file: "index.md",
    });
    expect(decideEditorTarget("/blog/privet/ru/", map)).toEqual({
      kind: "open",
      file: "blog/Привет_RU.md",
    });
  });

  it("opens private notes (token unlocks them)", () => {
    expect(decideEditorTarget("/secret?token=abc", map)).toEqual({
      kind: "open",
      file: "secret.md",
    });
  });

  it("external link -> ignore", () => {
    expect(decideEditorTarget("https://example.com/blog/post", map)).toEqual({
      kind: "ignore",
    });
    expect(decideEditorTarget("mailto:a@example.com", map)).toEqual({
      kind: "ignore",
    });
    expect(decideEditorTarget("//example.com/blog/post", map)).toEqual({
      kind: "ignore",
    });
  });

  it("utility routes and attachments -> ignore", () => {
    for (const u of [
      "/search",
      "/search?q=x",
      "/tags",
      "/tag/python",
      "/feed.xml",
      "/sitemap.xml",
      "/attachments/blog/_attachments/a.png",
      "/__inkstone/source-map",
    ]) {
      expect(decideEditorTarget(u, map), u).toEqual({ kind: "ignore" });
    }
  });

  it("unknown url -> ignore", () => {
    expect(decideEditorTarget("/nope", map)).toEqual({ kind: "ignore" });
    expect(decideEditorTarget("", map)).toEqual({ kind: "ignore" });
  });

  it("unpublished entry without private access -> ignore", () => {
    expect(decideEditorTarget("/odd", map)).toEqual({ kind: "ignore" });
  });
});

describe("displayUrl", () => {
  it("strips the token and decodes the path", () => {
    expect(
      displayUrl("http://127.0.0.1:5123/secret?token=abc&lang=ru#top"),
    ).toBe("http://127.0.0.1:5123/secret?lang=ru#top");
    expect(displayUrl("http://127.0.0.1:5123/secret?token=abc")).toBe(
      "http://127.0.0.1:5123/secret",
    );
    expect(
      displayUrl("http://127.0.0.1:5123/blog/%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82"),
    ).toBe("http://127.0.0.1:5123/blog/привет");
  });

  it("never returns the token, even for odd input", () => {
    expect(displayUrl("not a url ?token=abc")).not.toContain("abc");
  });
});

describe("path mapping", () => {
  it("maps a vault file into the site folder", () => {
    expect(siteRelativePath("/v", "site/blog/a.md", "/v/site")).toBe(
      "blog/a.md",
    );
    expect(siteRelativePath("/v", "other/a.md", "/v/site")).toBeNull();
    expect(siteRelativePath("/v", "site/a.md", "/elsewhere")).toBeNull();
    expect(
      siteRelativePath("C:\\Vault", "site/a.md", "C:\\Vault\\site\\"),
    ).toBe("a.md");
  });

  it("maps a site file back into the vault, or null outside it", () => {
    expect(vaultPathForSiteFile("/v", "/v/site", "blog/a.md")).toBe(
      "site/blog/a.md",
    );
    expect(vaultPathForSiteFile("/v", "/v", "a.md")).toBe("a.md");
    expect(vaultPathForSiteFile("/v", "/elsewhere", "a.md")).toBeNull();
  });
});
