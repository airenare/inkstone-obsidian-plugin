// Path and name rules for creating notes. Pure: no Obsidian imports.

export type NoteType = "page" | "book" | "listing" | "feed" | "homepage";

export type NameResult =
  | { ok: true; name: string }
  | { ok: false; reason: string };

const FORBIDDEN = /[\\/:*?"<>|#^[\]]/;

export function sanitizeName(name: string): NameResult {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, reason: "Name can't be empty" };
  if (FORBIDDEN.test(trimmed)) {
    return {
      ok: false,
      reason: 'Name can\'t contain \\ / : * ? " < > | # ^ [ ]',
    };
  }
  if (trimmed.startsWith(".")) {
    return { ok: false, reason: "Name can't start with a dot" };
  }
  if (/[. ]$/.test(trimmed)) {
    return { ok: false, reason: "Name can't end with a dot or space" };
  }
  return { ok: true, name: trimmed };
}

export function normalizeLang(input: string): string | null {
  const s = input.trim();
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(s)) return null;
  const dash = s.indexOf("-");
  if (dash === -1) return s.toLowerCase();
  // Primary subtag lowercased; region kept as typed.
  return s.slice(0, dash).toLowerCase() + s.slice(dash);
}

export function isEnglish(lang: string): boolean {
  return lang.trim().split("-")[0].toLowerCase() === "en";
}

export function variantBaseName(base: string, lang: string): string {
  if (/^[A-Za-z]{2}$/.test(lang)) return `${base}_${lang.toUpperCase()}`;
  return `${base} (${lang})`;
}

export function joinVaultPath(...parts: string[]): string {
  return parts
    .filter((p) => p !== "")
    .join("/")
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "");
}

export function relativeToSite(
  vaultPath: string,
  siteRel: string,
): string | null {
  const site = siteRel.replace(/\/+$/, "");
  if (site === "") return vaultPath;
  if (vaultPath === site) return "";
  if (vaultPath.startsWith(site + "/")) return vaultPath.slice(site.length + 1);
  return null;
}

export function navKind(
  type: NoteType,
  folderRelToSite: string,
): "menu_order" | "nav_hidden" | "none" {
  const folder = folderRelToSite.replace(/\/+$/, "");
  if (type === "page" || type === "book") {
    return folder === "" ? "menu_order" : "none";
  }
  if (folder !== "" && !folder.includes("/")) return "nav_hidden";
  return "none";
}

export function nextMenuOrder(existing: number[]): number {
  return existing.length ? Math.max(...existing) + 1 : 1;
}
