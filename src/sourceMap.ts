export type SourceEntry = {
  file: string;
  url: string | null;
  published: boolean;
  private: boolean;
  has_own_token?: boolean;
};

const MIN_VERSION_HINT = "update InkStone to >= 1.57.0";

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Strip origin, query, hash and trailing slash; percent-decode. */
export function normalizeUrl(u: string): string {
  let s = u.trim().replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*/, "");
  s = s.replace(/[?#].*$/s, "");
  s = safeDecode(s);
  s = s.replace(/\/+$/, "");
  if (s === "" && u.trim() !== "") return "/";
  return s;
}

function toSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

function fixDrive(p: string): string {
  return /^[a-zA-Z]:\//.test(p) ? p[0].toLowerCase() + p.slice(1) : p;
}

/**
 * Site-folder-relative path with forward slashes, or null when the file
 * lies outside the site folder.
 */
export function normalizeFile(p: string, siteFolder: string): string | null {
  const file = toSlashes(p);
  const root = toSlashes(siteFolder).replace(/\/+$/, "");
  if (root === "") return file.replace(/^\.\//, "");
  const f = fixDrive(file);
  const r = fixDrive(root);
  if (!f.startsWith(r + "/")) return null;
  const rel = file.slice(r.length + 1);
  return rel === "" ? null : rel;
}

export class SourceMap {
  private byFile = new Map<string, SourceEntry>();
  private byUrl = new Map<string, SourceEntry>();

  constructor(entries: SourceEntry[]) {
    for (const e of entries) {
      this.byFile.set(toSlashes(e.file), e);
      if (e.url !== null && e.url !== undefined) {
        this.byUrl.set(normalizeUrl(e.url), e);
      }
    }
  }

  urlForFile(file: string): SourceEntry | undefined {
    return this.byFile.get(toSlashes(file));
  }

  fileForUrl(url: string): SourceEntry | undefined {
    const key = normalizeUrl(url);
    if (key === "") return undefined;
    return this.byUrl.get(key);
  }
}

export async function fetchSourceMap(
  baseUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<SourceMap> {
  const url = baseUrl.replace(/\/+$/, "") + "/__inkstone/source-map";
  const res = await fetchFn(url);
  if (res.status === 404) {
    throw new Error(`Source map endpoint not found: ${MIN_VERSION_HINT}`);
  }
  if (!res.ok) {
    throw new Error(`Source map request failed with status ${res.status}`);
  }
  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new Error("Source map response was invalid JSON");
  }
  if (!data || !Array.isArray(data.files)) {
    throw new Error("Source map response was invalid: missing files list");
  }
  return new SourceMap(data.files as SourceEntry[]);
}
