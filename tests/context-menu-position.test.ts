import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTEXT_MENU_WINDOW_SIZE,
  positionContextMenu,
} from "../src/services/context-menu-position.ts";

test("positions the fixed-size menu beside a global cursor anchor", () => {
  assert.deepEqual(
    positionContextMenu(
      { x: 520, y: 280 },
      { x: 0, y: 0, width: 1920, height: 1040 },
    ),
    { x: 526, y: 268 },
  );
  assert.deepEqual(CONTEXT_MENU_WINDOW_SIZE, {
    width: 286,
    height: 414,
  });
});

test("flips and clamps the menu inside the active display work area", () => {
  assert.deepEqual(
    positionContextMenu(
      { x: 1900, y: 1020 },
      { x: 0, y: 0, width: 1920, height: 1040 },
    ),
    { x: 1608, y: 626 },
  );
  assert.deepEqual(
    positionContextMenu(
      { x: -1915, y: 10 },
      { x: -1920, y: 0, width: 1920, height: 1040 },
    ),
    { x: -1909, y: 0 },
  );
});
