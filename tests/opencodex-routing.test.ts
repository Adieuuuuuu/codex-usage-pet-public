import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  isOpenCodexRouteActive,
  readActiveOpenCodexQuota,
} from "../src/services/opencodex-routing.ts";

const writeConfig = async (content: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "usage-pet-opencodex-route-"));
  const configPath = join(root, "config.toml");
  await writeFile(configPath, content, "utf8");
  return configPath;
};

test("ignores a historical OpenCodex cache when the active provider is native", async () => {
  const configPath = await writeConfig(`
model_provider = "custom"

[model_providers.custom]
name = "OpenAI"
wire_api = "responses"
`);
  assert.equal(isOpenCodexRouteActive(configPath), false);
});

test("detects the active local OpenCodex route", async () => {
  const configPath = await writeConfig(`
model_provider = "custom"

[model_providers.custom]
name = "OpenAI"
base_url = "http://127.0.0.1:10100/v1"
wire_api = "responses"
`);
  assert.equal(isOpenCodexRouteActive(configPath), true);
});

test("ignores an inactive OpenCodex provider and external custom routes", async () => {
  const inactiveConfigPath = await writeConfig(`
model_provider = "native"
[model_providers.native]
name = "OpenAI"
[model_providers.custom]
base_url = "http://127.0.0.1:10100/v1"
`);
  const externalConfigPath = await writeConfig(`
model_provider = "custom"
[model_providers.custom]
base_url = "https://api.example.com/v1"
`);
  assert.equal(isOpenCodexRouteActive(inactiveConfigPath), false);
  assert.equal(isOpenCodexRouteActive(externalConfigPath), false);
});

test("fails closed for missing or malformed config", async () => {
  const malformedPath = await writeConfig("model_provider = [broken");
  assert.equal(isOpenCodexRouteActive(malformedPath), false);
  assert.equal(isOpenCodexRouteActive(`${malformedPath}.missing`), false);
});

test("does not read a valid historical quota cache on a native route", async () => {
  const root = await mkdtemp(join(tmpdir(), "usage-pet-native-quota-"));
  const configPath = join(root, "config.toml");
  const cachePath = join(root, "codex-quota-cache.json");
  const now = Date.parse("2026-08-05T01:00:00.000Z");
  await writeFile(
    configPath,
    `model_provider = "custom"\n[model_providers.custom]\nname = "OpenAI"\n`,
    "utf8",
  );
  await writeFile(
    cachePath,
    JSON.stringify({
      quotas: {
        __main__: {
          weeklyPercent: 17,
          weeklyResetAt: Math.floor(now / 1_000) + 86_400,
          updatedAt: now,
        },
      },
    }),
    "utf8",
  );
  assert.equal(readActiveOpenCodexQuota(configPath, cachePath, now), null);
});
