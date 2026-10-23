// A tiny in-memory timeline for diagnosing preview latency. Marks are
// cheap strings; nothing is written to disk or the console. The user copies
// the formatted log with a command when they want to share it. No Obsidian
// imports, so it's unit-testable.

interface Mark {
  at: number;
  label: string;
  /** A click starts a new "run": format() begins at the latest one. */
  start: boolean;
}

export class Trace {
  private marks: Mark[] = [];

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly cap = 300,
  ) {}

  get size(): number {
    return this.marks.length;
  }

  mark(label: string, start = false): void {
    this.marks.push({ at: this.now(), label, start });
    if (this.marks.length > this.cap) this.marks.shift();
  }

  clear(): void {
    this.marks = [];
  }

  /** Lines for the latest run: "+total ms (+since previous)  label". */
  format(): string {
    if (this.marks.length === 0) return "(no events recorded yet)";
    let from = 0;
    for (let i = this.marks.length - 1; i >= 0; i--) {
      if (this.marks[i]?.start) {
        from = i;
        break;
      }
    }
    const run = this.marks.slice(from);
    const t0 = run[0]?.at ?? 0;
    let prev = t0;
    return run
      .map((m) => {
        const line = `+${Math.round(m.at - t0)} ms (+${Math.round(m.at - prev)})  ${m.label}`;
        prev = m.at;
        return line;
      })
      .join("\n");
  }
}

/** Fields of PerformanceNavigationTiming the page reports, in ms. */
export interface NavTiming {
  startTime?: number;
  redirectEnd?: number;
  fetchStart?: number;
  domainLookupStart?: number;
  domainLookupEnd?: number;
  connectStart?: number;
  connectEnd?: number;
  requestStart?: number;
  responseStart?: number;
  responseEnd?: number;
  domContentLoadedEventEnd?: number;
  loadEventEnd?: number;
  fcp?: number;
}

/**
 * One readable line from a page's navigation timing: where the time went
 * between the start of the navigation and the page being loaded. Phases that
 * the page didn't report are skipped.
 */
export function describeNavTiming(raw: string): string {
  let t: NavTiming;
  try {
    t = JSON.parse(raw) as NavTiming;
  } catch {
    return `unreadable timing: ${raw}`;
  }
  const n = (v: number | undefined): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const span = (label: string, a?: number, b?: number): string | null => {
    const x = n(a);
    const y = n(b);
    return x === null || y === null ? null : `${label} ${Math.round(y - x)}`;
  };
  const parts = [
    span("queued-before-fetch", t.startTime, t.fetchStart),
    span("dns", t.domainLookupStart, t.domainLookupEnd),
    span("connect", t.connectStart, t.connectEnd),
    span("sent-to-first-byte", t.requestStart, t.responseStart),
    span("download", t.responseStart, t.responseEnd),
    span("parse-to-DOMContentLoaded", t.responseEnd, t.domContentLoadedEventEnd),
    span("to-load", t.domContentLoadedEventEnd, t.loadEventEnd),
  ].filter((p): p is string => p !== null);
  const fcp = n(t.fcp);
  if (fcp !== null) parts.push(`first-paint-at ${Math.round(fcp)}`);
  const total = n(t.loadEventEnd);
  const head = total === null ? "" : `total ${Math.round(total)} ms | `;
  return `${head}${parts.join(" | ")} (all ms)`;
}
