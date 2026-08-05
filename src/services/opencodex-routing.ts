import { readFileSync } from "node:fs";

import type { UsageWindowSnapshot } from "../shared/contracts.ts";
import { readOpenCodexQuota } from "./opencodex-quota.ts";

const TOML_STRING = /^\s*([A-Za-z0-9_-]+)\s*=\s*(["'])(.*?)\2\s*(?:#.*)?$/;
const PROVIDER_SECTION =
  /^\s*\[\s*model_providers\.(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*\]\s*(?:#.*)?$/;

const readTomlString = (
  line: string,
  expectedKey: string,
): string | null => {
  const match = line.match(TOML_STRING);
  return match?.[1] === expectedKey ? (match[3] ?? null) : null;
};

const isLocalOpenCodexUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "http:" &&
      (host === "127.0.0.1" || host === "localhost" || host === "[::1]") &&
      url.port === "10100" &&
      (url.pathname === "/v1" || url.pathname === "/v1/")
    );
  } catch {
    return false;
  }
};

/** Returns true only when the active Codex provider routes to OpenCodex. */
export const isOpenCodexRouteActive = (configPath: string): boolean => {
  try {
    const lines = readFileSync(configPath, "utf8").split(/\r?\n/);
    let activeProvider: string | null = null;

    for (const line of lines) {
      if (PROVIDER_SECTION.test(line)) {
        break;
      }
      activeProvider ??= readTomlString(line, "model_provider");
    }
    if (activeProvider === null) {
      return false;
    }

    let inActiveProvider = false;
    for (const line of lines) {
      const section = line.match(PROVIDER_SECTION);
      if (section !== null) {
        const providerName = section[1] ?? section[2] ?? section[3] ?? "";
        inActiveProvider = providerName === activeProvider;
        continue;
      }
      if (!inActiveProvider) {
        continue;
      }
      const baseUrl = readTomlString(line, "base_url");
      if (baseUrl !== null) {
        return isLocalOpenCodexUrl(baseUrl);
      }
    }
    return false;
  } catch {
    return false;
  }
};

export const readActiveOpenCodexQuota = (
  configPath: string,
  cachePath: string,
  now = Date.now(),
): UsageWindowSnapshot | null =>
  isOpenCodexRouteActive(configPath)
    ? readOpenCodexQuota(cachePath, now)
    : null;
