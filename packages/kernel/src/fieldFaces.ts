import { kindOf } from './fieldKind.js';
import { FIELD_FAMILY_MARKER, drawsFieldFamily, familyOfMarker } from './fieldFamily.js';
import { type FieldFace, faceOfFont, parseDefaultAppearance, textColourOf } from './fieldActions.js';
import { type FieldBorderStyle, borderOps, opsText } from './fieldMarks.js';
import { borderStyleOf, borderWidthOf, fieldDictionaryOf, nearest } from './fieldRules.js';
import { type PDFAnnotation, type PDFDocument, type PDFObject, PDFWidget } from './mupdfRaw.js';
import { canDraw, layoutFonts, settersFor } from './textBoxAppearance.js';
import {
  type BoxAlign,
  type BoxLook,
  type Layout,
  type Line,
  type Piece,
  type Typesetter,
  DEFAULT_LOOK,
  appearanceContent,
  layoutBox,
} from './textBoxStyle.js';

/**
 * A form field's value drawn in its real family
 * ([ADR-0229](../../../docs/DECISIONS/0229-a-form-field-in-a-real-font-has-an-appearance-monstera-draws.md)).
 *
 * MuPDF draws a field's value in its three `/DA` faces alone (measured: an embedded font `/DA` names is painted in
 * Helvetica), so a field carrying `/MonsteraFamily` has its value drawn here, by the text box's typesetter, over the
 * appearance MuPDF draws for an EMPTY value: the background, the border and the clip are MuPDF's reading of `/MK` and `/BS`,
 * and only the words are Monstera's. The words go before the base's closing `Q EMC`, inside its clip and the variable-text
 * section a reader's own editing looks for.
 *
 * ## Where it runs
 *
 * In both redraws (`pageAnnotations.ts`): {@link setAside} empties the field before the redraw's one update, which then
 * draws the base, and {@link refaced} puts the value back and draws its words after it, beside a text box's `restyled`. A
 * value changed by a setter is redrawn at once (`fieldWidgets.ts`), and a pdf-lib edit is followed by a redraw of the fields
 * it named (`pdfLibFieldFaces.ts`). A field with no marker is left exactly as its writer drew it.
 */

/** The share of the type size below the baseline the centring of a single line counts: MuPDF's own (measured 11.3 for 14 pt in a 31 pt box). */
const DESCENT = 0.2;
/** The type size a field set to the reader's automatic size starts from before it is fitted. */
const AUTO_START = 12;
/** The smallest an automatic size is fitted down to: past this a value is clipped rather than unreadable. */
const AUTO_FLOOR = 4;

const ALIGN_OF_Q: readonly BoxAlign[] = ['left', 'center', 'right'];

/** The base-14 measure every stream number here is written in: three decimals, as the text box's writer writes them. */
const fixed = (value: number): string => {
  const text = value.toFixed(3).replace(/\.?0+$/u, '');
  return text === '-0' || text === '' ? '0' : text;
};

/** The value a field shows: a dropdown's chosen option by its label where the document lists labels apart from values. */
function shownValue(widget: PDFWidget, kind: string): string {
  const value = widget.getValue();
  if (kind !== 'dropdown') return widget.isPassword() ? '*'.repeat(Array.from(value).length) : value;
  const exports = widget.getOptions(true);
  const labels = widget.getOptions(false);
  const at = exports.indexOf(value);
  return at >= 0 ? (labels[at] ?? value) : value;
}

/** A marked field's words set aside while the engine draws its base: what they say, and its value as the file held it. */
export interface SetAside {
  readonly widget: PDFWidget;
  readonly kind: string;
  readonly family: string;
  /** The words the field shows, read before it was emptied. */
  readonly shown: string;
  /** The field dictionary that holds `/V`, and what it held. */
  readonly field: PDFObject;
  readonly kept: PDFObject;
  /** The border's style, and its colour lifted for the base where that style is drawn here (ADR-0230), else `null`. */
  readonly style: FieldBorderStyle;
  readonly borderColour: PDFObject | null;
}

/**
 * Empties a field in a real family so that the redraw about to run draws MuPDF's appearance for no value — the base the words
 * are drawn on — and answers what was set aside; `undefined` for any other annotation, which the redraw draws as before.
 * The redraw's own `update` is the one that draws the base (ADR-0103: only `redraw` and `redrawPage` call it).
 */
