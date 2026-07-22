import * as opentype from "opentype.js";
import { getTtcFaceOffsets, readSfntTables, validateFontFile, type SfntTableRecord } from "./font-validator.js";

export interface FontFaceMetadata {
  index: number;
  familyNames: string[];
  weight: number;
  bold: boolean;
  italic: boolean;
}

export class OpenTypeFontInspector {
  inspect(bytes: Uint8Array): FontFaceMetadata[] {
    return parseFontMetadata(bytes);
  }

  validate(filename: string, bytes: Uint8Array): { valid: boolean; error?: string } {
    return validateFontFile(filename, bytes);
  }
}

function isTtc(data: Uint8Array): boolean {
  return data[0] === 0x74 && data[1] === 0x74 && data[2] === 0x63 && data[3] === 0x66;
}

function parseSingleFace(buffer: ArrayBuffer): opentype.Font | null {
  try { return opentype.parse(buffer, { lowMemory: true }); } catch { return null; }
}

function getNames(font: opentype.Font): string[] {
  const names = new Set<string>();
  const nameTable = font.tables?.name as Record<string, unknown> | undefined;
  if (!nameTable) return [];
  const buckets: Array<Record<string, Record<string, string>>> = [];
  for (const platform of ["windows", "macintosh", "unicode"]) {
    const bucket = nameTable[platform];
    if (bucket && typeof bucket === "object") buckets.push(bucket as Record<string, Record<string, string>>);
  }
  buckets.push(nameTable as Record<string, Record<string, string>>);
  for (const bucket of buckets) {
    for (const field of ["fontFamily", "preferredFamily", "fullName", "postScriptName"]) {
      const entry = bucket[field];
      if (!entry || typeof entry !== "object") continue;
      for (const value of Object.values(entry)) if (typeof value === "string" && value.trim()) names.add(value.trim());
    }
  }
  return [...names];
}

const FALLBACK_NAME_IDS = new Set([1, 4, 6, 16]);

function decodeUtf16Be(bytes: Uint8Array): string {
  const units: number[] = [];
  for (let index = 0; index + 1 < bytes.length; index += 2) units.push((bytes[index] << 8) | bytes[index + 1]);
  let result = "";
  for (let index = 0; index < units.length; index += 8192) result += String.fromCharCode(...units.slice(index, index + 8192));
  return result;
}

function decodeName(platformId: number, encodingId: number, bytes: Uint8Array): string {
  if (platformId === 0 || platformId === 3) return decodeUtf16Be(bytes);
  if (platformId === 1) {
    try { return new TextDecoder("macintosh").decode(bytes); } catch { return new TextDecoder("latin1").decode(bytes); }
  }
  if (bytes.length >= 2 && bytes.length % 2 === 0 && bytes[0] === 0) return decodeUtf16Be(bytes);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return encodingId === 0 ? new TextDecoder("latin1").decode(bytes) : decodeUtf16Be(bytes); }
}

function parseNamesFromSfnt(buffer: ArrayBuffer, tables: Map<string, SfntTableRecord>): string[] {
  const table = tables.get("name");
  if (!table || table.length < 6) return [];
  const view = new DataView(buffer);
  const count = view.getUint16(table.offset + 2, false);
  const storageStart = table.offset + view.getUint16(table.offset + 4, false);
  const tableEnd = table.offset + table.length;
  const byNameId = new Map<number, { primary: Set<string>; fallback: Set<string> }>();
  for (let index = 0; index < count; index++) {
    const offset = table.offset + 6 + index * 12;
    if (offset + 12 > tableEnd) break;
    const platformId = view.getUint16(offset, false);
    const encodingId = view.getUint16(offset + 2, false);
    const nameId = view.getUint16(offset + 6, false);
    if (!FALLBACK_NAME_IDS.has(nameId)) continue;
    const length = view.getUint16(offset + 8, false);
    const start = storageStart + view.getUint16(offset + 10, false);
    if (start > tableEnd || length > tableEnd - start) continue;
    const decoded = decodeName(platformId, encodingId, new Uint8Array(buffer, start, length)).replace(/\0/g, "").replace(/\s+/g, " ").trim();
    if (!decoded) continue;
    const bucket = byNameId.get(nameId) ?? { primary: new Set<string>(), fallback: new Set<string>() };
    (platformId === 0 || platformId === 3 ? bucket.primary : bucket.fallback).add(decoded);
    byNameId.set(nameId, bucket);
  }
  const result = new Set<string>();
  for (const id of [16, 1, 4, 6]) {
    const bucket = byNameId.get(id);
    if (!bucket) continue;
    for (const value of bucket.primary.size ? bucket.primary : bucket.fallback) result.add(value);
  }
  return [...result];
}

