import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  PetPackRegistry,
  PetPackValidationError,
  validatePetDirectory,
} from "../src/services/pet-registry.ts";

function makeVp8xWebp(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUInt32LE(10, 16);
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  return buffer;
}

async function createRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "usage-pet-registry-"));
}

async function createPet(
  root: string,
  directoryName: string,
  manifest: Record<string, unknown>,
  dimensions: { width: number; height: number },
): Promise<string> {
  const packageDirectory = join(root, directoryName);
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(join(packageDirectory, "pet.json"), JSON.stringify(manifest), "utf8");
  await writeFile(
    join(packageDirectory, "spritesheet.webp"),
    makeVp8xWebp(dimensions.width, dimensions.height),
  );
  return packageDirectory;
}

test("validates a legacy v1 package when spriteVersionNumber is omitted", async () => {
  const root = await createRoot();
  const packageDirectory = await createPet(
    root,
    "legacy",
    {
      id: "legacy",
      displayName: "Legacy",
      description: "A v1 test pet.",
      spritesheetPath: "spritesheet.webp",
    },
    { width: 1536, height: 1872 },
  );

  const pack = await validatePetDirectory(packageDirectory);

  assert.equal(pack.snapshot.spriteVersionNumber, 1);
  assert.equal(pack.snapshot.atlasHeight, 1872);
  assert.equal(pack.snapshot.frameWidth, 192);
  assert.equal(pack.snapshot.frameHeight, 208);
  assert.equal(pack.mediaType, "image/webp");
});

test("validates v2, prefers zhima-3, and keeps absolute paths out of snapshots", async () => {
  const root = await createRoot();
  await createPet(
    root,
    "alpha",
    {
      id: "alpha",
      displayName: "Alpha",
      description: "The alphabetically first pet.",
      spriteVersionNumber: 2,
      cellSize: [192, 208],
      spritesheetPath: "spritesheet.webp",
    },
    { width: 1536, height: 2288 },
  );
  await createPet(
    root,
    "zhima-3",
    {
      id: "zhima-3",
      displayName: "芝麻 3",
      description: "The preferred pet.",
      spriteVersionNumber: 2,
      cellSize: { width: 192, height: 208 },
      spritesheetPath: "spritesheet.webp",
    },
    { width: 1536, height: 2288 },
  );

  const registry = new PetPackRegistry({ roots: [root], selectedId: "missing" });
  const snapshot = await registry.refresh();

  assert.equal(snapshot.selected?.id, "zhima-3");
  assert.equal(snapshot.selected?.atlasHeight, 2288);
  assert.match(snapshot.selected?.assetUrl ?? "", /^usagepet:\/\/pet\//u);
  assert.equal(JSON.stringify(snapshot).includes(root), false);
  assert.ok(registry.resolveSpritesheet("zhima-3")?.startsWith(root));

  assert.equal(registry.select("alpha")?.id, "alpha");
  assert.equal((await registry.refresh()).selected?.id, "alpha");
});

test("lets a user-installed pet override the bundled fallback with the same id", async () => {
  const userRoot = await createRoot();
  const bundledRoot = await createRoot();
  const userPackage = await createPet(
    userRoot,
    "zhima-3",
    {
      id: "zhima-3",
      displayName: "用户更新版芝麻 3",
      description: "Loaded from the user Codex pet directory.",
      spriteVersionNumber: 2,
      spritesheetPath: "spritesheet.webp",
    },
    { width: 1536, height: 2288 },
  );
  await createPet(
    bundledRoot,
    "zhima-3",
    {
      id: "zhima-3",
      displayName: "内置芝麻 3",
      description: "Bundled fallback.",
      spriteVersionNumber: 2,
      spritesheetPath: "spritesheet.webp",
    },
    { width: 1536, height: 2288 },
  );

  const registry = new PetPackRegistry({
    roots: [userRoot, bundledRoot],
    selectedId: "zhima-3",
  });
  const snapshot = await registry.refresh();
  const initialAssetUrl = snapshot.selected?.assetUrl;

  assert.equal(snapshot.pets.length, 1);
  assert.equal(snapshot.selected?.displayName, "用户更新版芝麻 3");
  assert.ok(
    registry.getSelectedResolved()?.packageDirectory.startsWith(userRoot),
  );

  const replacement = makeVp8xWebp(1536, 2288);
  replacement[20] = 1;
  await writeFile(
    join(userPackage, "spritesheet.webp"),
    replacement,
  );
  const rescanned = await registry.refresh();
  assert.notEqual(rescanned.selected?.assetUrl, initialAssetUrl);
});

test("rejects spritesheet path traversal", async () => {
  const root = await createRoot();
  await writeFile(join(root, "outside.webp"), makeVp8xWebp(1536, 2288));
  const packageDirectory = await createPet(
    root,
    "traversal",
    {
      id: "traversal",
      displayName: "Traversal",
      description: "Must not escape its package.",
      spriteVersionNumber: 2,
      spritesheetPath: "../outside.webp",
    },
    { width: 1536, height: 2288 },
  );

  await assert.rejects(
    validatePetDirectory(packageDirectory),
    (error: unknown) =>
      error instanceof PetPackValidationError && error.code === "path-invalid",
  );
});

test("rejects a valid-header image with the wrong v2 dimensions", async () => {
  const root = await createRoot();
  const packageDirectory = await createPet(
    root,
    "wrong-size",
    {
      id: "wrong-size",
      displayName: "Wrong size",
      description: "Has the wrong atlas width.",
      spriteVersionNumber: 2,
      spritesheetPath: "spritesheet.webp",
    },
    { width: 1535, height: 2288 },
  );

  await assert.rejects(
    validatePetDirectory(packageDirectory),
    (error: unknown) =>
      error instanceof PetPackValidationError && error.code === "dimensions-invalid",
  );
});

test("rejects unsupported versions, wrong cell sizes, and malformed JSON", async (t) => {
  const root = await createRoot();

  await t.test("unsupported spriteVersionNumber", async () => {
    const packageDirectory = await createPet(
      root,
      "bad-version",
      {
        id: "bad-version",
        displayName: "Bad version",
        description: "Uses an unsupported sprite version.",
        spriteVersionNumber: 3,
        spritesheetPath: "spritesheet.webp",
      },
      { width: 1536, height: 2288 },
    );
    await assert.rejects(validatePetDirectory(packageDirectory), PetPackValidationError);
  });

  await t.test("wrong declared cellSize", async () => {
    const packageDirectory = await createPet(
      root,
      "bad-cell",
      {
        id: "bad-cell",
        displayName: "Bad cell",
        description: "Declares an incompatible cell size.",
        spriteVersionNumber: 2,
        cellSize: { width: 200, height: 208 },
        spritesheetPath: "spritesheet.webp",
      },
      { width: 1536, height: 2288 },
    );
    await assert.rejects(validatePetDirectory(packageDirectory), PetPackValidationError);
  });

  await t.test("malformed pet.json", async () => {
    const packageDirectory = join(root, "bad-json");
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(join(packageDirectory, "pet.json"), "{", "utf8");
    await writeFile(join(packageDirectory, "spritesheet.webp"), makeVp8xWebp(1536, 2288));
    await assert.rejects(validatePetDirectory(packageDirectory), PetPackValidationError);
  });
});
