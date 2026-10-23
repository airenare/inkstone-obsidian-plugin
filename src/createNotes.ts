import { App, Editor, Notice, TFile } from "obsidian";
import type { CreationPlan } from "./createNoteLogic";

export type ExecuteResult = { ok: true } | { ok: false; error: string };

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Creates `folder` and any missing parents, one segment at a time. */
async function ensureFolder(app: App, folder: string): Promise<void> {
  if (folder === "") return;
  let current = "";
  for (const segment of folder.split("/")) {
    current = current ? `${current}/${segment}` : segment;
    if (app.vault.getAbstractFileByPath(current) === null) {
      await app.vault.createFolder(current);
    }
  }
}

/**
 * Writes the planned files, then inserts the link and opens the note.
 * A failed write stops there: nothing is opened or linked, and one Notice
 * names the failure and whatever was already written.
 */
export async function executePlan(
  app: App,
  plan: CreationPlan,
  editor: Editor | null,
): Promise<ExecuteResult> {
  const created: string[] = [];
  for (const file of plan.files) {
    try {
      await ensureFolder(app, parentOf(file.path));
      await app.vault.create(file.path, file.content);
      created.push(file.path);
    } catch (err) {
      const error = `Couldn't create ${file.path}: ${errorText(err)}`;
      const lines = [error];
      if (created.length) lines.push(`Already created: ${created.join(", ")}`);
      new Notice(lines.join("\n"), 0);
      return { ok: false, error };
    }
  }

  if (plan.linkName && editor) {
    editor.replaceSelection(`[[${plan.linkName}]]`);
  }

  const note = app.vault.getAbstractFileByPath(plan.openPath);
  if (note instanceof TFile) {
    await app.workspace.getLeaf(false).openFile(note);
  }

  const lines = [`Created ${created.join(", ")}`, ...plan.notices];
  new Notice(lines.join("\n"));
  return { ok: true };
}
