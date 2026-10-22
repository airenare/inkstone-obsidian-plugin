// Which settings changes matter to a running server. Keep this module free
// of Obsidian imports so it stays unit-testable.
import type { InkStoneSettings } from "./settings";

const SERVER_KEYS = ["siteFolder", "inkstoneCheckout", "pythonPath"] as const;

/** True when a setting the server starts with differs (ignoring spaces). */
export function serverSettingsChanged(
  before: InkStoneSettings,
  after: InkStoneSettings,
): boolean {
  return SERVER_KEYS.some((k) => before[k].trim() !== after[k].trim());
}
