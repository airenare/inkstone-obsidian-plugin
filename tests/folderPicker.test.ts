import { describe, expect, it } from "vitest";
import { pickFolder, type PickerStrategy } from "../src/folderPicker";

const picked = (path: string): PickerStrategy["pick"] => async () => ({
  kind: "picked",
  path,
});

describe("pickFolder strategy chain", () => {
  it("returns the first strategy's pick without trying the rest", async () => {
    let second = false;
    const r = await pickFolder([
      { name: "dialog", pick: picked("/a") },
      {
        name: "input",
        pick: async () => {
          second = true;
          return { kind: "picked", path: "/b" };
        },
      },
    ]);
    expect(r).toEqual({ kind: "picked", path: "/a" });
    expect(second).toBe(false);
  });

  it("stops at a cancel instead of opening a second dialog", async () => {
    let second = false;
    const r = await pickFolder([
      { name: "dialog", pick: async () => ({ kind: "cancelled" }) },
      {
        name: "input",
        pick: async () => {
          second = true;
          return { kind: "picked", path: "/b" };
        },
      },
    ]);
    expect(r.kind).toBe("cancelled");
    expect(second).toBe(false);
  });

  it("falls through when a strategy is unavailable or throws", async () => {
    const r = await pickFolder([
      { name: "dialog", pick: async () => ({ kind: "unavailable", reason: "no remote" }) },
      { name: "weird", pick: async () => { throw new Error("boom"); } },
      { name: "input", pick: picked("/c") },
    ]);
    expect(r).toEqual({ kind: "picked", path: "/c" });
  });

  it("reports every reason when nothing works", async () => {
    const r = await pickFolder([
      { name: "dialog", pick: async () => ({ kind: "unavailable", reason: "no remote" }) },
      { name: "input", pick: async () => { throw new Error("blocked"); } },
    ]);
    expect(r.kind).toBe("unavailable");
    if (r.kind === "unavailable") {
      expect(r.reason).toContain("dialog: no remote");
      expect(r.reason).toContain("input: blocked");
    }
  });
});
