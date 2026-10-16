import { type PageTransform, pageTransform, snapRotation, toPdf, viewportPoint } from '@monstera/shared';

import { COORDINATE_DECIMALS, SCALE_DECIMALS, contentNumber } from './contentNumbers.js';
import type { PDFDocument, PDFObject } from './mupdfRaw.js';
import { displayedBox } from './pageBoxes.js';
import { wrapContents } from './pageContentWrap.js';
import { freeName, resourceDictionaryOf } from './pageResources.js';
import { faceFont, settersFor } from './textBoxAppearance.js';
import type { SetPiece } from './textBoxStyle.js';

/**
 * Words drawn onto pages by the MuPDF writer — the watermark, the headers and footers and the Bates number
 * ([ADR-0235](../../../docs/DECISIONS/0235-stamps-are-drawn-by-the-mupdf-writer-in-the-text-boxes-faces.md), the owner's L3).
 *
 * ## The words are set by the text box's own typesetter
 *
 * {@link settersFor}: the base 14 where a standard face writes the word in a standard family, the catalogue's faces
 * otherwise, a `□` for a character no face carries. So a stamp in a family is the glyphs a text box in that family is,
 * subset and named by the same code, and Helvetica, Times and Courier stay the faces they always were.
 *
 * ## One appended stream per page, the page's own content bracketed first
 *
 * The page's content is wrapped in `q` … `Q` (`pageContentWrap.ts`), so a matrix or a colour it left set cannot reach the
 * stamp, and the stamp is one stream after it. Its faces and its opacity go into the page's resources under names the
 * page does not already hold (`pageResources.ts`).
 *
 * ## Placed in the page as the reader sees it
 *
 * A point is given from the displayed page's left and top, and taken to user space through the one `PageTransform`, as
 * `pdfLibFrame.ts`' `upright` did; a turn is the reader's, so the page's own `/Rotate` is added to it.
 */
/** One drawing operator, or one that names a resource only {@link PageStamps.finish} gives a name. */
type Op = string | { readonly face: string; readonly size: string } | { readonly opacity: number };

/**
 * What a stamp's stream is, in Monstera's record of it (ADR-0246 Decision 1): the kind a person edits and removes as one,
 * and the settings that drew it, as JSON, for Edit to fill its window with.
 */
export interface StampRecord {
  readonly kind: StampKind;
  readonly settings: string;
}

/** The three kinds of stamp, as the record and `removePageMarks` name them. */
export type StampKind = 'watermark' | 'headerFooter' | 'bates';

/**
 * The marked-content artifact subtype a drawn item carries (ADR-0246 Decision 1): PDF's `/Pagination` artifacts, with
 * PDF 2.0's `/Bates`. A header or footer item takes the edge it sits on.
 */
export type ArtifactSubtype = 'Watermark' | 'Header' | 'Footer' | 'Bates';

/** The record's key in a stamp stream's dictionary. */
export const STAMP_RECORD_KEY = 'MonsteraMark';

/**
 * The key on the two streams that bracket a page's own content for its stamps, `/Open` and `/Close`.
 *
 * The bracket is written ONCE. Every stamp bracketed the whole `/Contents` again until 2026-10-16, earlier stamps
 * included, and a removal leaves brackets where they are (ADR-0246 Decisions 4 and 5), so each add or edit nested the
 * page one `q` deeper for good: the marks walk's C4.3 read one more `q` and `Q` in the page's own content after an edit
 * and a removal than after the first add, and a page stamped often enough would pass the nesting depth readers allow.
 */
export const STAMP_BRACKET_KEY = 'MonsteraStampBracket';

/** The value `key` holds in a stream's dictionary, as a name, or `undefined`. */
function bracketSide(stream: PDFObject): string | undefined {
  if (!stream.isStream()) return undefined;
  const side = stream.get(STAMP_BRACKET_KEY);
  return side.isName() ? side.asName() : undefined;
}

/**
 * Whether `contents` is already this build's bracket around the page's own content with nothing after it but stamps:
 * first an `/Open`, then a `/Close`, and every stream after the last `/Close` a stamp of this build's. Anything else —
 * another tool's content appended after the bracket, or no bracket — is bracketed again, because the stamp must not
 * inherit a state that content left set.
 */
