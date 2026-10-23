// Turns a creation request into the exact files to write, and decides
// which dialog fields to show. Pure: no Obsidian imports.

import {
  buildNote,
  buildTranslations,
  buildVariant,
  type NoteSpec,
} from "./noteTemplates";
import {
  isEnglish,
  joinVaultPath,
  navKind,
  nextMenuOrder,
  normalizeLang,
  relativeToSite,
  sanitizeName,
  variantBaseName,
  type NameResult,
} from "./notePaths";
import {
  existingTranslations,
  hasRootHomepage,
  menuOrders,
  sectionTypes,
  type SiteNote,
} from "./siteIndex";

export type CreateType =
  | "homepage"
  | "page"
  | "book"
  | "listing"
  | "feed"
  | "translations"
  | "variant";

export interface CreateRequest {
  type: CreateType;
  name: string;
  /** Vault path; "" is the vault root. */
  folder: string;
  isPrivate?: boolean;
  token?: string;
  navigation?: boolean;
  language?: string;
  defaultTheme?: string;
  showSearch?: boolean;
  showTags?: boolean;
  siteTitle?: string;
  icon?: string;
  theme?: string;
  tags?: string[];
  summary?: string;
  /** Source note for a variant; `path` is a vault path. */
  variantSource?: { path: string; fm: Record<string, unknown> };
  alsoTranslations?: boolean;
  insertLink?: boolean;
}

export interface PlanContext {
  /** Site folder as a vault path; "" when it is the vault root. */
  siteRel: string;
  /** Notes of the site, paths relative to the site folder. */
  notes: SiteNote[];
  /** Takes a vault path. */
  exists: (vaultPath: string) => boolean;
  today: string;
}

export interface PlannedFile {
  path: string;
  content: string;
}

export interface CreationPlan {
  files: PlannedFile[];
  openPath: string;
  linkName?: string;
  notices: string[];
  warnings: string[];
}

export type PlanResult =
  | { ok: true; plan: CreationPlan }
  | { ok: false; error: string };

export interface FieldVisibility {
  name: boolean;
  folder: boolean;
  location: boolean;
  private: boolean;
  token: boolean;
  navigation: "none" | "add" | "hide";
  language: boolean;
  homepageRoot: boolean;
  homepageSection: boolean;
  insertLink: boolean;
}

