import { execFile } from "child_process";
import { promises as fs } from "fs";
import { resolveSiteFolder } from "./paths";
import type { InkStoneSettings } from "./settings";

export type EnvironmentResult = { ok: true } | { ok: false; problem: string };

export interface RunResult {
  code: number;
  stderr: string;
}

export interface EnvironmentDeps {
  dirExists(path: string): Promise<boolean>;
  fileExists(path: string): Promise<boolean>;
  /** Runs a command; rejects if it cannot be launched. */
  run(command: string, args: string[]): Promise<RunResult>;
  /**
   * The vault's folder on disk; relative site folders resolve against it.
   * Null or absent: relative site folders are refused.
   */
  vaultBasePath?: string | null;
}

export function defaultPythonPath(
  checkout: string,
  platform: NodeJS.Platform,
): string {
  const base = checkout.replace(/[\\/]+$/, "");
  if (platform === "win32") {
    return `${base}\\.venv\\Scripts\\python.exe`;
  }
  return `${base}/.venv/bin/python3`;
}

/**
 * Derives the picked folder from the first file of a directory input.
 * `path` is the file's absolute path; `webkitRelativePath` is
 * "<folder>/.../<file>" with forward slashes. Both end with the same number
 * of characters, so strip that suffix and re-add the folder name.
 */
export function folderFromPickedFile(
  path: string,
  webkitRelativePath: string,
): string {
  const rel = webkitRelativePath.split("/")[0];
  return (
    path.slice(0, path.length - webkitRelativePath.length) + rel
  );
}

export const realDeps: EnvironmentDeps = {
  async dirExists(path) {
    try {
      return (await fs.stat(path)).isDirectory();
    } catch {
      return false;
    }
  },
  async fileExists(path) {
    try {
      return (await fs.stat(path)).isFile();
    } catch {
      return false;
    }
  },
  run(command, args) {
    return new Promise((resolve, reject) => {
      execFile(command, args, { timeout: 15000 }, (err, _out, stderr) => {
        if (!err) {
          resolve({ code: 0, stderr: String(stderr) });
        } else if (typeof (err as NodeJS.ErrnoException).code === "number") {
          resolve({
            code: (err as NodeJS.ErrnoException).code as unknown as number,
            stderr: String(stderr),
          });
        } else {
          reject(err);
        }
      });
    });
  },
};

export async function validateEnvironment(
  s: InkStoneSettings,
  deps: EnvironmentDeps = realDeps,
): Promise<EnvironmentResult> {
  const fail = (problem: string): EnvironmentResult => ({
    ok: false,
    problem,
  });

  if (!s.siteFolder.trim()) {
    return fail("No site folder is set. Choose the folder that holds your site.");
  }
  const site = resolveSiteFolder(
    s.siteFolder,
    deps.vaultBasePath ?? null,
    process.platform,
  );
  if (!site) {
    return fail(
      `The site folder "${s.siteFolder}" is relative, but the vault folder is unknown. Use an absolute path.`,
    );
  }
  if (!(await deps.dirExists(site))) {
    return fail(
      `The site folder "${site}" does not exist. Choose an existing folder.`,
    );
  }

  if (!s.inkstoneCheckout.trim()) {
    return fail(
      "No InkStone checkout is set. Enter the folder where you cloned InkStone.",
    );
  }
  const sep = s.inkstoneCheckout.includes("\\") ? "\\" : "/";
  const appPy = `${s.inkstoneCheckout.replace(/[\\/]+$/, "")}${sep}app.py`;
  if (!(await deps.fileExists(appPy))) {
    return fail(
      `No app.py found in "${s.inkstoneCheckout}". Point the InkStone checkout at the repository root.`,
    );
  }

  const python =
    s.pythonPath.trim() || defaultPythonPath(s.inkstoneCheckout, process.platform);
  let result: RunResult;
  try {
    result = await deps.run(python, ["-c", "import flask"]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(
      `Could not run Python at "${python}" (${msg}). Check the path, or create the venv in your InkStone checkout.`,
    );
  }
  if (result.code !== 0) {
    const detail = result.stderr.trim().split("\n").pop() ?? "";
    return fail(
      `Python at "${python}" cannot import flask${detail ? ` (${detail})` : ""}. Run "${python} -m pip install -r requirements.txt" in your InkStone checkout.`,
    );
  }
  return { ok: true };
}
