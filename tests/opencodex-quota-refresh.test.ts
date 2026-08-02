import assert from "node:assert/strict";
import test from "node:test";

import {
  OpenCodexQuotaRefresher,
  resolveOpenCodexQuotaRefreshCommand,
  type OpenCodexQuotaRefreshRunner,
} from "../src/services/opencodex-quota-refresh.ts";

test("builds a fixed Windows OpenCodex quota refresh command", () => {
  assert.deepEqual(
    resolveOpenCodexQuotaRefreshCommand(
      "win32",
      "C:\\Windows\\System32\\cmd.exe",
    ),
    {
      file: "C:\\Windows\\System32\\cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        "ocx.cmd account refresh openai --json",
      ],
    },
  );
});

test("coalesces concurrent quota refreshes and recovers after failure", async () => {
  let release!: () => void;
  let calls = 0;
  const runner: OpenCodexQuotaRefreshRunner = () => {
    calls += 1;
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  };
  const refresher = new OpenCodexQuotaRefresher(runner, {
    file: "ocx",
    args: ["account", "refresh", "openai", "--json"],
  });

  const first = refresher.refresh();
  const second = refresher.refresh();
  assert.equal(first, second);
  assert.equal(calls, 1);
  release();
  assert.equal(await first, true);

  const failed = new OpenCodexQuotaRefresher(async () => {
    throw new Error("offline");
  });
  assert.equal(await failed.refresh(), false);
});
