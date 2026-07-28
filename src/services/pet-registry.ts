import { readdir, readFile, realpath, stat } from "node:fs/promises";
import {
  extname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";
import { TextDecoder } from "node:util";

import type { PetPackSnapshot } from "../shared/contracts.ts";
import { readRasterSize, type RasterSize } from "./webp-size.ts";

const MANIFEST_FILENAME = "pet.json";
const MAX_MANIFEST_BYTES = 64 * 1024;
const DEFAULT_PREFERRED_ID = "zhima-3";
const FRAME_WIDTH = 192 as const;
const FRAME_HEIGHT = 208 as const;
const ATLAS_WIDTH = 1536 as const;

type PetVersion = 1 | 2;
type AtlasHeight = 1872 | 2288;

export type PetValidationCode =
  | "manifest-invalid"
  | "manifest-too-large"
  | "path-invalid"
  | "spritesheet-missing"
  | "spritesheet-invalid"
  | "dimensions-invalid";

export class PetPackValidationError extends Error {
  readonly code: PetValidationCode;

  constructor(code: PetValidationCode, message: string) {
    super(message);
    this.name = "PetPackValidationError";
    this.code = code;
  }
}

export interface ResolvedPetPack {
  snapshot: PetPackSnapshot;
  packageDirectory: string;
  manifestPath: string;
  spritesheetPath: string;
  mediaType: RasterSize["mediaType"];
}

export interface PetRegistryDiagnostic {
  packageName: string;
  code: PetValidationCode;
  message: string;
}

export interface PetRegistrySnapshot {
  pets: PetPackSnapshot[];
  selected: PetPackSnapshot | null;
}

export interface PetPackRegistryOptions {
  roots: readonly string[];
  selectedId?: string | null;
  preferredId?: string;
}

interface PetManifest {
  id: string;
  displayName: string;
  description: string;
  spriteVersionNumber: PetVersion;
  spritesheetPath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedLookupId(id: string): string {
  return id.toLocaleLowerCase("en-US");
}

function readRequiredText(
  manifest: Record<string, unknown>,
  field: "id" | "displayName" | "description" | "spritesheetPath",
  maxLength: number,
): string {
  const raw = manifest[field];
  if (typeof raw !== "string") {
    throw new PetPackValidationError("manifest-invalid", `${field} must be a string`);
  }

  const value = raw.trim();
  if (!value || value.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
    throw new PetPackValidationError(
      "manifest-invalid",
      `${field} must be non-empty, bounded text`,
    );
  }

  return value;
}

function readPetVersion(manifest: Record<string, unknown>): PetVersion {
  const value = manifest.spriteVersionNumber;
  if (value === undefined || value === 1) {
    return 1;
  }
  if (value === 2) {
    return 2;
  }
  throw new PetPackValidationError(
    "manifest-invalid",
    "spriteVersionNumber must be 1, 2, or omitted for a v1 package",
  );
}

function validateCellSize(manifest: Record<string, unknown>): void {
  const value = manifest.cellSize;
  if (value === undefined) {
    return;
  }

  const isTuple =
    Array.isArray(value) &&
    value.length === 2 &&
    value[0] === FRAME_WIDTH &&
    value[1] === FRAME_HEIGHT;
  const isObject =
    isRecord(value) && value.width === FRAME_WIDTH && value.height === FRAME_HEIGHT;

  if (!isTuple && !isObject) {
    throw new PetPackValidationError(
      "manifest-invalid",
      `cellSize must be ${FRAME_WIDTH}x${FRAME_HEIGHT}`,
    );
  }
}

function parseManifest(contents: Buffer): PetManifest {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(contents);
  } catch {
    throw new PetPackValidationError("manifest-invalid", "pet.json must be valid UTF-8");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded) as unknown;
  } catch {
    throw new PetPackValidationError("manifest-invalid", "pet.json must contain valid JSON");
  }

  if (!isRecord(parsed)) {
    throw new PetPackValidationError("manifest-invalid", "pet.json must contain an object");
  }

  validateCellSize(parsed);
  const id = readRequiredText(parsed, "id", 128);
  try {
    encodeURIComponent(id);
  } catch {
    throw new PetPackValidationError("manifest-invalid", "id contains invalid Unicode");
  }

  return {
    id,
    displayName: readRequiredText(parsed, "displayName", 160),
    description: readRequiredText(parsed, "description", 1_000),
    spriteVersionNumber: readPetVersion(parsed),
    spritesheetPath: readRequiredText(parsed, "spritesheetPath", 512),
  };
}

