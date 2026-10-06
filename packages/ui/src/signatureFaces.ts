import {
  MAX_SIGNATURE_OUTLINE_POINTS,
  type OutlinedSignatureMark,
  SIGNATURE_FONTS,
  SIGNATURE_OUTLINE_GRID,
  type SignatureFont,
  type SignatureOutline,
  type TypedSignatureMark,
  OUTLINE_OPS,
  outlineOpCodes,
  outlinePointsOf,
} from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import { type Font, type Glyph, type PathCommand, parse } from 'opentype.js';

import {
  SIGNATURE_FACE_ALEX_BRUSH,
  SIGNATURE_FACE_ALLURA,
  SIGNATURE_FACE_CAVEAT,
  SIGNATURE_FACE_COURIER_PRIME,
  SIGNATURE_FACE_DANCING_SCRIPT,
  SIGNATURE_FACE_GARAMOND,
  SIGNATURE_FACE_GARAMOND_ITALIC,
  SIGNATURE_FACE_GREAT_VIBES,
  SIGNATURE_FACE_HERR_VON_MUELLERHOFF,
  SIGNATURE_FACE_LA_BELLE_AURORE,
  SIGNATURE_FACE_MR_DAFOE,
  SIGNATURE_FACE_PARISIENNE,
  SIGNATURE_FACE_PINYON_SCRIPT,
  SIGNATURE_FACE_SACRAMENTO,
  SIGNATURE_FACE_SOURCE_SANS,
} from './messages/en.js';

/**
 * The faces a typed signature is set in, and everything they answer — THE ONE MODULE that reads them
 * ([ADR-0150](../../../docs/DECISIONS/0150-a-typed-signature-is-written-as-outlines-of-a-bundled-face.md)).
 *
 * ## What it answers, and why it is one module
 *
 * Which characters a face can draw, the outline of a name in it, and the path the dialog shows. The dialog's list, its
 * preview, a kept signature's look and the mark the page receives are all drawn from the same glyphs here, so what a
 * person picks is what is written (B3a: the face's own character map is the authority on what it can draw).
 *
 * ## From the bundle, never from a fetch
 *
 * Each face is fifteen OFL packages' WOFF files, one per script, every one its own lazily imported chunk, as
 * `cmaps.ts` bundles PDF.js's CMaps: `script-src 'self'` allows the chunk, `connect-src 'none'` would refuse a fetch, and
 * a face is decoded only when a typed signature is made or shown. Nothing is a CSS font: the dialog draws the outline as
 * a path, so the page and the screen cannot be set by two different renderers of one font.
 *
 * ## Glyph by glyph, not `font.getPath(text)`
 *
 * opentype.js's own layout applies the face's substitution tables and throws on one it does not support — measured
 * 2026-10-03 on Great Vibes, *"lookupType: 6 - substFormat: 2 is not yet supported"*. A name is set here from the
 * character map, each glyph's advance and the face's pair kerning, which every one of the fifteen reads.
 */

/** Where a face's files are, by package and style, and the name a person reads for it. */
interface FaceSource {
  readonly package: string;
  readonly style: 'normal' | 'italic';
  readonly name: MessageKey;
}

