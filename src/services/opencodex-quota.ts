import { readFileSync } from "node:fs";

import type { UsageWindowSnapshot } from "../shared/contracts.ts";

export const OPENCODEX_WEEKLY_WINDOW_MINUTES = 7 * 24 * 60;
export const OPENCODEX_QUOTA_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1_000;

type OpenCodexQuotaCache = {
  quotas?: {
    __main__?: {
      weeklyPercent?: unknown;
      weeklyResetAt?: unknown;
      updatedAt?: unknown;
    };
  };
};

const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const readOpenCodexQuota = (
  cachePath: string,
  now = Date.now(),
): UsageWindowSnapshot | null => {
  let cache: OpenCodexQuotaCache;
  try {
    cache = JSON.parse(readFileSync(cachePath, "utf8")) as OpenCodexQuotaCache;
  } catch {
    return null;
  }

  const quota = cache.quotas?.__main__;
  const weeklyPercent = finiteNumber(quota?.weeklyPercent);
  const weeklyResetAt = finiteNumber(quota?.weeklyResetAt);
  const updatedAt = finiteNumber(quota?.updatedAt);
  if (
    weeklyPercent === null ||
    weeklyPercent < 0 ||
    weeklyPercent > 100 ||
    weeklyResetAt === null ||
    weeklyResetAt <= Math.floor(now / 1_000) ||
    updatedAt === null ||
    updatedAt > now + 5 * 60 * 1_000 ||
    now - updatedAt > OPENCODEX_QUOTA_CACHE_MAX_AGE_MS
  ) {
    return null;
  }

  return {
    remainingPercent: 100 - weeklyPercent,
    usedPercent: weeklyPercent,
    windowDurationMins: OPENCODEX_WEEKLY_WINDOW_MINUTES,
    resetsAt: weeklyResetAt,
    capturedAt: new Date(updatedAt).toISOString(),
    source: "opencodex-quota-cache",
  };
};
