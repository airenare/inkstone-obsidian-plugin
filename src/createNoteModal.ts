import {
  App,
  ButtonComponent,
  Editor,
  Modal,
  Setting,
  TextComponent,
  ToggleComponent,
} from "obsidian";
import {
  fieldVisibility,
  noteFileBase,
  planCreation,
  type CreateRequest,
  type CreateType,
  type FieldVisibility,
  type PlanResult,
} from "./createNoteLogic";
import { executePlan } from "./createNotes";
import { LanguagePicker } from "./languagePicker";
import {
  isEnglish,
  joinVaultPath,
  normalizeLang,
  relativeToSite,
  sanitizeName,
} from "./notePaths";
import { generateToken, todayIso } from "./noteTemplates";
import {
  existingTranslations,
  hasRootHomepage,
  knownLanguages,
  type SiteNote,
} from "./siteIndex";
import { scanSite } from "./siteScan";

export interface CreateNoteOptions {
  type: CreateType;
  /** Site folder as a vault path; "" when it is the vault root. */
  siteRel: string;
  editor: Editor | null;
  /** Vault path of the open note's folder, if any. */
  activeFolder: string | null;
  variantSource?: { path: string; fm: Record<string, unknown> };
  /** Never offer the site root as the folder (secondary homepage). */
  secondary?: boolean;
  /** Initial language code (variant, translations, root homepage). */
  language?: string;
}

type LocationMode = "root" | "current" | "existing" | "new";

type FolderChoice =
  | { ok: true; folder: string }
  | { ok: false; folder: string; error: string };

const TITLES: Record<CreateType, string> = {
  homepage: "Create homepage",
  page: "Create page",
  book: "Create book",
  listing: "Create listing",
  feed: "Create feed",
  translations: "Create translations note",
  variant: "Create language variant",
};

const MODE_LABELS: Record<LocationMode, string> = {
  root: "Site root",
  current: "Open note's folder",
  existing: "Existing folder",
  new: "New folder",
};

/** Folders Obsidian users keep media or drafts in; never a section. */
function isSkippedFolder(rel: string): boolean {
  return rel
    .split("/")
    .some((s) => s.startsWith(".") || s === "_attachments");
}

/**
 * The creation dialog. It only collects input: what to write, and which
 * fields to show, comes from `planCreation` and `fieldVisibility`.
 */
export class CreateNoteModal extends Modal {
  private readonly opts: CreateNoteOptions;
  private notes: SiteNote[];
  private readonly folders: string[];
  private readonly modes: LocationMode[];

  private name = "";
  private isPrivate = false;
  private token = "";
  private mode: LocationMode;
  private existingFolder = "";
  private newFolder = "";
  private navigation = false;
  private insertLink = false;
  private language: string;
  private defaultTheme = "";
  private showSearch = false;
  private showTags = false;
  private siteTitle = "";
  private icon = "";
  private theme = "";
  private tags = "";
  private summary = "";
  private alsoTranslations = true;
  private alsoTouched = false;
  private attempted = false;
  private busy = false;
  private focused = false;

  private nameHintEl: HTMLElement | null = null;
  private folderHintEl: HTMLElement | null = null;
  private navEl: HTMLElement | null = null;
  private alsoEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private createButton: ButtonComponent | null = null;

  constructor(app: App, opts: CreateNoteOptions) {
    super(app);
    this.opts = opts;
    this.notes = scanSite(app, opts.siteRel);
    this.folders = this.siteFolders();
    this.modes = this.availableModes();
    this.mode = this.modes[0];
    this.existingFolder = this.folders[0] ?? "";
    this.language = opts.language ?? "";
    this.syncAlsoTranslations();
  }

