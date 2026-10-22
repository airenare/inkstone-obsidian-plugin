// Folder pickers for the settings tab: a native dialog when Obsidian
// exposes one, otherwise a hidden <input webkitdirectory>.
import { folderFromPickedFile } from "./environment";
import {
  pickFolder,
  type PickerStrategy,
  type PickResult,
} from "./folderPicker";

interface OpenDialog {
  showOpenDialog(options: {
    title?: string;
    defaultPath?: string;
    properties: string[];
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

interface ElectronLike {
  remote?: { dialog?: OpenDialog };
  webUtils?: { getPathForFile?: (file: File) => string };
}

type Loader = { require?: (id: string) => unknown; electron?: ElectronLike };

function tryRequire(id: string): unknown {
  try {
    return (window as unknown as Loader).require?.(id);
  } catch {
    return undefined;
  }
}

function pathOfFile(file: File): string {
  const electron = tryRequire("electron") as ElectronLike | undefined;
  try {
    const p = electron?.webUtils?.getPathForFile?.(file);
    if (p) return p;
  } catch {
    // fall through to the legacy property
  }
  return (file as File & { path?: string }).path ?? "";
}

function dialogStrategy(title: string, defaultPath?: string): PickerStrategy {
  return {
    name: "native dialog",
    pick: async (): Promise<PickResult> => {
      const candidates = [
        (tryRequire("@electron/remote") as { dialog?: OpenDialog } | undefined)
          ?.dialog,
        (tryRequire("electron") as ElectronLike | undefined)?.remote?.dialog,
        (window as unknown as Loader).electron?.remote?.dialog,
      ];
      const dialog = candidates.find(
        (d) => typeof d?.showOpenDialog === "function",
      );
      if (!dialog) {
        return { kind: "unavailable", reason: "no dialog API in this build" };
      }
      const r = await dialog.showOpenDialog({
        title,
        defaultPath,
        properties: ["openDirectory", "createDirectory"],
      });
      const path = r.filePaths?.[0];
      return r.canceled || !path ? { kind: "cancelled" } : { kind: "picked", path };
    },
  };
}

function inputStrategy(): PickerStrategy {
  return {
    name: "file input",
    pick: () =>
      new Promise<PickResult>((resolve) => {
        const input = createEl("input", {
          type: "file",
          cls: "inkstone-hidden-input",
        });
        input.setAttribute("webkitdirectory", "");
        const done = (r: PickResult): void => {
          input.remove();
          resolve(r);
        };
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          if (!file) return done({ kind: "cancelled" });
          const p = pathOfFile(file);
          if (!p) {
            return done({ kind: "unavailable", reason: "couldn't read the path" });
          }
          done({
            kind: "picked",
            path: folderFromPickedFile(p, file.webkitRelativePath),
          });
        });
        input.addEventListener("cancel", () => done({ kind: "cancelled" }));
        // Some Chromium builds ignore clicks on detached inputs.
        activeDocument.body.appendChild(input);
        try {
          input.click();
        } catch (err) {
          const msg = err instanceof Error ? err.message : "click failed";
          done({ kind: "unavailable", reason: msg });
        }
      }),
  };
}

/** Pick a folder anywhere on disk. */
export function pickDiskFolder(
  title: string,
  defaultPath?: string,
): Promise<PickResult> {
  return pickFolder([dialogStrategy(title, defaultPath), inputStrategy()]);
}
