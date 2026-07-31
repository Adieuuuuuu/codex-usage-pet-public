import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

export interface WindowPosition {
  x: number;
  y: number;
}

export interface UsagePetPreferences {
  scale: number;
  position: WindowPosition | null;
  selectedPetId: string;
  reviewAcknowledgements: Record<string, number>;
}

export const MIN_SCALE = 0.55;
export const MAX_SCALE = 1.6;

const DEFAULT_PREFERENCES: UsagePetPreferences = {
  scale: 1,
  position: null,
  selectedPetId: "zhima-3",
  reviewAcknowledgements: {},
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REVIEW_ACKNOWLEDGEMENTS = 128;

const clampScale = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_PREFERENCES.scale;
  }
  return (
    Math.round(
      Math.max(MIN_SCALE, Math.min(MAX_SCALE, value)) * 100,
    ) / 100
  );
};

const normalizePosition = (value: unknown): WindowPosition | null => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("x" in value) ||
    !("y" in value)
  ) {
    return null;
  }
  const x = (value as { x: unknown }).x;
  const y = (value as { y: unknown }).y;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return null;
  }
  return { x: Math.round(x), y: Math.round(y) };
};

const normalizeSelectedPetId = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value)
  ) {
    return DEFAULT_PREFERENCES.selectedPetId;
  }
  return value;
};

const normalizeReviewAcknowledgements = (
  value: unknown,
): Record<string, number> => {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        (entry): entry is [string, number] =>
          UUID_PATTERN.test(entry[0]) &&
          typeof entry[1] === "number" &&
          Number.isSafeInteger(entry[1]) &&
          entry[1] > 0,
      )
      .sort((left, right) => right[1] - left[1])
      .slice(0, MAX_REVIEW_ACKNOWLEDGEMENTS),
  );
};

export const normalizePreferences = (
  value: unknown,
): UsagePetPreferences => {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_PREFERENCES };
  }
  const record = value as Record<string, unknown>;
  return {
    scale: clampScale(record.scale),
    position: normalizePosition(record.position),
    selectedPetId: normalizeSelectedPetId(record.selectedPetId),
    reviewAcknowledgements: normalizeReviewAcknowledgements(
      record.reviewAcknowledgements,
    ),
  };
};

export class PreferencesStore {
  readonly #filePath: string;
  #preferences: UsagePetPreferences;

  constructor(filePath: string) {
    this.#filePath = resolve(filePath);
    this.#preferences = this.#load();
  }

  get value(): UsagePetPreferences {
    return {
      ...this.#preferences,
      position:
        this.#preferences.position === null
          ? null
          : { ...this.#preferences.position },
      reviewAcknowledgements: {
        ...this.#preferences.reviewAcknowledgements,
      },
    };
  }

  update(
    patch: Partial<UsagePetPreferences>,
  ): UsagePetPreferences {
    this.#preferences = normalizePreferences({
      ...this.#preferences,
      ...patch,
    });
    this.#save();
    return this.value;
  }

  #load(): UsagePetPreferences {
    try {
      if (!existsSync(this.#filePath)) {
        return { ...DEFAULT_PREFERENCES };
      }
      return normalizePreferences(
        JSON.parse(readFileSync(this.#filePath, "utf8")) as unknown,
      );
    } catch {
      return { ...DEFAULT_PREFERENCES };
    }
  }

  #save(): void {
    try {
      mkdirSync(dirname(this.#filePath), { recursive: true });
      const temporaryPath = `${this.#filePath}.next`;
      writeFileSync(
        temporaryPath,
        `${JSON.stringify(this.#preferences, null, 2)}\n`,
        {
          encoding: "utf8",
          mode: 0o600,
        },
      );
      renameSync(temporaryPath, this.#filePath);
    } catch {
      // Preferences are convenience state; failure must not stop monitoring.
    }
  }
}
