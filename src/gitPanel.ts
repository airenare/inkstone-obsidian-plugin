import { Notice } from "obsidian";
import { GitError, validateRemoteUrl, type GitChange, type GitService } from "./git";
import {
  buttonStates,
  canInit,
  canSetRemote,
  formatDiffForDisplay,
  NO_SITE,
  type ButtonState,
  type PanelGitState,
} from "./gitPanelState";

export const DEFAULT_COMMIT_MESSAGE = "Update site content";
const NOTICE_MAX = 200;
const SSH_HINT =
  "Git timed out; if this remote uses SSH, check for a passphrase " +
  "or host-key prompt.";

export interface GitPanelOptions {
  /**
   * A service for the current site folder (the setting can change), or
   * null when no usable (absolute) site folder is set.
   */
  getService: () => GitService | null;
  /** Called after a successful pull: files on disk changed. */
  onPulled: () => Promise<void> | void;
}

function errorText(e: unknown): string {
  if (e instanceof GitError) {
    // stderr is git's own output; show it whole, plus our message if new.
    const stderr = e.stderr.trim();
    if (!stderr) return e.message;
    return e.message && !stderr.includes(e.message)
      ? `${e.message}\n\n${stderr}`
      : stderr;
  }
  return e instanceof Error ? e.message : String(e);
}

function truncate(s: string): string {
  const line = s.replace(/\s+/g, " ").trim();
  return line.length > NOTICE_MAX ? `${line.slice(0, NOTICE_MAX)}...` : line;
}

/** Collapsible git section: changed files, diff, commit, pull, push. */
export class GitPanel {
  readonly el: HTMLDetailsElement;
  private state: PanelGitState = { kind: "no-site" };
  private changes: GitChange[] = [];
  /** Paths the user unchecked; everything else is checked by default. */
  private unchecked = new Set<string>();
  private selected: string | null = null;
  private diffSeq = 0;
  private busy = false;
  private refreshQueued = false;
  private disposed = false;

  private statusEl: HTMLElement;
  private listEl: HTMLElement;
  private diffEl: HTMLElement;
  private errorEl: HTMLElement;
  private errorTextEl: HTMLElement;
  private errorHintEl: HTMLElement;
  private msgInput: HTMLInputElement;
  private inlineEl: HTMLElement;
  private pullBtn: HTMLButtonElement;
  private commitBtn: HTMLButtonElement;
  private pushBtn: HTMLButtonElement;
  private refreshBtn: HTMLButtonElement;
  private setupEl: HTMLElement;
  private initBtn: HTMLButtonElement;
  private remoteRow: HTMLElement;
  private remoteInput: HTMLInputElement;
  private remoteBtn: HTMLButtonElement;

  constructor(parent: HTMLElement, private opts: GitPanelOptions) {
    this.el = parent.createEl("details", { cls: "inkstone-git" });
    this.el.createEl("summary", { text: "Git" });
    const body = this.el.createDiv({ cls: "inkstone-git-body" });

    const head = body.createDiv({ cls: "inkstone-git-head" });
    this.statusEl = head.createSpan({ cls: "inkstone-git-status" });
    this.refreshBtn = head.createEl("button", { text: "Refresh" });
    this.refreshBtn.addEventListener("click", () => void this.refresh());

    this.listEl = body.createDiv({ cls: "inkstone-git-list" });
    this.diffEl = body.createEl("pre", { cls: "inkstone-git-diff" });
    this.diffEl.hide();

    const row = body.createDiv({ cls: "inkstone-git-row" });
    this.msgInput = row.createEl("input", {
      cls: "inkstone-git-message",
      attr: { type: "text", "aria-label": "Commit message" },
    });
    this.msgInput.value = DEFAULT_COMMIT_MESSAGE;
    this.msgInput.addEventListener("input", () => this.updateButtons());
    this.pullBtn = row.createEl("button", { text: "Pull" });
    this.commitBtn = row.createEl("button", { text: "Commit", cls: "mod-cta" });
    this.pushBtn = row.createEl("button", { text: "Push" });
    this.pullBtn.addEventListener("click", () =>
      void this.act(async (svc) => {
        await svc.pull();
        await this.opts.onPulled();
      }),
    );
    this.commitBtn.addEventListener("click", () => void this.commit());
    this.pushBtn.addEventListener("click", () =>
      void this.act((svc) => svc.push()),
    );

    this.setupEl = body.createDiv({ cls: "inkstone-git-setup" });
    this.initBtn = this.setupEl.createEl("button", {
      text: "Initialize repository",
    });
    this.initBtn.addEventListener("click", () =>
      void this.act((svc) => svc.init()),
    );
    this.remoteRow = this.setupEl.createDiv({ cls: "inkstone-git-row" });
    this.remoteInput = this.remoteRow.createEl("input", {
      cls: "inkstone-git-message",
      attr: {
        type: "text",
        placeholder: "Remote URL",
        "aria-label": "Remote URL",
      },
    });
    this.remoteBtn = this.remoteRow.createEl("button", {
      text: "Set remote",
    });
    this.remoteBtn.addEventListener("click", () => void this.setRemote());

    this.inlineEl = body.createDiv({ cls: "inkstone-git-inline" });
    this.errorEl = body.createDiv({ cls: "inkstone-git-error" });
    this.errorTextEl = this.errorEl.createEl("pre");
    this.errorHintEl = this.errorEl.createDiv({ cls: "inkstone-git-hint" });
    this.errorEl.hide();

    this.el.addEventListener("toggle", () => {
      if (this.el.open) void this.refresh();
    });
    this.render();
  }