export function bracketedForStamps(contents: PDFObject): boolean {
  if (!contents.isArray() || contents.length < 2) return false;
  if (bracketSide(contents.get(0)) !== 'Open') return false;
  let close = -1;
  for (let at = 0; at < contents.length; at += 1) if (bracketSide(contents.get(at)) === 'Close') close = at;
  if (close < 1) return false;
  for (let at = close + 1; at < contents.length; at += 1) {
    const stream = contents.get(at);
    if (!stream.isStream() || !stream.get(STAMP_RECORD_KEY).isDictionary()) return false;
  }
  return true;
}

/** The PDF name each kind is recorded under. */
export const STAMP_KIND_NAMES: Readonly<Record<StampKind, string>> = { watermark: 'Watermark', headerFooter: 'HeaderFooter', bates: 'Bates' };

/** A colour as the content stream's `rg` takes it, each part 0 to 1. */
export interface StampColour {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export class PageStamps {
  readonly #document: PDFDocument;
  readonly #family: string;
  readonly #record: StampRecord;
  readonly #setters: ReturnType<typeof settersFor>;
  /** Each page's drawing, as operators and the two resources it names, which only `finish` can name. */
  readonly #pages = new Map<number, { readonly ops: Op[]; readonly faces: Set<string>; readonly opacities: Set<number> }>();

  constructor(document: PDFDocument, family: string, record: StampRecord) {
    this.#document = document;
    this.#family = family;
    this.#record = record;
    this.#setters = settersFor(document);
  }

  /**
   * The displayed page `index` and the way from a point on it to user space. A page that displays nothing has no frame to
   * place anything in, which is refused as `pdfLibFrame.ts`' `pageFrame` refused it.
   */
  frame(index: number): PageTransform {
    const object = this.#document.findPage(index);
    const box = displayedBox(object);
    if (box === null) {
      throw new RangeError(
        `page ${String(index)} displays no region — it has no /MediaBox of four numbers, or its /CropBox and /MediaBox ` +
          'do not overlap — so there is no frame to place anything in',
      );
    }
    const rotate = object.getInheritable('Rotate');
    return pageTransform(box, snapRotation(rotate.isNumber() ? rotate.asNumber() : 0), 1);
  }

  /**
   * `text` set at `size` in this stamp's family: its pieces and the width they take. Throws where nothing this process holds
   * can set it, which is a process started without its fonts — never a fact about the person's words, since the resolver
   * draws a character no face carries as the box.
   */
  set(text: string, size: number): { readonly pieces: readonly SetPiece[]; readonly width: number } {
    const pieces = this.#setters.setter.set(text, { family: this.#family, bold: false, italic: false }, size, false);
    if (pieces === undefined) {
      throw new Error(`no face this process holds can set the stamp's words in ${this.#family}; the host was started without its fonts`);
    }
    return { pieces, width: pieces.reduce((sum, piece) => sum + piece.width, 0) };
  }

  /**
   * Draws set words on page `index`, starting at `x` from the displayed page's left with the baseline `fromTop` from its
   * top, turned `turn` degrees counter-clockwise as the reader sees it, in `colour` at `opacity`, marked as the
   * `artifact` it is (ADR-0246).
   */
  draw(
    index: number,
    set: { readonly pieces: readonly SetPiece[] },
    size: number,
    place: {
      readonly x: number;
      readonly fromTop: number;
      readonly turn: number;
      readonly colour: StampColour;
      readonly opacity: number;
      readonly artifact: ArtifactSubtype;
    },
  ): void {
    if (set.pieces.every((piece) => piece.text.trim() === '')) return;
    const frame = this.frame(index);
    const at = toPdf(viewportPoint(place.x, place.fromTop), frame);
    const radians = ((frame.rotation + place.turn) * Math.PI) / 180;
    const scale = (value: number): string => contentNumber(value, SCALE_DECIMALS);
    const coordinate = (value: number): string => contentNumber(value, COORDINATE_DECIMALS);
    const drawn = this.#pages.get(index) ?? { ops: [], faces: new Set<string>(), opacities: new Set<number>() };
    this.#pages.set(index, drawn);

    // MARKED AS WHAT IT IS (ADR-0246 Decision 1): the PDF world's own convention, so another reader knows it is not the
    // page's content and Monstera can find it again.
    drawn.ops.push(`/Artifact <</Type /Pagination /Subtype /${place.artifact}>> BDC`, 'q');
    if (place.opacity < 1) {
      drawn.opacities.add(place.opacity);
      drawn.ops.push({ opacity: place.opacity });
    }
    drawn.ops.push(
      `${scale(place.colour.r)} ${scale(place.colour.g)} ${scale(place.colour.b)} rg`,
      'BT',
      `${scale(Math.cos(radians))} ${scale(Math.sin(radians))} ${scale(-Math.sin(radians))} ${scale(Math.cos(radians))} ${coordinate(at.x)} ${coordinate(at.y)} Tm`,
    );
    for (const piece of set.pieces) {
      // EACH PIECE IN ITS OWN FACE, drawn where the last one ended: a show moves the pen by what it drew.
      drawn.faces.add(piece.face);
      drawn.ops.push({ face: piece.face, size: coordinate(size) }, piece.show);
    }
    drawn.ops.push('ET', 'Q', 'EMC');
  }

