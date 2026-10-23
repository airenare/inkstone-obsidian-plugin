import type { App } from "obsidian";
import { relativeToSite } from "./notePaths";
import type { SiteNote } from "./siteIndex";

/** Markdown notes under siteRel ("" = vault root), with frontmatter. */
export function scanSite(app: App, siteRel: string): SiteNote[] {
  const notes: SiteNote[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const path = relativeToSite(file.path, siteRel);
    if (path === null || path === "") continue;
    const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    notes.push({ path, fm: { ...fm } });
  }
  return notes;
}
