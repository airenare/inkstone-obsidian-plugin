import { App, Editor, Notice, TFile } from "obsidian";
import { firstExistingPath, type CreationPlan } from "./createNoteLogic";

/**
 * `ok: false` means nothing was written; the caller shows `error`.
 * `ok: true` means at least the main note exists; `problems` lists what
 * went wrong after that (already shown in a sticky Notice).
 */
export type ExecuteResult =
  | { ok: true; problems: string[] }
  | { ok: false; error: string };

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
 * Every target is checked on disk first, so an existing file (in any
 * letter case) stops the plan before anything is written. Once a file
 * is written the result is `ok`: later failures (another file, the link,
 * opening) go into one sticky Notice next to the list of what was written.
 */
export async function executePlan(
  app: App,
  plan: CreationPlan,
  editor: Editor | null,
): Promise<ExecuteResult> {
  try {
    const taken = await firstExistingPath(plan.files, (p) =>
      app.vault.adapter.exists(p),
    );
    if (taken !== null) return { ok: false, error: `${taken} already exists.` };
  } catch (err) {
    return { ok: false, error: `Couldn't check the vault: ${errorText(err)}` };
  }

  const created: string[] = [];
  const problems: string[] = [];
  for (const file of plan.files) {
    try {
      await ensureFolder(app, parentOf(file.path));
      await app.vault.create(file.path, file.content);
      created.push(file.path);
    } catch (err) {
      const error = `Couldn't create ${file.path}: ${errorText(err)}`;
      if (created.length === 0) return { ok: false, error };
      problems.push(error);
      break;
    }
  }

  if (plan.linkName && editor) {
    try {
      // Insert at the cursor end; never replace selected text.
      editor.replaceRange(`[[${plan.linkName}]]`, editor.getCursor("to"));
    } catch (err) {
      problems.push(`Couldn't insert the link: ${errorText(err)}`);
    }
  }

  try {
    const note = app.vault.getAbstractFileByPath(plan.openPath);
    if (note instanceof TFile) {
      const leaf =
        plan.openIn === "split"
          ? app.workspace.getLeaf("split")
          : app.workspace.getLeaf(false);
      await leaf.openFile(note);
    }
  } catch (err) {
    problems.push(`Couldn't open ${plan.openPath}: ${errorText(err)}`);
  }

  const lines = [`Created ${created.join(", ")}`, ...plan.notices];
  if (problems.length) {
    new Notice([...lines, ...problems].join("\n"), 0);
  } else {
    new Notice(lines.join("\n"));
  }
  return { ok: true, problems };
}
