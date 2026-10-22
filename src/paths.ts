// Site folder resolution. Keep this module free of Obsidian imports so it
// stays unit-testable.
import { posix, win32 } from "path";

/** Drive-absolute (`C:\x`) or UNC (`\\server\share`). */
function isWinAbsolute(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || /^[\\/]{2}[^\\/]/.test(p);
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
): string | null {
  const p = setting.trim();
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
