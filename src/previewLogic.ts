// Pure preview decisions. Keep this module free of Obsidian imports so it
// stays unit-testable.
import {
  normalizeFile,
  normalizeUrl,
  type SourceEntry,
  type SourceMap,
} from "./sourceMap";

export type PreviewTarget =
  | { kind: "url"; url: string }
  | { kind: "unpublished" }
  | { kind: "not-found" };

export type EditorTarget = { kind: "open"; file: string } | { kind: "ignore" };

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const IGNORED_EXACT = new Set(["/search", "/tags", "/feed.xml", "/sitemap.xml"]);
const IGNORED_PREFIXES = ["/tag/", "/attachments/", "/__inkstone/"];

function safeDecode(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}

/** Encode a site path exactly once, whether it arrives raw or encoded. */
function encodePath(path: string): string {
  return encodeURI(safeDecode(path));
}

/**
 * What the preview should show for a note. `url` is a site path (no
 * origin). The token is appended only for private notes in owner view;
 * InkStone unlocks the session and redirects to the clean URL.
 */
export function decidePreviewTarget(
  entry: SourceEntry | undefined,
  ownerView: boolean,
  token = "",
): PreviewTarget {
  if (!entry) return { kind: "not-found" };
  if (!entry.url || (!entry.published && !entry.private)) {
    return { kind: "unpublished" };
  }
  const url = encodePath(entry.url);
  if (entry.private && ownerView && token) {
    return { kind: "url", url: `${url}?token=${encodeURIComponent(token)}` };
  }
  return { kind: "url", url };
}

/** Site path of a local preview URL, or null for anything external. */
function localPath(url: string): string | null {
  const u = url.trim();
  if (u === "" || u.startsWith("//")) return null;
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/s.exec(u);
  if (m) {
    const scheme = m[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") return null;
    const rest = /^\/\/([^/?#]*)(.*)$/s.exec(m[2]);
    if (!rest) return null;
    const host = rest[1].replace(/^[^@]*@/, "").replace(/:\d+$/, "");
    if (!LOCAL_HOSTS.has(host.toLowerCase())) return null;
    return rest[2] || "/";
  }
  return u.startsWith("/") ? u : null;
}

/** Which vault note (site-relative) a clicked preview URL belongs to. */
export function decideEditorTarget(url: string, map: SourceMap): EditorTarget {
  const raw = localPath(url);
  if (raw === null) return { kind: "ignore" };
  const path = normalizeUrl(raw);
  if (path === "" || IGNORED_EXACT.has(path)) return { kind: "ignore" };
  if (IGNORED_PREFIXES.some((p) => (path + "/").startsWith(p))) {
    return { kind: "ignore" };
  }
  const entry = map.fileForUrl(path);
  if (!entry || (!entry.published && !entry.private)) {
    return { kind: "ignore" };
  }
  return { kind: "open", file: entry.file };
}

/** URL for the toolbar: token removed, path decoded for readable slugs. */
export function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete("token");
    const search = u.searchParams.toString();
    return (
      u.origin +
      safeDecode(u.pathname) +
      (search ? `?${search}` : "") +
      safeDecode(u.hash)
    );
  } catch {
    return url.replace(/([?&])token=[^&#]*&?/g, "$1").replace(/[?&]$/, "");
  }
}

/**
 * Site-folder-relative path of a vault file, or null when the file lies
 * outside the site folder. `siteFolder` must already be absolute.
 */
export function siteRelativePath(
  vaultBase: string,
  vaultFilePath: string,
  siteFolder: string,
): string | null {
  const base = vaultBase.replace(/[\\/]+$/, "");
  return normalizeFile(`${base}/${vaultFilePath}`, siteFolder);
}

/**
 * Vault-relative path of a site file, or null when the site folder (or the
 * file) lies outside the vault.
 */
export function vaultPathForSiteFile(
  vaultBase: string,
  siteFolder: string,
  siteFile: string,
): string | null {
  const site = siteFolder.replace(/[\\/]+$/, "");
  return normalizeFile(`${site}/${siteFile}`, vaultBase);
}