function isContained(parentDirectory: string, candidatePath: string): boolean {
  const pathFromParent = relative(parentDirectory, candidatePath);
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith(`..${sep}`) &&
      pathFromParent !== ".." &&
      !isAbsolute(pathFromParent))
  );
}

async function resolveSpritesheet(
  packageDirectory: string,
  manifestPath: string,
): Promise<string> {
  const normalized = manifestPath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    isAbsolute(manifestPath) ||
    win32.isAbsolute(manifestPath) ||
    posix.isAbsolute(manifestPath) ||
    /^[a-z][a-z0-9+.-]*:/iu.test(manifestPath) ||
    segments.some((segment) => segment === ".." || segment === "" || segment === ".")
  ) {
    throw new PetPackValidationError(
      "path-invalid",
      "spritesheetPath must be a normalized relative path",
    );
  }

  const extension = extname(normalized).toLowerCase();
  if (extension !== ".webp" && extension !== ".png") {
    throw new PetPackValidationError(
      "path-invalid",
      "spritesheetPath must point to a .webp or .png file",
    );
  }

  const packagePath = resolve(packageDirectory);
  const candidatePath = resolve(packagePath, ...segments);
  if (!isContained(packagePath, candidatePath)) {
    throw new PetPackValidationError(
      "path-invalid",
      "spritesheetPath must stay inside the pet package",
    );
  }

  let realPackagePath: string;
  let realCandidatePath: string;
  try {
    [realPackagePath, realCandidatePath] = await Promise.all([
      realpath(packagePath),
      realpath(candidatePath),
    ]);
  } catch {
    throw new PetPackValidationError(
      "spritesheet-missing",
      "spritesheetPath does not identify a readable file",
    );
  }

  if (!isContained(realPackagePath, realCandidatePath)) {
    throw new PetPackValidationError(
      "path-invalid",
      "spritesheetPath resolves outside the pet package",
    );
  }

  return realCandidatePath;
}

function expectedAtlasHeight(version: PetVersion): AtlasHeight {
  return version === 2 ? 2288 : 1872;
}

function createAssetUrl(id: string, contentHash: string): string {
  return `usagepet://pet/${encodeURIComponent(
    id,
  )}/spritesheet?v=${contentHash}`;
}

export async function validatePetDirectory(packageDirectory: string): Promise<ResolvedPetPack> {
  const manifestPath = join(packageDirectory, MANIFEST_FILENAME);
  let manifestStat;
  try {
    manifestStat = await stat(manifestPath);
  } catch {
    throw new PetPackValidationError("manifest-invalid", "pet.json is missing");
  }

  if (!manifestStat.isFile() || manifestStat.size === 0) {
    throw new PetPackValidationError("manifest-invalid", "pet.json must be a non-empty file");
  }
  if (manifestStat.size > MAX_MANIFEST_BYTES) {
    throw new PetPackValidationError(
      "manifest-too-large",
      "pet.json must be smaller than 64 KiB",
    );
  }

  const manifest = parseManifest(await readFile(manifestPath));
  const spritesheetPath = await resolveSpritesheet(packageDirectory, manifest.spritesheetPath);

  let rasterSize: RasterSize;
  try {
    rasterSize = await readRasterSize(spritesheetPath);
  } catch (error) {
    throw new PetPackValidationError(
      "spritesheet-invalid",
      error instanceof Error ? error.message : "spritesheet could not be inspected",
    );
  }

  const atlasHeight = expectedAtlasHeight(manifest.spriteVersionNumber);
  if (rasterSize.width !== ATLAS_WIDTH || rasterSize.height !== atlasHeight) {
    throw new PetPackValidationError(
      "dimensions-invalid",
      `v${manifest.spriteVersionNumber} spritesheet must be ${ATLAS_WIDTH}x${atlasHeight}`,
    );
  }

  return {
    snapshot: {
      id: manifest.id,
      displayName: manifest.displayName,
      description: manifest.description,
      spriteVersionNumber: manifest.spriteVersionNumber,
      atlasWidth: ATLAS_WIDTH,
      atlasHeight,
      frameWidth: FRAME_WIDTH,
      frameHeight: FRAME_HEIGHT,
      assetUrl: createAssetUrl(manifest.id, rasterSize.contentHash),
    },
    packageDirectory: await realpath(packageDirectory),
    manifestPath: await realpath(manifestPath),
    spritesheetPath,
    mediaType: rasterSize.mediaType,
  };
}

