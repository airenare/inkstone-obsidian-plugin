// Pure button-state logic for the git panel. No Obsidian imports.
import type { GitState } from "./git";

export type ButtonState = { enabled: boolean; hint?: string };

export interface ButtonStates {
  pull: ButtonState;
  commit: ButtonState;
  push: ButtonState;
}

const NO_REPO = "Folder is not a git repo";
const NO_REMOTE = "No remote configured";

export function buttonStates(state: GitState): ButtonStates {
  if (state.kind === "not-repo") {
    const off = { enabled: false, hint: NO_REPO };
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