  get isOpen(): boolean {
    return this.el.open;
  }

  /** Refresh state and change list (cheap no-op while collapsed). */
  async refreshIfOpen(): Promise<void> {
    if (this.el.open) await this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.disposed) return;
    if (this.busy) {
      this.refreshQueued = true;
      return;
    }
    this.setBusy(true);
    this.clearError();
    try {
      await this.load();
    } finally {
      this.setBusy(false);
      this.drainQueue();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.el.remove();
  }

  // ---- internals ----

  private drainQueue(): void {
    if (this.refreshQueued && !this.disposed) {
      this.refreshQueued = false;
      void this.refresh();
    }
  }

  /** Read state and changes. Only runs git beyond state() inside a repo. */
  private async load(): Promise<void> {
    try {
      const svc = this.opts.getService();
      this.state = svc ? await svc.state() : { kind: "no-site" };
      this.changes =
        svc && this.state.kind === "repo" ? await svc.changes() : [];
    } catch (e) {
      this.showError(e);
      this.changes = [];
    }
    const paths = new Set(this.changes.map((c) => c.path));
    for (const p of this.unchecked) if (!paths.has(p)) this.unchecked.delete(p);
    if (this.selected && !paths.has(this.selected)) this.selected = null;
    this.render();
    if (this.selected) void this.loadDiff(this.selected);
  }

  /** Run one serialized git action, then refresh. */
  private async act(fn: (svc: GitService) => Promise<void>): Promise<void> {
    if (this.busy || this.disposed) return;
    this.setBusy(true);
    this.clearError();
    try {
      const svc = this.opts.getService();
      if (!svc) throw new Error(NO_SITE);
      await fn(svc);
    } catch (e) {
      this.showError(e);
    }
    try {
      await this.load();
    } finally {
      this.setBusy(false);
      this.drainQueue();
    }
  }

  private checkedPaths(): string[] {
    return this.changes
      .filter((c) => !this.unchecked.has(c.path))
      .map((c) => c.path);
  }

  private commit(): Promise<void> {
    const paths = this.checkedPaths();
    const message = this.msgInput.value;
    if (paths.length === 0 || message.trim() === "") return Promise.resolve();
    return this.act((svc) => svc.commit(paths, message));
  }

  private setRemote(): Promise<void> {
    const url = this.remoteInput.value.trim();
    const bad = validateRemoteUrl(url);
    if (bad) {
      this.showError(new Error(bad));
      return Promise.resolve();
    }
    return this.act(async (svc) => {
      await svc.setRemote(url);
      this.remoteInput.value = "";
    });
  }

  private setBusy(on: boolean): void {
    this.busy = on;
    this.updateButtons();
  }

  private applyButton(btn: HTMLButtonElement, s: ButtonState, extra = ""): void {
    const off = this.busy || !s.enabled || extra !== "";
    btn.disabled = off;
    btn.toggleClass("is-disabled", off);
    const tip = !s.enabled ? (s.hint ?? "") : extra;
    if (tip && !this.busy) btn.setAttribute("title", tip);
    else btn.removeAttribute("title");
  }

