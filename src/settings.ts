import { App, Notice, PluginSettingTab, Setting, TextComponent } from "obsidian";
import {
  defaultPythonPath,
  folderFromPickedFile,
} from "./environment";
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
  private pythonText: TextComponent | undefined;
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
        "Folder holding your site notes. Relative paths resolve against " +
          "the vault. Folders outside the vault still preview, but " +
          "auto-reload and editor sync only work inside the vault.",
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
      .addText((t) => {
        this.pythonText = t;
        return t
          .setPlaceholder(defaultPythonPath(s.inkstoneCheckout || "<checkout>", process.platform))
          .setValue(s.pythonPath)
          .onChange((v) => this.applyChange({ pythonPath: v }));
      });

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
      const file = input.files?.[0];
      const picked = file ? this.pathOf(file) : "";
      if (file && picked) {
        const dir = folderFromPickedFile(picked, file.webkitRelativePath);
        this.applyChange({ siteFolder: dir });
        this.display();
      } else {
        new Notice(
          "Couldn't read the folder path; type it into the field instead.",
        );
      }
    };
    input.click();
  }

  private pathOf(file: File): string {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const electron = require("electron");
      const p = electron?.webUtils?.getPathForFile?.(file);
      if (p) return p;
    } catch {
      // not available; fall through
    }
    return (file as File & { path?: string }).path ?? "";
  }

  private applyChange(patch: Partial<InkStoneSettings>, rederive = false): void {
    const s = this.plugin.settings;
    const prevDefault = defaultPythonPath(s.inkstoneCheckout, process.platform);
    Object.assign(s, patch);
    if (rederive && (!s.pythonPath || s.pythonPath === prevDefault)) {
      s.pythonPath = s.inkstoneCheckout
        ? defaultPythonPath(s.inkstoneCheckout, process.platform)
        : "";
      this.pythonText?.setValue(s.pythonPath);
    }
    void this.plugin.saveSettings();
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.refreshStatus(), 400);
  }

  private async refreshStatus(): Promise<void> {
    this.statusEl.setText("Checking environment...");
    const r = await this.plugin.validate();
    this.statusEl.setText(r.ok ? "Environment OK." : r.problem);
    this.statusEl.toggleClass("mod-warning", !r.ok);
  }
}
