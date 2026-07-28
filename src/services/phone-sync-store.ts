import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import {
  decodePhonePairingUri,
  encodePhonePairingUri,
  generatePhonePairing,
  normalizeRelayEndpoint,
  type PhonePairingMaterial,
} from "./phone-sync-protocol.ts";

export interface PhoneSecretProtector {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface PhoneSyncFile {
  version: 1;
  protectedPairing: string;
  sequence: number;
}

export interface PhoneRelayConfig {
  endpoint: string;
  proxy: string | null;
}

export class PhoneSyncStore {
  readonly #filePath: string;
  readonly #protector: PhoneSecretProtector;

  constructor(filePath: string, protector: PhoneSecretProtector) {
    this.#filePath = resolve(filePath);
    this.#protector = protector;
  }

  get pairing(): PhonePairingMaterial | null {
    const state = this.#load();
    if (state === null) {
      return null;
    }
    try {
      const uri = this.#protector.decryptString(
        Buffer.from(state.protectedPairing, "base64"),
      );
      return decodePhonePairingUri(uri);
    } catch {
      return null;
    }
  }

  get sequence(): number {
    return this.#load()?.sequence ?? 0;
  }

  createPairing(endpoint: string): PhonePairingMaterial {
    if (!this.#protector.isEncryptionAvailable()) {
      throw new Error("Protected storage is unavailable.");
    }
    const pairing = generatePhonePairing(endpoint);
    this.#savePairing(pairing, 0);
    return pairing;
  }

  rotatePairing(endpoint: string): PhonePairingMaterial {
    return this.createPairing(endpoint);
  }

  reserveSequence(): number {
    const pairing = this.pairing;
    if (pairing === null) {
      throw new Error("Phone sync is not paired.");
    }
    const current = this.sequence;
    if (current >= Number.MAX_SAFE_INTEGER) {
      throw new Error("Phone sync sequence is exhausted.");
    }
    const next = current + 1;
    this.#savePairing(pairing, next);
    return next;
  }

  clear(): void {
    try {
      unlinkSync(this.#filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  pairingUri(): string | null {
    const pairing = this.pairing;
    return pairing === null ? null : encodePhonePairingUri(pairing);
  }

  #savePairing(pairing: PhonePairingMaterial, sequence: number): void {
    const protectedPairing = this.#protector.encryptString(
      encodePhonePairingUri(pairing),
    );
    this.#save({
      version: 1,
      protectedPairing: protectedPairing.toString("base64"),
      sequence,
    });
  }

  #load(): PhoneSyncFile | null {
    try {
      if (
        !this.#protector.isEncryptionAvailable() ||
        !existsSync(this.#filePath)
      ) {
        return null;
      }
      const value = JSON.parse(
        readFileSync(this.#filePath, "utf8"),
      ) as unknown;
      if (
        typeof value !== "object" ||
        value === null ||
        !("version" in value) ||
        !("protectedPairing" in value) ||
        !("sequence" in value)
      ) {
        return null;
      }
      const candidate = value as Record<string, unknown>;
      if (
        candidate.version !== 1 ||
        typeof candidate.protectedPairing !== "string" ||
        !/^[A-Za-z0-9+/]+={0,2}$/u.test(candidate.protectedPairing) ||
        !Number.isSafeInteger(candidate.sequence) ||
        (candidate.sequence as number) < 0
      ) {
        return null;
      }
      return {
        version: 1,
        protectedPairing: candidate.protectedPairing,
        sequence: candidate.sequence as number,
      };
    } catch {
      return null;
    }
  }

  #save(value: PhoneSyncFile): void {
    mkdirSync(dirname(this.#filePath), { recursive: true });
    const temporaryPath = `${this.#filePath}.next`;
    writeFileSync(
      temporaryPath,
      `${JSON.stringify(value, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    renameSync(temporaryPath, this.#filePath);
  }
}

export const loadPhoneRelayConfig = (
  filePath: string,
): PhoneRelayConfig | null => {
  try {
    const value = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (
      typeof value !== "object" ||
      value === null ||
      !("version" in value) ||
      !("endpoint" in value)
    ) {
      return null;
    }
    const candidate = value as Record<string, unknown>;
    if (
      candidate.version !== 1 ||
      typeof candidate.endpoint !== "string"
    ) {
      return null;
    }
    const proxy = candidate.proxy;
    if (
      proxy !== undefined &&
      typeof proxy !== "string"
    ) {
      return null;
    }
    return {
      endpoint: normalizeRelayEndpoint(candidate.endpoint),
      proxy:
        proxy === undefined
          ? null
          : normalizeLocalPhoneRelayProxy(proxy),
    };
  } catch {
    return null;
  }
};

export const normalizeLocalPhoneRelayProxy = (
  value: string,
): string => {
  const url = new URL(value.trim());
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.port === "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Phone relay proxy must be a local HTTP origin.");
  }
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Phone relay proxy port is invalid.");
  }
  return url.origin;
};