export function setAside(annotation: PDFAnnotation, document: PDFDocument): SetAside | undefined {
  if (!(annotation instanceof PDFWidget)) return undefined;
  const kind = kindOf(annotation);
  if (!drawsFieldFamily(kind)) return undefined;
  const object = annotation.getObject();
  const marker = nearest(object, FIELD_FAMILY_MARKER);
  const real = familyOfMarker(marker.isString() ? marker.asString() : null, kind);
  const style = borderStyleOf(object);
  // DRAWN BY MONSTERA where the field carries a real family or a border that is not solid (ADR-0230 Decision 2): the words
  // of a field with only a style are set in the standard face its `/DA` names, by the same typesetter.
  if (real === null && style === 'solid') return undefined;
  const family = real ?? standardFamilyOf(annotation, document);
  const shown = shownValue(annotation, kind);
  // WORDS THIS PROCESS CANNOT SET are left to the engine, which draws them in the standard face `/DA` names: the text box's
  // one rule (`canDraw`), so a field is never emptied for words nothing then draws (preserve, never drop).
  if (!canDraw(shown, family)) return undefined;
  // THE BORDER COLOUR IS LIFTED with the value where the style is not solid, so MuPDF's base draws no border of its own
  // (measured: with no `/MK /BC` the base is the background and the inset clip alone).
  const characteristics = object.get('MK');
  const borderColour = style !== 'solid' && characteristics.isDictionary() ? characteristics.get('BC') : null;
  if (borderColour !== null && !borderColour.isNull()) characteristics.delete('BC');
  const field = fieldDictionaryOf(object);
  const kept = field.get('V');
  annotation.setTextValue('');
  return { widget: annotation, kind, family, shown, field, kept, style, borderColour: borderColour?.isArray() === true ? borderColour : null };
}

/** Each standard face by the family name the typesetter takes. */
const STANDARD_FAMILY: Readonly<Record<FieldFace, string>> = { helvetica: 'Helvetica', times: 'Times', courier: 'Courier' };

/** The standard family a field's `/DA` names, read through the form's resources as the Properties read reads it. */
function standardFamilyOf(widget: PDFWidget, document: PDFDocument): string {
  const da = nearest(widget.getObject(), 'DA');
  const font = parseDefaultAppearance(da.isString() ? da.asString() : undefined);
  const base = font === undefined ? undefined : document.getTrailer().get('Root', 'AcroForm', 'DR', 'Font', font.resource, 'BaseFont');
  return STANDARD_FAMILY[faceOfFont(base?.isName() === true ? base.asName() : undefined, font?.resource)];
}

/** The look a field's words are drawn in: its family, its `/DA` size and colour, `/Q`, and its border's inset. */
function lookOf(widget: PDFWidget, family: string, size: number): BoxLook {
  const object = widget.getObject();
  const da = nearest(object, 'DA');
  const text = da.isString() ? da.asString() : undefined;
  const colour = textColourOf(text) ?? DEFAULT_LOOK.colour;
  const quadding = nearest(object, 'Q');
  const style = object.get('BS', 'S');
  // A BEVELLED OR INSET BORDER IS DRAWN TWICE AS DEEP, so the words start further in, as MuPDF's own do.
  const deep = style.isName() && (style.asName() === 'B' || style.asName() === 'I');
  return {
    ...DEFAULT_LOOK,
    family,
    size,
    colour,
    align: ALIGN_OF_Q[quadding.isNumber() ? quadding.asNumber() : 0] ?? 'left',
    lineHeight: DEFAULT_LOOK.lineHeight,
    fill: null,
    padding: 1,
    borderWidth: borderWidthOf(object) * (deep ? 2 : 1),
  };
}

/** A single line centred on the box's middle, by MuPDF's own rule: half the box, less the share of the size below the line. */
function centred(layout: Layout, size: number): Layout {
  const first = layout.lines[0];
  if (first === undefined) return layout;
  const shift = layout.height / 2 + (0.5 - DESCENT) * size - first.baseline;
  return { ...layout, lines: layout.lines.map((line) => ({ ...line, baseline: line.baseline + shift })) };
}

/** The widest a laid-out line reaches past its start: how much room a single line needs. */
function needed(layout: Layout, look: BoxLook): number {
  const start = look.padding + look.borderWidth;
  return Math.max(0, ...layout.lines.flatMap((line) => line.pieces.map((piece) => piece.x + piece.width - start)));
}

/**
 * One character in each of `cells` equal cells across the box, centred in its cell: a comb field. A character no typesetter
 * can set makes the whole answer `undefined`, as `layoutBox`'s does.
 */
function combLayout(width: number, height: number, look: BoxLook, value: string, cells: number, setter: Typesetter): Layout | undefined {
  const cell = width / cells;
  const pieces: Piece[] = [];
  for (const [at, character] of Array.from(value).slice(0, cells).entries()) {
    const set = setter.set(character, { family: look.family, bold: false, italic: false }, look.size, false);
    if (set === undefined) return undefined;
    const drawn = set.reduce((sum, piece) => sum + piece.width, 0);
    let x = at * cell + (cell - drawn) / 2;
    for (const piece of set) {
      pieces.push({
        text: piece.text,
        face: piece.face,
        shows: [piece.show],
        colour: look.colour,
        underline: false,
        strike: false,
        highlight: null,
        spacing: 0,
        x,
        width: piece.width,
      });
      x += piece.width;
    }
  }
  const line: Line = { baseline: 0, pieces };
  return centred({ width, height, lines: [line] }, look.size);
}

/**
 * The value laid out as the field shows it — a comb's cells, several lines, or one line, at a fixed or a fitted size — with
 * the look it was laid out in, whose size the stream's `Tf` says.
 */
