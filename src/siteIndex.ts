// Pure queries over the notes of an InkStone site. No Obsidian imports.

export interface SiteNote {
  /** Path relative to the site folder, POSIX separators. */
  path: string;
  fm: Record<string, unknown>;
}

export function visibleNotes(notes: SiteNote[]): SiteNote[] {
  return notes.filter((note) => {
    const segments = note.path.split("/");
    if (segments.some((s) => s.startsWith("."))) return false;
    return !(segments.length > 1 && segments[0] === "templates");
  });
}

function isRootHomepage(note: SiteNote): boolean {
  return !note.path.includes("/") && note.fm.type === "homepage";
}

export function hasRootHomepage(notes: SiteNote[]): boolean {
  return notes.some(isRootHomepage);
}

function primary(code: string): string {
  return code.trim().split("-")[0].toLowerCase();
}

export function knownLanguages(notes: SiteNote[]): string[] {
  const found = new Set<string>();
  for (const note of visibleNotes(notes)) {
    const lang = note.fm.lang;
    if (typeof lang === "string" && lang.trim()) found.add(primary(lang));
    const base = note.path.split("/").pop() ?? "";
    const m = /_([A-Z]{2})\.md$/.exec(base);
    if (m) found.add(m[1].toLowerCase());
    const language = note.fm.language;
    if (
      isRootHomepage(note) &&
      typeof language === "string" &&
      language.trim()
    ) {
      found.add(primary(language));
    }
  }
  return [...found].sort();
}

export function menuOrders(notes: SiteNote[]): number[] {
  const out: number[] = [];
  for (const note of visibleNotes(notes)) {
    const v = note.fm.menu_order;
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

const SECTION_TYPES = new Set(["listing", "feed", "homepage"]);

export function sectionTypes(notes: SiteNote[], folderRel: string): string[] {
  const folder = folderRel.replace(/\/+$/, "");
  const out: string[] = [];
  for (const note of visibleNotes(notes)) {
    const i = note.path.lastIndexOf("/");
    const dir = i === -1 ? "" : note.path.slice(0, i);
    const type = note.fm.type;
    if (dir === folder && typeof type === "string" && SECTION_TYPES.has(type)) {
      out.push(type);
    }
  }
  return out;
}

export function existingTranslations(
  notes: SiteNote[],
  lang: string,
): string | null {
  const want = lang.trim().toLowerCase();
  for (const note of visibleNotes(notes)) {
    const l = note.fm.lang;
    if (
      note.fm.type === "translations" &&
      typeof l === "string" &&
      l.trim().toLowerCase() === want
    ) {
      return note.path;
    }
  }
  return null;
}
