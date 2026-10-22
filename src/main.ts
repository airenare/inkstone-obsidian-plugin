import { Plugin } from "obsidian";
import {
  DEFAULT_SETTINGS,
  InkStoneSettings,
  InkStoneSettingTab,
} from "./settings";

export default class InkStonePlugin extends Plugin {
  settings: InkStoneSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new InkStoneSettingTab(this.app, this));
  }

  onunload(): void {}

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
