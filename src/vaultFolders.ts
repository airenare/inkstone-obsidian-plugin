// Pure helpers for the vault folder picker. No Obsidian imports.

export interface FolderEntry {
  /** Vault-relative path; "/" for the vault root. */
  path: string;
  isRoot: boolean;
}

/**
 * The value stored in the site folder setting for a picked vault folder.
 * The vault root is "." and never "/": a bare "/" is an absolute path (the
 * disk root) and would point the site at the wrong place.
 */
export function siteSettingFor(f: FolderEntry): string {
  return f.isRoot ? "." : f.path;
}

/** 0 for the vault root, 1 for a top-level folder, and so on. */
export function depthOf(f: FolderEntry): number {
  return f.isRoot ? 0 : f.path.split("/").filter(Boolean).length;
}

/** The text shown for a folder: "Vault root" or its own name. */
export function folderLabel(f: FolderEntry): string {
  if (f.isRoot) return "Vault root";
  const parts = f.path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? f.path;
}

/**
 * Tree order: the root first, then folders by path so each parent is
 * directly followed by its children. Case-insensitive.
 */
export function sortFolders<T extends FolderEntry>(folders: T[]): T[] {
  const key = (f: T) => (f.isRoot ? "" : f.path.toLowerCase());
  return [...folders].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === kb) return a.path.localeCompare(b.path);
    return ka < kb ? -1 : 1;
  });
}
