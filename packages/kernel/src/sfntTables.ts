/**
 * One table of a TrueType or OpenType font, read from its bytes: the ONE reader of the `sfnt` table directory (B3a).
 *
 * ## Why not HarfBuzz's `referenceTable`
 *
 * harfbuzzjs 1.6.2's `Face.referenceTable` answers a sub-blob it never destroys, and that sub-blob holds a reference to
 * the face's whole blob: every call pinned a full copy of the font in HarfBuzz's WebAssembly memory for the life of the
 * process. Measured 2026-10-14: a ShapingFace's `metrics()` (`head`, `post`) pinned about one program copy per call, 33
 * MB over 40 calls on a 613 KB program even with collection forced, and the PDFium host grew by about 100 MB over 30
 * `document.runFonts` reads. A table read from the bytes allocates nothing in HarfBuzz.
 *
 * ## A collection
 *
 * A `ttcf` file holds several faces' directories behind one header; `faceIndex` picks one. Every offset is bounds-checked
 * against the bytes, so a malformed file answers `undefined` rather than a table read from somewhere else.
 */

/** The `sfnt` versions a face's directory begins with: 1.0, Apple's `true`, and CFF-flavoured `OTTO`. */
const SFNT_VERSIONS = new Set([0x00010000, 0x74727565, 0x4f54544f]);

/** `ttcf`, a collection's header. */
const COLLECTION = 0x74746366;

/** The four-byte tag as the directory spells it. */
function tagOf(tag: string): number {
  if (tag.length !== 4) throw new RangeError(`a table tag is four characters, not ${JSON.stringify(tag)}`);
  return ((tag.charCodeAt(0) << 24) | (tag.charCodeAt(1) << 16) | (tag.charCodeAt(2) << 8) | tag.charCodeAt(3)) >>> 0;
}

/** Where face `faceIndex`'s table directory starts, or `undefined` where there is no such face. */
function directoryOf(view: DataView, faceIndex: number): number | undefined {
  if (view.byteLength < 12) return undefined;
  if (view.getUint32(0) !== COLLECTION) return faceIndex === 0 ? 0 : undefined;
  const count = view.getUint32(8);
  if (faceIndex < 0 || faceIndex >= count || 12 + 4 * (faceIndex + 1) > view.byteLength) return undefined;
  return view.getUint32(12 + 4 * faceIndex);
}

/**
 * Face `faceIndex`'s table `tag` as a view into `bytes`; `undefined` where the bytes are not a face or the face has no
 * such table; and `'past-end'` where the directory names the table and it runs past the end of the bytes, which a
 * caller may refuse as a damaged file rather than read as an absence ({@link sfntTable} reads it as one).
 *
 * @param bytes a font file, a collection or a single face
 * @param faceIndex which face of a collection; 0 for a single face
 * @param tag the table's four-character tag, as `OS/2` or `head`
 */
export function sfntTableEntry(bytes: Uint8Array, faceIndex: number, tag: string): Uint8Array | 'past-end' | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = directoryOf(view, faceIndex);
  if (start === undefined || start + 12 > bytes.length || !SFNT_VERSIONS.has(view.getUint32(start))) return undefined;
  const wanted = tagOf(tag);
  const tables = view.getUint16(start + 4);
  for (let at = 0; at < tables; at += 1) {
    const record = start + 12 + at * 16;
    if (record + 16 > bytes.length) return undefined;
    if (view.getUint32(record) !== wanted) continue;
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    return offset + length > bytes.length ? 'past-end' : bytes.subarray(offset, offset + length);
  }
  return undefined;
}

/** {@link sfntTableEntry}, with a table that runs past the end read as absent: for a caller that only reads facts. */
export function sfntTable(bytes: Uint8Array, faceIndex: number, tag: string): Uint8Array | undefined {
  const entry = sfntTableEntry(bytes, faceIndex, tag);
  return entry === 'past-end' ? undefined : entry;
}

/**
 * Whether face `faceIndex` draws from CFF outlines (a `CFF ` or `CFF2` table) rather than TrueType's `glyf`: THE ONE
 * reading of it, for a single face and a collection's alike, since a collection's first bytes are `ttcf` whatever its
 * faces hold. What decides how a face is embedded (`cidFont.ts`) and which writers can embed it (`pdfiumFfi.ts`).
 */
export function hasCffOutlines(bytes: Uint8Array, faceIndex: number): boolean {
  return sfntTableEntry(bytes, faceIndex, 'CFF ') !== undefined || sfntTableEntry(bytes, faceIndex, 'CFF2') !== undefined;
}
