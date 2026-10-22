import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pathsToNotify, ReloadScheduler } from "../src/autoReload";

describe("ReloadScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("collapses a burst of notifies into one flush", () => {
    const flush = vi.fn();
    const s = new ReloadScheduler(flush, 300);
    for (let i = 0; i < 5; i++) {
      s.notify();
      vi.advanceTimersByTime(50);
    }
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("flushes twice for bursts separated by more than the delay", () => {
    const flush = vi.fn();
    const s = new ReloadScheduler(flush, 300);
    s.notify();
    s.notify();
    vi.advanceTimersByTime(301);
    s.notify();
    vi.advanceTimersByTime(301);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("dispose cancels a pending flush and later notifies", () => {
    const flush = vi.fn();
    const s = new ReloadScheduler(flush, 300);
    s.notify();
    s.dispose();
    vi.advanceTimersByTime(1000);
    s.notify();
    vi.advanceTimersByTime(1000);
    expect(flush).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses injected timer functions", () => {
    const set = vi.fn(() => 7 as unknown);
    const clear = vi.fn();
    const s = new ReloadScheduler(() => {}, 10, { set, clear });
    s.notify();
    s.notify();
    expect(set).toHaveBeenCalledTimes(2);
    expect(clear).toHaveBeenCalledWith(7);
  });
});

describe("pathsToNotify", () => {
  const vault = "/home/me/vault";
  it("accepts a file inside the site folder", () => {
    expect(pathsToNotify(vault, "/home/me/vault/site", ["site/a.md"])).toBe(true);
  });
  it("rejects a file outside the site folder", () => {
    expect(pathsToNotify(vault, "/home/me/vault/site", ["other/a.md"])).toBe(false);
  });
  it("rejects a sibling folder sharing a prefix", () => {
    expect(pathsToNotify(vault, "/home/me/vault/site", ["site2/a.md"])).toBe(false);
  });
  it("handles Windows-style paths", () => {
    expect(
      pathsToNotify("C:\\Users\\me\\vault", "C:\\Users\\me\\vault\\site", [
        "site/a.md",
      ]),
    ).toBe(true);
    expect(
      pathsToNotify("C:\\Users\\me\\vault", "c:\\Users\\me\\vault\\site", [
        "site/a.md",
      ]),
    ).toBe(true);
    expect(
      pathsToNotify("C:\\Users\\me\\vault", "C:\\Users\\me\\vault\\site", [
        "site2/a.md",
      ]),
    ).toBe(false);
  });
  it("treats a site folder equal to the vault root as everything", () => {
    expect(pathsToNotify(vault, vault, ["a.md"])).toBe(true);
    expect(pathsToNotify(vault, vault, ["x/y/a.png"])).toBe(true);
  });
  it("for a rename, notifies if either path is inside", () => {
    const site = "/home/me/vault/site";
    expect(pathsToNotify(vault, site, ["other/a.md", "site/a.md"])).toBe(true);
    expect(pathsToNotify(vault, site, ["site/a.md", "other/a.md"])).toBe(true);
    expect(pathsToNotify(vault, site, ["x/a.md", "y/a.md"])).toBe(false);
  });
});