  /**
   * Writes every face drawn into the document, then each page's resources and its one appended stream. The placeholders
   * the drawing used for a face and an opacity are replaced by the names this page's resources give them.
   */
  finish(): void {
    const document = this.#document;
    const embedded = this.#setters.resolver?.finish() ?? new Map<string, PDFObject>();
    // ONE OBJECT PER FACE AND PER OPACITY, shared by every page that names it: a base-14 dictionary is built direct and an
    // opacity's state fresh, so writing either per page would put a thousand copies of one object in a thousand-page file.
    const sharedFonts = new Map<string, PDFObject>();
    const fontOf = (face: string): PDFObject => {
      const held = sharedFonts.get(face);
      if (held !== undefined) return held;
      const made = faceFont(document, face, embedded);
      const shared = made.isIndirect() ? made : document.addObject(made);
      sharedFonts.set(face, shared);
      return shared;
    };
    const sharedStates = new Map<number, PDFObject>();
    const stateOf = (opacity: number): PDFObject => {
      const held = sharedStates.get(opacity);
      if (held !== undefined) return held;
      const state = document.newDictionary();
      state.put('Type', document.newName('ExtGState'));
      state.put('ca', opacity);
      state.put('CA', opacity);
      const shared = document.addObject(state);
      sharedStates.set(opacity, shared);
      return shared;
    };
    for (const [index, drawn] of this.#pages) {
      const object = document.findPage(index);
      const fontNames = new Map<string, string>();
      const fonts = resourceDictionaryOf(document, object, 'Font');
      for (const face of drawn.faces) {
        const name = freeName(fonts, 'MonsteraStamp');
        fonts.put(name, fontOf(face));
        fontNames.set(face, name);
      }
      const stateNames = new Map<number, string>();
      if (drawn.opacities.size > 0) {
        const states = resourceDictionaryOf(document, object, 'ExtGState');
        for (const opacity of drawn.opacities) {
          const name = freeName(states, 'MonsteraStamp');
          states.put(name, stateOf(opacity));
          stateNames.set(opacity, name);
        }
      }
      const content = drawn.ops
        .map((op) => {
          if (typeof op === 'string') return op;
          if ('face' in op) return `/${fontNames.get(op.face) ?? ''} ${op.size} Tf`;
          return `/${stateNames.get(op.opacity) ?? ''} gs`;
        })
        .join('\n');
      // THE PAGE'S OWN CONTENT BRACKETED, so nothing it left set reaches the stamp; an empty page has nothing to bracket.
      // ONCE: a page this build already bracketed, with only stamps after the bracket, is not bracketed again.
      if (!bracketedForStamps(object.get('Contents'))) wrapContents(document, object, 'q\n', STAMP_BRACKET_KEY);
      // MONSTERA'S RECORD ON THE STREAM (ADR-0246 Decision 1): the kind and the settings that drew it, where the drawing is.
      const dictionary = document.newDictionary();
      const record = document.newDictionary();
      record.put('Kind', document.newName(STAMP_KIND_NAMES[this.#record.kind]));
      record.put('Settings', document.newString(this.#record.settings));
      dictionary.put(STAMP_RECORD_KEY, record);
      const stamp = document.addStream(new TextEncoder().encode(`\n${content}\n`), dictionary);
      const existing = object.get('Contents');
      const list = document.newArray();
      if (existing.isArray()) for (let at = 0; at < existing.length; at += 1) list.push(existing.get(at));
      else if (!existing.isNull()) list.push(existing);
      list.push(stamp);
      object.put('Contents', list);
    }
  }
}
