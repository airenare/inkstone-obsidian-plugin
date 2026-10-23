import {
  App,
  FileSystemAdapter,
  MarkdownView,
  Notice,
  Plugin,
  type TAbstractFile,
  type TFile,
  type WorkspaceLeaf,
} from "obsidian";
import {
  pathsToNotify,
  RELOAD_DEBOUNCE_MS,
  createReloadScheduler,
  type ReloadScheduler,
} from "./autoReload";
import { CREATE_COMMANDS } from "./createCommands";
import { planCreation, type CreateType } from "./createNoteLogic";
import { CreateNoteModal } from "./createNoteModal";
import { executePlan } from "./createNotes";
import { GitService } from "./git";
import { LanguagePicker } from "./languagePicker";
import { relativeToSite } from "./notePaths";
import { todayIso } from "./noteTemplates";
import {
  decideFirstRun,
  siteFolderInVault,
  type FirstRun,
} from "./previewLogic";
import { hasRootHomepage, knownLanguages } from "./siteIndex";
import { scanSite } from "./siteScan";
import {
  realDeps as envDeps,
  validateEnvironment,
  type EnvironmentResult,
} from "./environment";
import { resolveSiteFolder } from "./paths";
import { serverSettingsChanged } from "./settingsChange";
import { InkStonePreviewView, VIEW_TYPE_PREVIEW } from "./previewView";
import { Trace } from "./trace";
import { InkStoneServer, type ServerStatus } from "./server";
import {
  DEFAULT_SETTINGS,
  InkStoneSettings,
  InkStoneSettingTab,
} from "./settings";

const GIT_REFRESH_DEBOUNCE_MS = 1000;
const SETTINGS_RESTART_DEBOUNCE_MS = 1000;

/** Obsidian's settings window; not in the public typings. */
interface AppSettingWindow {
  open(): void;
  openTabById(id: string): void;
}

export interface CreateDialogOptions {
  /** Never offer the site root (secondary homepage). */
  secondary?: boolean;
  /** Editor leaf to use when no Markdown view is active (the pane). */
  leaf?: WorkspaceLeaf | null;
}

/** Vault path of a file's folder; "" for the vault root. */
function folderOf(file: TFile): string {
  const path = file.parent?.path ?? "";
  return path === "/" ? "" : path;
}

export type StartResult =
  | { ok: true; baseUrl: string }
  | { ok: false; kind: "env" | "start"; message: string };

export default class InkStonePlugin extends Plugin {
  settings: InkStoneSettings = { ...DEFAULT_SETTINGS };
  server!: InkStoneServer;
  /** Why the last start attempt failed; "" after a successful start. */
  lastStartError = "";
  /** Timeline of preview events, shared by every preview view. */
  readonly trace = new Trace();
  private reloader: ReloadScheduler | null = null;
  private gitRefresher: ReloadScheduler | null = null;
  private settingsRestarter: ReloadScheduler | null = null;
  /** Settings as last saved; compared on save to spot server changes. */
  private savedSettings: InkStoneSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    await this.loadSettings();
    this.server = new InkStoneServer(this.settings, {
      vaultBasePath: () => this.vaultBasePath(),
    });
    // One listener for the plugin's lifetime; views come and go.
    this.server.on("status", (s) => {
      for (const v of this.previewViews()) {
        v.onServerStatus(s as ServerStatus);
      }
    });

    this.reloader = createReloadScheduler(
      () => this.flushReload(),
      RELOAD_DEBOUNCE_MS,
    );
    this.gitRefresher = createReloadScheduler(async () => {
      await Promise.all(this.previewViews().map((v) => v.refreshGit()));
    }, GIT_REFRESH_DEBOUNCE_MS);
    this.settingsRestarter = createReloadScheduler(
      () => this.applyServerSettings(),
      SETTINGS_RESTART_DEBOUNCE_MS,
    );
    const { vault } = this.app;
    this.registerEvent(
      vault.on("modify", (f) => this.onVaultChange(f.path)),
    );
    this.registerEvent(
      vault.on("create", (f) => this.onVaultChange(f.path)),
    );
    this.registerEvent(
      vault.on("delete", (f) => this.onVaultChange(f.path)),
    );
    this.registerEvent(
      vault.on("rename", (f: TAbstractFile, oldPath: string) =>
        this.onVaultChange(f.path, oldPath),
      ),
    );

