// Debounce and path filtering for auto-reload. Keep this module free of
// Obsidian imports so it stays unit-testable.
import { normalizeFile } from "./sourceMap";

export const RELOAD_DEBOUNCE_MS = 300;

export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Collapses a burst of notify() calls into one onFlush after a quiet gap. */
export class ReloadScheduler {
  private handle: unknown = null;
  private disposed = false;

  constructor(
    private onFlush: () => void,
    private delayMs: number,
    private timers: Timers = defaultTimers,
  ) {}

  notify(): void {
    if (this.disposed) return;
    if (this.handle !== null) this.timers.clear(this.handle);
    this.handle = this.timers.set(() => {
      this.handle = null;
      this.onFlush();
    }, this.delayMs);
  }

  /** Cancel any pending flush; later notify() calls do nothing. */
  dispose(): void {
    this.disposed = true;
    if (this.handle !== null) this.timers.clear(this.handle);
    this.handle = null;
  }
}

/**
 * True when any of the vault-relative paths (two for a rename) lies inside
 * the site folder. Both folders are absolute filesystem paths.
 */
export function pathsToNotify(
  vaultBase: string,
  siteFolder: string,
  vaultPaths: string[],
): boolean {
  const base = vaultBase.replace(/[\\/]+$/, "");
  return vaultPaths.some(
    (p) => normalizeFile(`${base}/${p.replace(/^[\\/]+/, "")}`, siteFolder) !== null,
  );
}
