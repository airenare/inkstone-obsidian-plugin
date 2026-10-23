import { App, SuggestModal } from "obsidian";
import { normalizeLang } from "./notePaths";

/**
 * Pick a language code: the codes the site already uses, plus whatever
 * valid code is typed (a new language).
 */
export class LanguagePicker extends SuggestModal<string> {
  constructor(
    app: App,
    private readonly known: string[],
    private readonly onPick: (code: string) => void,
  ) {
    super(app);
    this.setPlaceholder("Type a language code, such as ru or fr");
    this.emptyStateText = "Type a language code such as ru or pt-BR";
  }

  getSuggestions(query: string): string[] {
    const q = query.trim().toLowerCase();
    const matches = this.known.filter((code) =>
      code.toLowerCase().includes(q),
    );
    const typed = normalizeLang(query);
    const isKnown =
      typed !== null &&
      this.known.some((code) => code.toLowerCase() === typed.toLowerCase());
    if (typed !== null && !isKnown) matches.push(typed);
    return matches;
  }

  renderSuggestion(code: string, el: HTMLElement): void {
    el.createSpan({ text: code });
    if (!this.known.includes(code)) {
      el.createSpan({ text: "New language", cls: "inkstone-folder-path" });
    }
  }

  onChooseSuggestion(code: string): void {
    this.onPick(code);
  }
}
