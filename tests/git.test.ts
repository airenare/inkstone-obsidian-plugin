import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import { GitError, GitService, validateRemoteUrl } from "../src/git";
import { canInit } from "../src/gitPanelState";

const BASE_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: BASE_ENV,
    encoding: "utf8",
  });
}

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function svc(folder: string, extra: Record<string, unknown> = {}) {
  return new GitService(folder, {
    env: BASE_ENV,
    path: process.env.PATH ?? "",
    ...extra,
  });
}

let tmp: string;
const servers: (http.Server | net.Server)[] = [];

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ink-git-")));
});

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function initRepo(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
}

/** Repo with one commit, plus a bare remote named origin (pushed). */
function repoWithRemote() {
  const bare = path.join(tmp, "remote.git");
  fs.mkdirSync(bare);
  git(bare, "init", "-q", "--bare", "-b", "main");
  const work = path.join(tmp, "work");
  initRepo(work);
  write(path.join(work, "a.md"), "one\n");
  git(work, "add", ".");
  git(work, "commit", "-q", "-m", "init");
  git(work, "remote", "add", "origin", bare);
  git(work, "push", "-q", "-u", "origin", "main");
  return { bare, work };
}

describe("GitService.state", () => {
  it("reports not-repo outside a work tree", async () => {
    expect(await svc(tmp).state()).toEqual({ kind: "not-repo" });
  });

  it("repo without remote", async () => {
    const d = path.join(tmp, "r");
    initRepo(d);
    expect(await svc(d).state()).toEqual({
      kind: "repo",
      hasRemote: false,
      branch: "main",
    });
  });

  it("repo with a remote", async () => {
    const { work } = repoWithRemote();
    expect(await svc(work).state()).toEqual({
      kind: "repo",
      hasRemote: true,
      branch: "main",
    });
  });

  it("detached HEAD gives null branch", async () => {
    const { work } = repoWithRemote();
    git(work, "checkout", "-q", "--detach");
    expect(await svc(work).state()).toEqual({
      kind: "repo",
      hasRemote: true,
      branch: null,
    });
  });

  it("site folder inside a bigger repo is a repo (no init)", async () => {
    const root = path.join(tmp, "big");
    initRepo(root);
    const site = path.join(root, "site");
    fs.mkdirSync(site);
    const st = await svc(site).state();
    expect(st).toEqual({ kind: "repo", hasRemote: false, branch: "main" });
    expect(canInit(st)).toBe(false);
  });

  it("throws a clear GitError when git is missing", async () => {
    const s = svc(tmp, { path: path.join(tmp, "nope") });
    await expect(s.state()).rejects.toThrow(/git not found on PATH/);
    await expect(s.state()).rejects.toBeInstanceOf(GitError);
  });
});

