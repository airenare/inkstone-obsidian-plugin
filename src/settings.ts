import {
  App,
  Notice,
  PluginSettingTab,
  Setting,
  SettingDefinitionItem,
  TextComponent,
} from "obsidian";
import { pickDiskFolder } from "./diskPicker";
import { defaultPythonPath } from "./environment";
import type InkStonePlugin from "./main";
import { VaultFolderModal } from "./vaultFolderModal";

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
  private siteText: TextComponent | undefined;
  private checkoutText: TextComponent | undefined;
  private pythonText: TextComponent | undefined;
  private statusSetting: Setting | undefined;
  private timer: number | undefined;

  constructor(app: App, plugin: InkStonePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const s = this.plugin.settings;
    return [
      {
        name: "Environment",
        desc: "Checking...",
        searchable: false,
        render: (setting) => {
          this.statusSetting = setting;
          setting.settingEl.addClass("inkstone-status");
          void this.refreshStatus();
        },
      },
      {
        name: "Site folder",
        desc:
          "Folder holding your site notes. Choose one from your vault " +
          "(a dot is the vault root), or browse to any folder on disk. " +
          "Relative paths resolve against the vault. Folders outside the " +
          "vault still preview, but auto-reload and editor sync only work " +
          "inside the vault.",
        aliases: ["notes", "vault", "root", "directory"],
        render: (setting) => {
          setting.addText((t) => {
            this.siteText = t;
            t.setPlaceholder("Folder in your vault, or a full path")
              .setValue(s.siteFolder)
              .onChange((v) => this.applyChange({ siteFolder: v }));
          });
          setting.addButton((b) =>
            b.setButtonText("Choose from vault").onClick(() => {
              new VaultFolderModal(this.app, (value) => {
                this.siteText?.setValue(value);
                this.applyChange({ siteFolder: value });
              }).open();
            }),
          );
          setting.addButton((b) =>
            b.setButtonText("Browse").onClick(() => {
              void this.browse("Choose the site folder", (dir) => {
                this.siteText?.setValue(dir);
                this.applyChange({ siteFolder: dir });
              });
            }),
          );
        },
      },
      {
        name: "Checkout folder",
        desc: "The local clone of the engine: the folder with app.py.",
        aliases: ["inkstone", "engine", "repository", "clone"],
        render: (setting) => {
          setting.addText((t) => {
            this.checkoutText = t;
            t.setValue(s.inkstoneCheckout).onChange((v) =>
              this.applyChange({ inkstoneCheckout: v }, true),
            );
          });
          setting.addButton((b) =>
            b.setButtonText("Browse").onClick(() => {
              void this.browse("Choose the checkout folder", (dir) => {
                this.checkoutText?.setValue(dir);
                this.applyChange({ inkstoneCheckout: dir }, true);
              });
            }),
          );
        },
      },
      {
        name: "Python executable",
        desc:
          "Defaults to the venv inside the checkout. Must have the " +
          "engine's requirements installed.",
        aliases: ["venv", "interpreter"],
        render: (setting) => {
          setting.addText((t) => {
            this.pythonText = t;
            t.setPlaceholder(
              defaultPythonPath(s.inkstoneCheckout || "<checkout>", process.platform),
            )
              .setValue(s.pythonPath)
              .onChange((v) => this.applyChange({ pythonPath: v }));
          });
        },
      },
      {
        name: "Start server automatically",
        desc: "Start the preview server when Obsidian opens.",
        control: { type: "toggle", key: "autoStartServer" },
      },
    ];
  }

  getControlValue(key: string): unknown {
    return this.plugin.settings[key as keyof InkStoneSettings];
  }

  setControlValue(key: string, value: unknown): void {
    this.applyChange({ [key]: value });
  }

  hide(): void {
    window.clearTimeout(this.timer);
  }

  /** Opens a disk folder picker and hands the result to `apply`. */
  private async browse(
    title: string,
    apply: (dir: string) => void,
  ): Promise<void> {
    const r = await pickDiskFolder(title);
    if (r.kind === "picked") {
      apply(r.path);
    } else if (r.kind === "unavailable") {
      new Notice(
        "Couldn't open a folder picker here. Type the path into the field instead.",
      );
      console.error(`InkStone: folder picker unavailable (${r.reason})`);
    }
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
    const setting = this.statusSetting;
    if (!setting) return;
    setting.setDesc("Checking...");
    const r = await this.plugin.validate();
    setting.setDesc(r.ok ? "Everything looks good." : r.problem);
    setting.settingEl.toggleClass("mod-warning", !r.ok);
  }
}