const ILLEGAL_IN_FILENAME = /[\\/:*?"<>|#^[\]]/g;

/**
 * Filename (without .md) for a note name. The name stays the title as
 * typed; characters a filename or wiki-link can't hold are dropped here.
 */
export function noteFileBase(name: string): NameResult {
  const base = name
    .replace(ILLEGAL_IN_FILENAME, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitizeName(base);
}

function trimSlashes(p: string): string {
  return p.replace(/\/+$/, "");
}

function isRootFolder(folder: string, siteRel: string): boolean {
  return trimSlashes(folder) === trimSlashes(siteRel);
}

function baseName(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.md$/i, "");
}

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function translationsPath(siteRel: string, lang: string): string {
  return joinVaultPath(siteRel, `translations_${lang.toUpperCase()}.md`);
}

const OUTSIDE = "The folder is outside the site folder.";
const BAD_LANG = "Language must be a code such as ru or pt-BR.";

type Lang = { ok: true; lang: string | null } | { ok: false };

function parseLang(input: string | undefined): Lang {
  if (input === undefined || input.trim() === "") {
    return { ok: true, lang: null };
  }
  const lang = normalizeLang(input);
  return lang === null ? { ok: false } : { ok: true, lang };
}

/**
 * Adds a translations note for `lang` to `files` unless the site already
 * has one, in which case a notice says it is reused.
 */
function addTranslations(
  lang: string,
  ctx: PlanContext,
  files: PlannedFile[],
  notices: string[],
): void {
  const existing = existingTranslations(ctx.notes, lang);
  if (existing !== null) {
    const path = joinVaultPath(ctx.siteRel, existing);
    notices.push(`Reusing the existing translations note ${path}.`);
    return;
  }
  files.push({
    path: translationsPath(ctx.siteRel, lang),
    content: buildTranslations(lang),
  });
}

function sectionWarning(
  type: "listing" | "feed" | "homepage",
  folderRel: string,
  ctx: PlanContext,
): string[] {
  if (!sectionTypes(ctx.notes, folderRel).includes(type)) return [];
  const where = joinVaultPath(ctx.siteRel, folderRel) || "The vault root";
  return [
    `${where} already has a ${type} note; ` +
      "a folder should hold only one of each type.",
  ];
}

interface Draft {
  files: PlannedFile[];
  notices: string[];
  warnings: string[];
}

function draftFor(req: CreateRequest, ctx: PlanContext): Draft | string {
  const notices: string[] = [];
  const warnings: string[] = [];

  if (req.type === "translations") {
    const parsed = parseLang(req.language);
    if (!parsed.ok || parsed.lang === null) return BAD_LANG;
    const existing = existingTranslations(ctx.notes, parsed.lang);
    if (existing !== null) {
      const path = joinVaultPath(ctx.siteRel, existing);
      return `A translations note for ${parsed.lang} already exists: ${path}.`;
    }
    const file = {
      path: translationsPath(ctx.siteRel, parsed.lang),
      content: buildTranslations(parsed.lang),
    };
    return { files: [file], notices, warnings };
  }

  if (req.type === "variant") {
    const source = req.variantSource;
    if (!source) return "Open a note to create a language variant of it.";
    if (relativeToSite(source.path, ctx.siteRel) === null) {
      return "The note is outside the site folder.";
    }
    const parsed = parseLang(req.language);
    if (!parsed.ok || parsed.lang === null) return BAD_LANG;
    const lang = parsed.lang;
    const name = variantBaseName(baseName(source.path), lang);
    const files = [
      {
        path: joinVaultPath(parentOf(source.path), `${name}.md`),
        content: buildVariant(source.fm, lang),
      },
    ];
    if (req.alsoTranslations && !isEnglish(lang)) {
      addTranslations(lang, ctx, files, notices);
    }
    return { files, notices, warnings };
  }

  const folderRel = relativeToSite(trimSlashes(req.folder), ctx.siteRel);
  if (folderRel === null) return OUTSIDE;
  const title = req.name.trim();

  if (req.type === "homepage" && isRootFolder(req.folder, ctx.siteRel)) {
    if (hasRootHomepage(ctx.notes)) {
      return "The site already has a homepage.";
    }
    if (!title) return "Name can't be empty";
    const parsed = parseLang(req.language);
    if (!parsed.ok) return BAD_LANG;
    const files = [
      {
        path: joinVaultPath(ctx.siteRel, "Home.md"),
        content: buildNote({
          type: "homepage",
          title,
          root: true,
          language: parsed.lang ?? undefined,
          defaultTheme: req.defaultTheme,
          showSearch: req.showSearch,
          showTags: req.showTags,
        }),
      },
    ];
    if (parsed.lang !== null && !isEnglish(parsed.lang)) {
      addTranslations(parsed.lang, ctx, files, notices);
    }
    return { files, notices, warnings };
  }

  const fileBase = noteFileBase(req.name);
  if (!fileBase.ok) return fileBase.reason;
  const path = joinVaultPath(req.folder, `${fileBase.name}.md`);
  const kind = navKind(req.type, folderRel);
  let spec: NoteSpec;

  if (req.type === "page" || req.type === "book") {
    let privateToken: string | undefined;
    if (req.isPrivate) {
      privateToken = (req.token ?? "").trim();
      if (!privateToken) return "A private note needs a token.";
    }
    const addToNav =
      req.navigation === true &&
      privateToken === undefined &&
      kind === "menu_order";
    spec = {
      type: req.type,
      title,
      date: ctx.today,
      tags: req.tags && req.tags.length ? req.tags : undefined,
      summary: req.summary?.trim() ? req.summary.trim() : undefined,
      menuOrder: addToNav ? nextMenuOrder(menuOrders(ctx.notes)) : undefined,
      privateToken,
    };
  } else {
    const navHidden = req.navigation === true && kind === "nav_hidden";
    warnings.push(...sectionWarning(req.type, folderRel, ctx));
    spec =
      req.type === "homepage"
        ? {
            type: "homepage",
            title,
            root: false,
            siteTitle: req.siteTitle?.trim() || undefined,
            icon: req.icon?.trim() || undefined,
            theme: req.theme?.trim() || undefined,
            navHidden,
          }
        : { type: req.type, title, navHidden };
  }
  return { files: [{ path, content: buildNote(spec) }], notices, warnings };
}

export function planCreation(
  req: CreateRequest,
  ctx: PlanContext,
): PlanResult {
  const draft = draftFor(req, ctx);
  if (typeof draft === "string") return { ok: false, error: draft };
  for (const file of draft.files) {
    if (ctx.exists(file.path)) {
      return { ok: false, error: `${file.path} already exists.` };
    }
  }
  const openPath = draft.files[0].path;
  const plan: CreationPlan = {
    files: draft.files,
    openPath,
    notices: draft.notices,
    warnings: draft.warnings,
  };
  if (req.insertLink && req.type !== "translations") {
    plan.linkName = baseName(openPath);
  }
  return { ok: true, plan };
}

export function fieldVisibility(
  type: CreateType,
  req: Pick<CreateRequest, "folder" | "isPrivate">,
  siteRel: string,
  hasEditor: boolean,
): FieldVisibility {
  const pageLike = type === "page" || type === "book";
  const sectionLike =
    type === "listing" || type === "feed" || type === "homepage";
  const rootHome = type === "homepage" && isRootFolder(req.folder, siteRel);

  let navigation: FieldVisibility["navigation"] = "none";
  const folderRel = relativeToSite(trimSlashes(req.folder), siteRel);
  if (
    folderRel !== null &&
    !rootHome &&
    type !== "translations" &&
    type !== "variant"
  ) {
    const kind = navKind(type, folderRel);
    if (kind === "menu_order" && pageLike && !req.isPrivate) {
      navigation = "add";
    } else if (kind === "nav_hidden" && sectionLike) {
      navigation = "hide";
    }
  }

  return {
    name: type !== "translations" && type !== "variant",
    folder: sectionLike,
    location: pageLike,
    private: pageLike,
    token: pageLike && req.isPrivate === true,
    navigation,
    language: rootHome || type === "variant" || type === "translations",
    homepageRoot: rootHome,
    homepageSection: type === "homepage" && !rootHome,
    insertLink: hasEditor && type !== "translations",
  };
}