  onOpen(): void {
    this.setTitle(TITLES[this.opts.type]);
    this.modalEl.addClass("inkstone-create");
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  // ---- input to request ----------------------------------------------

  /** Vault paths of folders inside the site, the site root excluded. */
  private siteFolders(): string[] {
    const out: string[] = [];
    for (const folder of this.app.vault.getAllFolders(false)) {
      const rel = relativeToSite(folder.path, this.opts.siteRel);
      if (rel === null || rel === "" || isSkippedFolder(rel)) continue;
      out.push(folder.path);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }

  private availableModes(): LocationMode[] {
    const { type, secondary, activeFolder, siteRel } = this.opts;
    const modes: LocationMode[] = [];
    const pageLike = type === "page" || type === "book";
    // A root listing or feed clashes with the root homepage's route, and
    // a secondary homepage needs its own folder.
    const rootHome =
      type === "homepage" && !secondary && !hasRootHomepage(this.notes);
    if (pageLike || rootHome) modes.push("root");
    if (pageLike && activeFolder !== null) {
      const rel = relativeToSite(activeFolder, siteRel);
      if (rel !== null && rel !== "") modes.push("current");
    }
    if (this.folders.length) modes.push("existing");
    modes.push("new");
    return modes;
  }

  private folderChoice(): FolderChoice {
    const siteRel = this.opts.siteRel;
    if (this.mode === "root") return { ok: true, folder: siteRel };
    if (this.mode === "current") {
      return { ok: true, folder: this.opts.activeFolder ?? siteRel };
    }
    if (this.mode === "existing") {
      return { ok: true, folder: this.existingFolder };
    }
    const cleaned = this.newFolder.trim().replace(/^\/+|\/+$/g, "");
    const folder = joinVaultPath(siteRel, cleaned || "folder");
    if (!cleaned) {
      return { ok: false, folder, error: "Folder name can't be empty" };
    }
    for (const segment of cleaned.split("/")) {
      const checked = sanitizeName(segment);
      if (!checked.ok) {
        return { ok: false, folder, error: `Folder: ${checked.reason}` };
      }
    }
    return { ok: true, folder: joinVaultPath(siteRel, cleaned) };
  }

  private request(folder: string): CreateRequest {
    const tags = this.tags
      .split(",")
      .map((t) => t.trim().replace(/^#/, ""))
      .filter((t) => t !== "");
    return {
      type: this.opts.type,
      name: this.name,
      folder,
      isPrivate: this.isPrivate,
      token: this.token,
      navigation: this.navigation,
      language: this.language,
      defaultTheme: this.defaultTheme || undefined,
      showSearch: this.showSearch || undefined,
      showTags: this.showTags || undefined,
      siteTitle: this.siteTitle,
      icon: this.icon,
      theme: this.theme,
      tags,
      summary: this.summary,
      variantSource: this.opts.variantSource,
      alsoTranslations: this.alsoTranslations,
      insertLink: this.insertLink,
    };
  }

  private plan(notes: SiteNote[]): PlanResult {
    const choice = this.folderChoice();
    if (!choice.ok) return { ok: false, error: choice.error };
    return planCreation(this.request(choice.folder), {
      siteRel: this.opts.siteRel,
      notes,
      exists: (p) => this.app.vault.getAbstractFileByPath(p) !== null,
      today: todayIso(),
    });
  }

  private visibility(): FieldVisibility {
    const choice = this.folderChoice();
    const vis = fieldVisibility(
      this.opts.type,
      { folder: choice.folder, isPrivate: this.isPrivate },
      this.opts.siteRel,
      this.opts.editor !== null,
    );
    if (!choice.ok) vis.navigation = "none";
    return vis;
  }

  /** "Also create translations note" defaults on when none exists. */
  private syncAlsoTranslations(): void {
    if (this.alsoTouched) return;
    const lang = normalizeLang(this.language);
    this.alsoTranslations =
      lang === null || existingTranslations(this.notes, lang) === null;
  }

  // ---- rendering -------------------------------------------------------

  private render(): void {
    const el = this.contentEl;
    el.empty();
    const vis = this.visibility();

    if (vis.name) this.renderName(el, vis.homepageRoot);
    if (vis.location || vis.folder) this.renderLocation(el);
    if (vis.private) this.renderPrivate(el, vis.token);

    this.navEl = el.createDiv();
    this.renderNav();

    if (vis.homepageRoot) this.renderRootHomepage(el);
    if (vis.homepageSection) this.renderSecondaryHomepage(el);
    if (this.opts.type === "page" || this.opts.type === "book") {
      this.renderPageExtras(el);
    }
    if (this.opts.type === "variant") this.renderVariant(el);
    if (vis.homepageRoot) {
      this.renderLanguage(el, "Site language", "Blank means English.");
    } else if (vis.language && this.opts.type !== "variant") {
      this.renderLanguage(el, "Language", "A code such as ru or pt-BR.");
    }
    if (vis.insertLink) {
      new Setting(el)
        .setName("Insert a link to it in the open note")
        .addToggle((t) =>
          t.setValue(this.insertLink).onChange((v) => {
            this.insertLink = v;
          }),
        );
    }

    this.statusEl = el.createDiv({ cls: "inkstone-create-status" });
    new Setting(el)
      .addButton((b) =>
        b.setButtonText("Cancel").onClick(() => this.close()),
      )
      .addButton((b) => {
        this.createButton = b;
        b.setButtonText("Create")
          .setCta()
          .onClick(() => void this.submit());
      });
    this.refreshStatus();
  }

  private renderName(el: HTMLElement, rootHome: boolean): void {
    const setting = new Setting(el).setName("Name");
    setting.addText((t) => {
      t.setPlaceholder("Title of the note")
        .setValue(this.name)
        .onChange((v) => {
          this.name = v;
          this.refreshNameHint(rootHome);
          this.refreshStatus();
        });
      if (!this.focused) {
        this.focused = true;
        window.setTimeout(() => t.inputEl.focus(), 0);
      }
    });
    this.nameHintEl = setting.descEl.createDiv({
      cls: "inkstone-create-hint",
    });
    this.refreshNameHint(rootHome);
  }

  private refreshNameHint(rootHome: boolean): void {
    const hint = this.nameHintEl;
    if (!hint) return;
    hint.removeClass("mod-error");
    if (rootHome) {
      hint.setText("File: Home.md");
      return;
    }
    if (!this.name.trim()) {
      hint.setText("Becomes the title and the filename.");
      return;
    }
    const base = noteFileBase(this.name);
    if (base.ok) {
      hint.setText(`File: ${base.name}.md`);
    } else {
      hint.setText(base.reason);
      hint.addClass("mod-error");
    }
  }

  private renderLocation(el: HTMLElement): void {
    const isFolderOnly = !(
      this.opts.type === "page" || this.opts.type === "book"
    );
    const setting = new Setting(el)
      .setName(isFolderOnly ? "Folder" : "Location")
      .addDropdown((d) => {
        for (const mode of this.modes) d.addOption(mode, MODE_LABELS[mode]);
        d.setValue(this.mode).onChange((v) => {
          this.mode = v as LocationMode;
          this.render();
        });
      });
    if (isFolderOnly) {
      setting.setDesc("This note represents the folder.");
    }

    if (this.mode === "existing") {
      new Setting(el).setName("Existing folder").addDropdown((d) => {
        for (const path of this.folders) {
          const rel = relativeToSite(path, this.opts.siteRel) ?? path;
          d.addOption(path, rel);
        }
        d.setValue(this.existingFolder).onChange((v) => {
          this.existingFolder = v;
          this.render();
        });
      });
    } else if (this.mode === "new") {
      const folderSetting = new Setting(el)
        .setName("New folder")
        .addText((t) =>
          t
            .setPlaceholder("Inside the site folder, such as blog")
            .setValue(this.newFolder)
            .onChange((v) => {
              this.newFolder = v;
              this.refreshFolderHint();
              this.renderNav();
              this.refreshStatus();
            }),
        );
      this.folderHintEl = folderSetting.descEl.createDiv({
        cls: "inkstone-create-hint",
      });
      this.refreshFolderHint();
    } else if (this.mode === "current" && this.opts.activeFolder !== null) {
      setting.setDesc(
        relativeToSite(this.opts.activeFolder, this.opts.siteRel) ?? "",
      );
    }
  }

  private refreshFolderHint(): void {
    const hint = this.folderHintEl;
    if (!hint) return;
    const choice = this.folderChoice();
    hint.toggleClass("mod-error", !choice.ok && this.newFolder.trim() !== "");
    if (!choice.ok) {
      hint.setText(
        this.newFolder.trim() ? choice.error : "Created if missing.",
      );
    } else {
      hint.setText("Created if missing.");
    }
  }

  private renderPrivate(el: HTMLElement, tokenEnabled: boolean): void {
    new Setting(el)
      .setName("Private")
      .setDesc(
        "Not published; shared by link with a token. The token is " +
          "stored in plain text in the note.",
      )
      .addToggle((t) =>
        t.setValue(this.isPrivate).onChange((v) => {
          this.isPrivate = v;
          if (v && !this.token) this.token = generateToken();
          this.render();
        }),
      );
    let tokenText: TextComponent | null = null;
    new Setting(el)
      .setName("Token")
      .setDisabled(!tokenEnabled)
      .addText((t) => {
        tokenText = t;
        t.setPlaceholder("Access token")
          .setValue(this.token)
          .setDisabled(!tokenEnabled)
          .onChange((v) => {
            this.token = v;
            this.refreshStatus();
          });
      })
      .addButton((b) =>
        b
          .setButtonText("Generate")
          .setDisabled(!tokenEnabled)
          .onClick(() => {
            this.token = generateToken();
            tokenText?.setValue(this.token);
            this.refreshStatus();
          }),
      );
  }

  private renderNav(): void {
    const el = this.navEl;
    if (!el) return;
    el.empty();
    const nav = this.visibility().navigation;
    if (nav === "none") return;
    new Setting(el)
      .setName(nav === "add" ? "Add to navigation" : "Hide from navigation")
      .addToggle((t) =>
        t.setValue(this.navigation).onChange((v) => {
          this.navigation = v;
        }),
      );
  }

  private renderRootHomepage(el: HTMLElement): void {
    new Setting(el).setName("Default theme").addDropdown((d) =>
      d
        .addOption("", "Not set")
        .addOption("system", "Follow the system")
        .addOption("dark", "Dark")
        .addOption("light", "Light")
        .setValue(this.defaultTheme)
        .onChange((v) => {
          this.defaultTheme = v;
        }),
    );
    this.toggle(el, "Show search", "Adds a search link to the top bar.",
      this.showSearch, (v) => {
        this.showSearch = v;
      });
    this.toggle(el, "Show tags", "Adds a tags link to the top bar.",
      this.showTags, (v) => {
        this.showTags = v;
      });
  }

  private renderSecondaryHomepage(el: HTMLElement): void {
    this.text(el, "Site title", "Shown in the header of this section.",
      "Title of the section", this.siteTitle, (v) => {
        this.siteTitle = v;
      });
    this.text(el, "Icon", "An image beside the site title.",
      "_attachments/logo.png", this.icon, (v) => {
        this.icon = v;
      });
    this.text(el, "Theme", "A theme for this section.", "nord",
      this.theme, (v) => {
        this.theme = v;
      });
  }

  private renderPageExtras(el: HTMLElement): void {
    this.text(el, "Tags", "Optional, separated by commas.", "python, notes",
      this.tags, (v) => {
        this.tags = v;
      });
    this.text(el, "Summary", "Optional; shown on listing pages.", "",
      this.summary, (v) => {
        this.summary = v;
      });
  }

  private renderVariant(el: HTMLElement): void {
    const source = this.opts.variantSource;
    if (source) {
      new Setting(el).setName("Source note").setDesc(source.path);
    }
    this.renderLanguage(el, "Language", "A code such as ru or pt-BR.");
    this.alsoEl = el.createDiv();
    this.renderAlso();
  }

  private renderAlso(): void {
    const el = this.alsoEl;
    if (!el) return;
    el.empty();
    const lang = normalizeLang(this.language);
    if (lang === null || isEnglish(lang)) return;
    new Setting(el)
      .setName("Also create translations note")
      .setDesc(
        existingTranslations(this.notes, lang) === null
          ? "None exists yet for this language."
          : "One already exists for this language and is reused.",
      )
      .addToggle((t) =>
        t.setValue(this.alsoTranslations).onChange((v) => {
          this.alsoTranslations = v;
          this.alsoTouched = true;
        }),
      );
  }

  private renderLanguage(el: HTMLElement, name: string, desc: string): void {
    let langText: TextComponent | null = null;
    const onLang = (v: string) => {
      this.language = v;
      this.syncAlsoTranslations();
      this.renderAlso();
      this.refreshStatus();
    };
    new Setting(el)
      .setName(name)
      .setDesc(desc)
      .addText((t) => {
        langText = t;
        t.setPlaceholder("Code such as ru").setValue(this.language).onChange(onLang);
      })
      .addButton((b) =>
        b.setButtonText("Choose").onClick(() => {
          new LanguagePicker(this.app, knownLanguages(this.notes), (code) => {
            langText?.setValue(code);
            onLang(code);
          }).open();
        }),
      );
  }

  private toggle(
    el: HTMLElement,
    name: string,
    desc: string,
    value: boolean,
    set: (v: boolean) => void,
  ): void {
    new Setting(el)
      .setName(name)
      .setDesc(desc)
      .addToggle((t: ToggleComponent) => t.setValue(value).onChange(set));
  }

  private text(
    el: HTMLElement,
    name: string,
    desc: string,
    placeholder: string,
    value: string,
    set: (v: string) => void,
  ): void {
    new Setting(el)
      .setName(name)
      .setDesc(desc)
      .addText((t) =>
        t
          .setPlaceholder(placeholder)
          .setValue(value)
          .onChange((v) => {
            set(v);
            this.refreshStatus();
          }),
      );
  }

  // ---- status and submit ----------------------------------------------

  /**
   * Live check with the notes read at open time: warnings always show;
   * errors show once something was typed or Create was clicked.
   */
  private refreshStatus(error?: string): void {
    const el = this.statusEl;
    if (!el) return;
    el.empty();
    const result = this.plan(this.notes);
    const untouched =
      !this.attempted &&
      this.visibility().name &&
      this.name.trim() === "";
    const message = error ?? (result.ok ? null : result.error);
    if (message && !untouched) {
      el.createDiv({ text: message, cls: "inkstone-create-error" });
    }
    if (result.ok) {
      for (const w of result.plan.warnings) {
        el.createDiv({ text: w, cls: "inkstone-create-warning" });
      }
    }
    this.createButton?.setDisabled(this.busy || (!result.ok && !untouched));
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    this.attempted = true;
    this.notes = scanSite(this.app, this.opts.siteRel);
    const result = this.plan(this.notes);
    if (!result.ok) {
      this.refreshStatus(result.error);
      return;
    }
    this.busy = true;
    this.refreshStatus();
    let error: string;
    try {
      const done = await executePlan(this.app, result.plan, this.opts.editor);
      if (done.ok) {
        // Partial problems are already in executePlan's sticky Notice.
        this.close();
        return;
      }
      error = done.error;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
    this.refreshStatus(error);
  }
}