/** Keyed on the contract's list, so a face added there owes its files and its name here as a compile error. */
const SOURCES: Readonly<Record<SignatureFont, FaceSource>> = {
  'dancing-script': { package: 'dancing-script', style: 'normal', name: SIGNATURE_FACE_DANCING_SCRIPT },
  'great-vibes': { package: 'great-vibes', style: 'normal', name: SIGNATURE_FACE_GREAT_VIBES },
  allura: { package: 'allura', style: 'normal', name: SIGNATURE_FACE_ALLURA },
  'alex-brush': { package: 'alex-brush', style: 'normal', name: SIGNATURE_FACE_ALEX_BRUSH },
  sacramento: { package: 'sacramento', style: 'normal', name: SIGNATURE_FACE_SACRAMENTO },
  parisienne: { package: 'parisienne', style: 'normal', name: SIGNATURE_FACE_PARISIENNE },
  'pinyon-script': { package: 'pinyon-script', style: 'normal', name: SIGNATURE_FACE_PINYON_SCRIPT },
  'mr-dafoe': { package: 'mr-dafoe', style: 'normal', name: SIGNATURE_FACE_MR_DAFOE },
  'herr-von-muellerhoff': { package: 'herr-von-muellerhoff', style: 'normal', name: SIGNATURE_FACE_HERR_VON_MUELLERHOFF },
  'la-belle-aurore': { package: 'la-belle-aurore', style: 'normal', name: SIGNATURE_FACE_LA_BELLE_AURORE },
  caveat: { package: 'caveat', style: 'normal', name: SIGNATURE_FACE_CAVEAT },
  'garamond-italic': { package: 'eb-garamond', style: 'italic', name: SIGNATURE_FACE_GARAMOND_ITALIC },
  garamond: { package: 'eb-garamond', style: 'normal', name: SIGNATURE_FACE_GARAMOND },
  'source-sans': { package: 'source-sans-3', style: 'normal', name: SIGNATURE_FACE_SOURCE_SANS },
  'courier-prime': { package: 'courier-prime', style: 'normal', name: SIGNATURE_FACE_COURIER_PRIME },
};

/** The face a new typed signature starts in: a script face that reads plainly. */
export const DEFAULT_SIGNATURE_FONT: SignatureFont = 'dancing-script';

/** The name a person reads for `face`. */
export function signatureFaceName(face: SignatureFont): MessageKey {
  return SOURCES[face].name;
}

/**
 * Every subset file of the fifteen, at weight 400, each its own chunk. NAMED, not `@fontsource/*`, so a font package
 * that arrives as some other dependency's is not bundled with them.
 */
const FILES = import.meta.glob<string>(
  [
    '../../../node_modules/@fontsource/{dancing-script,great-vibes,allura,alex-brush,sacramento,parisienne,pinyon-script,mr-dafoe,herr-von-muellerhoff,la-belle-aurore,caveat,eb-garamond,source-sans-3,courier-prime}/files/*-400-normal.woff',
    '../../../node_modules/@fontsource/eb-garamond/files/*-400-italic.woff',
  ],
  { query: '?inline', import: 'default' },
);

/** The scripts a face's files are split by, in the order a character is looked for: Latin first, as names mostly are. */
const SUBSET_ORDER = ['latin', 'latin-ext', 'vietnamese', 'cyrillic', 'cyrillic-ext', 'greek', 'greek-ext'];

/** A face's files, keyed by subset: `…/{package}/files/{package}-{subset}-400-{style}.woff`. */
function filesOf(source: FaceSource): readonly (readonly [subset: string, load: () => Promise<string>])[] {
  const prefix = `/@fontsource/${source.package}/files/${source.package}-`;
  const suffix = `-400-${source.style}.woff`;
  const found = Object.entries(FILES).flatMap(([path, load]) => {
    const at = path.indexOf(prefix);
    if (at < 0 || !path.endsWith(suffix)) return [];
    return [[path.slice(at + prefix.length, path.length - suffix.length), load] as const];
  });
  const rank = (subset: string): number => {
    const known = SUBSET_ORDER.indexOf(subset);
    return known < 0 ? SUBSET_ORDER.length : known;
  };
  return found.sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
}

/** A `data:` URL's bytes, `cmaps.ts`' decoding: `?inline` gives base64, and `atob` reads it without a fetch. */
function bytesOf(dataUrl: string): ArrayBuffer {
  const text = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(text.length);
  for (let at = 0; at < text.length; at += 1) bytes[at] = text.charCodeAt(at);
  return bytes.buffer;
}

/** A face, read: its subsets in lookup order. The first is Latin, and its line box is the face's. */
export interface LoadedFace {
  readonly face: SignatureFont;
  readonly fonts: readonly Font[];
}

const LOADING = new Map<SignatureFont, Promise<LoadedFace>>();

/**
 * Reads `face`, once for the application's life.
 *
 * A face with no file at all is a build defect — the glob named a package that is not installed — and throws rather
 * than answering a face that can draw nothing, which would read as every character missing.
 */
