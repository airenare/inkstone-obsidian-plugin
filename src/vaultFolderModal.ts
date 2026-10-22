import { App, FuzzyMatch, FuzzySuggestModal, TFolder } from "obsidian";
import {
  depthOf,
  folderLabel,
  siteSettingFor,
  sortFolders,
} from "./vaultFolders";

/**
 * Pick a folder from the vault's folder tree (or the vault root). Folders
 * are listed in tree order, indented by depth, and searchable by path.
 */
export class VaultFolderModal extends FuzzySuggestModal<TFolder> {
  constructor(
    app: App,
    private readonly onPick: (siteSetting: string) => void,
  ) {
    super(app);
    this.setPlaceholder("Choose the site folder, or type to filter");
  }

  getItems(): TFolder[] {
    const folders = this.app.vault.getAllFolders(true);
    const byPath = new Map(folders.map((f) => [f.path, f]));
    const order = sortFolders(
      folders.map((f) => ({ path: f.path, isRoot: f.isRoot() })),
    );
    return order.flatMap((e) => byPath.get(e.path) ?? []);
  }

  getItemText(folder: TFolder): string {
    return folder.isRoot() ? "Vault root" : folder.path;
  }

  renderSuggestion(match: FuzzyMatch<TFolder>, el: HTMLElement): void {
    const entry = { path: match.item.path, isRoot: match.item.isRoot() };
    el.addClass("inkstone-folder-row");
    el.setCssProps({ "--inkstone-depth": String(depthOf(entry)) });
    el.createSpan({ text: folderLabel(entry), cls: "inkstone-folder-name" });
    if (!entry.isRoot && depthOf(entry) > 1) {
      el.createSpan({ text: entry.path, cls: "inkstone-folder-path" });
    }
  }

  onChooseItem(folder: TFolder): void {
    this.onPick(siteSettingFor({ path: folder.path, isRoot: folder.isRoot() }));
  }
}
