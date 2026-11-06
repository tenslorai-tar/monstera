import type { PDFDocument, PDFObject } from './mupdfRaw.js';

import { contentNumber } from './contentNumber.js';
import { engravedOnSave } from './pageAnnotations.js';

/**
 * A placed signature, picture or barcode, drawn by the page in a file a person keeps
 * ([ADR-0287](../../../docs/DECISIONS/0287-a-saved-file-draws-a-placed-signature-picture-or-barcode-as-part-of-the-page.md)).
 *
 * Some PDF readers draw only the page's content, so a mark living in an annotation's appearance is invisible in them
 * (the owner's phone, 2026-11-06). Which annotations are drawn this way is {@link engravedOnSave}'s answer, Monstera's
 * own kinds only; this module decides nothing about that and reads nothing else.
 *
 * ## For one save, then put back
 *
 * {@link savedEngraved} engraves the LIVE document, lets `save` write its bytes, and restores every page key it changed
 * in a `finally`, `savedWithoutOutline`'s shape. So the session keeps the layer: the item still moves, resizes and undoes
 * after a save, and the next save engraves it again from the layer, once. What this adds (a content stream or two, a
 * resource dictionary per page) is left unreferenced in memory afterwards, and the next collecting save drops it.
 *
 * ## What a page becomes
 *
 * `/Contents` is `[q, the page's own streams, Q and q cm Do Q per mark]`. The leading `q` and the `Q` undo whatever
 * graphics state the page's content leaves behind, so a page that ends inside a `cm` still draws each mark where its
 * layer was. No stream the page already had is edited, so a stream shared with another page is unchanged there.
 * `/Resources` is a fresh dictionary for this page, a shallow copy of the one it used (its own, or one inherited from
 * the page tree), with a fresh `/XObject` naming each mark's appearance under a name no other resource already uses:
 * a dictionary shared with another page is never written to. The annotation leaves `/Annots`.
 *
 * The `cm` is the format's own mapping of an appearance onto its annotation (ISO 32000-1 §12.5.5): the form's `/BBox`
 * through its `/Matrix`, fitted to `/Rect`. `Do` applies the form's `/Matrix` itself, so a mark that counter-rotates on a
 * turned page draws upright, and `/Rect` is in the same default user space as the content, so a CropBox off zero needs
 * nothing. An annotation's own `/CA` is carried as an `ExtGState`.
 *
 * ## What is left a layer
 *
 * A mark with no appearance or no rectangle, one hidden or not for viewing (`/F` bits 2 and 6), and one another
 * annotation replies to (`/IRT`), whose reply would otherwise point at nothing. Each stays exactly as it was.
 */

/** `/F` bits that keep an annotation from being drawn on screen: Hidden (2) and NoView (6), ISO 32000-1 §12.5.3. */
const NOT_SHOWN = (1 << 1) | (1 << 5);

/** The prefix of the names this module gives the marks it draws, in a page's `/XObject` and `/ExtGState`. */
const PREFIX = 'MonsteraEngraved';

/** How many marks a save drew by the page, and on how many pages, for the measurement and the cases. */
export interface Engraved {
  readonly marks: number;
  readonly pages: number;
}

/**
 * `save`'s answer for `document` with every mark {@link engravedOnSave} names drawn by its page, the document put back
 * exactly as it was afterwards, whatever `save` did.
 */
export function savedEngraved<T>(document: PDFDocument, save: () => T): { readonly saved: T; readonly engraved: Engraved } {
  const restore: (() => void)[] = [];
  try {
    const engraved = engrave(document, restore);
    return { saved: save(), engraved };
  } finally {
    for (const step of restore.reverse()) step();
    // MUPDF'S SAVE SYNCED EVERY OPEN PAGE TO THE ARRAY THIS REMOVED THE MARKS FROM, and opening a page again answers the
    // same page, so without this the session lists none of them and none can be selected until the document closes.
    if (restore.length > 0) document.syncOpenPages();
  }
}

/**
 * Engraves `document` for good, with nothing put back: for a document nothing else holds, such as the pages an
 * extraction just built.
 */
export function engraveForGood(document: PDFDocument): Engraved {
  return engrave(document, []);
}

