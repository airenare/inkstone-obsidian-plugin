import { describe, expect, it, vi } from "vitest";
import {
  compareVersions,
  defaultPythonPath,
  effectivePythonPath,
  folderFromPickedFile,
  parseVersion,
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
    readFile: async () => "1.57.0\n",
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

describe("folderFromPickedFile", () => {
  it("returns the picked folder", () => {
    expect(folderFromPickedFile("/a/notes/x.md", "notes/x.md")).toBe(
      "/a/notes",
    );
  });
  it("handles a repeated folder name", () => {
    expect(
      folderFromPickedFile("/a/notes/sub/notes/x.md", "notes/sub/notes/x.md"),
    ).toBe("/a/notes");
  });
  it("handles Windows-style paths", () => {
    expect(
      folderFromPickedFile(
        "C:\\a\\notes\\sub\\x.md",
        "notes/sub/x.md",
      ),
    ).toBe("C:\\a\\notes");
  });
});

describe("validateEnvironment python default", () => {
  it("falls back to the default interpreter when pythonPath is empty", async () => {
    const run = vi.fn(async () => ({ code: 0, stderr: "" }));
    const r = await validateEnvironment(
      { ...settings, pythonPath: "" },
      makeDeps({ run }),
    );
    expect(r).toEqual({ ok: true });
    expect(run).toHaveBeenCalledWith(
      defaultPythonPath("/inkstone", process.platform),
      ["-c", "import flask"],
    );
  });
});

describe("validateEnvironment site folder resolution", () => {
  it("resolves a relative site folder against the vault", async () => {
    const dirExists = vi.fn(async () => true);
    const r = await validateEnvironment(
      { ...settings, siteFolder: "site" },
      makeDeps({ dirExists, vaultBasePath: "/vault" }),
    );
    expect(r).toEqual({ ok: true });
    expect(dirExists).toHaveBeenCalledWith("/vault/site");
  });

  it("refuses a relative site folder when the vault path is unknown", async () => {
    const dirExists = vi.fn(async () => true);
    const r = await validateEnvironment(
      { ...settings, siteFolder: "site" },
      makeDeps({ dirExists, vaultBasePath: null }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain("site");
    expect(dirExists).not.toHaveBeenCalled();
  });
});

describe("parseVersion / compareVersions", () => {
  it("parses X.Y.Z with surrounding whitespace", () => {
    expect(parseVersion(" 1.57.0\n")).toEqual([1, 57, 0]);
    expect(parseVersion("v2.0.10")).toEqual([2, 0, 10]);
  });
  it("rejects anything else", () => {
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("1.57")).toBeNull();
    expect(parseVersion("abc")).toBeNull();
    expect(parseVersion("1.57.0.1")).toBeNull();
  });
  it("compares numerically, not as strings", () => {
    expect(compareVersions([1, 57, 0], [1, 57, 0])).toBe(0);
    expect(compareVersions([1, 9, 0], [1, 57, 0])).toBeLessThan(0);
    expect(compareVersions([1, 100, 0], [1, 57, 0])).toBeGreaterThan(0);
    expect(compareVersions([2, 0, 0], [1, 99, 99])).toBeGreaterThan(0);
    expect(compareVersions([1, 57, 1], [1, 57, 2])).toBeLessThan(0);
  });
});

describe("validateEnvironment InkStone version", () => {
  it("reads VERSION from the checkout root", async () => {
    const readFile = vi.fn(async () => "1.60.2\n");
    const r = await validateEnvironment(settings, makeDeps({ readFile }));
    expect(r).toEqual({ ok: true });
    expect(readFile).toHaveBeenCalledWith("/inkstone/VERSION");
  });

  it("rejects a checkout older than 1.57.0", async () => {
    const run = vi.fn(async () => ({ code: 0, stderr: "" }));
    const r = await validateEnvironment(
      settings,
      makeDeps({ readFile: async () => "1.56.3\n", run }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problem).toContain("1.56.3");
      expect(r.problem).toContain("1.57.0");
      expect(r.problem).toContain("git pull");
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("reports a missing VERSION file", async () => {
    const r = await validateEnvironment(
      settings,
      makeDeps({
        readFile: async () => {
          throw new Error("ENOENT");
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain("VERSION");
  });

  it("reports an unparseable VERSION file", async () => {
    const r = await validateEnvironment(
      settings,
      makeDeps({ readFile: async () => "garbage" }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problem).toContain("VERSION");
      expect(r.problem).toContain("garbage");
    }
  });
});

describe("effectivePythonPath", () => {
  it("trims an explicit path", () => {
    expect(
      effectivePythonPath({ ...settings, pythonPath: "  /opt/py \n" }, "linux"),
    ).toBe("/opt/py");
  });
  it("falls back to the venv default when blank", () => {
    expect(
      effectivePythonPath({ ...settings, pythonPath: "   " }, "darwin"),
    ).toBe("/inkstone/.venv/bin/python3");
  });
});
