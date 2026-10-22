import { describe, expect, it } from "vitest";
import { getLoginShellPath } from "../src/shellEnv";

describe("getLoginShellPath", () => {
  it("returns process.env.PATH on Windows", async () => {
    expect(await getLoginShellPath("win32")).toBe(process.env.PATH ?? "");
  });

  it("returns a non-empty path elsewhere", async () => {
    if (process.platform === "win32") return;
    expect((await getLoginShellPath(process.platform)).length).toBeGreaterThan(0);
  });
});
