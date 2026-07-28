import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readSync,
} from "node:fs";

import type { SessionSignal } from "./rollout-parser.ts";
import { parseHookEvent } from "./session-reducer.ts";

export interface HookObservation {
  threadId: string;
  signal: SessionSignal;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INITIAL_TAIL_BYTES = 2 * 1024 * 1024;
const READ_CHUNK_BYTES = 512 * 1024;

interface JsonRecord {
  [key: string]: unknown;
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export class HookEventStore {
  readonly #filePath: string;
  #offset: number | null = null;
  #remainder = "";
  #discardFirstPartialLine = false;
  #latestEventAt: number | null = null;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  get latestEventAt(): number | null {
    return this.#latestEventAt;
  }

  readNew(): HookObservation[] {
    if (!existsSync(this.#filePath)) {
      return [];
    }

    let descriptor: number | null = null;
    try {
      descriptor = openSync(this.#filePath, "r");
      const size = fstatSync(descriptor).size;
      if (this.#offset === null || size < this.#offset) {
        this.#offset = Math.max(0, size - INITIAL_TAIL_BYTES);
        this.#remainder = "";
        this.#discardFirstPartialLine = this.#offset > 0;
      }

      const observations: HookObservation[] = [];
      while (this.#offset < size) {
        const length = Math.min(READ_CHUNK_BYTES, size - this.#offset);
        const buffer = Buffer.allocUnsafe(length);
        const bytesRead = readSync(
          descriptor,
          buffer,
          0,
          length,
          this.#offset,
        );
        if (bytesRead <= 0) {
          break;
        }
        this.#offset += bytesRead;
        this.#consume(
          buffer.toString("utf8", 0, bytesRead),
          observations,
        );
      }
      return observations;
    } catch {
      this.#offset = null;
      this.#remainder = "";
      this.#discardFirstPartialLine = false;
      return [];
    } finally {
      if (descriptor !== null) {
        closeSync(descriptor);
      }
    }
  }

  #consume(chunk: string, output: HookObservation[]): void {
    const complete = `${this.#remainder}${chunk}`;
    const lines = complete.split(/\r?\n/);
    this.#remainder = lines.pop() ?? "";

    for (const line of lines) {
      if (this.#discardFirstPartialLine) {
        this.#discardFirstPartialLine = false;
        continue;
      }
      const observation = this.#parseLine(line);
      if (observation !== null) {
        output.push(observation);
      }
    }

    if (this.#remainder.length > READ_CHUNK_BYTES) {
      this.#remainder = "";
      this.#discardFirstPartialLine = true;
    }
  }

  #parseLine(line: string): HookObservation | null {
    if (line.length === 0) {
      return null;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed)) {
        return null;
      }
      const threadId = parsed.threadId;
      if (typeof threadId !== "string" || !UUID_PATTERN.test(threadId)) {
        return null;
      }
      const signal = parseHookEvent(parsed);
      if (signal === null) {
        return null;
      }
      const capturedAt = Date.parse(signal.capturedAt);
      if (Number.isFinite(capturedAt)) {
        this.#latestEventAt = Math.max(
          this.#latestEventAt ?? Number.NEGATIVE_INFINITY,
          capturedAt,
        );
      }
      return { threadId, signal };
    } catch {
      return null;
    }
  }
}