function layoutOf(
  widget: PDFWidget,
  kind: string,
  family: string,
  value: string,
  width: number,
  height: number,
  setter: Typesetter,
): { readonly look: BoxLook; readonly layout: Layout } | undefined {
  const object = widget.getObject();
  const da = nearest(object, 'DA');
  const stated = parseDefaultAppearance(da.isString() ? da.asString() : undefined)?.size ?? 0;
  const multiline = kind === 'text' && widget.isMultiline();
  const cells = kind === 'text' && widget.isComb() ? widget.getMaxLen() : 0;
  const runs = [{ text: value }];
  const at = (size: number): { readonly look: BoxLook; readonly layout: Layout } | undefined => {
    const look = lookOf(widget, family, size);
    if (cells > 0) {
      const comb = combLayout(width, height, look, value, cells, setter);
      return comb === undefined ? undefined : { look, layout: comb };
    }
    const laid = layoutBox(width, height, look, runs, setter, multiline);
    return laid === undefined ? undefined : { look, layout: multiline ? laid : centred(laid, size) };
  };
  if (stated > 0) return at(stated);
  // THE READER'S AUTOMATIC SIZE (0): from a start the box's height allows, down until the words fit across, or for several
  // lines down the box, never under the floor, where the words are clipped as a reader's are.
  let size = multiline ? AUTO_START : Math.max(AUTO_FLOOR, Math.min(AUTO_START, (height - 4) / 1.2));
  for (;;) {
    const laid = at(size);
    if (laid === undefined) return undefined;
    const { look, layout } = laid;
    const inner = width - 2 * (look.padding + look.borderWidth);
    const fits = multiline ? (layout.lines.at(-1)?.baseline ?? 0) + size * DESCENT <= height : cells > 0 || needed(layout, look) <= inner;
    if (fits || size <= AUTO_FLOOR) return laid;
    size = Math.max(AUTO_FLOOR, size * 0.9);
  }
}

/** The base appearance's own stream dictionary, every entry but its length and filter, with `fonts` as its fonts. */
function streamDictionary(document: PDFDocument, base: PDFObject, fonts: PDFObject): PDFObject {
  const dictionary = document.newDictionary();
  base.forEach((value, key) => {
    const name = String(key);
    if (name !== 'Length' && name !== 'Filter' && name !== 'DecodeParms' && name !== 'Resources') dictionary.put(name, value);
  });
  const resources = document.newDictionary();
  const kept = base.get('Resources');
  if (kept.isDictionary()) {
    kept.forEach((value, key) => {
      if (String(key) !== 'Font') resources.put(String(key), value);
    });
  }
  resources.put('Font', fonts);
  dictionary.put('Resources', resources);
  return dictionary;
}

/**
 * Puts the set-aside value back and draws its words in the field's family over the base the redraw just drew (ADR-0229
 * Decision 2), answering whether it drew. Nothing set aside is nothing to do.
 */
export function refaced(aside: SetAside | undefined, document: PDFDocument): boolean {
  if (aside === undefined) return false;
  const { widget: annotation, kind, family, shown: value, field, kept, style, borderColour } = aside;
  const object = annotation.getObject();
  // PUT BACK THROUGH THE OBJECT, which leaves nothing for the engine to redraw: measured, the next update draws nothing.
  if (kept.isNull()) field.delete('V');
  else field.put('V', kept);
  if (borderColour !== null) object.get('MK').put('BC', borderColour);
  const base = object.get('AP', 'N');
  const box = base.get('BBox');
  if (!base.isStream() || !box.isArray() || box.length !== 4) return false;
  const width = box.get(2).asNumber() - box.get(0).asNumber();
  const height = box.get(3).asNumber() - box.get(1).asNumber();
  const origin = `1 0 0 1 ${fixed(box.get(0).asNumber())} ${fixed(box.get(1).asNumber())} cm`;
  // THE BORDER BY ITS STYLE, after the base's `EMC` and so outside its inset clip, in the box's own space (ADR-0230).
  const colour = borderColour === null ? null : Array.from({ length: borderColour.length }, (_unused, at) => borderColour.get(at).asNumber());
  const border = opsText(borderOps(style, width, height, borderWidthOf(object), colour));
  const framed = border === '' ? '' : `q\n${origin}\n${border}\nQ\n`;
  const content = base.readStream().asString();
  let words = '';
  let fonts: PDFObject | undefined;
  if (value !== '') {
    const { setter, resolver } = settersFor(document);
    const laid = layoutOf(annotation, kind, family, value, width, height, setter);
    if (laid !== undefined) {
      // THE WORDS ARE DRAWN IN THE BOX'S OWN SPACE, with no border or fill of their own: those are the base's and the style's.
      words = `q\n${origin}\n${appearanceContent(laid.layout, { ...laid.look, fill: null, borderWidth: 0 })}Q\n`;
      fonts = layoutFonts(document, laid.layout, resolver);
    }
  }
  const end = content.lastIndexOf('Q\nEMC');
  const inner = end < 0 ? `${content}\n${words}` : `${content.slice(0, end)}${words}${content.slice(end)}`;
  const made = document.addStream(`${inner}${inner.endsWith('\n') ? '' : '\n'}${framed}`, streamDictionary(document, base, fonts ?? document.newDictionary()));
  object.get('AP').put('N', made);
  return true;
}
