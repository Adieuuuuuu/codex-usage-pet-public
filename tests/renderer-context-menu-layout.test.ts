import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(
  new URL("../src/renderer/context-menu.css", import.meta.url),
  "utf8",
);

test("keeps the context menu shadowless in light and dark modes", () => {
  const menuRules =
    styles.match(/\.menu-shell\s*\{[^}]*\}/gs) ?? [];

  assert.equal(menuRules.length, 2);
  for (const rules of menuRules) {
    assert.match(rules, /box-shadow:\s*none/);
    assert.doesNotMatch(rules, /drop-shadow|rgba\([^)]*\)\s*,/);
  }
});
