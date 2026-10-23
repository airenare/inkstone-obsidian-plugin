import { describe, expect, it } from "vitest";
import { buttonStates, canInit, canSetRemote } from "../src/gitPanelState";

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

  it("disables everything when no site folder is set", () => {
    const hint = "Site folder not set";
    expect(buttonStates({ kind: "no-site" })).toEqual({
      pull: { enabled: false, hint },
      commit: { enabled: false, hint },
      push: { enabled: false, hint },
    });
  });
});

import { DIFF_MAX_BYTES, formatDiffForDisplay } from "../src/gitPanelState";

describe("formatDiffForDisplay", () => {
  it("leaves a small diff unchanged", () => {
    const d = "@@ -1 +1 @@\n-a\n+b\n";
    expect(formatDiffForDisplay(d)).toEqual({
      text: d,
      truncated: false,
      binary: false,
    });
  });

  it("truncates a large diff at the cap", () => {
    const d = "x".repeat(DIFF_MAX_BYTES + 500);
    const r = formatDiffForDisplay(d);
    expect(r.truncated).toBe(true);
    expect(r.binary).toBe(false);
    expect(r.text.length).toBe(DIFF_MAX_BYTES);
  });

  it("flags binary diffs", () => {
    expect(
      formatDiffForDisplay("Binary files a/x.png and b/x.png differ\n").binary,
    ).toBe(true);
    expect(
      formatDiffForDisplay("diff --git a/x b/x\nGIT binary patch\nliteral 3\n")
        .binary,
    ).toBe(true);
  });

  it("does not split a multi-byte character at the cut", () => {
    // 3-byte chars; a cap of 10 bytes lands mid-character.
    const r = formatDiffForDisplay("€".repeat(100), 10);
    expect(r.truncated).toBe(true);
    expect(r.text).toBe("€€€");
    expect(r.text).not.toContain("�");
  });
});

describe("canInit and canSetRemote", () => {
  const withRemote = { kind: "repo", hasRemote: true, branch: "main" } as const;
  const noRemote = { kind: "repo", hasRemote: false, branch: "main" } as const;

  it("offers init only when the folder is not a repo", () => {
    expect(canInit({ kind: "not-repo" })).toBe(true);
    expect(canInit({ kind: "no-site" })).toBe(false);
    expect(canInit(noRemote)).toBe(false);
    expect(canInit(withRemote)).toBe(false);
  });

  it("offers set remote only for a repo without one", () => {
    expect(canSetRemote(noRemote)).toBe(true);
    expect(canSetRemote(withRemote)).toBe(false);
    expect(canSetRemote({ kind: "not-repo" })).toBe(false);
    expect(canSetRemote({ kind: "no-site" })).toBe(false);
  });
});
