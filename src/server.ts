import { spawn as nodeSpawn, spawnSync } from "child_process";
import { randomBytes } from "crypto";
import { createServer } from "net";
import { request } from "http";
import { resolve as resolvePath } from "path";
import { defaultPythonPath } from "./environment";
import { getLoginShellPath } from "./shellEnv";
import type { InkStoneSettings } from "./settings";

export type ServerStatus = "stopped" | "starting" | "running" | "crashed";

/** The subset of ChildProcess the manager relies on. */
export interface ChildLike {
  pid?: number;
  stdout: { on(event: "data", cb: (d: Buffer) => void): unknown } | null;
  stderr: { on(event: "data", cb: (d: Buffer) => void): unknown } | null;
  on(event: "exit", cb: (code: number | null, sig: string | null) => void): unknown;
  on(event: "error", cb: (err: Error) => void): unknown;
}

export interface ServerDeps {
  spawn(
    command: string,
    args: string[],
    options: {
      cwd: string;
      env: NodeJS.ProcessEnv;
      detached: boolean;
      windowsHide: boolean;
    },
  ): ChildLike;
  /** Kills the process and all its descendants. Must be synchronous. */
  killTree(pid: number): void;
  /** Resolves with the HTTP status; rejects when nothing is listening. */
  probe(url: string): Promise<number>;
  pickPort(): Promise<number>;
  getPath(platform: NodeJS.Platform): Promise<string>;
  sleep(ms: number): Promise<void>;
  log(message: string): void;
  platform: NodeJS.Platform;
  baseEnv: NodeJS.ProcessEnv;
  /** Registers last-chance cleanup; returns a function that removes it. */
  installExitHooks(cleanup: () => void): () => void;
}

export const OUTDATED_MESSAGE =
  "This InkStone checkout is too old: update InkStone to >= 1.57.0.";
const READY_TIMEOUT_MS = 60_000;
const POLL_MS = 250;
const STOP_WAIT_MS = 2000;
const STDERR_LIMIT = 8192;

export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => (port ? resolve(port) : reject(new Error("no port"))));
    });
  });
}

/**
 * Plugin-controlled vars override the checkout's `.env` (python-dotenv does
 * not override variables already in the process environment). Everything else
 * is left to `.env`.
 */
export function buildServerEnv(
  s: InkStoneSettings,
  port: number,
  token: string,
  base: NodeJS.ProcessEnv,
  secretKey: string = randomBytes(32).toString("hex"),
): NodeJS.ProcessEnv {
  return {
    ...base,
    VAULT_PATH: resolvePath(s.siteFolder),
    PORT: String(port),
    ACCESS_TOKEN: token,
    SECRET_KEY: secretKey,
    INKSTONE_DEV_API: "1",
  };
}

function killTreeReal(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], {
      windowsHide: true,
    });
    return;
  }
  // The child was started detached, so it leads its own process group,
  // which also contains the Flask reloader's grandchild.
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

function probeReal(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url, { timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

/**
 * Orphan protection. Covers: window close/reload (beforeunload, pagehide),
 * normal Node exit. Signal handlers are deliberately NOT installed: a
 * SIGTERM/SIGHUP listener removes Node's default terminate action. NOT
 * covered: a hard kill of
 * Obsidian (SIGKILL, crash, Task Manager "End task") gives no code a chance
 * to run, and the detached process group / taskkill tree is not tied to the
 * parent's lifetime. The next start() therefore uses a fresh random port and
 * token, so a leftover server is harmless but keeps running until the user
 * ends it; this is a documented limit rather than something we can fix from
 * plugin code on all three OSes.
 */
function installExitHooksReal(cleanup: () => void): () => void {
  const w = (globalThis as { window?: Window }).window;
  const onExit = () => cleanup();
  w?.addEventListener("beforeunload", onExit);
  w?.addEventListener("pagehide", onExit);
  process.on("exit", onExit);
  return () => {
    w?.removeEventListener("beforeunload", onExit);
    w?.removeEventListener("pagehide", onExit);
    process.off("exit", onExit);
  };
}

function realDeps(): ServerDeps {
  return {
    spawn: (cmd, args, opts) =>
      nodeSpawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] }),
    killTree: killTreeReal,
    probe: probeReal,
    pickPort: pickFreePort,
    getPath: getLoginShellPath,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (m) => console.log(`[inkstone] ${m}`),
    platform: process.platform,
    baseEnv: process.env,
    installExitHooks: installExitHooksReal,
  };
}

type Listener = (s: string) => void;

export class InkStoneServer {
  readonly token = randomBytes(24).toString("hex");
  private _status: ServerStatus = "stopped";
  private _stderr = "";
  private _ownerUnlock = false;
  private listeners: Listener[] = [];
  private child: ChildLike | null = null;
  private port = 0;
  private gen = 0;
  private startPromise: Promise<{ port: number; baseUrl: string }> | null =
    null;
  private childExit: Promise<void> | null = null;
  private removeHooks: (() => void) | null = null;
  private deps: ServerDeps;

