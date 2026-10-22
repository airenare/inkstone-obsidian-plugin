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

/**
 * Collapses a burst of notify() calls into one onFlush after a quiet gap.
 * Flushes never overlap: notify() calls that arrive while an async flush is
 * running produce exactly one follow-up flush once it finishes.
 */
export class ReloadScheduler {
  private handle: unknown = null;
  private disposed = false;
  private running = false;
  private again = false;

  constructor(
    private onFlush: () => void | Promise<void>,
    private delayMs: number,
    private timers: Timers = defaultTimers,
  ) {}

  notify(): void {
    if (this.disposed) return;
    if (this.running) {
      this.again = true;
      return;
    }
    if (this.handle !== null) this.timers.clear(this.handle);
    this.handle = this.timers.set(() => {
      this.handle = null;
      this.run();
    }, this.delayMs);
  }

  private run(): void {
    let result: void | Promise<void>;
    try {
      result = this.onFlush();
    } catch {
      return;
    }
    if (!result) return; // synchronous flush: nothing in flight
    this.running = true;
    const done = (): void => {
      this.running = false;
      if (this.again && !this.disposed) {
        this.again = false;
        this.notify();
      }
    };
    // A failed flush must not break later ones or the event loop.
    void (async () => {
      try {
        await result;
      } catch {
        /* swallowed on purpose */
      }
      done();
    })();
  }

  /** Cancel any pending flush; later notify() calls do nothing. */
  dispose(): void {
    this.disposed = true;
    this.again = false;
    if (this.handle !== null) this.timers.clear(this.handle);
    this.handle = null;
  }
}

/**
 * The scheduler as the plugin uses it. The flush must return its promise:
 * the in-flight guard only works when the scheduler can see it finish.
 */
export function createReloadScheduler(
  flush: () => Promise<void>,
  delayMs: number = RELOAD_DEBOUNCE_MS,
  timers?: Timers,
): ReloadScheduler {
  return new ReloadScheduler(flush, delayMs, timers);
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
