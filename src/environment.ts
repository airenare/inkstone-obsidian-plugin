import { execFile } from "child_process";
import { promises as fs } from "fs";
import { expandSettingsPaths, resolveSiteFolder } from "./paths";
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
  /** Reads a text file; rejects if it cannot be read. */
  readFile(path: string): Promise<string>;
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

/** The interpreter to run: the trimmed setting, or the checkout's venv. */
export function effectivePythonPath(
  s: InkStoneSettings,
  platform: NodeJS.Platform,
): string {
  return s.pythonPath.trim() || defaultPythonPath(s.inkstoneCheckout, platform);
}

export type Version = [number, number, number];

/** The oldest InkStone with PORT support and the dev source-map API. */
export const MIN_INKSTONE_VERSION: Version = [1, 57, 0];

/** Parses "X.Y.Z" (optional leading "v", surrounding whitespace). */
export function parseVersion(text: string): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negative, zero or positive, like a sort comparator. */
export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
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
      const opts = { timeout: 15000, windowsHide: true };
      execFile(command, args, opts, (err, _out, stderr) => {
        if (!err) {
          resolve({ code: 0, stderr: String(stderr) });
        } else if (typeof (err as NodeJS.ErrnoException).code === "number") {
          resolve({
            code: (err as NodeJS.ErrnoException).code as unknown as number,
            stderr: String(stderr),
          });
        } else {
          reject(err instanceof Error ? err : new Error("Command failed"));
        }
      });
    });
  },
  readFile(path) {
    return fs.readFile(path, "utf8");
  },
};

const MIN_TEXT = MIN_INKSTONE_VERSION.join(".");

export async function validateEnvironment(
  settings: InkStoneSettings,
  deps: EnvironmentDeps = realDeps,
): Promise<EnvironmentResult> {
  const s = expandSettingsPaths(settings);
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

  const versionFile = `${s.inkstoneCheckout.replace(/[\\/]+$/, "")}${sep}VERSION`;
  let versionText: string;
  try {
    versionText = await deps.readFile(versionFile);
  } catch {
    return fail(
      `No VERSION file found in "${s.inkstoneCheckout}". This plugin needs InkStone ${MIN_TEXT} or newer. Update the checkout (git pull).`,
    );
  }
  const version = parseVersion(versionText);
  if (!version) {
    const shown = versionText.trim().slice(0, 40);
    return fail(
      `Couldn't read the InkStone version from VERSION ("${shown}"). This plugin needs InkStone ${MIN_TEXT} or newer.`,
    );
  }
  if (compareVersions(version, MIN_INKSTONE_VERSION) < 0) {
    return fail(
      `InkStone ${version.join(".")} found; this plugin needs ${MIN_TEXT} or newer. Update the checkout (git pull).`,
    );
  }

  const python = effectivePythonPath(s, process.platform);
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
