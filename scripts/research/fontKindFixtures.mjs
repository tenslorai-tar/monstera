// @ts-check
/**
 * One small PDF per font kind ISO 32000 defines, built here from freely licensed fonts, for asking what an in-place
 * text edit does with each — `fontKindEdits.mjs` is the instrument that asks.
 *
 * ## Why every font dictionary is written by hand
 *
 * pdf-lib embeds a custom font only through fontkit, which this repository does not depend on, and when it does it
 * writes one shape (Type0 over CIDFontType2). The question is about every shape, so each dictionary is built here from
 * the font file's own tables — the TrueType `cmap`, `hmtx`, `glyf` and `loca`, and a Type 1 program's charstrings —
 * and nothing about a kind is left to a library's choice.
 *
 * ## The fonts, and their licences
 *
 * Already on any machine that builds this repository, and none committed — every fixture is built on demand:
 *
 * - Liberation Sans (SIL OFL 1.1, `pdfjs-dist/standard_fonts/LICENSE_LIBERATION`) for TrueType and CID;
 * - URW Nimbus Roman (SIL OFL 1.1, the `OFL.txt` beside it), a raw Type 1 program with its AFM, from the MuPDF source
 *   the MuPDF provisioning extracts under `.tools`;
 * - PDFium's Foxit Serif (BSD-3, `pdfjs-dist/standard_fonts/LICENSE_FOXIT`) for the compact Type 1 kind. pdf.js names
 *   it `.pfb`, and it is a bare CFF — its header is `01 00 04 02` — which is exactly what `FontFile3 /Type1C` holds.
 *
 * ## Every page says the same three things, in our own words
 *
 * Line A is the one an edit changes, line B is a second line in the SAME font that nothing changes, and line C is a
 * control in Helvetica. B and C are what make a silent loss visible: an edit that saves the page without them has
 * destroyed text nobody asked it to touch, which a read-back of what was written cannot see.
 *
 * Usage: import { FONT_KINDS, buildFixture } from './fontKindFixtures.mjs'
 *        node scripts/research/fontKindFixtures.mjs <directory>   writes each fixture there, for a person to open
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';

import { isMain } from '../lib/isMain.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(ROOT, 'package.json'));
const FONTS = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts');

/** The three lines, in our own words. A is edited, B is left alone in the same font, C is the Helvetica control. */
export const LINES = {
  a: 'Monstera fixture heading.',
  b: 'Untouched line in the same font.',
  c: 'Control line in Helvetica.',
};

/** Line A and B for the CID-keyed font that is not embedded: Japanese, because that is what such a font carries. */
const JAPANESE = { a: 'モンステラの見出し。', b: '変更しない行です。' };

// ---------------------------------------------------------------------------------------------- TrueType tables

/** @param {Buffer} sfnt */
function tablesOf(sfnt) {
  /** @type {Map<string, Buffer>} */
  const tables = new Map();
  const count = sfnt.readUInt16BE(4);
  for (let i = 0; i < count; i += 1) {
    const at = 12 + i * 16;
    const offset = sfnt.readUInt32BE(at + 8);
    tables.set(sfnt.toString('latin1', at, at + 4), sfnt.subarray(offset, offset + sfnt.readUInt32BE(at + 12)));
  }
  return tables;
}

/**
 * A TrueType font's metrics and its Unicode-to-glyph map (the (3,1) format 4 subtable), read from its own tables.
 *
 * @param {Buffer} sfnt
 */