describe("GitService.changes / diff", () => {
  it("lists only files under the site subfolder", async () => {
    const root = path.join(tmp, "big");
    initRepo(root);
    write(path.join(root, "site/keep.md"), "x\n");
    write(path.join(root, "other/o.md"), "x\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "init");
    write(path.join(root, "site/keep.md"), "y\n");
    write(path.join(root, "site/sub/new.md"), "n\n");
    write(path.join(root, "other/o.md"), "y\n");
    const res = await svc(path.join(root, "site")).changes();
    const sorted = [...res].sort((a, b) => a.path.localeCompare(b.path));
    expect(sorted).toEqual([
      { path: "keep.md", status: "M" },
      { path: "sub/new.md", status: "??" },
    ]);
  });

  it("handles spaces, Cyrillic and renames", async () => {
    const d = path.join(tmp, "r");
    initRepo(d);
    write(path.join(d, "old name.md"), "content of the file\n");
    git(d, "add", ".");
    git(d, "commit", "-q", "-m", "init");
    write(path.join(d, "Заметка о жизни.md"), "привет\n");
    git(d, "mv", "old name.md", "new name.md");
    const res = await svc(d).changes();
    const paths = res.map((c) => c.path).sort();
    expect(paths).toEqual(["new name.md", "Заметка о жизни.md"]);
    expect(res.find((c) => c.path === "new name.md")!.status).toBe("R");
  });

  it("diff returns a patch for modified and untracked files", async () => {
    const d = path.join(tmp, "r");
    initRepo(d);
    write(path.join(d, "a.md"), "one\n");
    git(d, "add", ".");
    git(d, "commit", "-q", "-m", "init");
    write(path.join(d, "a.md"), "two\n");
    write(path.join(d, "u v.md"), "fresh\n");
    const s = svc(d);
    const mod = await s.diff("a.md");
    expect(mod).toContain("-one");
    expect(mod).toContain("+two");
    const unt = await s.diff("u v.md");
    expect(unt).toContain("+fresh");
  });
});

describe("GitService.commit / push / pull", () => {
  it("rejects empty paths or blank message before running git", async () => {
    const { work } = repoWithRemote();
    write(path.join(work, "a.md"), "changed\n");
    git(work, "add", "a.md");
    const head = git(work, "rev-parse", "HEAD");
    const idx = git(work, "status", "--porcelain");
    const s = svc(work);
    await expect(s.commit([], "m")).rejects.toBeInstanceOf(GitError);
    await expect(s.commit(["a.md"], "  ")).rejects.toBeInstanceOf(GitError);
    expect(git(work, "rev-parse", "HEAD")).toBe(head);
    expect(git(work, "status", "--porcelain")).toBe(idx);
  });

  it("treats glob characters literally", async () => {
    const d = path.join(tmp, "r");
    initRepo(d);
    write(path.join(d, "[d] idea.md"), "1\n");
    write(path.join(d, "d idea.md"), "1\n");
    write(path.join(d, "x.md"), "1\n");
    git(d, "add", ".");
    git(d, "commit", "-q", "-m", "i");
    for (const f of ["[d] idea.md", "d idea.md", "x.md"]) {
      write(path.join(d, f), "2\n");
    }
    await svc(d).commit(["[d] idea.md"], "one");
    expect(git(d, "show", "--name-only", "--format=", "HEAD").trim()).toBe(
      "[d] idea.md",
    );
    await svc(d).commit(["*.md"], "star").catch(() => {});
    expect(git(d, "status", "--porcelain")).toContain(' M "d idea.md"');
    expect(git(d, "status", "--porcelain")).toContain(" M x.md");
  });

  it("rejects ':/', '..' and absolute paths without staging", async () => {
    const root = path.join(tmp, "big");
    initRepo(root);
    write(path.join(root, "site/a.md"), "1\n");
    write(path.join(root, "other/x.md"), "1\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "i");
    write(path.join(root, "other/x.md"), "2\n");
    const s = svc(path.join(root, "site"));
    await expect(s.commit([":/"], "m")).rejects.toBeInstanceOf(GitError);
    await expect(s.commit(["../other/x.md"], "m")).rejects.toThrow(/outside/);
    await expect(s.commit([path.join(root, "other/x.md")], "m")).rejects
      .toThrow(/outside/);
    await expect(s.diff("../other/x.md")).rejects.toThrow(/outside/);
    expect(git(root, "status", "--porcelain").trim()).toBe("M other/x.md");
    expect(git(root, "status", "--porcelain")).toBe(" M other/x.md\n");
  });

  it("push never force-pushes a branch named +main", async () => {
    const { bare, work } = repoWithRemote();
    const other = path.join(tmp, "other");
    git(tmp, "clone", "-q", bare, other);
    write(path.join(other, "r.md"), "remote\n");
    git(other, "add", ".");
    git(other, "commit", "-q", "-m", "remote only");
    git(other, "push", "-q");
    const remoteHead = git(bare, "rev-parse", "main").trim();
    git(work, "checkout", "-q", "-b", "+main");
    write(path.join(work, "a.md"), "local\n");
    git(work, "commit", "-qam", "local");
    await expect(svc(work).push()).rejects.toBeInstanceOf(GitError);
    expect(git(bare, "rev-parse", "main").trim()).toBe(remoteHead);
  });

  it("nothing-to-commit error keeps git's stdout text, no leaks", async () => {
    const { work } = repoWithRemote();
    let err: GitError | undefined;
    try {
      await svc(work).commit(["a.md"], "SECRETMSG");
    } catch (e) {
      err = e as GitError;
    }
    expect(err).toBeInstanceOf(GitError);
    expect(err!.message).toMatch(/nothing to commit|no changes/i);
    expect(err!.message).not.toContain("SECRETMSG");
    expect(err!.message).not.toContain("a.md");
  });

  it("commits a staged rename with its source", async () => {
    const d = path.join(tmp, "r");
    initRepo(d);
    write(path.join(d, "old.md"), "some longer content here\n");
    git(d, "add", ".");
    git(d, "commit", "-q", "-m", "i");
    git(d, "mv", "old.md", "new.md");
    const ch = await svc(d).changes();
    expect(ch).toEqual([{ path: "new.md", status: "R", origPath: "old.md" }]);
    await svc(d).commit(["new.md"], "rename");
    expect(git(d, "status", "--porcelain").trim()).toBe("");
  });

  it("commits a deleted file as a deletion", async () => {
    const d = path.join(tmp, "r");
    initRepo(d);
    write(path.join(d, "gone.md"), "x\n");
    git(d, "add", ".");
    git(d, "commit", "-q", "-m", "i");
    fs.rmSync(path.join(d, "gone.md"));
    await svc(d).commit(["gone.md"], "del");
    expect(git(d, "status", "--porcelain").trim()).toBe("");
    expect(git(d, "show", "--name-status", "--format=", "HEAD").trim()).toBe(
      "D\tgone.md",
    );
  });

  it("failed commit restores the index for its paths only", async () => {
    const d = path.join(tmp, "r");
    initRepo(d);
    write(path.join(d, "a.md"), "1\n");
    write(path.join(d, "b.md"), "1\n");
    git(d, "add", ".");
    git(d, "commit", "-q", "-m", "i");
    write(path.join(d, "a.md"), "2\n");
    write(path.join(d, "b.md"), "2\n");
    git(d, "add", "b.md");
    const hook = path.join(d, ".git/hooks/pre-commit");
    fs.writeFileSync(hook, "#!/bin/sh\necho HOOKFAIL >&2\nexit 1\n");
    fs.chmodSync(hook, 0o755);
    await expect(svc(d).commit(["a.md"], "m")).rejects.toThrow(/HOOKFAIL/);
    expect(git(d, "status", "--porcelain")).toBe(" M a.md\nM  b.md\n");
  });

  it("reports a missing site folder clearly", async () => {
    const s = svc(path.join(tmp, "missing"));
    await expect(s.state()).rejects.toThrow(/does not exist/);
    await expect(s.state()).rejects.not.toThrow(/not found on PATH/);
  });

  it("commits only the given paths and pushes to the remote", async () => {
    const { bare, work } = repoWithRemote();
    write(path.join(work, "a.md"), "changed\n");
    write(path.join(work, "b.md"), "other\n");
    git(work, "add", "b.md"); // staged but not requested
    const s = svc(work);
    await s.commit(["a.md"], "update a");
    expect(git(work, "show", "--name-only", "--format=", "HEAD").trim()).toBe(
      "a.md",
    );
    expect(git(work, "status", "--porcelain").trim()).toBe("A  b.md");
    await s.push();
    expect(git(bare, "log", "-1", "--format=%s", "main").trim()).toBe(
      "update a",
    );
  });

  it("push without upstream uses -u with the first remote", async () => {
    const bare = path.join(tmp, "remote.git");
    fs.mkdirSync(bare);
    git(bare, "init", "-q", "--bare", "-b", "main");
    const work = path.join(tmp, "w");
    initRepo(work);
    write(path.join(work, "a.md"), "x\n");
    git(work, "add", ".");
    git(work, "commit", "-q", "-m", "first");
    git(work, "remote", "add", "origin", bare);
    await svc(work).push();
    expect(git(bare, "log", "-1", "--format=%s", "main").trim()).toBe("first");
    expect(git(work, "rev-parse", "--abbrev-ref", "@{u}").trim()).toBe(
      "origin/main",
    );
  });

  it("push with no remote throws GitError", async () => {
    const d = path.join(tmp, "r");
    initRepo(d);
    write(path.join(d, "a.md"), "x\n");
    git(d, "add", ".");
    git(d, "commit", "-q", "-m", "i");
    await expect(svc(d).push()).rejects.toBeInstanceOf(GitError);
  });

  it("pull --rebase brings in a remote commit", async () => {
    const { bare, work } = repoWithRemote();
    const other = path.join(tmp, "other");
    git(tmp, "clone", "-q", bare, other);
    write(path.join(other, "r.md"), "remote\n");
    git(other, "add", ".");
    git(other, "commit", "-q", "-m", "remote commit");
    git(other, "push", "-q");
    await svc(work).pull();
    expect(fs.readFileSync(path.join(work, "r.md"), "utf8")).toBe("remote\n");
  });

  it("pull with a dirty tree surfaces git's message", async () => {
    const { bare, work } = repoWithRemote();
    const other = path.join(tmp, "other");
    git(tmp, "clone", "-q", bare, other);
    write(path.join(other, "a.md"), "remote change\n");
    git(other, "commit", "-qam", "remote edit");
    git(other, "push", "-q");
    write(path.join(work, "a.md"), "local dirty\n");
    let err: unknown;
    try {
      await svc(work).pull();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(GitError);
    expect((err as GitError).stderr).toMatch(/unstaged changes|overwritten/i);
    expect((err as GitError).exitCode).not.toBe(0);
  });
});

describe("GitService never hangs", () => {
  async function listen(server: http.Server | net.Server) {
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    return (server.address() as net.AddressInfo).port;
  }

  function withUrl(url: string) {
    const { work } = repoWithRemote();
    git(work, "remote", "set-url", "origin", url);
    return work;
  }

  it("fails fast instead of prompting when credentials are required", async () => {
    const port = await listen(
      http.createServer((_q, res) => {
        res.writeHead(401, { "WWW-Authenticate": 'Basic realm="x"' });
        res.end();
      }),
    );
    const work = withUrl(`http://127.0.0.1:${port}/r.git`);
    const s = svc(work, { networkTimeoutMs: 5000 });
    const t0 = Date.now();
    await expect(s.pull()).rejects.toBeInstanceOf(GitError);
    await expect(s.push()).rejects.toBeInstanceOf(GitError);
    expect(Date.now() - t0).toBeLessThan(8000);
  });

  it("kills a stalled network command at the timeout", async () => {
    const port = await listen(net.createServer(() => {})); // accepts, silent
    const work = withUrl(`http://127.0.0.1:${port}/r.git`);
    const s = svc(work, { networkTimeoutMs: 400 });
    const t0 = Date.now();
    await expect(s.pull()).rejects.toThrow(/timed out/);
    await expect(s.push()).rejects.toBeInstanceOf(GitError);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("an unreachable https remote errors out", async () => {
    const work = withUrl("https://127.0.0.1:1/r.git");
    await expect(
      svc(work, { networkTimeoutMs: 1000 }).pull(),
    ).rejects.toBeInstanceOf(GitError);
  });
});

describe("GitService construction", () => {
  it("refuses an empty or relative site folder", () => {
    expect(() => new GitService("")).toThrow(/site folder/i);
    expect(() => new GitService("site")).toThrow(/site folder/i);
  });
  it("accepts an absolute folder", () => {
    expect(() => new GitService("/tmp/site")).not.toThrow();
  });
});

describe("validateRemoteUrl", () => {
  it("rejects empty, spaced and option-like values", () => {
    expect(validateRemoteUrl("")).not.toBeNull();
    expect(validateRemoteUrl("   ")).not.toBeNull();
    expect(validateRemoteUrl("a b")).not.toBeNull();
    expect(validateRemoteUrl("-oops")).not.toBeNull();
  });

  it("accepts ssh and https urls", () => {
    expect(validateRemoteUrl("git@github.com:u/r.git")).toBeNull();
    expect(validateRemoteUrl("https://github.com/u/r.git")).toBeNull();
  });

  it("accepts http, ssh:// and git:// urls", () => {
    expect(validateRemoteUrl("http://example.com/r.git")).toBeNull();
    expect(validateRemoteUrl("ssh://git@example.com/u/r.git")).toBeNull();
    expect(validateRemoteUrl("ssh://git@example.com:2222/r.git")).toBeNull();
    expect(validateRemoteUrl("git://example.com/r.git")).toBeNull();
    expect(validateRemoteUrl("HTTPS://github.com/u/r.git")).toBeNull();
  });

  it("rejects helper transports", () => {
    expect(validateRemoteUrl("ext::sh")).not.toBeNull();
    expect(validateRemoteUrl("fd::17")).not.toBeNull();
    expect(validateRemoteUrl("https::github.com/u/r")).not.toBeNull();
    expect(validateRemoteUrl("git@host::path")).not.toBeNull();
    expect(validateRemoteUrl("https://x.com/a::b")).not.toBeNull();
  });

  it("rejects file urls and local paths", () => {
    expect(validateRemoteUrl("file:///tmp/r.git")).not.toBeNull();
    expect(validateRemoteUrl("FILE:///tmp/r.git")).not.toBeNull();
    expect(validateRemoteUrl("/tmp/r.git")).not.toBeNull();
    expect(validateRemoteUrl("../r.git")).not.toBeNull();
  });

  it("rejects control characters", () => {
    expect(validateRemoteUrl("https://x.com/r\u0000")).not.toBeNull();
    expect(validateRemoteUrl("https://x.com/\u001br")).not.toBeNull();
    expect(validateRemoteUrl("https://x.com/r\u007f")).not.toBeNull();
    expect(validateRemoteUrl("https://x.com/\nr")).not.toBeNull();
  });

  it("rejects other schemes and malformed scp-style", () => {
    expect(validateRemoteUrl("ftp://example.com/r.git")).not.toBeNull();
    expect(validateRemoteUrl("https://")).not.toBeNull();
    expect(validateRemoteUrl("git@github.com")).not.toBeNull();
    expect(validateRemoteUrl("git@github.com:")).not.toBeNull();
    expect(validateRemoteUrl("-u@h:p")).not.toBeNull();
  });
});

describe("GitService.init and setRemote", () => {
  it("init creates a repo on main", async () => {
    const d = path.join(tmp, "fresh");
    fs.mkdirSync(d);
    const s = svc(d);
    expect(await s.state()).toEqual({ kind: "not-repo" });
    await s.init();
    expect(await s.state()).toEqual({
      kind: "repo",
      hasRemote: false,
      branch: "main",
    });
  });

  it("setRemote adds origin", async () => {
    const d = path.join(tmp, "r");
    initRepo(d);
    const s = svc(d);
    await s.setRemote("https://github.com/u/r.git");
    expect(await s.state()).toMatchObject({ hasRemote: true });
    expect(git(d, "remote", "get-url", "origin").trim()).toBe(
      "https://github.com/u/r.git",
    );
  });

  it("setRemote rejects option-like and invalid urls", async () => {
    const d = path.join(tmp, "r");
    initRepo(d);
    const s = svc(d);
    await expect(s.setRemote("-x")).rejects.toBeInstanceOf(GitError);
    await expect(s.setRemote("a b")).rejects.toBeInstanceOf(GitError);
    expect(await s.state()).toMatchObject({ hasRemote: false });
  });

  it("setRemote surfaces git's error when origin exists", async () => {
    const d = path.join(tmp, "r");
    initRepo(d);
    const s = svc(d);
    await s.setRemote("https://github.com/u/r.git");
    await expect(s.setRemote("https://github.com/u/o.git")).rejects.toThrow(
      /already exists/,
    );
  });
});
