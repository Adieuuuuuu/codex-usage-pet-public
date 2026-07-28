import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_SCALE,
  MIN_SCALE,
  normalizePreferences,
} from "../src/services/preferences.ts";

test("normalizes persisted scale, position, and selected pet", () => {
  assert.deepEqual(
    normalizePreferences({
      scale: 0.4,
      position: { x: 12.7, y: -9.2 },
      selectedPetId: "zhima-3",
    }),
    {
      scale: 0.55,
      position: { x: 13, y: -9 },
      selectedPetId: "zhima-3",
    },
  );
});

test("locks the supported scale range to a readable compact minimum", () => {
  assert.equal(MIN_SCALE, 0.55);
  assert.equal(
    normalizePreferences({ scale: MIN_SCALE - 0.01 }).scale,
    MIN_SCALE,
  );
  assert.equal(
    normalizePreferences({ scale: MAX_SCALE + 0.01 }).scale,
    MAX_SCALE,
  );
});

test("falls back safely for malformed preference fields", () => {
  assert.deepEqual(
    normalizePreferences({
      scale: Number.NaN,
      position: { x: "private", y: 1 },
      selectedPetId: "../escape",
    }),
    {
      scale: 1,
      position: null,
      selectedPetId: "zhima-3",
    },
  );
});
