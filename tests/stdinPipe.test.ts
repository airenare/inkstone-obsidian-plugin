import { spawn } from "child_process";
import { describe, expect, it } from "vitest";
import { buildServerEnv, SERVER_STDIO } from "../src/server";

describe("orphan protection plumbing", () => {
  it("asks InkStone to exit when its stdin closes", () => {
    const env = buildServerEnv("/site", 1234, "tok", {});
    expect(env.INKSTONE_EXIT_ON_STDIN_EOF).toBe("1");
  });

  it("spawns the server with a live stdin pipe, never 'ignore'", () => {
    expect(SERVER_STDIO[0]).toBe("pipe");
  });

  it("keeps a child alive while the pipe is open and lets it see EOF when the parent side closes", async () => {
    // Stand-in for InkStone: exits when stdin reaches EOF, like stdin_watch.
    const script =
      "process.stdin.on('end', () => process.exit(0)); process.stdin.resume();";
    const child = spawn(process.execPath, ["-e", script], {
      stdio: [...SERVER_STDIO],
    });
    expect(child.stdin).not.toBeNull();
    const exited = new Promise<number | null>((resolve) =>
      child.on("exit", (code) => resolve(code)),
    );
    const early = await Promise.race([
      exited,
      new Promise<"alive">((r) => setTimeout(() => r("alive"), 400)),
    ]);
    expect(early).toBe("alive");
    child.stdin?.end(); // what the OS does when Obsidian dies
    expect(await exited).toBe(0);
  });
});
