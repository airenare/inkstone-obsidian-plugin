// Pure button-state logic for the git panel. No Obsidian imports.
import type { GitState } from "./git";

export type ButtonState = { enabled: boolean; hint?: string };

export interface ButtonStates {
  pull: ButtonState;
  commit: ButtonState;
  push: ButtonState;
}

/** What the panel shows: a git state, or no usable site folder. */
export type PanelGitState = GitState | { kind: "no-site" };

export const NO_SITE = "Site folder not set";
const NO_REPO = "Folder is not a git repo";
const NO_REMOTE = "No remote configured";

export function buttonStates(state: PanelGitState): ButtonStates {
  if (state.kind === "no-site" || state.kind === "not-repo") {
    const hint = state.kind === "no-site" ? NO_SITE : NO_REPO;
    const off = { enabled: false, hint };
    return { pull: { ...off }, commit: { ...off }, push: { ...off } };
  }
  if (!state.hasRemote) {
    const off = { enabled: false, hint: NO_REMOTE };
    return { pull: { ...off }, commit: { enabled: true }, push: { ...off } };
  }
  return {
    pull: { enabled: true },
    commit: { enabled: true },
    push: { enabled: true },
  };
}

/** Most diff text (in bytes) the panel renders. */
export const DIFF_MAX_BYTES = 200 * 1024;

export interface DiffDisplay {
  text: string;
  truncated: boolean;
  binary: boolean;
}

const BINARY_RE = /^Binary files .* differ$|^GIT binary patch$/m;

/** Decide what part of a diff is safe to render. Never splits a character. */
export function formatDiffForDisplay(
  diff: string,
  maxBytes: number = DIFF_MAX_BYTES,
): DiffDisplay {
  if (BINARY_RE.test(diff)) return { text: "", truncated: false, binary: true };
  const bytes = new TextEncoder().encode(diff);
  if (bytes.length <= maxBytes) {
    return { text: diff, truncated: false, binary: false };
  }
  let end = maxBytes;
  // Back off over UTF-8 continuation bytes to a character boundary.
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  const text = new TextDecoder().decode(bytes.subarray(0, end));
  return { text, truncated: true, binary: false };
}
