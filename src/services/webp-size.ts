import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";

const MAX_SPRITESHEET_BYTES = 64 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export interface RasterSize {
  width: number;
  height: number;
  mediaType: "image/png" | "image/webp";
  contentHash: string;
}

type RasterHeader = Omit<RasterSize, "contentHash">;

function readUint24LE(buffer: Buffer, offset: number): number {
  return buffer[offset]! | (buffer[offset + 1]! << 8) | (buffer[offset + 2]! << 16);
}

function readPngSize(buffer: Buffer): RasterHeader | null {
  if (
    buffer.length < 24 ||
    !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    buffer.readUInt32BE(8) !== 13 ||
    buffer.toString("ascii", 12, 16) !== "IHDR"
  ) {
    return null;
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width === 0 || height === 0) {
    return null;
  }

  return { width, height, mediaType: "image/png" };
}

function readWebpSize(buffer: Buffer): RasterHeader | null {
  if (
    buffer.length < 20 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }

  const containerEnd = buffer.readUInt32LE(4) + 8;
  if (containerEnd < 20 || containerEnd > buffer.length) {
    return null;
  }

  let offset = 12;
  while (offset + 8 <= containerEnd) {
    const chunkType = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    const chunkEnd = dataOffset + chunkSize;
    if (chunkEnd > containerEnd) {
      return null;
    }

    if (chunkType === "VP8X" && chunkSize >= 10) {
      return {
        width: readUint24LE(buffer, dataOffset + 4) + 1,
        height: readUint24LE(buffer, dataOffset + 7) + 1,
        mediaType: "image/webp",
      };
    }

    if (chunkType === "VP8L" && chunkSize >= 5 && buffer[dataOffset] === 0x2f) {
      const packedDimensions = buffer.readUInt32LE(dataOffset + 1);
      return {
        width: (packedDimensions & 0x3fff) + 1,
        height: ((packedDimensions >>> 14) & 0x3fff) + 1,
        mediaType: "image/webp",
      };
    }

    if (
      chunkType === "VP8 " &&
      chunkSize >= 10 &&
      buffer[dataOffset + 3] === 0x9d &&
      buffer[dataOffset + 4] === 0x01 &&
      buffer[dataOffset + 5] === 0x2a
    ) {
      const width = buffer.readUInt16LE(dataOffset + 6) & 0x3fff;
      const height = buffer.readUInt16LE(dataOffset + 8) & 0x3fff;
      if (width === 0 || height === 0) {
        return null;
      }
      return { width, height, mediaType: "image/webp" };
    }

    offset = chunkEnd + (chunkSize & 1);
  }

  return null;
}

export async function readRasterSize(filePath: string): Promise<RasterSize> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size === 0 || fileStat.size > MAX_SPRITESHEET_BYTES) {
    throw new Error("spritesheet must be a non-empty file smaller than 64 MiB");
  }

  const extension = extname(filePath).toLowerCase();
  const buffer = await readFile(filePath);
  const size =
    extension === ".png"
      ? readPngSize(buffer)
      : extension === ".webp"
        ? readWebpSize(buffer)
        : null;

  if (!size) {
    throw new Error(`spritesheet has an invalid ${extension || "image"} header`);
  }

  return {
    ...size,
    contentHash: createHash("sha256")
      .update(buffer)
      .digest("hex")
      .slice(0, 16),
  };
}
