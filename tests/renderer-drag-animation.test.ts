import assert from "node:assert/strict";
import test from "node:test";

import { updateDragAnimation } from "../src/renderer/drag-animation.ts";

test("starts the matching drag animation without restarting it on every move", () => {
  assert.deepEqual(updateDragAnimation(null, 4), {
    state: "running-right",
    changed: true,
  });
  assert.deepEqual(updateDragAnimation("running-right", 3), {
    state: "running-right",
    changed: false,
  });
  assert.deepEqual(updateDragAnimation("running-right", -2), {
    state: "running-left",
    changed: true,
  });
});

test("keeps the current drag animation when horizontal movement pauses", () => {
  assert.deepEqual(updateDragAnimation("running-left", 0), {
    state: "running-left",
    changed: false,
  });
});