export async function discoverPetPackages(
  roots: readonly string[],
): Promise<{ packs: ResolvedPetPack[]; diagnostics: PetRegistryDiagnostic[] }> {
  const packs: ResolvedPetPack[] = [];
  const diagnostics: PetRegistryDiagnostic[] = [];

  for (const root of roots) {
    let directories;
    try {
      directories = (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => left.name.localeCompare(right.name, "en"));
    } catch {
      continue;
    }

    for (const directory of directories) {
      try {
        packs.push(await validatePetDirectory(join(root, directory.name)));
      } catch (error) {
        const validationError =
          error instanceof PetPackValidationError
            ? error
            : new PetPackValidationError("manifest-invalid", "pet package could not be read");
        diagnostics.push({
          packageName: directory.name,
          code: validationError.code,
          message: validationError.message,
        });
      }
    }
  }

  return { packs, diagnostics };
}

export class PetPackRegistry {
  readonly roots: readonly string[];
  readonly preferredId: string;
  private readonly packsById = new Map<string, ResolvedPetPack>();
  private selectedId: string | null;
  private diagnostics: PetRegistryDiagnostic[] = [];

  constructor(options: PetPackRegistryOptions) {
    this.roots = [...options.roots];
    this.preferredId = options.preferredId ?? DEFAULT_PREFERRED_ID;
    this.selectedId = options.selectedId ?? null;
  }

  async refresh(): Promise<PetRegistrySnapshot> {
    const discovery = await discoverPetPackages(this.roots);
    this.packsById.clear();
    this.diagnostics = discovery.diagnostics;

    for (const pack of discovery.packs) {
      const key = normalizedLookupId(pack.snapshot.id);
      if (!this.packsById.has(key)) {
        this.packsById.set(key, pack);
      }
    }

    if (!this.selectedId || !this.getResolvedPack(this.selectedId)) {
      const preferred = this.getResolvedPack(this.preferredId);
      this.selectedId = preferred?.snapshot.id ?? this.packsById.values().next().value?.snapshot.id ?? null;
    }

    return this.getSnapshot();
  }

  getSnapshot(): PetRegistrySnapshot {
    const selected = this.getSelectedResolved();
    return {
      pets: [...this.packsById.values()].map((pack) => ({ ...pack.snapshot })),
      selected: selected ? { ...selected.snapshot } : null,
    };
  }

  getDiagnostics(): PetRegistryDiagnostic[] {
    return this.diagnostics.map((diagnostic) => ({ ...diagnostic }));
  }

  getResolvedPack(id: string): ResolvedPetPack | null {
    return this.packsById.get(normalizedLookupId(id)) ?? null;
  }

  getSelectedResolved(): ResolvedPetPack | null {
    return this.selectedId ? this.getResolvedPack(this.selectedId) : null;
  }

  select(id: string): PetPackSnapshot | null {
    const pack = this.getResolvedPack(id);
    if (!pack) {
      return null;
    }
    this.selectedId = pack.snapshot.id;
    return { ...pack.snapshot };
  }

  resolveSpritesheet(id: string): string | null {
    return this.getResolvedPack(id)?.spritesheetPath ?? null;
  }
}
