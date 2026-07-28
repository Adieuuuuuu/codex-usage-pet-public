import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  HOOK_SOUND_COOLDOWN_MS,
  HookSoundGate,
} from "../src/renderer/hook-sound-gate.ts";

const rendererSource = readFileSync(
  "src/renderer/index.ts",
  "utf8",
);

test("plays only on live transitions into waiting or review", () => {
  const gate = new HookSoundGate();

  assert.equal(
    gate.update([{ id: "first", status: "review" }], 1_000),
    false,
  );
  assert.equal(
    gate.update([{ id: "first", status: "running" }], 2_000),
    false,
  );
  assert.equal(
    gate.update([{ id: "first", status: "waiting" }], 3_000),
    true,
  );
  assert.equal(
    gate.update([{ id: "first", status: "waiting" }], 4_000),
    false,
  );
  assert.equal(
    gate.update(
      [
        { id: "first", status: "waiting" },
        { id: "second", status: "review" },
      ],
      3_000 + HOOK_SOUND_COOLDOWN_MS - 1,
    ),
    false,
  );
  assert.equal(
    gate.update(
      [
        { id: "first", status: "running" },
        { id: "second", status: "running" },
      ],
      3_000 + HOOK_SOUND_COOLDOWN_MS,
    ),
    false,
  );
  assert.equal(
    gate.update(
      [
        { id: "first", status: "running" },
        { id: "second", status: "review" },
      ],
      3_000 + HOOK_SOUND_COOLDOWN_MS,
    ),
    true,
  );
});

test("drives task sounds from notification states without requiring Hook connection", () => {
  assert.match(
    rendererSource,
    /hookSoundGate\.update\(nextSnapshot\.notificationTasks\)/u,
  );
  assert.doesNotMatch(
    rendererSource,
    /nextSnapshot\.hookMode\s*===\s*"connected"[\s\S]*hookSoundGate\.update/u,
  );
});

test("bundles the public-domain notification sound", () => {
  const contents = readFileSync(
    "src/renderer/sounds/hook-notification.mp3",
  );
  assert.equal(
    createHash("sha256").update(contents).digest("hex").toUpperCase(),
    "D7D5F0AAB2AEA359AAD83EC7FE8657B2B474574F9C46B708B082EB77C7AD19CB",
  );
});