function engrave(document: PDFDocument, restore: (() => void)[]): Engraved {
  let marks = 0;
  let pages = 0;
  const count = document.countPages();
  for (let index = 0; index < count; index += 1) {
    const page = document.findPage(index);
    const annots = page.get('Annots');
    if (!annots.isArray()) continue;
    const listed: PDFObject[] = [];
    annots.forEach((each) => {
      listed.push(each);
    });
    const replied = new Set<number>();
    for (const each of listed) {
      const target = each.get('IRT');
      if (target.isIndirect()) replied.add(target.asIndirect());
    }
    const drawn = listed.filter((each) => engravedOnSave(each) && drawable(each) && !(each.isIndirect() && replied.has(each.asIndirect())));
    if (drawn.length === 0) continue;

    // THE PAGE'S OWN KEYS, as they were, so the restore puts back exactly these (an absent key is deleted again).
    const own = { contents: page.get('Contents'), resources: page.get('Resources'), annots };
    restore.push(() => {
      for (const [key, value] of [
        ['Contents', own.contents],
        ['Resources', own.resources],
        ['Annots', own.annots],
      ] as const) {
        if (value.isNull()) page.delete(key);
        else page.put(key, value);
      }
    });

    const used = page.getInheritable('Resources');
    const resources = shallowCopy(document, used);
    const xobjects = shallowCopy(document, used.isDictionary() ? used.get('XObject') : used);
    const states = shallowCopy(document, used.isDictionary() ? used.get('ExtGState') : used);
    let drawing = 'Q\n';
    let withState = false;
    for (const annotation of drawn) {
      const appearance = annotation.get('AP').get('N');
      const name = freeName(xobjects, used);
      xobjects.put(name, appearance);
      const opacity = annotation.get('CA');
      let state = '';
      if (opacity.isNumber() && opacity.asNumber() < 1) {
        const gs = freeName(states, used);
        const dictionary = document.newDictionary();
        dictionary.put('CA', document.newReal(opacity.asNumber()));
        dictionary.put('ca', document.newReal(opacity.asNumber()));
        states.put(gs, dictionary);
        state = `/${gs} gs `;
        withState = true;
      }
      drawing += `q ${state}${placement(annotation, appearance).map(contentNumber).join(' ')} cm /${name} Do Q\n`;
      marks += 1;
    }
    resources.put('XObject', xobjects);
    if (withState) resources.put('ExtGState', states);

    const contents = document.newArray();
    contents.push(document.addStream('q\n', document.newDictionary()));
    if (own.contents.isArray()) {
      own.contents.forEach((stream) => {
        contents.push(stream);
      });
    } else if (!own.contents.isNull()) {
      contents.push(own.contents);
    }
    contents.push(document.addStream(drawing, document.newDictionary()));
    page.put('Contents', contents);
    page.put('Resources', resources);

    const kept = document.newArray();
    for (const each of listed) if (!drawn.includes(each)) kept.push(each);
    if (kept.length === 0) page.delete('Annots');
    else page.put('Annots', kept);
    pages += 1;
  }
  return { marks, pages };
}

/** Whether the annotation can be drawn by the page as its layer drew it: an appearance, a rectangle, and shown. */
function drawable(annotation: PDFObject): boolean {
  const flags = annotation.get('F');
  if (flags.isNumber() && (flags.asNumber() & NOT_SHOWN) !== 0) return false;
  const rect = annotation.get('Rect');
  const appearance = annotation.get('AP').get('N');
  return rect.isArray() && rect.length === 4 && appearance.isStream() && appearance.get('BBox').isArray();
}

/** The `cm` that puts `appearance` onto `annotation`'s `/Rect`: ISO 32000-1 §12.5.5's matrix A. */
function placement(annotation: PDFObject, appearance: PDFObject): [number, number, number, number, number, number] {
  const [q0 = 0, q1 = 0, q2 = 0, q3 = 0] = numbers(annotation.get('Rect'));
  const [r0, r1, r2, r3] = [Math.min(q0, q2), Math.min(q1, q3), Math.max(q0, q2), Math.max(q1, q3)];
  const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = numbers(appearance.get('BBox'));
  const matrix = appearance.get('Matrix');
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = matrix.isArray() && matrix.length === 6 ? numbers(matrix, 6) : [1, 0, 0, 1, 0, 0];
  const corners = [
    [b0, b1],
    [b2, b1],
    [b2, b3],
    [b0, b3],
  ].map(([x = 0, y = 0]) => [a * x + c * y + e, b * x + d * y + f] as const);
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sx = x1 - x0 === 0 ? 1 : (r2 - r0) / (x1 - x0);
  const sy = y1 - y0 === 0 ? 1 : (r3 - r1) / (y1 - y0);
  return [sx, 0, 0, sy, r0 - sx * x0, r1 - sy * y0];
}

function numbers(array: PDFObject, length = 4): number[] {
  return Array.from({ length }, (_, at) => {
    const value = array.get(at);
    return value.isNumber() ? value.asNumber() : 0;
  });
}

/** A new dictionary holding `from`'s entries, or an empty one where `from` is no dictionary. */
function shallowCopy(document: PDFDocument, from: PDFObject): PDFObject {
  const copy = document.newDictionary();
  if (from.isDictionary()) {
    from.forEach((value, key) => {
      copy.put(String(key), value);
    });
  }
  return copy;
}

/** A name `into` does not hold and no resource category of `used` uses, so no name the page already has is shadowed. */
function freeName(into: PDFObject, used: PDFObject): string {
  for (let at = 1; ; at += 1) {
    const name = `${PREFIX}${String(at)}`;
    if (!into.get(name).isNull() || usedIn(used, name)) continue;
    return name;
  }
}

/** Whether any resource category of `used` (its `/XObject`, `/ExtGState`, `/Font` …) holds `name`. */
function usedIn(used: PDFObject, name: string): boolean {
  if (!used.isDictionary()) return false;
  const categories: PDFObject[] = [];
  used.forEach((category) => {
    categories.push(category);
  });
  return categories.some((category) => category.isDictionary() && !category.get(name).isNull());
}
