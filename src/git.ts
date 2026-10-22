import { execFile } from "child_process";
import { promises as fsp } from "fs";
import * as nodePath from "path";
import { getLoginShellPath } from "./shellEnv";

export type GitState =
  | { kind: "not-repo" }
  | { kind: "repo"; hasRemote: boolean; branch: string | null };

export interface GitChange {
  path: string;
  status: string;
  /** Source path of a rename or copy (relative to the site folder). */
  origPath?: string;
}

export interface GitServiceOptions {
  /** Base environment (default: process.env). Mainly for tests. */
  env?: NodeJS.ProcessEnv;
  /** PATH to use; default is the login shell's PATH. */
  path?: string;
  /** Timeout for local commands (ms). */
  localTimeoutMs?: number;
  /** Timeout for network commands: pull and push (ms). */
  networkTimeoutMs?: number;
}

/** A failed git call. `stderr` is git's own output, verbatim. */
export class GitError extends Error {
  constructor(
    message: string,
    readonly stderr: string = "",
    readonly exitCode: number | null = null,
    readonly command: string = "",
  ) {
    super(message);
    this.name = "GitError";
  }
}

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

interface RunOptions {
  network?: boolean;
  /** Exit codes (besides 0) that are returned instead of thrown. */
  okCodes?: number[];
  env?: NodeJS.ProcessEnv;
}

const LOCAL_TIMEOUT_MS = 15_000;
const NETWORK_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Thin wrapper over the git CLI, scoped to the site folder. It never
 * prompts and never hangs; authentication is whatever the folder's own git
 * config already does. No credentials are stored here.
 */
export class GitService {
  private pathPromise: Promise<string> | null = null;

  constructor(
    private readonly siteFolder: string,
    private readonly opts: GitServiceOptions = {},
  ) {
    // Git must never run in the process cwd (an unrelated repo).
    if (!siteFolder || !nodePath.isAbsolute(siteFolder)) {
      throw new GitError("Site folder not set (needs an absolute path).");
    }
  }

  async state(): Promise<GitState> {
    const probe = await this.run(["rev-parse", "--is-inside-work-tree"], {
      okCodes: [128],
      env: { LC_ALL: "C" },
    });
    if (probe.code === 128) {
      if (/not a git repository/i.test(probe.stderr)) {
        return { kind: "not-repo" };
      }
      throw this.fail(probe, ["rev-parse"]);
    }
    if (probe.stdout.trim() !== "true") return { kind: "not-repo" };
    const sym = await this.run(["symbolic-ref", "--short", "-q", "HEAD"], {
      okCodes: [1],
    });
    const branch = sym.code === 0 ? sym.stdout.trim() || null : null;
    const remotes = await this.remotes();
    return { kind: "repo", hasRemote: remotes.length > 0, branch };
  }

