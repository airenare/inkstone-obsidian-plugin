import { EventEmitter } from "events";
import { createServer } from "net";
import { describe, expect, it, vi } from "vitest";
import {
  buildServerEnv,
  InkStoneServer,
  pickFreePort,
  type ChildLike,
  type ServerDeps,
} from "../src/server";
import type { InkStoneSettings } from "../src/settings";

const settings: InkStoneSettings = {
  siteFolder: "/site",
  inkstoneCheckout: "/inkstone",
  pythonPath: "",
  autoStartServer: false,
};

class FakeChild extends EventEmitter implements ChildLike {
  pid = 4242;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

function makeDeps(
  overrides: Partial<ServerDeps> = {},
): { deps: ServerDeps; child: FakeChild } & Record<string, any> {
  const child = new FakeChild();
  const spawn = vi.fn(() => child);
  const killTree = vi.fn();
  const log = vi.fn();
  const probe = vi.fn(async () => 200);
  const deps: ServerDeps = {
    spawn,
    killTree,
    probe,
    pickPort: async () => 5555,
    getPath: async () => "/usr/bin:/bin",
    sleep: async () => {},
    log,
    platform: "darwin",
    baseEnv: { HOME: "/home/x", FOO: "bar" },
    installExitHooks: () => () => {},
    ...overrides,
  };
  return { deps, child, spawn, killTree, log, probe };
}

describe("buildServerEnv", () => {
  it("overrides the three vars and enables the dev API", () => {
    const env = buildServerEnv(
      settings,
      5555,
      "tok",
      { VAULT_PATH: "rel", ACCESS_TOKEN: "old", SECRET_KEY: "old", X: "1" },
      "sec",
    );
    expect(env.VAULT_PATH).toBe("/site");
    expect(env.ACCESS_TOKEN).toBe("tok");
    expect(env.SECRET_KEY).toBe("sec");
    expect(env.PORT).toBe("5555");
    expect(env.INKSTONE_DEV_API).toBe("1");
    expect(env.X).toBe("1");
  });

  it("generates a random secret key when none is given", () => {
    const a = buildServerEnv(settings, 1, "t", {});
    const b = buildServerEnv(settings, 1, "t", {});
    expect(a.SECRET_KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(a.SECRET_KEY).not.toBe(b.SECRET_KEY);
  });
});

describe("pickFreePort", () => {
  it("returns a bindable port", async () => {
    const port = await pickFreePort();
    expect(port).toBeGreaterThan(0);
    await new Promise<void>((resolve, reject) => {
      const s = createServer();
      s.once("error", reject);
      s.listen(port, "127.0.0.1", () => s.close(() => resolve()));
    });
  });
});

describe("InkStoneServer", () => {
  it("goes starting -> running when the source-map answers 200", async () => {
    const { deps, spawn, probe } = makeDeps();
    probe
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue(200);
    const server = new InkStoneServer(settings, deps);
    const seen: string[] = [];
    server.on("status", (s) => seen.push(s));
    expect(server.status).toBe("stopped");
    const res = await server.start();
    expect(seen).toEqual(["starting", "running"]);
    expect(server.status).toBe("running");
    expect(res).toEqual({ port: 5555, baseUrl: "http://127.0.0.1:5555" });
    expect(probe).toHaveBeenLastCalledWith(
      "http://127.0.0.1:5555/__inkstone/source-map",
    );
    const [cmd, args, opts] = spawn.mock.calls[0] as any[];
    expect(cmd).toBe("/inkstone/.venv/bin/python3");
    expect(args).toEqual(["app.py"]);
    expect(opts.cwd).toBe("/inkstone");
    expect(opts.detached).toBe(true);
    expect(opts.env.PATH).toBe("/usr/bin:/bin");
    expect(opts.env.ACCESS_TOKEN).toBe(server.token);
  });

  it("uses an explicit python path when set", async () => {
    const { deps, spawn } = makeDeps();
    const server = new InkStoneServer(
      { ...settings, pythonPath: "/opt/py" },
      deps,
    );
    await server.start();
    expect(spawn.mock.calls[0][0]).toBe("/opt/py");
  });

  it("never logs the token", async () => {
    const { deps, log, child, spawn } = makeDeps();
    const server = new InkStoneServer(settings, deps);
    const p = server.start();
    child.stderr.emit("data", Buffer.from(`leak ${server.token}\n`));
    await p;
    expect(server.token.length).toBeGreaterThan(20);
    expect(JSON.stringify(log.mock.calls)).not.toContain(server.token);
    expect(JSON.stringify(spawn.mock.calls[0].slice(0, 2))).not.toContain(
      server.token,
    );
    expect(server.lastStderr).not.toContain(server.token);
  });

  it("reports an outdated checkout on 404", async () => {
    const { deps, killTree, probe } = makeDeps();
    probe.mockResolvedValue(404);
    const server = new InkStoneServer(settings, deps);
    await expect(server.start()).rejects.toThrow(/>= 1\.57\.0/);
    expect(server.status).toBe("crashed");
    expect(killTree).toHaveBeenCalledWith(4242);
  });

  it("goes crashed on unexpected exit with stderr captured", async () => {
    const { deps, child } = makeDeps();
    const server = new InkStoneServer(settings, deps);
    await server.start();
    child.stderr.emit("data", Buffer.from("Traceback: boom\n"));
    child.emit("exit", 1, null);
    expect(server.status).toBe("crashed");
    expect(server.lastStderr).toContain("boom");
  });

  it("rejects start when the process dies before ready", async () => {
    const { deps, child, probe } = makeDeps();
    probe.mockImplementation(async () => {
      child.stderr.emit("data", Buffer.from("ModuleNotFoundError\n"));
      child.emit("exit", 1, null);
      throw new Error("ECONNREFUSED");
    });
    const server = new InkStoneServer(settings, deps);
    await expect(server.start()).rejects.toThrow();
    expect(server.status).toBe("crashed");
    expect(server.lastStderr).toContain("ModuleNotFoundError");
  });

  it("rejects start on spawn error", async () => {
    const { deps, child, probe } = makeDeps();
    probe.mockImplementation(async () => {
      child.emit("error", new Error("ENOENT"));
      throw new Error("ECONNREFUSED");
    });
    const server = new InkStoneServer(settings, deps);
    await expect(server.start()).rejects.toThrow();
    expect(server.status).toBe("crashed");
  });

  it("stop() kills the whole tree and ends stopped, not crashed", async () => {
    const { deps, child, killTree } = makeDeps();
    const server = new InkStoneServer(settings, deps);
    await server.start();
    killTree.mockImplementation(() => child.emit("exit", 0, null));
    await server.stop();
    expect(killTree).toHaveBeenCalledWith(4242);
    expect(server.status).toBe("stopped");
  });

  it("stop() when stopped is a no-op", async () => {
    const { deps, killTree } = makeDeps();
    const server = new InkStoneServer(settings, deps);
    await server.stop();
    expect(killTree).not.toHaveBeenCalled();
  });

  it("restart() stops then starts again", async () => {
    const first = new FakeChild();
    const second = new FakeChild();
    second.pid = 99;
    const kids = [first, second];
    const { deps, killTree } = makeDeps({
      spawn: vi.fn(() => kids.shift()!) as any,
    });
    killTree.mockImplementation(() => first.emit("exit", 0, null));
    const server = new InkStoneServer(settings, deps);
    await server.start();
    await server.restart();
    expect(killTree).toHaveBeenCalledWith(4242);
    expect(server.status).toBe("running");
  });

  it("removes exit hooks on stop", async () => {
    const remove = vi.fn();
    const { deps, child, killTree } = makeDeps({
      installExitHooks: () => remove,
    });
    const server = new InkStoneServer(settings, deps);
    await server.start();
    killTree.mockImplementation(() => child.emit("exit", 0, null));
    await server.stop();
    expect(remove).toHaveBeenCalled();
  });

  it("tracks owner unlock", () => {
    const { deps } = makeDeps();
    const server = new InkStoneServer(settings, deps);
    expect(server.ownerUnlock).toBe(false);
    server.setOwnerUnlock(true);
    expect(server.ownerUnlock).toBe(true);
  });
});
