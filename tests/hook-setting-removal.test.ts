import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string): string => readFileSync(path, "utf8");

test("does not expose Codex Hook setup in either context menu", () => {
  const sources = [
    read("src/renderer/context-menu.html"),
    read("src/renderer/context-menu.ts"),
    read("src/shared/contracts.ts"),
    read("src/main/index.ts"),
  ].join("\n");

  assert.doesNotMatch(sources, /hook-action|enable-hook/u);
  assert.doesNotMatch(sources, /启用 Codex 实时 Hook/u);
});