function trueTypeOf(sfnt) {
  const tables = tablesOf(sfnt);
  const need = (/** @type {string} */ tag) => {
    const table = tables.get(tag);
    if (table === undefined) throw new Error(`the font has no ${tag} table`);
    return table;
  };
  const head = need('head');
  const hhea = need('hhea');
  const hmtx = need('hmtx');
  const cmap = need('cmap');
  const unitsPerEm = head.readUInt16BE(18);
  const metrics = hhea.readUInt16BE(34);
  let format4 = -1;
  for (let i = 0; i < cmap.readUInt16BE(2); i += 1) {
    const at = 4 + i * 8;
    if (cmap.readUInt16BE(at) === 3 && cmap.readUInt16BE(at + 2) === 1) format4 = cmap.readUInt32BE(at + 4);
  }
  if (format4 < 0 || cmap.readUInt16BE(format4) !== 4) throw new Error('the font has no (3,1) format 4 cmap');
  const segments = cmap.readUInt16BE(format4 + 6) / 2;
  const ends = format4 + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;
  /** @param {number} code */
  const glyphOf = (code) => {
    for (let s = 0; s < segments; s += 1) {
      if (code > cmap.readUInt16BE(ends + s * 2)) continue;
      const start = cmap.readUInt16BE(starts + s * 2);
      if (code < start) return 0;
      const delta = cmap.readInt16BE(deltas + s * 2);
      const rangeAt = ranges + s * 2;
      const range = cmap.readUInt16BE(rangeAt);
      if (range === 0) return (code + delta) & 0xffff;
      const glyph = cmap.readUInt16BE(rangeAt + range + (code - start) * 2);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
  /** Advance width in PDF glyph space (thousandths of an em). @param {number} glyph */
  const width = (glyph) => Math.round((hmtx.readUInt16BE(Math.min(glyph, metrics - 1) * 4) * 1000) / unitsPerEm);
  return { tables, glyphOf, width, unitsPerEm };
}

/** @param {Buffer} data */
function checksum(data) {
  const padded = Buffer.alloc((data.length + 3) & ~3);
  data.copy(padded);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}

/** An sfnt from its tables, in tag order, each 4-byte aligned. @param {Map<string, Buffer>} tables */
function sfntOf(tables) {
  const tags = [...tables.keys()].sort();
  const directory = Buffer.alloc(12 + tags.length * 16);
  directory.writeUInt32BE(0x00010000, 0);
  directory.writeUInt16BE(tags.length, 4);
  const power = 2 ** Math.floor(Math.log2(tags.length));
  directory.writeUInt16BE(power * 16, 6);
  directory.writeUInt16BE(Math.log2(power), 8);
  directory.writeUInt16BE(tags.length * 16 - power * 16, 10);
  /** @type {Buffer[]} */
  const bodies = [];
  let offset = directory.length;
  for (const [i, tag] of tags.entries()) {
    const data = /** @type {Buffer} */ (tables.get(tag));
    directory.write(tag, 12 + i * 16, 'latin1');
    directory.writeUInt32BE(checksum(data), 12 + i * 16 + 4);
    directory.writeUInt32BE(offset, 12 + i * 16 + 8);
    directory.writeUInt32BE(data.length, 12 + i * 16 + 12);
    const padded = Buffer.alloc((data.length + 3) & ~3);
    data.copy(padded);
    bodies.push(padded);
    offset += padded.length;
  }
  return Buffer.concat([directory, ...bodies]);
}

/**
 * A SUBSET of a TrueType font the way many producers write one: every glyph id kept, every glyph not in `keep` (nor a
 * component of one that is) emptied. The program then carries only the outlines the document draws.
 *
 * @param {Buffer} sfnt
 * @param {Iterable<number>} keep
 */
function trueTypeSubset(sfnt, keep) {
  const tables = new Map(tablesOf(sfnt));
  const head = Buffer.from(/** @type {Buffer} */ (tables.get('head')));
  const loca = /** @type {Buffer} */ (tables.get('loca'));
  const glyf = /** @type {Buffer} */ (tables.get('glyf'));
  const long = head.readInt16BE(50) === 1;
  const glyphs = /** @type {Buffer} */ (tables.get('maxp')).readUInt16BE(4);
  const offsetOf = (/** @type {number} */ g) => (long ? loca.readUInt32BE(g * 4) : loca.readUInt16BE(g * 2) * 2);
  const kept = new Set([0, ...keep]);
  // COMPONENTS of a kept composite are kept too, or the composite draws nothing.
  for (const g of [...kept]) {
    const at = offsetOf(g);
    if (offsetOf(g + 1) === at || glyf.readInt16BE(at) >= 0) continue;
    let p = at + 10;
    for (let more = true; more; ) {
      const flags = glyf.readUInt16BE(p);
      kept.add(glyf.readUInt16BE(p + 2));
      p += 4 + (flags & 0x1 ? 4 : 2) + (flags & 0x8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
      more = (flags & 0x20) !== 0;
    }
  }
  const parts = [];
  const newLoca = Buffer.alloc((glyphs + 1) * 4);
  let offset = 0;
  for (let g = 0; g < glyphs; g += 1) {
    newLoca.writeUInt32BE(offset, g * 4);
    if (!kept.has(g)) continue;
    const data = glyf.subarray(offsetOf(g), offsetOf(g + 1));
    const padded = Buffer.alloc((data.length + 3) & ~3);
    data.copy(padded);
    parts.push(padded);
    offset += padded.length;
  }
  newLoca.writeUInt32BE(offset, glyphs * 4);
  head.writeInt16BE(1, 50);
  tables.set('head', head);
  tables.set('loca', newLoca);
  tables.set('glyf', Buffer.concat(parts));
  return sfntOf(tables);
}

// ------------------------------------------------------------------------------------------------- Type 1 programs

/**
 * A raw Type 1 program's three parts — the clear-text header through `eexec`, the encrypted part, and the trailer of
 * zeros and `cleartomark` — which are `FontFile`'s `Length1`, `Length2` and `Length3`.
 *
 * @param {Buffer} program
 */
function type1Segments(program) {
  const text = program.toString('latin1');
  const eexec = /currentfile\s+eexec\r?\n?/u.exec(text);
  const mark = text.lastIndexOf('cleartomark');
  if (eexec === null || mark < 0) throw new Error('not a raw Type 1 program: no eexec section and trailer');
  let trailerStart = mark;
  // THE TRAILER is the run of zeros (512 of them, in lines) before `cleartomark`, and the whitespace between them.
  while (trailerStart > 0 && /[0\s]/u.test(text.charAt(trailerStart - 1))) trailerStart -= 1;
  const clear = program.subarray(0, eexec.index + eexec[0].length);
  const encrypted = program.subarray(clear.length, trailerStart);
  if (/^[0-9a-fA-F\s]+$/u.test(encrypted.subarray(0, 64).toString('latin1'))) {
    throw new Error('a hex (PFA) eexec section; this module reads the binary form');
  }
  return { clear, encrypted, trailer: program.subarray(trailerStart) };
}

/**
 * A font's advance widths by glyph name, from its AFM (`C code ; WX width ; N name ;`).
 *
 * @param {string} afm
 */
function afmWidths(afm) {
  /** @type {Map<string, number>} */
  const widths = new Map();
  for (const line of afm.matchAll(/^C\s+-?\d+\s*;\s*WX\s+(\d+)\s*;\s*N\s+(\S+)\s*;/gmu)) {
    widths.set(/** @type {string} */ (line[2]), Number(line[1]));
  }
  if (widths.size === 0) throw new Error('the AFM named no glyph widths');
  return widths;
}

/**
 * Where MuPDF's own copy of the URW base-35 fonts is: the source the MuPDF provisioning extracts under `.tools`, which
 * carries each as a raw Type 1 program beside its AFM (SIL OFL 1.1, the `OFL.txt` beside them).
 */
function urwDirectory() {
  const base = join(ROOT, '.tools', 'mupdf');
  for (const version of existsSync(base) ? readdirSync(base) : []) {
    for (const source of readdirSync(join(base, version)).filter((name) => name.startsWith('mupdf-'))) {
      const directory = join(base, version, source, 'resources', 'fonts', 'urw', 'input');
      if (existsSync(join(directory, 'NimbusRoman-Regular.t1'))) return directory;
    }
  }
  throw new Error('No URW Type 1 fonts under .tools/mupdf. Run `node scripts/provision/mupdf.mjs`, which extracts them.');
}

/** Type 1 encryption (Adobe Type 1 Font Format §7.1). @param {Buffer} data @param {number} key */
function decrypt(data, key) {
  const out = Buffer.alloc(data.length);
  let r = key;
  for (let i = 0; i < data.length; i += 1) {
    const c = /** @type {number} */ (data[i]);
    out[i] = c ^ (r >> 8);
    r = ((c + r) * 52845 + 22719) & 0xffff;
  }
  return out;
}

/** @param {Buffer} data @param {number} key */
function encrypt(data, key) {
  const out = Buffer.alloc(data.length);
  let r = key;
  for (let i = 0; i < data.length; i += 1) {
    const c = /** @type {number} */ (data[i]) ^ (r >> 8);
    out[i] = c;
    r = ((c + r) * 52845 + 22719) & 0xffff;
  }
  return out;
}

/**
 * Where each of a Type 1 program's charstrings sits in its decrypted private part, by glyph name — each entry is
 * `/name length RD <binary> ND`, and the binary is skipped by its length, never scanned.
 *
 * @param {Buffer} privatePart decrypted eexec section
 */
function charStringsOf(privatePart) {
  const text = privatePart.toString('latin1');
  const start = text.indexOf('/CharStrings');
  if (start < 0) throw new Error('no /CharStrings in the program');
  /** @type {Map<string, { from: number, to: number }>} */
  const glyphs = new Map();
  const entry = /\/([^\s/]+)\s+(\d+)\s+(RD|-\|)\s/gu;
  entry.lastIndex = text.indexOf('begin', start);
  for (let match = entry.exec(text); match !== null; match = entry.exec(text)) {
    const body = match.index + match[0].length;
    const close = /\s*(ND|\|-)/uy;
    close.lastIndex = body + Number(match[2]);
    if (close.exec(text) === null) break;
    glyphs.set(/** @type {string} */ (match[1]), { from: match.index, to: close.lastIndex });
    entry.lastIndex = close.lastIndex;
  }
  if (glyphs.size === 0) throw new Error('read no charstrings, which is a broken read rather than an empty font');
  return { text, glyphs };
}

/** The PostScript name of a WinAnsi character this module's lines use. @param {string} c */
function glyphName(c) {
  if (/[A-Za-z]/u.test(c)) return c;
  const names = /** @type {Record<string, string>} */ ({ ' ': 'space', '.': 'period', ',': 'comma' });
  const name = names[c];
  if (name === undefined) throw new Error(`no glyph name for U+${c.codePointAt(0)?.toString(16) ?? '?'}`);
  return name;
}

/**
 * A Type 1 program, whole or as a subset holding only `keep`'s glyphs and `.notdef`.
 *
 * @param {Buffer} source a raw Type 1 program
 * @param {Set<string> | null} keep
 */
function type1Program(source, keep) {
  const { clear, encrypted, trailer } = type1Segments(source);
  const privatePart = decrypt(encrypted, 55665);
  let body = privatePart;
  if (keep !== null) {
    const { text, glyphs } = charStringsOf(privatePart);
    const wanted = new Set([...keep, '.notdef']);
    const entries = [...glyphs.entries()].sort((x, y) => x[1].from - y[1].from);
    const first = /** @type {[string, { from: number }]} */ (entries[0])[1].from;
    const last = /** @type {[string, { to: number }]} */ (entries[entries.length - 1])[1].to;
    const kept = entries.filter(([name]) => wanted.has(name)).map(([, at]) => privatePart.subarray(at.from, at.to));
    const head = Buffer.from(
      text.slice(0, first).replace(/\/CharStrings\s+\d+/u, `/CharStrings ${String(kept.length)}`),
      'latin1',
    );
    body = Buffer.concat([head, ...kept.flatMap((part) => [part, Buffer.from('\n')]), privatePart.subarray(last)]);
  }
  const reencrypted = encrypt(body, 55665);
  return { program: Buffer.concat([clear, reencrypted, trailer]), lengths: [clear.length, reencrypted.length, trailer.length] };
}

// ------------------------------------------------------------------------------------------------------- the PDFs

/** A ToUnicode CMap mapping each 1- or 2-byte code to its character. @param {Map<number, string>} map @param {1 | 2} bytes */
function toUnicode(map, bytes) {
  const hex = (/** @type {number} */ n) => n.toString(16).padStart(bytes * 2, '0').toUpperCase();
  const utf16 = (/** @type {string} */ s) =>
    [...Buffer.from(s, 'utf16le').swap16()].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  const pairs = [...map.entries()].map(([code, char]) => `<${hex(code)}> <${utf16(char)}>`);
  return (
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Monstera-Fixture def /CMapType 2 def\n' +
    `1 begincodespacerange <${hex(0)}> <${hex(bytes === 1 ? 0xff : 0xffff)}> endcodespacerange\n` +
    `${String(pairs.length)} beginbfchar\n${pairs.join('\n')}\nendbfchar\nendcmap CMapName currentdict /CMap defineresource pop end end\n`
  );
}

/**
 * The font kinds ISO 32000 §9.6–9.7 defines, each as this module builds it. `id` is what the instrument reports.
 *
 * @type {readonly { id: string, kind: string, note: string }[]}
 */
export const FONT_KINDS = [
  { id: 'type1-standard14', kind: 'Type 1, standard 14, not embedded', note: 'Helvetica, WinAnsiEncoding' },
  { id: 'type1-embedded', kind: 'Type 1, embedded', note: 'URW Nimbus Roman program in FontFile, WinAnsiEncoding' },
  { id: 'type1-subset', kind: 'Type 1, embedded subset', note: 'the same program with only the glyphs drawn, AAAAAA+ name' },
  { id: 'type1c-embedded', kind: 'Type 1, embedded compact (CFF)', note: 'PDFium’s Foxit Serif CFF in FontFile3 /Type1C' },
  { id: 'truetype-embedded', kind: 'TrueType, embedded', note: 'Liberation Sans in FontFile2, WinAnsiEncoding' },
  { id: 'truetype-subset', kind: 'TrueType, embedded subset', note: 'every glyph not drawn emptied, AAAAAA+ name' },
  { id: 'truetype-not-embedded', kind: 'TrueType, not embedded', note: 'BaseFont Arial, Liberation Sans widths' },
  { id: 'truetype-symbolic', kind: 'TrueType, symbolic', note: 'Liberation Sans, Flags 4, no Encoding' },
  { id: 'type0-cidfonttype2', kind: 'Type0 over CIDFontType2', note: 'Liberation Sans, Identity-H, CIDToGIDMap Identity' },
  { id: 'type0-cidfonttype0', kind: 'Type0 over CIDFontType0, not embedded', note: 'KozMinPr6N-Regular, Adobe-Japan1, UniJIS-UCS2-H; Japanese lines' },
  { id: 'type3', kind: 'Type 3', note: 'one rectangle per glyph, ToUnicode, FontMatrix 0.001' },
];

/**
 * One fixture's bytes.
 *
 * @param {string} id one of {@link FONT_KINDS}' ids
 * @returns {Promise<Uint8Array>}
 */
export async function buildFixture(id) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const context = doc.context;
  const page = doc.addPage([612, 792]);
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const lines = id === 'type0-cidfonttype0' ? JAPANESE : LINES;

  /** The font under test, and how a line is encoded for it. */
  let font;
  /** @type {(text: string) => string} */
  let show;
  const literal = (/** @type {string} */ text) => PDFString.of(text).toString();
  const used = [...new Set(`${lines.a}${lines.b}`)];

  if (id === 'type1-standard14') {
    font = helvetica.ref;
    show = (text) => helvetica.encodeText(text).toString();
  } else if (id === 'type1-embedded' || id === 'type1-subset' || id === 'type1c-embedded') {
    const urw = urwDirectory();
    // TIMES' METRICS for all three: Nimbus Roman is metric-compatible with Times, and so is PDFium's own serif, which
    // is the compact program here.
    const widths = afmWidths(readFileSync(join(urw, 'NimbusRoman-Regular.afm'), 'latin1'));
    let file;
    let name;
    if (id === 'type1c-embedded') {
      // A BARE CFF, whatever pdf.js' file name says: its header is 01 00 04 02, which is FontFile3 /Type1C.
      name = 'FoxitSerif';
      file = { FontFile3: context.register(context.flateStream(readFileSync(join(FONTS, 'FoxitSerif.pfb')), { Subtype: 'Type1C' })) };
    } else {
      const subset = id === 'type1-subset';
      const { program, lengths } = type1Program(
        readFileSync(join(urw, 'NimbusRoman-Regular.t1')),
        subset ? new Set(used.map(glyphName)) : null,
      );
      name = subset ? 'AAAAAA+NimbusRoman-Regular' : 'NimbusRoman-Regular';
      file = {
        FontFile: context.register(
          context.flateStream(program, { Length1: lengths[0], Length2: lengths[1], Length3: lengths[2] }),
        ),
      };
    }
    font = context.register(
      context.obj({
        Type: 'Font',
        Subtype: 'Type1',
        BaseFont: name,
        FirstChar: 32,
        LastChar: 126,
        Widths: Array.from({ length: 95 }, (_, k) => {
          const c = String.fromCharCode(32 + k);
          return /[A-Za-z .,]/u.test(c) ? (widths.get(glyphName(c)) ?? 0) : 0;
        }),
        Encoding: 'WinAnsiEncoding',
        FontDescriptor: context.register(
          context.obj({
            Type: 'FontDescriptor',
            FontName: name,
            Flags: 34,
            FontBBox: [-170, -220, 1000, 900],
            ItalicAngle: 0,
            Ascent: 890,
            Descent: -216,
            CapHeight: 662,
            StemV: 80,
            ...file,
          }),
        ),
      }),
    );
    show = literal;
  } else if (id.startsWith('truetype')) {
    const sfnt = readFileSync(join(FONTS, 'LiberationSans-Regular.ttf'));
    const tt = trueTypeOf(sfnt);
    const subset = id === 'truetype-subset';
    const embedded = id !== 'truetype-not-embedded';
    const symbolic = id === 'truetype-symbolic';
    const name = subset ? 'AAAAAA+LiberationSans' : id === 'truetype-not-embedded' ? 'Arial' : 'LiberationSans';
    const program = subset ? trueTypeSubset(sfnt, used.map((c) => tt.glyphOf(c.charCodeAt(0)))) : sfnt;
    const descriptor = {
      Type: 'FontDescriptor',
      FontName: name,
      Flags: symbolic ? 4 : 32,
      FontBBox: [-544, -303, 1302, 980],
      ItalicAngle: 0,
      Ascent: 905,
      Descent: -212,
      CapHeight: 716,
      StemV: 80,
      ...(embedded ? { FontFile2: context.register(context.flateStream(program, { Length1: program.length })) } : {}),
    };
    font = context.register(
      context.obj({
        Type: 'Font',
        Subtype: 'TrueType',
        BaseFont: name,
        FirstChar: 32,
        LastChar: 126,
        Widths: Array.from({ length: 95 }, (_, k) => tt.width(tt.glyphOf(32 + k))),
        ...(symbolic ? {} : { Encoding: 'WinAnsiEncoding' }),
        FontDescriptor: context.register(context.obj(descriptor)),
      }),
    );
    show = literal;
  } else if (id === 'type0-cidfonttype2') {
    const sfnt = readFileSync(join(FONTS, 'LiberationSans-Regular.ttf'));
    const tt = trueTypeOf(sfnt);
    const gids = new Map(used.map((c) => [c, tt.glyphOf(c.charCodeAt(0))]));
    const descendant = context.register(
      context.obj({
        Type: 'Font',
        Subtype: 'CIDFontType2',
        BaseFont: 'LiberationSans',
        CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 },
        CIDToGIDMap: 'Identity',
        W: [...gids.values()].flatMap((g) => [g, [tt.width(g)]]),
        FontDescriptor: context.register(
          context.obj({
            Type: 'FontDescriptor',
            FontName: 'LiberationSans',
            Flags: 32,
            FontBBox: [-544, -303, 1302, 980],
            ItalicAngle: 0,
            Ascent: 905,
            Descent: -212,
            CapHeight: 716,
            StemV: 80,
            FontFile2: context.register(context.flateStream(sfnt, { Length1: sfnt.length })),
          }),
        ),
      }),
    );
    font = context.register(
      context.obj({
        Type: 'Font',
        Subtype: 'Type0',
        BaseFont: 'LiberationSans',
        Encoding: 'Identity-H',
        DescendantFonts: [descendant],
        ToUnicode: context.register(
          context.flateStream(toUnicode(new Map([...gids.entries()].map(([c, g]) => [g, c])), 2)),
        ),
      }),
    );
    show = (text) => PDFHexString.of([...text].map((c) => (gids.get(c) ?? 0).toString(16).padStart(4, '0')).join('')).toString();
  } else if (id === 'type0-cidfonttype0') {
    const descendant = context.register(
      context.obj({
        Type: 'Font',
        Subtype: 'CIDFontType0',
        BaseFont: 'KozMinPr6N-Regular',
        CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Japan1'), Supplement: 6 },
        DW: 1000,
        FontDescriptor: context.register(
          context.obj({
            Type: 'FontDescriptor',
            FontName: 'KozMinPr6N-Regular',
            Flags: 6,
            FontBBox: [-437, -340, 1147, 1317],
            ItalicAngle: 0,
            Ascent: 880,
            Descent: -120,
            CapHeight: 742,
            StemV: 80,
          }),
        ),
      }),
    );
    font = context.register(
      context.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'KozMinPr6N-Regular-UniJIS-UCS2-H', Encoding: 'UniJIS-UCS2-H', DescendantFonts: [descendant] }),
    );
    show = (text) => PDFHexString.of(Buffer.from(text, 'utf16le').swap16().toString('hex')).toString();
  } else if (id === 'type3') {
    /** Code 1.. per character, in first-use order. */
    const codes = new Map(used.map((c, k) => [c, k + 1]));
    /** @type {Record<string, import('@cantoo/pdf-lib').PDFRef>} */
    const procs = {};
    for (const [c, code] of codes) {
      // A RECTANGLE PER GLYPH, a space drawing nothing: the question is what an edit does with a Type 3 font, and a
      // glyph's shape plays no part in it.
      procs[`g${String(code)}`] = context.register(
        context.flateStream(c === ' ' ? '500 0 d0' : '600 0 0 0 550 700 d1 50 0 450 700 re f'),
      );
    }
    font = context.register(
      context.obj({
        Type: 'Font',
        Subtype: 'Type3',
        FontBBox: [0, 0, 550, 700],
        FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
        CharProcs: procs,
        Encoding: { Type: 'Encoding', Differences: [1, ...[...codes.values()].map((code) => `g${String(code)}`)] },
        FirstChar: 1,
        LastChar: codes.size,
        Widths: [...codes.keys()].map((c) => (c === ' ' ? 500 : 600)),
        Resources: {},
        ToUnicode: context.register(context.flateStream(toUnicode(new Map([...codes.entries()].map(([c, code]) => [code, c])), 1))),
      }),
    );
    show = (text) => PDFHexString.of([...text].map((c) => (codes.get(c) ?? 0).toString(16).padStart(2, '0')).join('')).toString();
  } else {
    throw new Error(`no fixture kind ${id}`);
  }

  page.node.set(PDFName.of('Resources'), context.obj({ Font: { F1: font, F2: helvetica.ref } }));
  const content =
    `BT /F1 18 Tf 72 700 Td ${show(lines.a)} Tj ET\n` +
    `BT /F1 12 Tf 72 670 Td ${show(lines.b)} Tj ET\n` +
    `BT /F2 12 Tf 72 640 Td ${helvetica.encodeText(LINES.c).toString()} Tj ET\n`;
  page.node.set(PDFName.of('Contents'), context.register(context.flateStream(content)));
  // HELVETICA'S DICTIONARY IS WRITTEN BY THE SAVE, which embeds every font the document made.
  return doc.save({ useObjectStreams: false });
}

if (isMain(import.meta.url)) {
  const directory = process.argv[2];
  if (directory === undefined) throw new Error('Usage: node scripts/research/fontKindFixtures.mjs <directory>');
  mkdirSync(directory, { recursive: true });
  for (const { id } of FONT_KINDS) {
    const bytes = await buildFixture(id);
    writeFileSync(join(directory, `${id}.pdf`), bytes);
    process.stdout.write(`${id}.pdf ${String(bytes.length)} bytes\n`);
  }
}
