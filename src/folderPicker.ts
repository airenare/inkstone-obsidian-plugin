// Tries several ways to pick a folder on disk, in order. No Obsidian
// imports, so the chain logic is unit-testable.

export type PickResult =
  | { kind: "picked"; path: string }
  | { kind: "cancelled" }
  | { kind: "unavailable"; reason: string };

export interface PickerStrategy {
  name: string;
  pick: () => Promise<PickResult>;
}

/**
 * Runs the strategies in order. A pick or a cancel ends the chain at once
 * (a cancel must not open a second dialog). Strategies that are unavailable
 * or throw fall through to the next; if none works, the reasons are joined.
 */
export async function pickFolder(
  strategies: PickerStrategy[],
): Promise<PickResult> {
  const reasons: string[] = [];
  for (const s of strategies) {
    try {
      const r = await s.pick();
      if (r.kind !== "unavailable") return r;
      reasons.push(`${s.name}: ${r.reason}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "failed";
      reasons.push(`${s.name}: ${msg}`);
    }
  }
  return { kind: "unavailable", reason: reasons.join("; ") };
}
