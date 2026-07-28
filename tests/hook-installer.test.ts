import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  buildUsagePetHookCommand,
  HOOK_EVENTS,
  mergeUsagePetHooks,
} from "../src/services/hook-installer.ts";

test("merges one Usage Pet command per event while preserving other products", () => {
  const command = buildUsagePetHookCommand(
    "C:\\Apps\\Usage Pet\\Usage Pet.exe",
    "C:\\Apps\\Usage Pet\\resources\\hooks\\codex-hook.cjs",
    "C:\\Users\\Adie\\AppData\\Roaming\\Usage Pet",
  );
  const existingCommand = 'node "D:\\clawd\\codex-hook.js"';
  const merged = mergeUsagePetHooks(
    {
      unrelated: { keep: true },
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: existingCommand }] }],
      },
    },
    command,
  );

  assert.deepEqual(merged.unrelated, { keep: true });
  const hooks = merged.hooks as Record<string, unknown[]>;
  assert.equal(hooks.Stop?.length, 2);
  assert.deepEqual(hooks.Stop?.[0], {
    hooks: [{ type: "command", command: existingCommand }],
  });
  for (const event of HOOK_EVENTS) {
    assert.equal(
      JSON.stringify(hooks[event]).match(/USAGE_PET_HOOK=1/gu)?.length,
      1,
    );
  }
});

test("updating the generated command is idempotent and removes its old path", () => {
  const oldCommand = buildUsagePetHookCommand(
    "C:\\Old\\Usage Pet.exe",
    "C:\\Old\\codex-hook.cjs",
    "C:\\Old\\Data",
  );
  const newCommand = buildUsagePetHookCommand(
    "C:\\New\\Usage Pet.exe",
    "C:\\New\\codex-hook.cjs",
    "C:\\New\\Data",
  );
  const first = mergeUsagePetHooks({}, oldCommand);
  const second = mergeUsagePetHooks(first, newCommand);
  const serialized = JSON.stringify(second);

  assert.equal(serialized.includes("C:\\\\Old"), false);
  assert.equal(
    serialized.match(/USAGE_PET_HOOK=1/gu)?.length,
    HOOK_EVENTS.length,
  );
});

test("rejects malformed existing hook event containers", () => {
  assert.throws(
    () =>
      mergeUsagePetHooks(
        { hooks: { Stop: { hooks: [] } } },
        "safe command",
      ),
    /Stop must contain an array/u,
  );
});

test(
  "generates a PowerShell command that preserves quoted paths and environment",
  { skip: process.platform !== "win32" },
  () => {
    const probe = fileURLToPath(
      new URL("fixtures/hook-env-probe.cjs", import.meta.url),
    );
    const dataDirectory = join(
      tmpdir(),
      "Usage Pet & Adie's Data",
    );
    const command = buildUsagePetHookCommand(
      process.execPath,
      probe,
      dataDirectory,
    );
    const result = spawnSync(
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      {
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      electronRunAsNode: "1",
      usagePetHook: "1",
      dataDirectory: resolve(dataDirectory),
    });
  },
);

test("rejects line breaks in generated Hook paths", () => {
  assert.throws(
    () =>
      buildUsagePetHookCommand(
        "C:\\Apps\\Usage Pet\\Usage Pet.exe",
        "C:\\Apps\\Usage Pet\\codex-hook.cjs",
        "C:\\Users\\Adie\\Usage Pet\nInjected",
      ),
    /unsafe for a Hook command/u,
  );
  assert.throws(
    () =>
      buildUsagePetHookCommand(
        "C:\\Apps\\Usage Pet\\Usage Pet.exe",
        "C:\\Apps\\Usage Pet\\codex-hook.cjs\rInjected",
        "C:\\Users\\Adie & Guest's Usage Pet",
      ),
    /unsafe for a Hook command/u,
  );
});
