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