  constructor(
    private settings: InkStoneSettings,
    deps: Partial<ServerDeps> = {},
  ) {
    this.deps = { ...realDeps(), ...deps };
  }

  get status(): ServerStatus {
    return this._status;
  }
  get lastStderr(): string {
    return this._stderr;
  }
  get ownerUnlock(): boolean {
    return this._ownerUnlock;
  }
  /** Whether previews should carry the access token (owner sees private notes). */
  setOwnerUnlock(on: boolean): void {
    this._ownerUnlock = on;
  }
  on(event: "status", cb: Listener): void {
    if (event === "status") this.listeners.push(cb);
  }

  private setStatus(s: ServerStatus): void {
    if (this._status === s) return;
    this._status = s;
    for (const cb of this.listeners) cb(s);
  }

  private appendStderr(chunk: Buffer): void {
    const text = String(chunk).split(this.token).join("[redacted]");
    this._stderr = (this._stderr + text).slice(-STDERR_LIMIT);
  }

  start(): Promise<{ port: number; baseUrl: string }> {
    if (this.startPromise) return this.startPromise;
    if (this._status === "running") {
      return Promise.resolve({
        port: this.port,
        baseUrl: `http://127.0.0.1:${this.port}`,
      });
    }
    const p = this.doStart().finally(() => {
      if (this.startPromise === p) this.startPromise = null;
    });
    this.startPromise = p;
    return p;
  }

  private async doStart(): Promise<{ port: number; baseUrl: string }> {
    const d = this.deps;
    const gen = ++this.gen;
    const cancelled = () => this.gen !== gen;
    const cancelError = () => new Error("InkStone start was cancelled.");
    let child: ChildLike | null = null;
    this._stderr = "";
    this.setStatus("starting");
    try {
      const port = await d.pickPort();
      if (cancelled()) throw cancelError();
      this.port = port;
      const baseUrl = `http://127.0.0.1:${port}`;
      const env = buildServerEnv(this.settings, port, this.token, d.baseEnv);
      env.PATH = await d.getPath(d.platform);
      if (cancelled()) throw cancelError();
      const python =
        this.settings.pythonPath ||
        defaultPythonPath(this.settings.inkstoneCheckout, d.platform);
      d.log(`starting server on port ${port}`);
      const c = d.spawn(python, ["app.py"], {
        cwd: this.settings.inkstoneCheckout,
        env,
        detached: d.platform !== "win32",
        windowsHide: true,
      });
      child = c;
      this.child = c;
      let spawnError: Error | null = null;
      let exited = false;
      this.childExit = new Promise<void>((resolve) => {
        const gone = (e?: Error) => {
          if (e) spawnError = e;
          exited = true;
          resolve();
          this.onChildGone(c);
        };
        c.on("error", (e) => gone(e));
        c.on("exit", () => gone());
      });
      c.stdout?.on("data", () => {});
      c.stderr?.on("data", (b) => this.appendStderr(b));
      if (c.pid !== undefined) {
        const pid = c.pid;
        this.removeHooks = d.installExitHooks(() => d.killTree(pid));
      }

      const url = `${baseUrl}/__inkstone/source-map`;
      let waited = 0;
      while (waited <= READY_TIMEOUT_MS) {
        let code = 0;
        try {
          code = await d.probe(url);
        } catch {
          code = 0;
        }
        if (cancelled()) throw cancelError();
        if (exited) {
          const err = spawnError as Error | null;
          throw new Error(
            err
              ? `Could not launch Python: ${err.message}`
              : "InkStone exited during startup.",
          );
        }
        if (code === 200) {
          this.setStatus("running");
          return { port, baseUrl };
        }
        if (code === 404) throw new Error(OUTDATED_MESSAGE);
        await d.sleep(POLL_MS);
        if (cancelled()) throw cancelError();
        waited += POLL_MS;
      }
      throw new Error("InkStone did not become ready in time.");
    } catch (e) {
      if (!cancelled()) {
        if (child && this.child === child) this.dropChild(child);
        this.setStatus("crashed");
      }
      throw e;
    }
  }

  /** Kills the tree and forgets the child so later events are ignored. */
  private dropChild(child: ChildLike): void {
    if (this.child === child) this.child = null;
    this.removeHooks?.();
    this.removeHooks = null;
    if (child.pid !== undefined) this.deps.killTree(child.pid);
  }

  private onChildGone(child: ChildLike): void {
    // Late events from a previous child (after stop/restart) are ignored.
    if (this.child !== child) return;
    // The reloader parent may die alone; make sure its child dies too.
    this.dropChild(child);
    if (this._status !== "stopped") this.setStatus("crashed");
  }

  async stop(): Promise<void> {
    this.gen++; // cancels any start still awaiting
    this.startPromise = null;
    const child = this.child;
    if (!child) {
      if (this._status !== "stopped") this.setStatus("stopped");
      return;
    }
    const exitP = this.childExit;
    this.dropChild(child);
    this.setStatus("stopped");
    if (exitP) {
      await Promise.race([exitP, this.deps.sleep(STOP_WAIT_MS)]);
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }
}
