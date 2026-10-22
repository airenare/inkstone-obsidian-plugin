import { App, PluginSettingTab, Setting } from "obsidian";
import { defaultPythonPath, validateEnvironment } from "./environment";
import type InkStonePlugin from "./main";

export interface InkStoneSettings {
  siteFolder: string;
  inkstoneCheckout: string;
  pythonPath: string;
  autoStartServer: boolean;
}

export const DEFAULT_SETTINGS: InkStoneSettings = {
  siteFolder: "",
  inkstoneCheckout: "",
  pythonPath: "",
  autoStartServer: false,
};

export class InkStoneSettingTab extends PluginSettingTab {
  private plugin: InkStonePlugin;
  private statusEl!: HTMLElement;
  private timer: number | undefined;

  constructor(app: App, plugin: InkStonePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;

    this.statusEl = containerEl.createDiv({ cls: "inkstone-status" });

    const folder = new Setting(containerEl)
      .setName("Site folder")
      .setDesc(
        "Folder holding your site notes. Any folder in the vault or on disk.",
      );
    folder.addText((t) =>
      t.setValue(s.siteFolder).onChange((v) => this.applyChange({ siteFolder: v })),
    );
    folder.addButton((b) =>
      b.setButtonText("Browse").onClick(() => this.pickFolder()),
    );

    new Setting(containerEl)
      .setName("InkStone checkout")
      .setDesc("Folder where you cloned InkStone (contains app.py).")
      .addText((t) =>
        t
          .setValue(s.inkstoneCheckout)
          .onChange((v) => this.applyChange({ inkstoneCheckout: v }, true)),
      );

    new Setting(containerEl)
      .setName("Python executable")
      .setDesc(
        "Defaults to the venv inside the checkout. Must have InkStone's requirements installed.",
      )
      .addText((t) =>
        t
          .setPlaceholder(defaultPythonPath(s.inkstoneCheckout || "<checkout>", process.platform))
          .setValue(s.pythonPath)
          .onChange((v) => this.applyChange({ pythonPath: v })),
      );

    new Setting(containerEl)
      .setName("Start server automatically")
      .setDesc("Start the preview server when Obsidian opens.")
      .addToggle((tg) =>
        tg
          .setValue(s.autoStartServer)
          .onChange((v) => this.applyChange({ autoStartServer: v })),
      );

    void this.refreshStatus();
  }

  hide(): void {
    window.clearTimeout(this.timer);
  }

  private pickFolder(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.setAttribute("webkitdirectory", "");
    input.onchange = () => {
      const file = input.files?.[0] as (File & { path?: string }) | undefined;
      const rel = file?.webkitRelativePath.split("/")[0];
      if (file?.path && rel) {
        const idx = file.path.lastIndexOf(rel);
        this.applyChange({ siteFolder: file.path.slice(0, idx + rel.length) });
        this.display();
      }
    };
    input.click();
  }

  private applyChange(patch: Partial<InkStoneSettings>, rederive = false): void {
    const s = this.plugin.settings;
    const prevDefault = defaultPythonPath(s.inkstoneCheckout, process.platform);
    Object.assign(s, patch);
    if (rederive && (!s.pythonPath || s.pythonPath === prevDefault)) {
      s.pythonPath = s.inkstoneCheckout
        ? defaultPythonPath(s.inkstoneCheckout, process.platform)
        : "";
    }
    void this.plugin.saveSettings();
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.refreshStatus(), 400);
  }

  private async refreshStatus(): Promise<void> {
    this.statusEl.setText("Checking environment...");
    const r = await validateEnvironment(this.plugin.settings);
    this.statusEl.setText(r.ok ? "Environment OK." : r.problem);
    this.statusEl.toggleClass("mod-warning", !r.ok);
  }
}
