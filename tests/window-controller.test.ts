import assert from "node:assert/strict";
import test from "node:test";

import {
  panelHeightForTaskCount,
  scaledSize,
} from "../src/main/window-controller.ts";
import { MIN_SCALE } from "../src/services/preferences.ts";
import { directionIndexFromPoints } from "../src/services/pointer-direction.ts";

const center = { x: 100, y: 100 };

test("maps global cursor positions to the Hatch Pet v2 clockwise directions", () => {
  assert.equal(
    directionIndexFromPoints({ x: 100, y: 50 }, center, 5),
    0,
  );
  assert.equal(
    directionIndexFromPoints({ x: 150, y: 100 }, center, 5),
    4,
  );
  assert.equal(
    directionIndexFromPoints({ x: 100, y: 150 }, center, 5),
    8,
  );
  assert.equal(
    directionIndexFromPoints({ x: 50, y: 100 }, center, 5),
    12,
  );
});

test("returns idle inside the eye-tracking deadzone", () => {
  assert.equal(
    directionIndexFromPoints({ x: 102, y: 103 }, center, 6),
    null,
  );
});

test("keeps the minimum collapsed window compact with a readable hit area", () => {
  assert.deepEqual(scaledSize(MIN_SCALE, false), {
    width: 194,
    height: 62,
  });
  assert.ok(scaledSize(MIN_SCALE, false).height >= 44);
});

test("sizes the task panel for 1 through 10 rows and caps at 10", () => {
  assert.equal(panelHeightForTaskCount(1), 110);
  assert.equal(panelHeightForTaskCount(2), 169);
  assert.equal(panelHeightForTaskCount(10), 641);
  assert.equal(panelHeightForTaskCount(11), 641);

  assert.deepEqual(scaledSize(1, true, 1), {
    width: 352,
    height: 222,
  });
  assert.deepEqual(scaledSize(1, true, 2), {
    width: 352,
    height: 281,
  });
  assert.deepEqual(scaledSize(1, true, 10), {
    width: 352,
    height: 753,
  });
  assert.deepEqual(scaledSize(1, true, 11), {
    width: 352,
    height: 753,
  });
});
