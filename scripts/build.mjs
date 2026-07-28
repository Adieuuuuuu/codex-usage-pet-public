import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

const ensureParent = (filePath) => {
  mkdirSync(dirname(filePath), { recursive: true });
};

const buildEntry = async (entry, outfile, options) => {
  ensureParent(outfile);
  await build({
    entryPoints: [entry],
    outfile,
    absWorkingDir: root,
    bundle: true,
    sourcemap: true,
    logLevel: "info",
    legalComments: "none",
    ...options,
  });
};

await Promise.all([
  buildEntry(
    "./src/main/index.ts",
    resolve(dist, "main/index.cjs"),
    {
      platform: "node",
      format: "cjs",
      target: "node24",
      external: ["electron", "node:sqlite"],
    },
  ),
  buildEntry(
    "./src/preload/index.ts",
    resolve(dist, "preload/index.cjs"),
    {
      platform: "node",
      format: "cjs",
      target: "node24",
      external: ["electron"],
    },
  ),
  buildEntry(
    "./src/preload/context-menu.ts",
    resolve(dist, "preload/context-menu.cjs"),
    {
      platform: "node",
      format: "cjs",
      target: "node24",
      external: ["electron"],
    },
  ),
  buildEntry(
    "./src/renderer/index.ts",
    resolve(dist, "renderer/index.js"),
    {
      platform: "browser",
      format: "iife",
      target: "chrome140",
    },
  ),
  buildEntry(
    "./src/renderer/context-menu.ts",
    resolve(dist, "renderer/context-menu.js"),
    {
      platform: "browser",
      format: "iife",
      target: "chrome140",
    },
  ),
]);

for (const file of [
  "index.html",
  "styles.css",
  "context-menu.html",
  "context-menu.css",
]) {
  const source = resolve(root, "src/renderer", file);
  const target = resolve(dist, "renderer", file);
  ensureParent(target);
  copyFileSync(source, target);
}

cpSync(
  resolve(root, "src/renderer/icons"),
  resolve(dist, "renderer/icons"),
  { recursive: true },
);

cpSync(
  resolve(root, "src/renderer/sounds"),
  resolve(dist, "renderer/sounds"),
  { recursive: true },
);
