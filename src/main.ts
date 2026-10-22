import { FileSystemAdapter, Notice, Plugin, type TAbstractFile } from "obsidian";
import { resolve as resolvePath } from "path";
import {
  pathsToNotify,
  RELOAD_DEBOUNCE_MS,
  ReloadScheduler,
} from "./autoReload";
import { validateEnvironment } from "./environment";
import { InkStonePreviewView, VIEW_TYPE_PREVIEW } from "./previewView";
import { InkStoneServer, type ServerStatus } from "./server";
import {
  DEFAULT_SETTINGS,
  InkStoneSettings,
  InkStoneSettingTab,
} from "./settings";

export type StartResult =
  | { ok: true; baseUrl: string }
  | { ok: false; kind: "env" | "start"; message: string };

export default class InkStonePlugin extends Plugin {
  settings: InkStoneSettings = { ...DEFAULT_SETTINGS };
  server!: InkStoneServer;
  /** Why the last start attempt failed; "" after a successful start. */
  lastStartError = "";
  private reloader: ReloadScheduler | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.server = new InkStoneServer(this.settings);
    // One listener for the plugin's lifetime; views come and go.
    this.server.on("status", (s) => {
      for (const v of this.previewViews()) {
        v.onServerStatus(s as ServerStatus);
      }
    });

    this.reloader = new ReloadScheduler(
      () => void this.flushReload(),
      RELOAD_DEBOUNCE_MS,
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
    this.addRibbonIcon("globe", "Open InkStone preview", () => {
      void this.activatePreview();
    });
    this.addCommand({
      id: "open-preview",
      name: "Open InkStone preview",
      callback: () => void this.activatePreview(),
    });
    this.addCommand({
      id: "restart-server",
      name: "Restart InkStone server",
      callback: () => void this.restartServer(),
    });
    this.addSettingTab(new InkStoneSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.autoStartServer) {
        void this.startServer().then((r) => {
          if (!r.ok) new Notice(`InkStone: ${r.message}`);
        });
      }
    });
  }

  onunload(): void {
    this.reloader?.dispose();
    this.reloader = null;
    // stop() kills the process tree synchronously before its first await.
    void this.server?.stop();
  }

  private onVaultChange(...paths: string[]): void {
    if (this.server.status !== "running") return;
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return;
    const site = resolvePath(this.settings.siteFolder);
    if (pathsToNotify(adapter.getBasePath(), site, paths)) {
      this.reloader?.notify();
    }
  }

  private async flushReload(): Promise<void> {
    if (this.server.status !== "running") return;
    for (const v of this.previewViews()) {
      try {
        await v.refreshAndReload();
      } catch {
        console.warn("InkStone: auto-reload failed for a preview");
      }
    }
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
      const env = await validateEnvironment(this.settings);
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
    const env = await validateEnvironment(this.settings);
    if (!env.ok) {
      new Notice(`InkStone: ${env.problem}`);
      for (const v of this.previewViews()) v.showEnvProblem(env.problem);
      return;
    }
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
