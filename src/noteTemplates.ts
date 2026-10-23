import { translationStrings } from "./translationStrings";

export type FmValue = string | number | boolean | string[] | undefined;

const SPECIAL = /[:#[\]{}&*!|>'"%@`,\n\r\t]/;
// Plain scalars that PyYAML (YAML 1.1) reads as something other than a
// string: booleans, null, numbers in any base, and dates.
const RESERVED = /^(y|n|yes|no|on|off|true|false|null|~)$/i;
const NUMBER = new RegExp(
  "^[-+]?(" +
    "\\d[\\d_]*(\\.[\\d_]*)?([eE][-+]?\\d+)?" +
    "|\\.\\d[\\d_]*([eE][-+]?\\d+)?" +
    "|0x[\\da-f_]+|0o[0-7_]+|0b[01_]+" +
    "|\\.inf|\\.nan" +
    ")$",
  "i",
);
const DATE_START = /^\d{4}-\d\d-\d\d/;
const ISO_DATE = /^\d{4}-\d\d-\d\d$/;

export function yamlString(v: string): string {
  const needsQuote =
    v === "" ||
    SPECIAL.test(v) ||
    /^[-? ]/.test(v) ||
    v.endsWith(" ") ||
    RESERVED.test(v) ||
    NUMBER.test(v) ||
    DATE_START.test(v);
  if (!needsQuote) return v;
  const escaped = v
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

export function renderFrontmatter(
  fields: Array<[string, FmValue]>,
): string {
  const lines: string[] = ["---"];
  for (const [key, value] of fields) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${yamlString(item)}`);
    } else if (typeof value === "string") {
      // A date stays bare, so Obsidian Properties keeps it a date.
      const bare = key === "date" && ISO_DATE.test(value);
      lines.push(`${key}: ${bare ? value : yamlString(value)}`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

export function generateToken(
  random: (n: number) => Uint8Array = (n) =>
    crypto.getRandomValues(new Uint8Array(n)),
): string {
  const bytes = random(16);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function todayIso(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type NoteSpec =
  | {
      type: "homepage";
      title: string;
      root: boolean;
      language?: string;
      defaultTheme?: string;
      showSearch?: boolean;
      showTags?: boolean;
      siteTitle?: string;
      icon?: string;
      theme?: string;
      navHidden?: boolean;
    }
  | {
      type: "page" | "book";
      title: string;
      date: string;
      tags?: string[];
      summary?: string;
      menuOrder?: number;
      privateToken?: string;
    }
  | { type: "listing" | "feed"; title: string; navHidden?: boolean };

export function buildNote(spec: NoteSpec): string {
  if (spec.type === "homepage") {
    const root = spec.root;
    return renderFrontmatter([
      ["website", true],
      ["type", "homepage"],
      ["title", spec.title],
      ["language", root ? spec.language : undefined],
      ["default_theme", root ? spec.defaultTheme : undefined],
      ["show_search", root ? spec.showSearch : undefined],
      ["show_tags", root ? spec.showTags : undefined],
      ["site_title", root ? undefined : spec.siteTitle],
      ["icon", root ? undefined : spec.icon],
      ["theme", root ? undefined : spec.theme],
      ["nav_hidden", spec.navHidden ? true : undefined],
    ]);
  }
  if (spec.type === "listing" || spec.type === "feed") {
    return renderFrontmatter([
      ["website", true],
      ["type", spec.type],
      ["title", spec.title],
      ["nav_hidden", spec.navHidden ? true : undefined],
    ]);
  }
  const page = spec as Extract<NoteSpec, { date: string }>;
  const isPrivate = page.privateToken !== undefined;
  return renderFrontmatter([
    ["website", isPrivate ? undefined : true],
    ["type", page.type === "book" ? "book" : undefined],
    ["title", page.title],
    ["date", page.date],
    ["tags", page.tags],
    ["summary", page.summary],
    ["menu_order", page.menuOrder],
    ["access_token", page.privateToken],
  ]);
}

export function buildTranslations(lang: string): string {
  const body = translationStrings(lang)
    .map(([k, v]) => `${yamlString(k)}: ${yamlString(v)}`)
    .join("\n");
  const fm = renderFrontmatter([
    ["type", "translations"],
    ["lang", lang],
  ]);
  return `${fm}\n\`\`\`yaml\n${body}\n\`\`\`\n`;
}

const VARIANT_KEYS = [
  "website",
  "title",
  "slug",
  "date",
  "tags",
  "summary",
  "type",
];

function toFmValue(v: unknown): FmValue {
  if (v === undefined || v === null) return undefined;
  if (v instanceof Date) return todayIso(v);
  if (Array.isArray(v)) {
    return v
      .filter(
        (x): x is string | number | boolean =>
          typeof x === "string" ||
          typeof x === "number" ||
          typeof x === "boolean",
      )
      .map((x) => String(x));
  }
  if (
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  ) {
    return v;
  }
  return undefined;
}

export function buildVariant(
  sourceFm: Record<string, unknown>,
  lang: string,
): string {
  const fields: Array<[string, FmValue]> = [];
  for (const key of VARIANT_KEYS) {
    if (key in sourceFm) fields.push([key, toFmValue(sourceFm[key])]);
  }
  fields.push(["lang", lang]);
  return renderFrontmatter(fields);
}
