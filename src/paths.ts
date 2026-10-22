// Site folder resolution. Keep this module free of Obsidian imports so it
// stays unit-testable.
import { homedir } from "os";
import { posix, win32 } from "path";
import type { InkStoneSettings } from "./settings";

/** Drive-absolute (`C:\x`) or UNC (`\\server\share`). */
function isWinAbsolute(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || /^[\\/]{2}[^\\/]/.test(p);
}

/**
 * Expand a leading `~` (or `~/`, `~\\`) to the home directory. Node doesn't
 * do this and people type `~/repos/x` into path fields. `~user` forms and
 * tildes elsewhere in the path are left alone.
 */
export function expandHome(p: string, home: string = homedir()): string {
  const t = p.trim();
  if (t === "~") return home;
  if (t.startsWith("~/") || t.startsWith("~\\")) {
    return home.replace(/[\\/]+$/, "") + t.slice(1);
  }
  return t;
}

/** A copy of the settings with `~` expanded in every path field. */
export function expandSettingsPaths(
  s: InkStoneSettings,
  home: string = homedir(),
): InkStoneSettings {
  return {
    ...s,
    siteFolder: expandHome(s.siteFolder, home),
    inkstoneCheckout: expandHome(s.inkstoneCheckout, home),
    pythonPath: expandHome(s.pythonPath, home),
  };
}

/**
 * The absolute site folder for a setting, or null when there is none.
 *
 * Absolute paths are used as is (normalized). Relative paths resolve
 * against the vault folder, never against the process cwd: without an
 * absolute vault base they give null. An empty setting gives null.
 */
export function resolveSiteFolder(
  setting: string,
  vaultBasePath: string | null,
  platform: NodeJS.Platform,
  home: string = homedir(),
): string | null {
  const p = expandHome(setting, home);
  if (!p) return null;
  if (platform === "win32") {
    if (isWinAbsolute(p)) return win32.resolve(p);
    // "C:x" is relative to that drive's cwd: refuse it.
    if (/^[A-Za-z]:/.test(p)) return null;
    if (!vaultBasePath || !isWinAbsolute(vaultBasePath)) return null;
    return win32.resolve(vaultBasePath, p);
  }
  if (posix.isAbsolute(p)) return posix.resolve(p);
  if (!vaultBasePath || !posix.isAbsolute(vaultBasePath)) return null;
  return posix.resolve(vaultBasePath, p);
}
