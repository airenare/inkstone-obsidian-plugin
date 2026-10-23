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
