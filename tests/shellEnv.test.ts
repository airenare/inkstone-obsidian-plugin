import { describe, expect, it, vi } from "vitest";
import { getLoginShellPath } from "../src/shellEnv";

function fakeExec(stdout: string) {
  return vi.fn((_f: string, _a: string[], _o: any, cb: any) => {
    cb(null, stdout);
    return { stdin: { end: vi.fn() } };
  }) as any;
}

describe("getLoginShellPath", () => {
  it("returns process.env.PATH on Windows", async () => {
    expect(await getLoginShellPath("win32")).toBe(process.env.PATH ?? "");
  });

  it("uses printenv (fish-safe) and SIGKILL on timeout", async () => {
    const exec = fakeExec("banner\n__INKSTONE_PATH__/a:/b\n");
    expect(await getLoginShellPath("darwin", 1000, exec)).toBe("/a:/b");
    const [, args, opts] = exec.mock.calls[0];
    expect(args.join(" ")).toContain("printenv PATH");
    expect(args.join(" ")).not.toContain("echo");
    expect(opts.killSignal).toBe("SIGKILL");
    expect(opts.timeout).toBe(1000);
  });

  it("falls back to process.env.PATH on error", async () => {
    const exec = vi.fn((_f: string, _a: string[], _o: any, cb: any) => {
      cb(new Error("boom"), "");
      return { stdin: { end() {} } };
    }) as any;
    expect(await getLoginShellPath("linux", 1000, exec)).toBe(
      process.env.PATH ?? "",
    );
  });
});
