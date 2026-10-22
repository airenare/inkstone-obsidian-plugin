import { describe, expect, it, vi } from "vitest";
import {
  defaultPythonPath,
  validateEnvironment,
  type EnvironmentDeps,
} from "../src/environment";
import type { InkStoneSettings } from "../src/settings";

const settings: InkStoneSettings = {
  siteFolder: "/site",
  inkstoneCheckout: "/inkstone",
  pythonPath: "/inkstone/.venv/bin/python3",
  autoStartServer: false,
};

function makeDeps(overrides: Partial<EnvironmentDeps> = {}): EnvironmentDeps {
  return {
    dirExists: async () => true,
    fileExists: async () => true,
    run: async () => ({ code: 0, stderr: "" }),
    ...overrides,
  };
}

describe("defaultPythonPath", () => {
  it("uses bin/python3 on darwin", () => {
    expect(defaultPythonPath("/x/InkStone", "darwin")).toBe(
      "/x/InkStone/.venv/bin/python3",
    );
  });
  it("uses bin/python3 on linux", () => {
    expect(defaultPythonPath("/x/InkStone", "linux")).toBe(
      "/x/InkStone/.venv/bin/python3",
    );
  });
  it("uses Scripts\\python.exe on win32", () => {
    expect(defaultPythonPath("C:\\InkStone", "win32")).toBe(
      "C:\\InkStone\\.venv\\Scripts\\python.exe",
    );
  });
});

describe("validateEnvironment", () => {
  it("passes when everything is in place", async () => {
    const run = vi.fn(async () => ({ code: 0, stderr: "" }));
    const r = await validateEnvironment(settings, makeDeps({ run }));
    expect(r).toEqual({ ok: true });
    expect(run).toHaveBeenCalledWith(settings.pythonPath, [
      "-c",
      "import flask",
    ]);
  });

  it("reports an unset or missing site folder", async () => {
    const r = await validateEnvironment(
      settings,
      makeDeps({ dirExists: async () => false }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problem).toContain("/site");
      expect(r.problem.toLowerCase()).toContain("site folder");
    }
    const empty = await validateEnvironment(
      { ...settings, siteFolder: "" },
      makeDeps(),
    );
    expect(empty.ok).toBe(false);
  });

  it("reports a checkout without app.py", async () => {
    const r = await validateEnvironment(
      settings,
      makeDeps({ fileExists: async () => false }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problem).toContain("app.py");
      expect(r.problem).toContain("/inkstone");
    }
  });

  it("reports an interpreter that cannot be launched", async () => {
    const r = await validateEnvironment(
      settings,
      makeDeps({
        run: async () => {
          throw new Error("spawn ENOENT");
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problem).toContain(settings.pythonPath);
      expect(r.problem).toContain("ENOENT");
    }
  });

  it("reports Flask missing from the interpreter", async () => {
    const r = await validateEnvironment(
      settings,
      makeDeps({
        run: async () => ({
          code: 1,
          stderr: "ModuleNotFoundError: No module named 'flask'",
        }),
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problem).toContain("flask");
      expect(r.problem).toContain("pip install");
    }
  });
});