    this.registerView(
      VIEW_TYPE_PREVIEW,
      (leaf) => new InkStonePreviewView(leaf, this),
    );
    this.addRibbonIcon("globe", "Open preview", () => {
      void this.activatePreview();
    });
    this.addCommand({
      id: "open-preview",
      name: "Open preview",
      callback: () => void this.activatePreview(),
    });
    this.addCommand({
      id: "copy-timing-log",
      name: "Copy preview timing log",
      callback: () => void this.copyTimingLog(),
    });
    this.addCommand({
      id: "restart-server",
      name: "Restart server",
      callback: () => void this.restartServer(),
    });
    this.addCommand({
      id: "stop-server",
      name: "Stop server",
      callback: () => void this.stopServerAndClose(),
    });
    for (const c of CREATE_COMMANDS) {
      this.addCommand({
        id: c.id,
        name: c.name,
        callback: () =>
          this.openCreateDialog(c.type, { secondary: c.secondary }),
      });
    }
    this.addSettingTab(new InkStoneSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.autoStartServer) {
        void (async () => {
          const r = await this.startServer();
          if (!r.ok) new Notice(`InkStone: ${r.message}`);
        })();
      }
    });
  }

  onunload(): void {
    this.reloader?.dispose();
    this.reloader = null;
    this.gitRefresher?.dispose();
    this.gitRefresher = null;
    this.settingsRestarter?.dispose();
    this.settingsRestarter = null;
    // stop() kills the process tree synchronously before its first await.
    void this.server?.stop();
  }

  private onVaultChange(...paths: string[]): void {
    const vaultBase = this.vaultBasePath();
    const site = this.siteFolderPath();
    if (!vaultBase || !site) return;
    if (!pathsToNotify(vaultBase, site, paths)) return;
    // Git panel refresh is independent of the server and is a no-op
    // while the panel is collapsed.
    this.gitRefresher?.notify();
    if (this.server.status === "running") this.reloader?.notify();
  }

  private async flushReload(): Promise<void> {
    if (this.server.status !== "running") return;
    for (const v of this.previewViews()) {
      try {
        await v.refreshAndReload();
      } catch {
        console.error("InkStone: auto-reload failed for a preview");
      }
    }
  }

  /** The vault's folder on disk, or null when the adapter has none. */
  vaultBasePath(): string | null {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
  }

  /** The absolute site folder, or null when none is usable. */
  siteFolderPath(): string | null {
    return resolveSiteFolder(
      this.settings.siteFolder,
      this.vaultBasePath(),
      process.platform,
    );
  }

  /**
   * The site folder as a vault path ("" for the vault root), or null when
   * it is unset or lies outside the vault.
   */
  siteRel(): string | null {
    const vaultBase = this.vaultBasePath();
    const site = this.siteFolderPath();
    if (!vaultBase || !site) return null;
    return siteFolderInVault(vaultBase, site);
  }

  /** Both the InkStone checkout and a usable site folder are set. */
  isConfigured(): boolean {
    return (
      this.settings.inkstoneCheckout.trim() !== "" &&
      this.siteFolderPath() !== null
    );
  }

  /**
   * Which first-run state the preview pane is in. A site folder outside
   * the vault can't be scanned, so it counts as ready (today's flows).
   */
  firstRunState(): FirstRun {
    if (!this.isConfigured()) return "setup";
    const siteRel = this.siteRel();
    if (siteRel === null) return "ready";
    const notes = scanSite(this.app, siteRel);
    return decideFirstRun(true, hasRootHomepage(notes));
  }

  /** Opens Obsidian's settings on this plugin's tab. */
  openSettings(): void {
    const app = this.app as App & { setting?: AppSettingWindow };
    if (!app.setting) {
      new Notice("Open this plugin's tab in Obsidian's settings.");
      return;
    }
    app.setting.open();
    app.setting.openTabById(this.manifest.id);
  }

  /** The site folder as a vault path, or a Notice and null. */
  private siteRelOrNotice(): string | null {
    if (!this.settings.siteFolder.trim()) {
      new Notice("Set the site folder in the plugin settings first.");
      return null;
    }
    const siteRel = this.siteRel();
    if (siteRel === null) {
      new Notice(
        "The site folder must be inside this vault to create notes.",
      );
    }
    return siteRel;
  }

  /** The active Markdown view, else the given or most recent one. */
  private markdownView(leaf?: WorkspaceLeaf | null): MarkdownView | null {
    const { workspace } = this.app;
    const active = workspace.getActiveViewOfType(MarkdownView);
    if (active) return active;
    if (leaf?.view instanceof MarkdownView) return leaf.view;
    const recent = workspace.getMostRecentLeaf();
    return recent?.view instanceof MarkdownView ? recent.view : null;
  }

  /** Opens the creation flow for a note type. */
  openCreateDialog(type: CreateType, opts: CreateDialogOptions = {}): void {
    const siteRel = this.siteRelOrNotice();
    if (siteRel === null) return;
    if (type === "translations") {
      this.createTranslations(siteRel);
      return;
    }
    const view = this.markdownView(opts.leaf);
    const editor = view?.editor ?? null;
    const file = view?.file ?? null;
    const activeFolder = file ? folderOf(file) : null;
    if (type === "variant") {
      const rel = file ? relativeToSite(file.path, siteRel) : null;
      if (!file || file.extension !== "md" || !rel) {
        new Notice("Open a note in the site folder to create a variant.");
        return;
      }
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) {
        new Notice(
          "Obsidian hasn't indexed this note yet. Try again in a moment.",
        );
        return;
      }
      const fm: Record<string, unknown> = { ...(cache.frontmatter ?? {}) };
      const known = knownLanguages(scanSite(this.app, siteRel));
      new LanguagePicker(this.app, known, (code) => {
        new CreateNoteModal(this.app, {
          type,
          siteRel,
          editor,
          sourceLeaf: view?.leaf ?? null,
          activeFolder,
          variantSource: { path: file.path, fm },
          language: code,
        }).open();
      }).open();
      return;
    }
    new CreateNoteModal(this.app, {
      type,
      siteRel,
      editor,
      sourceLeaf: view?.leaf ?? null,
      activeFolder,
      secondary: opts.secondary,
    }).open();
  }

  /** Picks a language, then writes its translations note directly. */
  private createTranslations(siteRel: string): void {
    const known = knownLanguages(scanSite(this.app, siteRel));
    new LanguagePicker(this.app, known, (code) => {
      // Scan again: the picker may have stayed open while notes changed.
      const result = planCreation(
        { type: "translations", name: "", folder: siteRel, language: code },
        {
          siteRel,
          notes: scanSite(this.app, siteRel),
          exists: (p) => this.app.vault.getAbstractFileByPath(p) !== null,
          today: todayIso(),
        },
      );
      if (!result.ok) {
        new Notice(result.error);
        return;
      }
      // executePlan reports success (and partial failure) itself; a plain
      // failure means nothing was written and is shown here.
      executePlan(this.app, result.plan, null).then(
        (done) => {
          if (!done.ok) new Notice(done.error);
        },
        (err: unknown) => {
          const text = err instanceof Error ? err.message : String(err);
          new Notice(`Couldn't create the translations note: ${text}`);
        },
      );
    }).open();
  }

  /** A git service for the site folder; null when none is set. */
  gitService(): GitService | null {
    const site = this.siteFolderPath();
    return site ? new GitService(site) : null;
  }

  /** Checks the current settings (relative paths against the vault). */
  validate(): Promise<EnvironmentResult> {
    return validateEnvironment(this.settings, {
      ...envDeps,
      vaultBasePath: this.vaultBasePath(),
    });
  }

  private previewViews(): InkStonePreviewView[] {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE_PREVIEW)
      .map((l) => l.view)
      .filter(
        (v): v is InkStonePreviewView => v instanceof InkStonePreviewView,
      );
  }

  async activatePreview(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_PREVIEW)[0];
    if (existing) {
      await workspace.revealLeaf(existing);
      return;
    }
    const leaf = workspace.getLeaf("split", "vertical");
    await leaf.setViewState({ type: VIEW_TYPE_PREVIEW, active: true });
    await workspace.revealLeaf(leaf);
  }

  /** Validates settings, then starts the server (no-op when running). */
  async startServer(): Promise<StartResult> {
    if (this.server.status !== "running") {
      const env = await this.validate();
      if (!env.ok) return { ok: false, kind: "env", message: env.problem };
    }
    try {
      const { baseUrl } = await this.server.start();
      this.lastStartError = "";
      return { ok: true, baseUrl };
    } catch (e) {
      return this.startFailed(e);
    }
  }

  /**
   * Stops the server and closes the preview pane. Opening the preview
   * again starts the server as usual.
   */
  async stopServerAndClose(): Promise<void> {
    await this.server.stop();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_PREVIEW);
  }

  async restartServer(): Promise<void> {
    const env = await this.validate();
    if (!env.ok) {
      this.reportEnvProblem(env.problem);
      return;
    }
    await this.restartValidated();
  }

  /** Server settings changed while it runs: restart with them. */
  private async applyServerSettings(): Promise<void> {
    const st = this.server.status;
    if (st !== "running" && st !== "starting") return;
    const env = await this.validate();
    if (!env.ok) {
      this.reportEnvProblem(env.problem);
      return;
    }
    new Notice("Restarting the server with the new settings");
    await this.restartValidated();
  }

  private reportEnvProblem(problem: string): void {
    new Notice(`InkStone: ${problem}`);
    for (const v of this.previewViews()) v.showEnvProblem(problem);
  }

  private async restartValidated(): Promise<void> {
    try {
      await this.server.restart();
      this.lastStartError = "";
    } catch (e) {
      const r = this.startFailed(e);
      if (!r.ok) new Notice(`InkStone: ${r.message}`);
    }
  }

  private startFailed(e: unknown): StartResult {
    const message = e instanceof Error ? e.message : String(e);
    // A cancelled start (a stop/restart raced it) is not worth showing.
    if (this.server.status === "crashed") {
      this.lastStartError = message;
      for (const v of this.previewViews()) v.onServerStatus("crashed");
    }
    return { ok: false, kind: "start", message };
  }

  /** Copies the latest preview click-to-page timeline to the clipboard. */
  private async copyTimingLog(): Promise<void> {
    const text = this.trace.format();
    try {
      await navigator.clipboard.writeText(text);
      new Notice("Preview timing log copied to the clipboard.");
    } catch {
      new Notice("Couldn't copy the timing log; it's in the developer console.");
      console.error(text);
    }
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<InkStoneSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    this.savedSettings = { ...this.settings };
  }

  async saveSettings(): Promise<void> {
    const changed = serverSettingsChanged(this.savedSettings, this.settings);
    this.savedSettings = { ...this.settings };
    await this.saveData(this.settings);
    const st = this.server?.status;
    if (changed && (st === "running" || st === "starting")) {
      this.settingsRestarter?.notify();
    }
  }
}
