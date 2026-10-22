import { describe, expect, it } from "vitest";
import {
  fetchSourceMap,
  type Fetcher,
  normalizeFile,
  normalizeUrl,
  SourceMap,
  type SourceEntry,
} from "../src/sourceMap";

const entries: SourceEntry[] = [
  { file: "blog/simple-post.md", url: "/blog/simple-post", published: true, private: false },
  { file: "blog/My Post.md", url: "/blog/my post", published: true, private: false },
  { file: "blog/Привет.md", url: "/blog/привет", published: true, private: false },
  { file: "blog/Привет_RU.md", url: "/blog/privet/ru", published: true, private: false },
  { file: "blog/draft.md", url: null, published: false, private: false },
  { file: "secret.md", url: "/secret", published: false, private: true, has_own_token: true },
];

describe("SourceMap", () => {
  const map = new SourceMap(entries);

  it("round-trips file and url", () => {
    expect(map.urlForFile("blog/simple-post.md")?.url).toBe("/blog/simple-post");
    expect(map.fileForUrl("/blog/simple-post")?.file).toBe("blog/simple-post.md");
  });

  it("matches Cyrillic and spaces, encoded or raw", () => {
    expect(map.fileForUrl("/blog/%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82")?.file).toBe("blog/Привет.md");
    expect(map.fileForUrl("/blog/привет")?.file).toBe("blog/Привет.md");
    expect(map.fileForUrl("/blog/my%20post")?.file).toBe("blog/My Post.md");
    expect(map.urlForFile("blog/Привет.md")?.url).toBe("/blog/привет");
    const enc = new SourceMap([
      { file: "a.md", url: "/blog/%D0%BF", published: true, private: false },
    ]);
    expect(enc.fileForUrl("/blog/п")?.file).toBe("a.md");
  });

  it("ignores origin, query, hash and trailing slash", () => {
    expect(map.fileForUrl("http://127.0.0.1:8000/blog/simple-post/?token=x#h")?.file).toBe(
      "blog/simple-post.md",
    );
    expect(map.fileForUrl("/blog/privet/ru/")?.file).toBe("blog/Привет_RU.md");
  });

  it("keeps null url for unpublished and does not match it", () => {
    expect(map.urlForFile("blog/draft.md")?.url).toBeNull();
    expect(map.fileForUrl("")).toBeUndefined();
    expect(map.fileForUrl("/nope")).toBeUndefined();
    expect(map.urlForFile("missing.md")).toBeUndefined();
  });

  it("keeps private entries with real url", () => {
    const e = map.fileForUrl("/secret?token=abc");
    expect(e?.private).toBe(true);
    expect(e?.has_own_token).toBe(true);
  });
});

describe("normalizeUrl", () => {
  it("strips origin, query, hash, trailing slash and decodes", () => {
    expect(normalizeUrl("https://x.com/a/b/?q=1#z")).toBe("/a/b");
    expect(normalizeUrl("/a%20b")).toBe("/a b");
    expect(normalizeUrl("/")).toBe("/");
    expect(normalizeUrl("/bad%zz")).toBe("/bad%zz");
  });
});

describe("normalizeFile", () => {
  it("normalizes windows paths", () => {
    expect(normalizeFile("C:\\v\\site\\blog\\My Post.md", "C:\\v\\site")).toBe("blog/My Post.md");
    expect(normalizeFile("c:\\v\\site\\a.md", "C:\\v\\site")).toBe("a.md");
    expect(normalizeFile("blog\\My Post.md", "")).toBe("blog/My Post.md");
  });
  it("handles posix paths", () => {
    expect(normalizeFile("/a/site/blog/x.md", "/a/site/")).toBe("blog/x.md");
  });
  it("returns null outside the site folder", () => {
    expect(normalizeFile("/a/other/x.md", "/a/site")).toBeNull();
    expect(normalizeFile("/a/site-other/x.md", "/a/site")).toBeNull();
    expect(normalizeFile("/a/site", "/a/site")).toBeNull();
    expect(normalizeFile("/A/site/x.md", "/a/site")).toBeNull();
  });
});

describe("fetchSourceMap", () => {
  const res = (status: number, body: unknown, raw?: string): Fetcher =>
    async () => ({
      status,
      text: async () => (raw !== undefined ? raw : JSON.stringify(body)),
    });

  it("parses entries", async () => {
    const m = await fetchSourceMap("http://h:1/", res(200, { version: "1.57.0", files: entries }));
    expect(m.fileForUrl("/blog/simple-post")?.file).toBe("blog/simple-post.md");
  });
  it("uses the injected fetcher with the endpoint url", async () => {
    const calls: string[] = [];
    const f: Fetcher = async (u) => {
      calls.push(u);
      return { status: 200, text: async () => JSON.stringify({ version: "1", files: [] }) };
    };
    await fetchSourceMap("http://h:1/", f);
    expect(calls).toEqual(["http://h:1/__inkstone/source-map"]);
  });
  it("wraps a rejecting fetcher in a friendly error", async () => {
    const f: Fetcher = async () => {
      throw new Error("ECONNREFUSED");
    };
    await expect(fetchSourceMap("http://h:1", f)).rejects.toThrow(
      /Couldn't reach the InkStone server at http:\/\/h:1; is it running\?.*ECONNREFUSED/,
    );
  });
  it("404 mentions update", async () => {
    await expect(fetchSourceMap("http://h", res(404, {}))).rejects.toThrow(
      "update InkStone to >= 1.57.0",
    );
  });
  it("other status and invalid json fail clearly", async () => {
    await expect(fetchSourceMap("http://h", res(500, {}))).rejects.toThrow(/500/);
    await expect(fetchSourceMap("http://h", res(200, {}, "x"))).rejects.toThrow(/invalid/i);
    await expect(fetchSourceMap("http://h", res(200, { nope: 1 }))).rejects.toThrow(/invalid/i);
  });
});

describe("unicode normalization", () => {
  const nfc = "й ё".normalize("NFC");
  const nfd = "й ё".normalize("NFD");
  it("sanity: forms differ", () => expect(nfc).not.toBe(nfd));
  it("fileForUrl: NFD encoded url vs NFC map", () => {
    const m = new SourceMap([
      { file: `blog/${nfc}.md`, url: `/blog/${nfc}`, published: true, private: false },
    ]);
    expect(m.fileForUrl("/blog/" + encodeURIComponent(nfd))?.file).toBe(`blog/${nfc}.md`);
    expect(m.fileForUrl("/blog/" + nfd)?.file).toBe(`blog/${nfc}.md`);
  });
  it("urlForFile and normalizeFile: NFD file vs NFC map", () => {
    const m = new SourceMap([
      { file: `blog/${nfc}.md`, url: `/blog/${nfc}`, published: true, private: false },
    ]);
    expect(m.urlForFile(`blog/${nfd}.md`)?.url).toBe(`/blog/${nfc}`);
    const rel = normalizeFile(`/a/site/blog/${nfd}.md`, "/a/site");
    expect(rel).toBe(`blog/${nfc}.md`);
    expect(m.urlForFile(rel!)?.url).toBe(`/blog/${nfc}`);
  });
  it("NFD map vs NFC lookup", () => {
    const m = new SourceMap([
      { file: `blog/${nfd}.md`, url: `/blog/${nfd}`, published: true, private: false },
    ]);
    expect(m.urlForFile(`blog/${nfc}.md`)).toBeDefined();
    expect(m.fileForUrl(`/blog/${nfc}`)).toBeDefined();
  });
});
