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
 * normal Node exit, and SIGTERM/SIGHUP. NOT coverable: a hard kill of
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
  process.on("SIGTERM", onExit);
  process.on("SIGHUP", onExit);
  return () => {
    w?.removeEventListener("beforeunload", onExit);
    w?.removeEventListener("pagehide", onExit);
    process.off("exit", onExit);
    process.off("SIGTERM", onExit);
    process.off("SIGHUP", onExit);
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
  private stopping = false;
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

  async start(): Promise<{ port: number; baseUrl: string }> {
    if (this._status === "starting" || this._status === "running") {
      return { port: this.port, baseUrl: `http://127.0.0.1:${this.port}` };
    }
    const d = this.deps;
    this._stderr = "";
    this.stopping = false;
    this.setStatus("starting");
    try {
      this.port = await d.pickPort();
      const baseUrl = `http://127.0.0.1:${this.port}`;
      const env = buildServerEnv(
        this.settings,
        this.port,
        this.token,
        d.baseEnv,
      );
      env.PATH = await d.getPath(d.platform);
      const python =
        this.settings.pythonPath ||
        defaultPythonPath(this.settings.inkstoneCheckout, d.platform);
      d.log(`starting server on port ${this.port}`);
      const child = d.spawn(python, ["app.py"], {
        cwd: this.settings.inkstoneCheckout,
        env,
        detached: d.platform !== "win32",
        windowsHide: true,
      });
      this.child = child;
      let spawnError: Error | null = null;
      let exited = false;
      child.stdout?.on("data", () => {});
      child.stderr?.on("data", (c) => this.appendStderr(c));
      child.on("error", (e) => {
        spawnError = e;
        exited = true;
        this.onChildGone();
      });
      child.on("exit", () => {
        exited = true;
        this.onChildGone();
      });
      if (child.pid !== undefined) {
        const pid = child.pid;
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
          return { port: this.port, baseUrl };
        }
        if (code === 404) throw new Error(OUTDATED_MESSAGE);
        await d.sleep(POLL_MS);
        waited += POLL_MS;
      }
      throw new Error("InkStone did not become ready in time.");
    } catch (e) {
      this.killChild();
      this.setStatus("crashed");
      throw e;
    }
  }

  private onChildGone(): void {
    this.child = null;
    this.removeHooks?.();
    this.removeHooks = null;
    if (this.stopping) {
      this.setStatus("stopped");
    } else if (this._status !== "stopped") {
      this.setStatus("crashed");
    }
  }

  private killChild(): void {
    const pid = this.child?.pid;
    if (pid !== undefined) this.deps.killTree(pid);
    this.removeHooks?.();
    this.removeHooks = null;
  }

  async stop(): Promise<void> {
    if (!this.child) {
      if (this._status !== "stopped") this.setStatus("stopped");
      return;
    }
    this.stopping = true;
    this.killChild();
    this.child = null;
    this.setStatus("stopped");
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }
}
