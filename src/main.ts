import { Notice, Plugin } from "obsidian";
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

  async onload(): Promise<void> {
    await this.loadSettings();
    this.server = new InkStoneServer(this.settings);
    // One listener for the plugin's lifetime; views come and go.
    this.server.on("status", (s) => {
      for (const v of this.previewViews()) {
        v.onServerStatus(s as ServerStatus);
      }
    });

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
    // stop() kills the process tree synchronously before its first await.
    void this.server?.stop();
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
