import {
  FileSystemAdapter,
  FileView,
  ItemView,
  Notice,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import { resolve as resolvePath } from "path";
import { obsidianFetcher } from "./obsidianFetcher";
import {
  decideAfterSave,
  decideEditorTarget,
  decidePreviewTarget,
  displayUrl,
  siteRelativePath,
  vaultPathForSiteFile,
} from "./previewLogic";
import type { ServerStatus } from "./server";
import { fetchSourceMap, normalizeUrl, type SourceMap } from "./sourceMap";
import type InkStonePlugin from "./main";

export const VIEW_TYPE_PREVIEW = "inkstone-preview";

/** The parts of Electron's <webview> element this view uses. */
interface WebviewElement extends HTMLElement {
  loadURL(url: string): Promise<void>;
  reload(): void;
  stop(): void;
  getURL(): string;
  canGoBack(): boolean;
  goBack(): void;
}

interface NavEvent extends Event {
  url: string;
  isMainFrame?: boolean;
  httpResponseCode?: number;
  httpStatusText?: string;
}

interface FailEvent extends Event {
  errorCode: number;
  errorDescription: string;
  validatedURL: string;
  isMainFrame: boolean;
}

interface PanelAction {
  label: string;
  onClick: () => void;
}

interface PanelSpec {
  title: string;
  body?: string;
  detail?: string;
  error?: boolean;
  actions?: PanelAction[];
}

const ERR_ABORTED = -3;
const STDERR_LINES = 60;

function newPartition(): string {
  // Not "persist:", so cookies live in memory only and die with the view.
  const rand = Math.random().toString(36).slice(2, 10);
  return `inkstone-${Date.now().toString(36)}-${rand}`;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

export class InkStonePreviewView extends ItemView {
  private plugin: InkStonePlugin;
  private baseUrl: string | null = null;
  private map: SourceMap | null = null;
  private mapSeq = 0;
  private connecting: Promise<void> | null = null;

  private webview: WebviewElement | null = null;
  private webviewReady = false;
  private partition = newPartition();
  /** Last URL loaded or being loaded in the webview (may carry the token). */
  private currentUrl: string | null = null;
  /** The token-unlocked session survives until partition or server change. */
  private sessionUnlocked = false;
  private pendingTokenLoad = false;
  private lastHttpCode = 0;
  /** Counts real webview loads, so a reload never cancels a fresh one. */
  private navCount = 0;
  /** The server went down since the page loaded; reload once it is back. */
  private needsReload = false;

  private activeFile: TFile | null = null;
  private missRefreshedFor: string | null = null;
  private lastEditorLeaf: WorkspaceLeaf | null = null;

  private dotEl!: HTMLElement;
  private urlEl!: HTMLInputElement;
  private privateBadgeEl!: HTMLElement;
  private ownerInput!: HTMLInputElement;
  private restartBtn!: HTMLButtonElement;
  private stageEl!: HTMLElement;
  private panelEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: InkStonePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_PREVIEW;
  }

  getDisplayText(): string {
    return "InkStone preview";
  }

  getIcon(): string {
    return "globe";
  }

  async onOpen(): Promise<void> {
    this.buildUi();
    this.rememberEditorLeaf(this.app.workspace.getMostRecentLeaf());
    this.activeFile = this.app.workspace.getActiveFile();

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!leaf || leaf === this.leaf) return;
        this.rememberEditorLeaf(leaf);
        this.syncToActiveFile();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.syncToActiveFile()),
    );

    this.onServerStatus(this.plugin.server.status);
    void this.connect();
  }

  async onClose(): Promise<void> {
    this.webview?.remove();
    this.webview = null;
  }

  // ---- public API (used by main.ts and the auto-reload task) ----

  /** Called by the plugin for every server status change. */
  onServerStatus(status: ServerStatus): void {
    if (!this.dotEl) return; // not opened yet; onOpen reads the status
    this.updateDot(status);
    this.restartBtn.toggle(status === "crashed");
    if (status === "starting" || status === "crashed") {
      if (this.webview) this.needsReload = true;
    }
    if (status === "starting") {
      this.sessionUnlocked = false;
      this.pendingTokenLoad = false;
      this.showPanel({ title: "Starting InkStone..." });
    } else if (status === "running") {
      void this.connect();
    } else if (status === "crashed") {
      this.baseUrl = null;
      this.showServerError(
        this.plugin.lastStartError
          ? "InkStone failed to start."
          : "The InkStone server stopped unexpectedly.",
      );
    } else if (status === "stopped") {
      this.baseUrl = null;
      this.showPanel({
        title: "InkStone server is stopped.",
        actions: [{ label: "Start server", onClick: () => void this.connect() }],
      });
    }
  }

  /**
   * Fetch the source map for the current server. Null when there is no
   * server, the request failed (the error panel is shown), or a newer
   * fetch superseded this one.
   */
  private async fetchMap(): Promise<SourceMap | null> {
    const base = this.baseUrl;
    if (!base) return null;
    const seq = ++this.mapSeq;
    let map: SourceMap;
    try {
      map = await fetchSourceMap(base, obsidianFetcher);
    } catch (e) {
      if (seq !== this.mapSeq) return null;
      this.showPanel({
        title: "Couldn't load the InkStone source map.",
        body: e instanceof Error ? e.message : String(e),
        error: true,
        actions: [{ label: "Retry", onClick: () => void this.refreshMap() }],
      });
      return null;
    }
    if (seq !== this.mapSeq || base !== this.baseUrl) return null;
    return map;
  }

  /** Refetch the source map and re-evaluate the current target. */
  async refreshMap(): Promise<void> {
    const map = await this.fetchMap();
    if (!map) return;
    this.map = map;
    this.evaluate();
  }

  /**
   * Auto-reload after a save: refetch the map, then reload the shown page
   * in place. Retargets (via the active note) only when the shown page was
   * renamed, deleted or unpublished. Does nothing when the fetch failed or
   * was superseded, so no reload lands on an error panel or a stale map.
   */
  async refreshAndReload(): Promise<void> {
    const map = await this.fetchMap();
    if (!map) return;
    const before = this.map;
    this.map = map;
    const action = decideAfterSave({
      shownUrl: this.currentUrl,
      before,
      after: map,
    });
    if (action === "retarget") this.evaluate();
    else this.reload();
  }

  /** Settings validation failed: show its problem instead of a page. */
  showEnvProblem(problem: string): void {
    this.showPanel({
      title: "InkStone isn't set up yet.",
      body: problem,
      error: true,
      actions: [{ label: "Retry", onClick: () => void this.connect() }],
    });
  }

  /** Reload the page currently shown in the webview. */
  reload(): void {
    if (!this.webview || !this.webviewReady || !this.currentUrl) return;
    this.webview.reload();
  }

  // ---- server connection ----

  private connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    const p = this.doConnect().finally(() => {
      if (this.connecting === p) this.connecting = null;
    });
    this.connecting = p;
    return p;
  }

  private async doConnect(): Promise<void> {
    const res = await this.plugin.startServer();
    if (!res.ok) {
      // Start failures reach the view through the "crashed" status; a
      // cancelled start (restart raced it) needs no panel at all.
      if (res.kind === "env") this.showEnvProblem(res.message);
      return;
    }
    if (this.baseUrl !== res.baseUrl) {
      this.baseUrl = res.baseUrl;
      this.map = null;
    }
    const before = this.navCount;
    await this.refreshMap();
    // Restarted server, same URL: the old page is stale, so load it again.
    if (this.needsReload) {
      this.needsReload = false;
      if (this.navCount === before) this.reload();
    }
  }

  // ---- editor -> preview ----

  private syncToActiveFile(): void {
    const file = this.app.workspace.getActiveFile();
    if (!file || file === this.activeFile) return;
    this.activeFile = file;
    this.evaluate();
  }

  private siteFolder(): string {
    return resolvePath(this.plugin.settings.siteFolder);
  }

  private vaultBase(): string | null {
    const a = this.app.vault.adapter;
    return a instanceof FileSystemAdapter ? a.getBasePath() : null;
  }

  /** Decide what to show for the active note and show it. */
  private evaluate(): void {
    const file = this.activeFile;
    const base = this.baseUrl;
    const map = this.map;
    if (!base || !map) return;
    if (!file) {
      if (!this.currentUrl) {
        this.showPanel({ title: "Open a note in the site folder to preview it." });
      }
      return;
    }
    const vaultBase = this.vaultBase();
    const rel = vaultBase
      ? siteRelativePath(vaultBase, file.path, this.siteFolder())
      : null;
    if (rel === null) {
      this.setPrivateBadge(false);
      this.showPanel({
        title: "Not in the site folder",
        body: `"${file.name}" isn't part of the InkStone site.`,
      });
      return;
    }
    const entry = map.urlForFile(rel);
    if (!entry && this.missRefreshedFor !== rel) {
      // Maybe a brand-new note: refetch once before calling it unpublished.
      this.missRefreshedFor = rel;
      void this.refreshMap();
      return;
    }
    if (entry) this.missRefreshedFor = null;
    const owner = this.plugin.server.ownerUnlock;
    const token =
      owner && !this.sessionUnlocked ? this.plugin.server.token : "";
    const target = decidePreviewTarget(entry, owner, token);
    if (target.kind !== "url") {
      const isPage = ["md", "base", "canvas"].includes(file.extension);
      this.setPrivateBadge(false);
      this.showPanel({
        title: 'Not published (no "website: true")',
        body: isPage
          ? `Add "website: true" to "${file.name}" to publish it.`
          : `"${file.name}" isn't a page; only notes, bases and canvases are.`,
      });
      return;
    }
    this.setPrivateBadge(!!entry?.private);
    this.navigate(base + target.url);
  }

  private sameTarget(a: string | null, b: string | null): boolean {
    if (!a || !b) return false;
    return originOf(a) === originOf(b) && normalizeUrl(a) === normalizeUrl(b);
  }

  private navigate(url: string, force = false): void {
    if (!force && this.sameTarget(url, this.currentUrl) && this.webview) {
      if (this.lastHttpCode < 400) this.hidePanel();
      return;
    }
    this.navCount++;
    this.currentUrl = url;
    this.pendingTokenLoad = /[?&]token=/.test(url);
    this.urlEl.value = displayUrl(url);
    this.hidePanel();
    if (!this.webview) {
      this.createWebview(url);
    } else if (this.webviewReady) {
      // Rejects when a newer navigation supersedes this one; harmless.
      this.webview.loadURL(url).catch(() => {});
    } else {
      this.webview.setAttribute("src", url);
    }
  }

  // ---- webview ----

  private createWebview(url: string): void {
    this.webview?.remove();
    this.webviewReady = false;
    const wv = document.createElement("webview") as WebviewElement;
    wv.addClass("inkstone-webview");
    wv.setAttribute("partition", this.partition);
    wv.setAttribute("src", url);
    wv.addEventListener("dom-ready", () => {
      if (this.webview === wv) this.webviewReady = true;
    });
    wv.addEventListener("will-navigate", (e) => {
      if (this.webview === wv) this.onWillNavigate((e as NavEvent).url);
    });
    wv.addEventListener("did-navigate", (e) => {
      const ev = e as NavEvent;
      if (this.webview === wv) {
        this.onDidNavigate(ev.url, ev.httpResponseCode ?? 0, ev.httpStatusText ?? "");
      }
    });
    wv.addEventListener("did-navigate-in-page", (e) => {
      const ev = e as NavEvent;
      if (this.webview !== wv || ev.isMainFrame === false) return;
      const prev = this.currentUrl;
      this.currentUrl = ev.url;
      this.urlEl.value = displayUrl(ev.url);
      if (!this.sameTarget(prev, ev.url)) this.openInEditor(ev.url);
    });
    wv.addEventListener("did-fail-load", (e) => {
      const ev = e as FailEvent;
      if (this.webview !== wv || !ev.isMainFrame) return;
      if (ev.errorCode === ERR_ABORTED) return;
      this.showServerError(
        `Couldn't load ${displayUrl(ev.validatedURL)}: ${ev.errorDescription}`,
        true,
      );
    });
    this.webview = wv;
    this.stageEl.prepend(wv);
  }

  /** User clicked a link (or the page set location): sync the editor. */
  private onWillNavigate(url: string): void {
    if (this.baseUrl && originOf(url) !== originOf(this.baseUrl)) {
      // External link: keep the preview on the site, open it in a browser.
      this.webview?.stop();
      window.open(url);
      return;
    }
    this.currentUrl = url;
    this.urlEl.value = displayUrl(url);
    this.openInEditor(url);
  }

  private onDidNavigate(url: string, code: number, statusText: string): void {
    this.lastHttpCode = code;
    if (this.baseUrl && originOf(url) !== originOf(this.baseUrl)) {
      if (this.webview?.canGoBack()) this.webview.goBack();
      return;
    }
    this.currentUrl = url;
    this.urlEl.value = displayUrl(url);
    const entry = this.map?.fileForUrl(url);
    this.setPrivateBadge(!!entry?.private);

    if (this.pendingTokenLoad) {
      this.pendingTokenLoad = false;
      if (code === 200) this.sessionUnlocked = true;
    } else if (
      code === 200 &&
      entry?.private &&
      this.plugin.server.ownerUnlock &&
      !this.sessionUnlocked
    ) {
      // Owner view reached a private note before the session was unlocked
      // (e.g. via a link right after a server restart): unlock it now.
      const t = decidePreviewTarget(entry, true, this.plugin.server.token);
      if (t.kind === "url" && this.baseUrl) {
        this.navigate(this.baseUrl + t.url, true);
        return;
      }
    }

    if (code >= 400 || (code > 0 && code < 200)) {
      this.showServerError(
        `The page returned HTTP ${code}${statusText ? ` ${statusText}` : ""}.`,
        true,
      );
    } else {
      this.hidePanel();
    }
  }

  // ---- preview -> editor ----

  private rememberEditorLeaf(leaf: WorkspaceLeaf | null): void {
    if (leaf && leaf !== this.leaf && leaf.view instanceof FileView) {
      this.lastEditorLeaf = leaf;
    }
  }

  private isAttached(leaf: WorkspaceLeaf): boolean {
    let found = false;
    this.app.workspace.iterateAllLeaves((l) => {
      if (l === leaf) found = true;
    });
    return found;
  }

  private editorLeaf(): WorkspaceLeaf {
    const last = this.lastEditorLeaf;
    if (last && this.isAttached(last)) return last;
    let found: WorkspaceLeaf | null = null;
    this.app.workspace.iterateRootLeaves((l) => {
      if (!found && l !== this.leaf && l.view instanceof FileView) found = l;
    });
    const leaf =
      found ?? this.app.workspace.createLeafBySplit(this.leaf, "vertical", true);
    this.lastEditorLeaf = leaf;
    return leaf;
  }

  private openInEditor(url: string): void {
    const map = this.map;
    if (!map) return;
    const target = decideEditorTarget(url, map);
    if (target.kind !== "open") return;
    const vaultBase = this.vaultBase();
    const vaultPath = vaultBase
      ? vaultPathForSiteFile(vaultBase, this.siteFolder(), target.file)
      : null;
    const file =
      vaultPath === null
        ? null
        : this.app.vault.getAbstractFileByPath(vaultPath) ??
          this.app.vault.getAbstractFileByPath(vaultPath.normalize("NFD"));
    if (!(file instanceof TFile)) {
      new Notice(`InkStone: "${target.file}" isn't in this vault, so it can't be opened here.`);
      return;
    }
    const leaf = this.editorLeaf();
    const view = leaf.view;
    if (view instanceof FileView && view.file === file) return;
    // The preview already shows this page; don't bounce it back.
    this.activeFile = file;
    void leaf.openFile(file, { active: false });
  }

  // ---- owner view ----

  private setOwnerView(on: boolean): void {
    this.plugin.server.setOwnerUnlock(on);
    this.sessionUnlocked = false;
    if (!on) {
      // Fresh in-memory partition = no unlock cookie = visitor view.
      this.partition = newPartition();
      this.webview?.remove();
      this.webview = null;
    }
    const target = this.currentPageTarget();
    if (target) {
      this.navigate(target, true);
    } else {
      this.currentUrl = null;
      this.evaluate();
    }
  }

  /** The page the webview is on, re-decided for the current owner state. */
  private currentPageTarget(): string | null {
    const base = this.baseUrl;
    const cur = this.currentUrl;
    if (!base || !cur || originOf(cur) !== originOf(base)) return null;
    const entry = this.map?.fileForUrl(cur);
    if (entry) {
      const owner = this.plugin.server.ownerUnlock;
      const t = decidePreviewTarget(entry, owner, owner ? this.plugin.server.token : "");
      if (t.kind === "url") return base + t.url;
    }
    try {
      const u = new URL(cur);
      u.searchParams.delete("token");
      return u.toString();
    } catch {
      return null;
    }
  }

  // ---- UI ----

  private buildUi(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("inkstone-preview");

    const bar = root.createDiv({ cls: "inkstone-toolbar" });
    this.dotEl = bar.createSpan({ cls: "inkstone-dot" });
    this.urlEl = bar.createEl("input", {
      cls: "inkstone-url",
      attr: { type: "text", readonly: "", "aria-label": "Current URL" },
    });
    this.privateBadgeEl = bar.createSpan({
      cls: "inkstone-badge",
      text: "Private",
      attr: { title: "Not published: visitors see the Private Note placeholder" },
    });
    this.privateBadgeEl.hide();

    const owner = bar.createEl("label", {
      cls: "inkstone-owner",
      attr: { title: "Show private notes as the owner sees them" },
    });
    this.ownerInput = owner.createEl("input", { attr: { type: "checkbox" } });
    this.ownerInput.checked = this.plugin.server.ownerUnlock;
    owner.appendText("Owner view");
    this.ownerInput.addEventListener("change", () =>
      this.setOwnerView(this.ownerInput.checked),
    );

    this.restartBtn = bar.createEl("button", {
      cls: "inkstone-restart mod-warning",
      text: "Restart",
    });
    this.restartBtn.addEventListener("click", () =>
      void this.plugin.restartServer(),
    );
    this.restartBtn.hide();

    this.stageEl = root.createDiv({ cls: "inkstone-stage" });
    this.panelEl = this.stageEl.createDiv({ cls: "inkstone-panel" });
    this.panelEl.hide();
  }

  private updateDot(status: ServerStatus): void {
    this.dotEl.className = `inkstone-dot is-${status}`;
    this.dotEl.setAttribute("aria-label", `Server ${status}`);
    this.dotEl.setAttribute("title", `Server ${status}`);
  }

  private setPrivateBadge(on: boolean): void {
    this.privateBadgeEl.toggle(on);
  }

  private showServerError(message: string, pageCanShow = false): void {
    const actions: PanelAction[] = [
      { label: "Restart server", onClick: () => void this.plugin.restartServer() },
    ];
    if (pageCanShow && this.webview) {
      actions.push({ label: "Show page", onClick: () => this.hidePanel() });
    }
    // stderr also carries werkzeug's request log; the tail is what matters.
    const stderr = this.plugin.server.lastStderr
      .trim()
      .split("\n")
      .slice(-STDERR_LINES)
      .join("\n");
    const startErr = this.plugin.lastStartError;
    this.showPanel({
      title: message,
      body: startErr && startErr !== message ? startErr : undefined,
      detail: stderr || undefined,
      error: true,
      actions,
    });
  }

  private showPanel(spec: PanelSpec): void {
    const p = this.panelEl;
    p.empty();
    p.toggleClass("is-error", !!spec.error);
    p.createEl("h3", { text: spec.title });
    if (spec.body) p.createEl("p", { text: spec.body });
    const pre = spec.detail
      ? p.createEl("pre", { cls: "inkstone-stderr", text: spec.detail })
      : null;
    if (spec.actions?.length) {
      const row = p.createDiv({ cls: "inkstone-actions" });
      for (const a of spec.actions) {
        const b = row.createEl("button", { text: a.label });
        b.addEventListener("click", a.onClick);
      }
    }
    p.show();
    this.stageEl.addClass("has-panel");
    if (pre) pre.scrollTop = pre.scrollHeight;
  }

  private hidePanel(): void {
    this.panelEl.hide();
    this.stageEl.removeClass("has-panel");
  }
}
