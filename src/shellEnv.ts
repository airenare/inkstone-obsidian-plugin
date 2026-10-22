import { execFile } from "child_process";

/**
 * PATH as the user's login shell sees it. A Dock-launched Obsidian on macOS
 * inherits a minimal PATH, so tools such as python or git would not be found.
 * Windows GUI apps get the full PATH already.
 */
export function getLoginShellPath(
  platform: NodeJS.Platform,
  timeoutMs = 3000,
): Promise<string> {
  const fallback = process.env.PATH ?? "";
  if (platform === "win32") return Promise.resolve(fallback);
  const shell = process.env.SHELL || "/bin/sh";
  return new Promise((resolve) => {
    try {
      const child = execFile(
        shell,
        ["-ilc", "echo __INKSTONE_PATH__$PATH"],
        { timeout: timeoutMs, windowsHide: true },
        (err, stdout) => {
          if (err) return resolve(fallback);
          // Interactive shells may print banners; find our marker line.
          const line = String(stdout)
            .split("\n")
            .find((l) => l.includes("__INKSTONE_PATH__"));
          const value = line
            ? line.slice(line.indexOf("__INKSTONE_PATH__") + 17).trim()
            : "";
          resolve(value || fallback);
        },
      );
      // An interactive shell waits on an open stdin pipe; close it.
      child.stdin?.end();
    } catch {
      resolve(fallback);
    }
  });
}
