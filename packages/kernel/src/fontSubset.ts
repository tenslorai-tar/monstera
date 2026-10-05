import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * A subset of a font, made by HarfBuzz's subsetter inside an engine host
 * ([ADR-0172](../../../docs/DECISIONS/0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md)
 * Decision 5).
 *
 * ## The subsetter imports nothing
 *
 * `harfbuzz-subset.wasm` declares no imports (measured 2026-10-05 with `WebAssembly.Module.imports`), so it is
 * instantiated with an empty import object and can reach no file, clock or network: a fault inside it is bounded by
 * its own linear memory, and the worst it can hand back is a wrong font, which the read-back and the reader see. Its
 * bytes are the package's own, read by `require.resolve`, `barcodeReader.ts`' route for zxing's.
 *
 * ## A subset is named by its own bytes
 *
 * PDFium writes every loaded font of one name as ONE page resource (measured 2026-10-05 on PDFium 155: three
 * `FPDFText_LoadFont` objects all named `Arimo-Regular` were written as `/FXF1`, and two of them drew with the first's
 * glyph table). So every subset gets the PDF convention's unique name, six capitals and a plus sign before the face's
 * PostScript name, taken from a digest of the subset's bytes: two different subsets cannot share a name, and the same
 * subset made twice is the same name, so a document is the same bytes on the same machine.
 */

