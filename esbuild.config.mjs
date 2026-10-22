import esbuild from "esbuild";
import process from "process";
import { builtinModules as builtins } from "node:module";

const production = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/*",
    "@lezer/*",
    ...builtins,
    ...builtins.map((name) => `node:${name}`),
  ],
  format: "cjs",
  target: "es2020",
  platform: "node",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  minify: production,
  outfile: "main.js",
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
