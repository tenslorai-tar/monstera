// @ts-check
/**
 * What a Windows executable says it is: its version resource, read from the bytes.
 *
 * ## Why it is read back, and not by the library that wrote it
 *
 * Task Manager names a process outside a package's app group by its executable's `FileDescription`, and the packaged
 * `Monstera.exe` is Electron's runtime renamed, so until R3 it said *Electron*, *GitHub, Inc.*, `electron.exe`. The
 * packager writes the strings with resedit; *the call returned* and *the file says Monstera* are different facts, as they
 * are for the icon (`peIcons.mjs`). And a writer's own reader agrees with the writer's mistakes, so this parses the
 * format itself, through the same resource walker the icon is read with.
 *
 * ## The format
 *
 * `RT_VERSION` (16) holds one `VS_VERSIONINFO` block. Every block is `wLength`, `wValueLength`, `wType` (1 for text,
 * 0 for binary), a NUL-terminated UTF-16 key, padding to a 32-bit boundary, the value, padding again, then child blocks
 * up to `wLength`. The root's value is `VS_FIXEDFILEINFO` (signature `0xFEEF04BD`, the file version at bytes 8–15 and
 * the product version at 16–23, each two DWORDs of two WORDs, high first). Its children are `StringFileInfo` — one
 * `StringTable` per language, keyed `040904B0` and the like, whose children are the strings, a text value of
 * `wValueLength` WORDs — and `VarFileInfo`. Alignment is from the start of the block, which the resource data begins at.
 */

import { resourceTree } from './peIcons.mjs';

const RT_VERSION = 16;
const FIXED_SIGNATURE = 0xfeef04bd;

/**
 * @typedef {{ key: string, text: boolean, value: Buffer, children: Block[] }} Block
 */

/** @param {number} at */
const aligned = (at) => (at + 3) & ~3;

/**
 * One block and its children, starting at `at` in `data`.
 *
 * @param {Buffer} data the version resource
 * @param {number} at
 * @returns {Block & { end: number }}
 */
function block(data, at) {
  const length = data.readUInt16LE(at);
  const valueLength = data.readUInt16LE(at + 2);
  const text = data.readUInt16LE(at + 4) === 1;
  const end = at + length;
  if (length < 6 || end > data.length) throw new Error(`a version block at ${String(at)} runs past the resource (${String(length)} bytes)`);
  let keyEnd = at + 6;
  while (keyEnd + 1 < end && data.readUInt16LE(keyEnd) !== 0) keyEnd += 2;
  const key = data.toString('utf16le', at + 6, keyEnd);
  const valueAt = aligned(keyEnd + 2);
  const valueBytes = text ? valueLength * 2 : valueLength;
  const value = data.subarray(valueAt, Math.min(end, valueAt + valueBytes));
  /** @type {Block[]} */
  const children = [];
  let child = aligned(valueAt + valueBytes);
  while (child + 6 <= end) {
    const read = block(data, child);
    children.push(read);
    child = aligned(read.end);
  }
  return { key, text, value, children, end };
}

/** A text value without its terminator. @param {Buffer} value */
const textOf = (value) => {
  const decoded = value.toString('utf16le');
  const nul = decoded.indexOf('\u0000');
  return nul === -1 ? decoded : decoded.slice(0, nul);
};

/** Two DWORDs of two WORDs, high first, as `a.b.c.d`. @param {Buffer} fixed @param {number} at */
const versionAt = (fixed, at) => {
  const high = fixed.readUInt32LE(at);
  const low = fixed.readUInt32LE(at + 4);
  return [high >>> 16, high & 0xffff, low >>> 16, low & 0xffff].join('.');
};

/**
 * The executable's version resource: every string table, by its language key, and the two versions of the fixed part.
 *
 * Throws where there is none or it cannot be followed, because every caller asks *does it say this* and a reader that
 * found nothing would answer *no* by itself — the answer a control wants, produced by the reader rather than the file.
 *
 * @param {Buffer} bytes the whole executable
 * @returns {{ tables: Map<string, Map<string, string>>, fileVersion: string, productVersion: string }}
 */
export function versionResource(bytes) {
  const tree = resourceTree(bytes);
  const [named] = tree === null ? [] : tree.namesOf(RT_VERSION);
  if (tree === null || named === undefined) throw new Error('the executable carries no version resource');
  const root = block(tree.dataOf(named), 0);
  if (root.key !== 'VS_VERSION_INFO') throw new Error(`the version resource's root is keyed ${JSON.stringify(root.key)}, not VS_VERSION_INFO`);
  if (root.value.length < 24 || root.value.readUInt32LE(0) !== FIXED_SIGNATURE) {
    throw new Error('the version resource carries no VS_FIXEDFILEINFO');
  }
  /** @type {Map<string, Map<string, string>>} */
  const tables = new Map();
  for (const info of root.children.filter((child) => child.key === 'StringFileInfo')) {
    for (const table of info.children) {
      tables.set(table.key, new Map(table.children.map((entry) => [entry.key, entry.text ? textOf(entry.value) : ''])));
    }
  }
  if (tables.size === 0) throw new Error('the version resource carries no string table');
  return { tables, fileVersion: versionAt(root.value, 8), productVersion: versionAt(root.value, 16) };
}

/**
 * Where an executable's version resource differs from what it should say: each string, in EVERY table, and the two
 * fixed versions. Empty when it says exactly that.
 *
 * @param {Buffer} bytes the whole executable
 * @param {Readonly<Record<string, string>>} strings
 * @param {string} version `a.b.c.d`
 * @returns {string[]}
 */
export function versionDiffers(bytes, strings, version) {
  const read = versionResource(bytes);
  /** @type {string[]} */
  const differs = [];
  for (const [language, table] of read.tables) {
    for (const [key, wanted] of Object.entries(strings)) {
      const found = table.get(key);
      if (found !== wanted) differs.push(`${language} ${key}: ${JSON.stringify(found)}, not ${JSON.stringify(wanted)}`);
    }
  }
  if (read.fileVersion !== version) differs.push(`fixed file version ${read.fileVersion}, not ${version}`);
  if (read.productVersion !== version) differs.push(`fixed product version ${read.productVersion}, not ${version}`);
  return differs;
}