interface SubsetExports {
  readonly memory: { readonly buffer: ArrayBuffer };
  malloc(size: number): number;
  free(pointer: number): void;
  hb_blob_create(data: number, length: number, mode: number, user: number, destroy: number): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_data(blob: number, length: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_set_add(set: number, value: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_unicode_set(input: number): number;
  hb_subset_input_glyph_set(input: number): number;
  hb_subset_input_get_flags(input: number): number;
  hb_subset_input_set_flags(input: number, flags: number): void;
  hb_subset_input_pin_all_axes_to_default(input: number, face: number): number;
  hb_subset_input_pin_axis_location(input: number, face: number, tag: number, value: number): number;
  hb_subset_or_fail(face: number, input: number): number;
}

/** HarfBuzz's `HB_MEMORY_MODE_WRITABLE`: the blob borrows the bytes, which this module frees. */
const MEMORY_MODE_WRITABLE = 2;
/** `HB_SUBSET_FLAGS_RETAIN_GIDS`: a glyph keeps its id, so ids a shaper produced from the whole face stay valid. */
const RETAIN_GIDS = 0x2;

/**
 * The part of Node's `WebAssembly` global this module uses, written out: this build's libraries declare no
 * `WebAssembly` types (`webpEncoder.ts`' reason), and naming the global's real type is not possible here.
 */
interface WebAssemblyRuntime {
  readonly Module: new (bytes: Uint8Array) => object;
  readonly Instance: new (module: object, imports: Readonly<Record<string, never>>) => { readonly exports: object };
}

/** Every function {@link SubsetExports} names, checked present at load so the typed view below is not taken on trust. */
const SUBSET_FUNCTIONS = [
  'malloc',
  'free',
  'hb_blob_create',
  'hb_blob_destroy',
  'hb_blob_get_data',
  'hb_face_create',
  'hb_face_destroy',
  'hb_face_reference_blob',
  'hb_set_add',
  'hb_subset_input_create_or_fail',
  'hb_subset_input_destroy',
  'hb_subset_input_unicode_set',
  'hb_subset_input_glyph_set',
  'hb_subset_input_get_flags',
  'hb_subset_input_set_flags',
  'hb_subset_input_pin_all_axes_to_default',
  'hb_subset_input_pin_axis_location',
  'hb_subset_or_fail',
] as const satisfies readonly (keyof SubsetExports)[];

let subsetter: SubsetExports | null = null;

function exportsOf(): SubsetExports {
  if (subsetter === null) {
    const runtime = (globalThis as typeof globalThis & { readonly WebAssembly: WebAssemblyRuntime }).WebAssembly;
    const require = createRequire(import.meta.url);
    const module = new runtime.Module(readFileSync(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm')));
    // AN EMPTY IMPORT OBJECT, so a build that grew an import is refused at instantiation rather than handed one.
    const exports: Record<string, unknown> = { ...new runtime.Instance(module, {}).exports };
    const missing = SUBSET_FUNCTIONS.filter((name) => typeof exports[name] !== 'function');
    const memory = exports['memory'];
    if (missing.length > 0 || typeof memory !== 'object' || memory === null || !('buffer' in memory)) {
      throw new Error(`harfbuzz-subset.wasm does not export what this module calls: ${missing.join(', ') || 'memory'}`);
    }
    subsetter = exports as unknown as SubsetExports;
  }
  return subsetter;
}

function tagOf(axis: string): number {
  if (!/^[\x20-\x7e]{4}$/u.test(axis)) throw new Error(`"${axis}" is not a four-character axis tag`);
  return ((axis.charCodeAt(0) << 24) | (axis.charCodeAt(1) << 16) | (axis.charCodeAt(2) << 8) | axis.charCodeAt(3)) >>> 0;
}

/** What a subset keeps. */
export interface SubsetRequest {
  /** Code points whose glyphs are kept, through the face's `cmap`. */
  readonly unicodes?: Iterable<number>;
  /** Glyph ids kept as they are, for glyphs a shaper chose. */
  readonly glyphs?: Iterable<number>;
  /** Keep every glyph's id, so ids taken from the whole face stay valid in the subset. */
  readonly retainGlyphIds?: boolean;
  /** Which face of a collection (`.ttc`) the subset is made from; the first where the file holds one face. */
  readonly faceIndex?: number;
  /**
   * Where each variation axis is pinned; every axis not named is pinned at its default, so the subset is a static face,
   * which is the only kind a PDF font program can be.
   */
  readonly axes?: Readonly<Record<string, number>>;
}

/**
 * The subset of `font` that `request` keeps, or `null` where HarfBuzz refuses it (ADR-0172 Decision 5: the caller then
 * takes the whole font where the licence allows, or the next source).
 */
export function subsetFont(font: Uint8Array, request: SubsetRequest): Uint8Array | null {
  const hb = exportsOf();
  const data = hb.malloc(font.length);
  if (data === 0) return null;
  new Uint8Array(hb.memory.buffer).set(font, data);
  const blob = hb.hb_blob_create(data, font.length, MEMORY_MODE_WRITABLE, 0, 0);
  const face = hb.hb_face_create(blob, request.faceIndex ?? 0);
  hb.hb_blob_destroy(blob);
  const input = hb.hb_subset_input_create_or_fail();
  let result = 0;
  try {
    if (input === 0) return null;
    const unicodes = hb.hb_subset_input_unicode_set(input);
    for (const point of request.unicodes ?? []) hb.hb_set_add(unicodes, point);
    const glyphs = hb.hb_subset_input_glyph_set(input);
    for (const glyph of request.glyphs ?? []) hb.hb_set_add(glyphs, glyph);
    if (request.retainGlyphIds === true) {
      hb.hb_subset_input_set_flags(input, hb.hb_subset_input_get_flags(input) | RETAIN_GIDS);
    }
    // EVERY AXIS AT ITS DEFAULT FIRST, then the named ones where they were asked: a later pin of one axis replaces
    // that axis' default, and an axis left unpinned would leave the subset variable.
    hb.hb_subset_input_pin_all_axes_to_default(input, face);
    for (const [axis, value] of Object.entries(request.axes ?? {})) {
      if (hb.hb_subset_input_pin_axis_location(input, face, tagOf(axis), value) === 0) return null;
    }
    result = hb.hb_subset_or_fail(face, input);
    if (result === 0) return null;
    const out = hb.hb_face_reference_blob(result);
    const length = hb.malloc(4);
    try {
      const at = hb.hb_blob_get_data(out, length);
      const size = new Uint32Array(hb.memory.buffer, length, 1)[0] ?? 0;
      return size === 0 ? null : new Uint8Array(hb.memory.buffer, at, size).slice();
    } finally {
      hb.free(length);
      hb.hb_blob_destroy(out);
    }
  } finally {
    if (result !== 0) hb.hb_face_destroy(result);
    if (input !== 0) hb.hb_subset_input_destroy(input);
    hb.hb_face_destroy(face);
    hb.free(data);
  }
}

/** Six capitals from a digest of `bytes`: the PDF convention's subset tag, the same for the same bytes. */
export function subsetTag(bytes: Uint8Array): string {
  const digest = createHash('sha256').update(bytes).digest();
  return Array.from(digest.subarray(0, 6), (byte) => String.fromCharCode(65 + (byte % 26))).join('');
}

/**
 * `font` with its PostScript name, family and full name replaced by `postscript`, its table checksums and `head`'s
 * `checkSumAdjustment` recomputed. The `name` table is rewritten whole rather than edited: the subset's other names say
 * nothing a document needs, and a table built here has one encoding to get right.
 *
 * @throws when `postscript` is not printable ASCII without spaces (the PostScript name's own rule) or the font has no
 * `head` table.
 */
export function withPostScriptName(font: Uint8Array, postscript: string): Uint8Array {
  if (!/^[\x21-\x7e]{1,63}$/u.test(postscript) || /[[\](){}<>/%]/u.test(postscript)) {
    throw new Error(`"${postscript}" is not a PostScript name`);
  }
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const count = view.getUint16(4);
  const tables: { tag: string; data: Uint8Array }[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = 12 + 16 * index;
    const tag = String.fromCharCode(font[at] ?? 0, font[at + 1] ?? 0, font[at + 2] ?? 0, font[at + 3] ?? 0);
    const offset = view.getUint32(at + 8);
    const length = view.getUint32(at + 12);
    if (offset + length > font.length) throw new Error(`the font's ${tag} table runs past its end`);
    if (tag !== 'name') tables.push({ tag, data: font.slice(offset, offset + length) });
  }
  const head = tables.find((table) => table.tag === 'head');
  if (head === undefined || head.data.length < 12) throw new Error('the font has no head table');
  head.data.fill(0, 8, 12);
  tables.push({ tag: 'name', data: nameTable(postscript) });
  tables.sort((left, right) => (left.tag < right.tag ? -1 : left.tag > right.tag ? 1 : 0));

  const directory = 12 + 16 * tables.length;
  const size = tables.reduce((total, table) => total + padded(table.data.length), directory);
  const out = new Uint8Array(size);
  const writer = new DataView(out.buffer);
  out.set(font.subarray(0, 4), 0);
  writer.setUint16(4, tables.length);
  // searchRange, entrySelector and rangeShift, from the table count as the specification defines them.
  const power = 2 ** Math.floor(Math.log2(tables.length));
  writer.setUint16(6, power * 16);
  writer.setUint16(8, Math.log2(power));
  writer.setUint16(10, tables.length * 16 - power * 16);
  let offset = directory;
  let headOffset = 0;
  tables.forEach((table, index) => {
    const at = 12 + 16 * index;
    for (let character = 0; character < 4; character += 1) out[at + character] = table.tag.charCodeAt(character);
    writer.setUint32(at + 4, checksum(table.data));
    writer.setUint32(at + 8, offset);
    writer.setUint32(at + 12, table.data.length);
    out.set(table.data, offset);
    if (table.tag === 'head') headOffset = offset;
    offset += padded(table.data.length);
  });
  writer.setUint32(headOffset + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}

/** A subset of `font` named `TAG+<postscript>`, or `null` where HarfBuzz refuses it. */
export function namedSubset(
  font: Uint8Array,
  postscript: string,
  request: SubsetRequest,
): { readonly bytes: Uint8Array; readonly name: string } | null {
  const subset = subsetFont(font, request);
  if (subset === null) return null;
  const name = `${subsetTag(subset)}+${postscript}`;
  return { bytes: withPostScriptName(subset, name), name };
}

function padded(length: number): number {
  return (length + 3) & ~3;
}

function checksum(bytes: Uint8Array): number {
  let sum = 0;
  for (let at = 0; at < bytes.length; at += 4) {
    const word = ((bytes[at] ?? 0) << 24) | ((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum;
}

/** A format 0 `name` table: names 1, 4 and 6, for the Macintosh (Roman) and Windows (UTF-16BE) platforms. */
function nameTable(postscript: string): Uint8Array {
  const roman = Uint8Array.from(postscript, (character) => character.charCodeAt(0));
  const utf16 = new Uint8Array(postscript.length * 2);
  for (let index = 0; index < postscript.length; index += 1) utf16[2 * index + 1] = postscript.charCodeAt(index);
  const records = [
    ...[1, 4, 6].map((id) => ({ platform: 1, encoding: 0, language: 0, id, data: roman })),
    ...[1, 4, 6].map((id) => ({ platform: 3, encoding: 1, language: 0x409, id, data: utf16 })),
  ];
  const header = 6 + 12 * records.length;
  const out = new Uint8Array(header + records.reduce((total, record) => total + record.data.length, 0));
  const writer = new DataView(out.buffer);
  writer.setUint16(2, records.length);
  writer.setUint16(4, header);
  let offset = 0;
  records.forEach((record, index) => {
    const at = 6 + 12 * index;
    writer.setUint16(at, record.platform);
    writer.setUint16(at + 2, record.encoding);
    writer.setUint16(at + 4, record.language);
    writer.setUint16(at + 6, record.id);
    writer.setUint16(at + 8, record.data.length);
    writer.setUint16(at + 10, offset);
    out.set(record.data, header + offset);
    offset += record.data.length;
  });
  return out;
}
