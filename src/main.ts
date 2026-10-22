import { FileSystemAdapter, Notice, Plugin, type TAbstractFile } from "obsidian";
import {
  pathsToNotify,
  RELOAD_DEBOUNCE_MS,
  createReloadScheduler,
  type ReloadScheduler,
} from "./autoReload";
import { GitService } from "./git";
import {
  realDeps as envDeps,
  validateEnvironment,
  type EnvironmentResult,
} from "./environment";
import { resolveSiteFolder } from "./paths";
import { serverSettingsChanged } from "./settingsChange";
import { InkStonePreviewView, VIEW_TYPE_PREVIEW } from "./previewView";
import { InkStoneServer, type ServerStatus } from "./server";
import {
  DEFAULT_SETTINGS,
  InkStoneSettings,
  InkStoneSettingTab,
} from "./settings";

const GIT_REFRESH_DEBOUNCE_MS = 1000;
const SETTINGS_RESTART_DEBOUNCE_MS = 1000;

export type StartResult =
  | { ok: true; baseUrl: string }
  | { ok: false; kind: "env" | "start"; message: string };

export default class InkStonePlugin extends Plugin {
  settings: InkStoneSettings = { ...DEFAULT_SETTINGS };
  server!: InkStoneServer;
  /** Why the last start attempt failed; "" after a successful start. */
  lastStartError = "";
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
      id: "restart-server",
      name: "Restart server",
      callback: () => void this.restartServer(),
    });
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