  private updateButtons(): void {
    const s = buttonStates(this.state);
    let why = "";
    if (s.commit.enabled) {
      if (this.checkedPaths().length === 0) why = "No files selected";
      else if (this.msgInput.value.trim() === "") why = "Enter a commit message";
    }
    this.applyButton(this.pullBtn, s.pull);
    this.applyButton(this.commitBtn, s.commit, why);
    this.applyButton(this.pushBtn, s.push);
    this.refreshBtn.disabled = this.busy;
    this.msgInput.disabled = this.state.kind !== "repo";
    this.initBtn.toggle(canInit(this.state));
    this.initBtn.disabled = this.busy;
    this.remoteRow.toggle(canSetRemote(this.state));
    this.remoteInput.disabled = this.busy;
    this.remoteBtn.disabled = this.busy;
    this.inlineEl.setText(this.busy ? "Working..." : why);
  }

  private render(): void {
    const st = this.state;
    this.statusEl.setText(
      st.kind === "no-site"
        ? NO_SITE
        : st.kind === "not-repo"
          ? "Folder is not a git repo"
          : `${st.branch ?? "detached HEAD"}${st.hasRemote ? "" : " (no remote)"}`,
    );
    this.listEl.empty();
    if (st.kind === "repo" && this.changes.length === 0) {
      this.listEl.createDiv({ cls: "inkstone-git-empty", text: "No changes" });
    }
    for (const c of this.changes) {
      const row = this.listEl.createDiv({ cls: "inkstone-git-file" });
      row.toggleClass("is-selected", c.path === this.selected);
      const box = row.createEl("input", { attr: { type: "checkbox" } });
      box.checked = !this.unchecked.has(c.path);
      box.addEventListener("change", () => {
        if (box.checked) this.unchecked.delete(c.path);
        else this.unchecked.add(c.path);
        this.updateButtons();
      });
      row.createSpan({ cls: "inkstone-git-letter", text: c.status });
      const name = row.createEl("button", {
        cls: "inkstone-git-name",
        text: c.origPath ? `${c.origPath} -> ${c.path}` : c.path,
      });
      name.addEventListener("click", () => this.select(c.path));
    }
    if (!this.selected) this.diffEl.hide();
    this.updateButtons();
  }

  private select(path: string): void {
    this.selected = path;
    this.render();
    void this.loadDiff(path);
  }

  /** Read-only git call; allowed while idle only, never overlapping. */
  private async loadDiff(path: string): Promise<void> {
    const seq = ++this.diffSeq;
    this.diffEl.show();
    this.diffEl.setText("Loading diff...");
    // Wait for any in-flight action so git calls never overlap.
    while (this.busy) await new Promise((r) => window.setTimeout(r, 50));
    if (seq !== this.diffSeq || this.disposed) return;
    this.setBusy(true);
    try {
      const svc = this.opts.getService();
      if (!svc) throw new Error(NO_SITE);
      const diff = await svc.diff(path);
      if (seq === this.diffSeq) this.showDiff(diff);
    } catch (e) {
      if (seq === this.diffSeq) {
        this.diffEl.setText("");
        this.showError(e);
      }
    } finally {
      this.setBusy(false);
      this.drainQueue();
    }
  }

  private showDiff(diff: string): void {
    const d = formatDiffForDisplay(diff);
    if (d.binary) {
      this.diffEl.setText("Binary file, no preview");
      return;
    }
    let text = d.text || "(no textual diff)";
    if (d.truncated) {
      const kb = (n: number): number => Math.round(n / 1024);
      const total = new TextEncoder().encode(diff).length;
      const shown = new TextEncoder().encode(d.text).length;
      text += `\n\n(truncated: showing first ${kb(shown)} KB of ${kb(total)} KB)`;
    }
    this.diffEl.setText(text);
  }

  private showError(e: unknown): void {
    const text = errorText(e);
    this.errorTextEl.setText(text);
    const timeout = /time(d)?[ -]?out/i.test(text);
    this.errorHintEl.setText(timeout ? SSH_HINT : "");
    this.errorHintEl.toggle(timeout);
    this.errorEl.show();
    new Notice(`InkStone git: ${truncate(text)}`);
  }

  private clearError(): void {
    this.errorEl.hide();
    this.errorTextEl.setText("");
  }
}
