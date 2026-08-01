import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  OPENCODEX_QUOTA_CACHE_MAX_AGE_MS,
  readOpenCodexQuota,
} from "../src/services/opencodex-quota.ts";

test("converts OpenCodex main-account used percent into remaining weekly usage", async () => {
  const root = await mkdtemp(join(tmpdir(), "usage-pet-opencodex-quota-"));
  const cachePath = join(root, "codex-quota-cache.json");
  const now = Date.parse("2026-08-01T10:20:00.000Z");
  const updatedAt = now - 60_000;
  const resetAt = Math.floor(
    Date.parse("2026-08-08T03:33:11.000Z") / 1_000,
  );
  await writeFile(
    cachePath,
    JSON.stringify({
      version: 1,
      quotas: {
        __main__: {
          weeklyPercent: 3,
          weeklyResetAt: resetAt,
          updatedAt,
        },
      },
    }),
    "utf8",
  );

  assert.deepEqual(readOpenCodexQuota(cachePath, now), {
    remainingPercent: 97,
    usedPercent: 3,
    windowDurationMins: 10_080,
    resetsAt: resetAt,
    capturedAt: new Date(updatedAt).toISOString(),
    source: "opencodex-quota-cache",
  });
});

test("ignores stale, reset, malformed, and non-main OpenCodex quota data", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "usage-pet-opencodex-quota-invalid-"),
  );
  const cachePath = join(root, "codex-quota-cache.json");
  const now = Date.parse("2026-08-01T10:20:00.000Z");
  const resetAt = Math.floor(
    Date.parse("2026-08-08T03:33:11.000Z") / 1_000,
  );

  await writeFile(
    cachePath,
    JSON.stringify({
      version: 1,
      quotas: {
        account_2: {
          weeklyPercent: 2,
          weeklyResetAt: resetAt,
          updatedAt: now,
        },
        __main__: {
          weeklyPercent: 2,
          weeklyResetAt: resetAt,
          updatedAt: now - OPENCODEX_QUOTA_CACHE_MAX_AGE_MS - 1,
        },
      },
    }),
    "utf8",
  );
  assert.equal(readOpenCodexQuota(cachePath, now), null);

  await writeFile(cachePath, "not json", "utf8");
  assert.equal(readOpenCodexQuota(cachePath, now), null);
});