function parseStyle(buffer: ArrayBuffer, tables: Map<string, SfntTableRecord>) {
  const view = new DataView(buffer);
  let weight = 400;
  let bold = false;
  let italic = false;
  const os2 = tables.get("OS/2");
  if (os2 && os2.length >= 64) {
    const candidate = view.getUint16(os2.offset + 4, false);
    if (candidate >= 1 && candidate <= 1000) weight = candidate;
    const selection = view.getUint16(os2.offset + 62, false);
    bold ||= Boolean(selection & 0x20);
    italic ||= Boolean(selection & 0x01);
  }
  const head = tables.get("head");
  if (head && head.length >= 46) {
    const style = view.getUint16(head.offset + 44, false);
    bold ||= Boolean(style & 0x01);
    italic ||= Boolean(style & 0x02);
  }
  return { weight, bold, italic };
}

function fromOpenType(font: opentype.Font, index: number): FontFaceMetadata {
  const os2 = font.tables?.os2 as { usWeightClass?: number; fsSelection?: number } | undefined;
  const head = font.tables?.head as { macStyle?: number } | undefined;
  const selection = os2?.fsSelection ?? 0;
  const style = head?.macStyle ?? 0;
  return {
    index,
    familyNames: getNames(font),
    weight: os2?.usWeightClass ?? 400,
    bold: Boolean(selection & 0x20) || Boolean(style & 0x01),
    italic: Boolean(selection & 0x01) || Boolean(style & 0x02),
  };
}

function fallback(buffer: ArrayBuffer, directoryOffset: number, index: number): FontFaceMetadata | null {
  try {
    const { tables } = readSfntTables(buffer, directoryOffset);
    return { index, familyNames: parseNamesFromSfnt(buffer, tables), ...parseStyle(buffer, tables) };
  } catch { return null; }
}

export function parseFontMetadata(bytes: Uint8Array): FontFaceMetadata[] {
  const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer as ArrayBuffer
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  if (isTtc(bytes)) return parseTtcMetadata(buffer);
  const font = parseSingleFace(buffer);
  if (!font) return fallback(buffer, 0, 0) ? [fallback(buffer, 0, 0)!] : [];
  const face = fromOpenType(font, 0);
  return face.familyNames.length ? [face] : [fallback(buffer, 0, 0) ?? face];
}

function parseTtcMetadata(buffer: ArrayBuffer): FontFaceMetadata[] {
  let offsets: number[];
  try { offsets = getTtcFaceOffsets(buffer); } catch { return []; }
  const faces: FontFaceMetadata[] = [];
  for (let index = 0; index < offsets.length; index++) {
    try {
      const font = parseSingleFace(extractTtcFace(buffer, index));
      const face = font ? fromOpenType(font, index) : null;
      const resolved = face?.familyNames.length ? face : fallback(buffer, offsets[index], index) ?? face;
      if (resolved) faces.push(resolved);
    } catch {
      const resolved = fallback(buffer, offsets[index], index);
      if (resolved) faces.push(resolved);
    }
  }
  return faces;
}

function extractTtcFace(buffer: ArrayBuffer, faceIndex: number): ArrayBuffer {
  const view = new DataView(buffer);
  const count = view.getUint32(8, false);
  const faceOffset = view.getUint32(12 + Math.min(faceIndex, count - 1) * 4, false);
  const tableCount = view.getUint16(faceOffset + 4, false);
  const version = view.getUint32(faceOffset, false);
  const tables: Array<{ tag: string; checksum: number; offset: number; length: number }> = [];
  for (let index = 0; index < tableCount; index++) {
    const offset = faceOffset + 12 + index * 16;
    tables.push({
      tag: String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3)),
      checksum: view.getUint32(offset + 4, false), offset: view.getUint32(offset + 8, false), length: view.getUint32(offset + 12, false),
    });
  }
  let cursor = 12 + tableCount * 16;
  const offsets = tables.map((table) => { const offset = cursor; cursor += (table.length + 3) & ~3; return offset; });
  const result = new ArrayBuffer(cursor);
  const output = new Uint8Array(result);
  const outputView = new DataView(result);
  outputView.setUint32(0, version, false);
  outputView.setUint16(4, tableCount, false);
  const exponent = Math.floor(Math.log2(tableCount));
  outputView.setUint16(6, (1 << exponent) * 16, false);
  outputView.setUint16(8, exponent, false);
  outputView.setUint16(10, tableCount * 16 - (1 << exponent) * 16, false);
  const source = new Uint8Array(buffer);
  tables.forEach((table, index) => {
    const record = 12 + index * 16;
    for (let character = 0; character < 4; character++) output[record + character] = table.tag.charCodeAt(character);
    outputView.setUint32(record + 4, table.checksum, false);
    outputView.setUint32(record + 8, offsets[index], false);
    outputView.setUint32(record + 12, table.length, false);
    output.set(source.subarray(table.offset, Math.min(table.offset + table.length, source.length)), offsets[index]);
  });
  return result;
}