export function loadFace(face: SignatureFont): Promise<LoadedFace> {
  const known = LOADING.get(face);
  if (known !== undefined) return known;
  const loading = (async (): Promise<LoadedFace> => {
    const files = filesOf(SOURCES[face]);
    if (files.length === 0) throw new Error(`no font file is bundled for the ${face} signature face`);
    const fonts = await Promise.all(files.map(async ([, load]) => parse(bytesOf(await load()))));
    return { face, fonts };
  })();
  LOADING.set(face, loading);
  return loading;
}

/** Every face, read. */
export function loadFaces(): Promise<readonly LoadedFace[]> {
  return Promise.all(SIGNATURE_FONTS.map(loadFace));
}

/** The first of a face's subsets whose character map has `character`, and its glyph; `undefined` when none has. */
function glyphFor(face: LoadedFace, character: string): { readonly font: Font; readonly glyph: Glyph } | undefined {
  for (const font of face.fonts) {
    const index = font.charToGlyphIndex(character);
    if (index > 0) return { font, glyph: font.glyphs.get(index) };
  }
  return undefined;
}

/**
 * A name as it is set: NFC, so an accent typed as a combining mark finds the face's precomposed letter, then by CODE
 * POINT, because a character map is keyed by code point — not by code unit, which would split a letter outside the
 * Basic Multilingual Plane in two, and not by grapheme, which a face has no table for.
 */
function charactersOf(text: string): readonly string[] {
  return Array.from(text.normalize('NFC'));
}

/** The characters of `text` that `face` cannot draw, each once, in the order they are typed. */
export function missingCharacters(face: LoadedFace, text: string): readonly string[] {
  const missing: string[] = [];
  for (const character of charactersOf(text)) {
    if (glyphFor(face, character) === undefined && !missing.includes(character)) missing.push(character);
  }
  return missing;
}

/** What setting a name in a face comes to. */
export type SetName =
  | { readonly kind: 'outline'; readonly outline: SignatureOutline }
  /** Characters the face cannot draw, each once (ADR-0150 Decision 5): nothing is drawn in their place. */
  | { readonly kind: 'missing'; readonly characters: readonly string[] }
  /** More points than an outline may carry ({@link MAX_SIGNATURE_OUTLINE_POINTS}): refused, never thinned. */
  | { readonly kind: 'too-long' }
  /** Every character is drawn and none has ink — spaces, or marks that draw nothing. */
  | { readonly kind: 'blank' };

/**
 * `text` set in `face`, as the outline a typed signature crosses as.
 *
 * In the first subset's units, one em `unitsPerEm` tall and the baseline at the ascender, so the line box runs from 0
 * to the ascender less the descender, y down — the grid's own direction. A subset with another em is scaled to the
 * first. Then the line box and the ink together are scaled onto {@link SIGNATURE_OUTLINE_GRID} on their longer side and
 * rounded: at a 32,767 grid the rounding is a thirty-thousandth of the name's width.
 */
