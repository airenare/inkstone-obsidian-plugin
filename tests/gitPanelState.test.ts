import { describe, expect, it } from "vitest";
import { buttonStates } from "../src/gitPanelState";

describe("buttonStates", () => {
  it("enables everything for a repo with a remote", () => {
    expect(
      buttonStates({ kind: "repo", hasRemote: true, branch: "main" }),
    ).toEqual({
      pull: { enabled: true },
      commit: { enabled: true },
      push: { enabled: true },
    });
  });

  it("disables pull and push without a remote", () => {
    expect(
      buttonStates({ kind: "repo", hasRemote: false, branch: "main" }),
    ).toEqual({
      pull: { enabled: false, hint: "No remote configured" },
      commit: { enabled: true },
      push: { enabled: false, hint: "No remote configured" },
    });
  });

  it("disables everything when the folder is not a repo", () => {
    const hint = "Folder is not a git repo";
    expect(buttonStates({ kind: "not-repo" })).toEqual({
      pull: { enabled: false, hint },
      commit: { enabled: false, hint },
      push: { enabled: false, hint },
    });
  });
});