  async changes(): Promise<GitChange[]> {
    const prefix = (await this.run(["rev-parse", "--show-prefix"])).stdout
      .replace(/\r?\n$/, "");
    const res = await this.run([
      "-c",
      "core.quotepath=false",
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ".",
    ]);
    const parts = res.stdout.split("\0");
    const out: GitChange[] = [];
    const rel = (p: string) =>
      prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p;
    const relOrig = (p: string) =>
      nodePath.posix.relative(prefix.replace(/\/$/, "") || ".", p);
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i];
      if (entry.length < 4) continue;
      const xy = entry.slice(0, 2);
      const file = entry.slice(3);
      // Renames and copies carry the original path as the next field.
      if (xy[0] === "R" || xy[0] === "C" || xy[1] === "R" || xy[1] === "C") {
        i++;
        out.push({
          path: rel(file),
          status: xy.trim(),
          origPath: relOrig(parts[i] ?? ""),
        });
        continue;
      }
      out.push({ path: rel(file), status: xy.trim() });
    }
    return out;
  }

  async diff(path: string): Promise<string> {
    assertInsideFolder(path);
    const untracked = await this.run([
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      path,
    ]);
    if (untracked.stdout.length > 0) {
      // --no-index exits 1 when the files differ, which is the normal case.
      const res = await this.run(
        [
          "diff",
          "--no-index",
          "--no-color",
          "--no-ext-diff",
          "--",
          "/dev/null",
          path,
        ],
        { okCodes: [1] },
      );
      return res.stdout;
    }
    const head = await this.run(["rev-parse", "--verify", "-q", "HEAD"], {
      okCodes: [1],
    });
    const args = ["diff", "--no-color", "--no-ext-diff"];
    if (head.code === 0) args.push("HEAD");
    else args.push("--cached");
    args.push("--", path);
    return (await this.run(args)).stdout;
  }

  async commit(paths: string[], message: string): Promise<void> {
    if (paths.length === 0) {
      throw new GitError("Nothing to commit: no paths were given.");
    }
    if (message.trim() === "") {
      throw new GitError("Commit message must not be empty.");
    }
    for (const p of paths) assertInsideFolder(p);
    // A staged rename must commit with its source, or only half is recorded.
    const wanted = new Set(paths.map(normalizeRel));
    const all = [...paths];
    for (const c of await this.changes()) {
      if (c.origPath && wanted.has(normalizeRel(c.path))) {
        all.push(c.origPath);
      }
    }
    await this.run(["add", "--", ...paths]);
    try {
      // `-- <paths>` (--only) commits just these, leaving other staged
      // files alone. Hooks and GPG pinentry can be slow, so use the long
      // timeout. A SIGKILL here may leave .git/index.lock behind.
      await this.run(["commit", "-m", message, "--", ...all], {
        network: true,
      });
    } catch (err) {
      // Undo our staging for these paths only; keep the original error.
      try {
        await this.run(["reset", "-q", "--", ...all]);
      } catch {
        /* best effort */
      }
      throw err;
    }
  }

  // Note: killing `pull --rebase` at the timeout can leave a rebase in
  // progress in the repo; the git message on the next call will say so.
  async pull(): Promise<void> {
    await this.run(["pull", "--rebase"], { network: true });
  }

  async push(): Promise<void> {
    const upstream = await this.run(
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      { okCodes: [128] },
    );
    if (upstream.code === 0) {
      await this.run(["push"], { network: true });
      return;
    }
    const remotes = await this.remotes();
    if (remotes.length === 0) {
      throw new GitError("No git remote is configured for this folder.");
    }
    const sym = await this.run(["symbolic-ref", "--short", "-q", "HEAD"], {
      okCodes: [1],
    });
    const branch = sym.code === 0 ? sym.stdout.trim() : "";
    if (!branch) {
      throw new GitError("Cannot push from a detached HEAD.");
    }
    if (/^[+-]/.test(branch)) {
      throw new GitError(`Refusing to push branch "${branch}".`);
    }
    // Explicit non-forcing refspec: the branch name is never parsed as one.
    await this.run(
      ["push", "-u", "--", remotes[0], `HEAD:refs/heads/${branch}`],
      { network: true },
    );
  }

  private async remotes(): Promise<string[]> {
    const res = await this.run(["remote"]);
    return res.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  }

  private loginPath(): Promise<string> {
    if (this.opts.path !== undefined) return Promise.resolve(this.opts.path);
    this.pathPromise ??= getLoginShellPath(process.platform);
    return this.pathPromise;
  }

  private fail(r: RunResult, args: string[]): GitError {
    const msg =
      r.stderr.trim() || r.stdout.trim() || `git ${args[0]} failed`;
    return new GitError(msg, r.stderr, r.code, `git ${args[0]}`);
  }

  private async run(args: string[], o: RunOptions = {}): Promise<RunResult> {
    const base = this.opts.env ?? process.env;
    const env: NodeJS.ProcessEnv = {
      ...base,
      PATH: await this.loginPath(),
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "",
      SSH_ASKPASS: "",
      GCM_INTERACTIVE: "never",
      GIT_LITERAL_PATHSPECS: "1",
      ...o.env,
    };
    const timeout = o.network
      ? (this.opts.networkTimeoutMs ?? NETWORK_TIMEOUT_MS)
      : (this.opts.localTimeoutMs ?? LOCAL_TIMEOUT_MS);
    // Subcommand name only: arguments may contain note names or messages.
    const name = args.find((a) => /^[a-z][a-z-]*$/.test(a)) ?? "git";
    try {
      if (!(await fsp.stat(this.siteFolder)).isDirectory()) throw new Error();
    } catch {
      throw new GitError(`Site folder does not exist: ${this.siteFolder}`);
    }
    return new Promise((resolve, reject) => {
      const child = execFile(
        "git",
        args,
        {
          cwd: this.siteFolder,
          env,
          timeout,
          killSignal: "SIGKILL",
          windowsHide: true,
          maxBuffer: MAX_BUFFER,
          encoding: "utf8",
        },
        (err, stdout, stderr) => {
          const so = String(stdout ?? "");
          const se = String(stderr ?? "");
          if (!err) return resolve({ stdout: so, stderr: se, code: 0 });
          const e = err as NodeJS.ErrnoException & {
            code?: string | number;
            killed?: boolean;
          };
          if (e.code === "ENOENT") {
            return reject(
              new GitError("git not found on PATH", "", null, `git ${name}`),
            );
          }
          if (e.killed) {
            return reject(
              new GitError(
                `git ${name} timed out after ${Math.round(timeout / 1000)}s`,
                se,
                null,
                `git ${name}`,
              ),
            );
          }
          const code = typeof e.code === "number" ? e.code : null;
          if (code !== null && o.okCodes?.includes(code)) {
            return resolve({ stdout: so, stderr: se, code });
          }
          reject(
            new GitError(
              se.trim() || so.trim() || `git ${name} failed`,
              se,
              code,
              `git ${name}`,
            ),
          );
        },
      );
      child.stdin?.end();
    });
  }
}

function normalizeRel(p: string): string {
  const q = process.platform === "win32" ? p.replace(/\\/g, "/") : p;
  return nodePath.posix.normalize(q);
}

/** Reject empty, absolute, drive, or escaping (`..`) paths. */
function assertInsideFolder(p: string): void {
  const q = process.platform === "win32" ? p.replace(/\\/g, "/") : p;
  const n = nodePath.posix.normalize(q);
  if (
    p === "" ||
    q.startsWith("/") ||
    /^[a-zA-Z]:/.test(q) ||
    n === ".." ||
    n.startsWith("../")
  ) {
    throw new GitError("Path is outside the site folder.");
  }
}
