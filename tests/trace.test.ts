import { describe, expect, it } from "vitest";
import { describeNavTiming, Trace } from "../src/trace";

function clock(times: number[]) {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)] ?? 0;
}

describe("Trace", () => {
  it("formats each mark with time since the first and since the previous", () => {
    const t = new Trace(clock([1000, 1004.4, 1100, 2100]));
    t.mark("click");
    t.mark("editor open");
    t.mark("dom-ready");
    t.mark("first paint");
    expect(t.format()).toEqual([
      "+0 ms (+0)  click",
      "+4 ms (+4)  editor open",
      "+100 ms (+96)  dom-ready",
      "+1100 ms (+1000)  first paint",
    ].join("\n"));
  });

  it("starts the clock at the most recent click so one test reads cleanly", () => {
    const t = new Trace(clock([10, 20, 5000, 5010, 5900]));
    t.mark("startup");
    t.mark("old stuff");
    t.mark("click /blog/x", true);
    t.mark("editor open");
    t.mark("page ready");
    const lines = t.format().split("\n");
    expect(lines[0]).toContain("click /blog/x");
    expect(lines[0]).toContain("+0 ms");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain("+900 ms");
  });

  it("keeps only the newest entries once past its cap", () => {
    const t = new Trace(clock([0]), 3);
    for (let i = 0; i < 10; i++) t.mark("m" + i);
    expect(t.size).toBe(3);
    expect(t.format()).toContain("m9");
    expect(t.format()).not.toContain("m6");
  });

  it("clears, and an empty trace says so", () => {
    const t = new Trace(clock([0]));
    t.mark("x");
    t.clear();
    expect(t.size).toBe(0);
    expect(t.format()).toBe("(no events recorded yet)");
  });
});

describe("describeNavTiming", () => {
  it("breaks a navigation into phases so the slow one stands out", () => {
    const line = describeNavTiming(
      JSON.stringify({
        startTime: 0, fetchStart: 2, domainLookupStart: 2, domainLookupEnd: 2,
        connectStart: 2, connectEnd: 3, requestStart: 4, responseStart: 1500,
        responseEnd: 1520, domContentLoadedEventEnd: 1540, loadEventEnd: 1550,
        fcp: 1700,
      }),
    );
    expect(line).toContain("total 1550 ms");
    expect(line).toContain("sent-to-first-byte 1496");
    expect(line).toContain("queued-before-fetch 2");
    expect(line).toContain("download 20");
    expect(line).toContain("first-paint-at 1700");
  });

  it("skips phases the page didn't report and survives junk", () => {
    expect(describeNavTiming(JSON.stringify({ loadEventEnd: 900 }))).toBe(
      "total 900 ms |  (all ms)",
    );
    expect(describeNavTiming("not json")).toContain("unreadable timing");
  });
});