export function setName(face: LoadedFace, text: string): SetName {
  const missing = missingCharacters(face, text);
  if (missing.length > 0) return { kind: 'missing', characters: missing };
  const [first] = face.fonts;
  if (first === undefined) throw new Error(`the ${face.face} signature face has no font`);
  const em = first.unitsPerEm;
  const baseline = first.ascender;

  const letters: string[] = [];
  const raw: number[] = [];
  let across = 0;
  let previous: { readonly font: Font; readonly glyph: Glyph } | undefined;
  for (const character of charactersOf(text)) {
    const found = glyphFor(face, character);
    if (found === undefined) throw new Error('a character the face draws was not found again');
    const scale = em / found.font.unitsPerEm;
    // PAIR KERNING WITHIN ONE SUBSET: a pair split across two files has no table that names it.
    if (previous?.font === found.font) {
      across += found.font.getKerningValue(previous.glyph, found.glyph) * scale;
    }
    // THE GLYPH'S OWN CONTOURS, placed here: moved along by what is already set, and turned y-down with the baseline at
    // the ascender, so the line box starts at the grid's top.
    const origin = across;
    appendPath(found.glyph.path.commands, (x, y) => [origin + x * scale, baseline - y * scale], letters, raw);
    across += (found.glyph.advanceWidth ?? 0) * scale;
    previous = found;
  }
  if (letters.length === 0) return { kind: 'blank' };
  const points = raw.length / 2;
  if (points > MAX_SIGNATURE_OUTLINE_POINTS) return { kind: 'too-long' };

  // THE LINE BOX AND THE INK TOGETHER, so a swash past either edge stays on the grid.
  const frame: readonly [number, number, number, number] = [0, 0, Math.max(across, 1), baseline - first.descender];
  let left = frame[0];
  let top = frame[1];
  let right = frame[2];
  let bottom = frame[3];
  for (let at = 0; at < raw.length; at += 2) {
    const x = raw[at] ?? 0;
    const y = raw[at + 1] ?? 0;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  const unit = SIGNATURE_OUTLINE_GRID / Math.max(right - left, bottom - top);
  const onGrid = (value: number, from: number): number =>
    Math.min(SIGNATURE_OUTLINE_GRID, Math.max(0, Math.round((value - from) * unit)));
  const ops = outlineOpCodes(letters.join(''));
  if (outlinePointsOf(ops) !== points) throw new Error('the outline holds points no operator takes');
  return {
    kind: 'outline',
    outline: {
      ops,
      points: raw.map((value, at) => onGrid(value, at % 2 === 0 ? left : top)),
      frame: [onGrid(frame[0], left), onGrid(frame[1], top), onGrid(frame[2], left), onGrid(frame[3], top)],
    },
  };
}

/**
 * One glyph's commands added to the path, each point through `place`, a subpath at a time. A subpath that draws nothing
 * — a move with no line or curve after it — is left out, which is the path rule the contract checks
 * (`outlineOpsArePath`).
 */
function appendPath(
  commands: readonly PathCommand[],
  place: (x: number, y: number) => readonly [number, number],
  letters: string[],
  points: number[],
): void {
  let pendingLetters: string[] = [];
  let pendingPoints: number[] = [];
  const at = (x: number, y: number): void => {
    pendingPoints.push(...place(x, y));
  };
  const flush = (): void => {
    if (pendingLetters.length > 1) {
      letters.push(...pendingLetters);
      points.push(...pendingPoints);
    }
    pendingLetters = [];
    pendingPoints = [];
  };
  for (const command of commands) {
    if (command.type === 'M') {
      flush();
      pendingLetters.push('M');
      at(command.x, command.y);
    } else if (command.type === 'Z') {
      if (pendingLetters.length > 1) pendingLetters.push('Z');
      flush();
    } else if (pendingLetters.length > 0) {
      pendingLetters.push(command.type);
      if (command.type === 'Q') at(command.x1, command.y1);
      if (command.type === 'C') {
        at(command.x1, command.y1);
        at(command.x2, command.y2);
      }
      at(command.x, command.y);
    }
  }
  flush();
}

/** A typed mark as the page is sent it: its outline made, or why it cannot be. */
export async function outlinedMarkOf(
  mark: TypedSignatureMark,
): Promise<{ readonly kind: 'ready'; readonly mark: OutlinedSignatureMark } | Exclude<SetName, { kind: 'outline' }>> {
  const set = setName(await loadFace(mark.font), mark.text);
  if (set.kind !== 'outline') return set;
  return { kind: 'ready', mark: { kind: 'outlined', text: mark.text, font: mark.font, outline: set.outline } };
}

/**
 * An outline as an SVG path and the box to show it in, on the grid — the dialog's preview, the face list and a kept
 * signature's look, drawn from the very outline the page is given.
 */
export function outlinePath(outline: SignatureOutline): { readonly d: string; readonly viewBox: string } {
  const parts: string[] = [];
  let next = 0;
  let [left, top, right, bottom] = outline.frame;
  const point = (): string => {
    const x = outline.points[next] ?? 0;
    const y = outline.points[next + 1] ?? 0;
    next += 2;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
    return `${String(x)} ${String(y)}`;
  };
  for (const code of outline.ops) {
    const op = OUTLINE_OPS[code];
    if (op === 'M' || op === 'L') parts.push(`${op}${point()}`);
    else if (op === 'Q') parts.push(`Q${point()} ${point()}`);
    else if (op === 'C') parts.push(`C${point()} ${point()} ${point()}`);
    else if (op === 'Z') parts.push('Z');
  }
  return { d: parts.join(''), viewBox: `${String(left)} ${String(top)} ${String(right - left)} ${String(bottom - top)}` };
}
