// The plugin code uses `window.setTimeout` and friends (Obsidian popout
// windows). Under Node, point `window` at the global object so the same
// calls work, including with vitest's fake timers.
const g = globalThis as unknown as { window?: unknown };
if (g.window === undefined) g.window = globalThis;
