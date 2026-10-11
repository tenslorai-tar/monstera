import { MAX_FONT_FAMILIES, MAX_FONT_FAMILY_NAME } from '@monstera/contract';

import { BoundedList } from './boundedList.js';
import type { MupdfSession } from './engineSeam.js';
import type { PDFDocument, PDFObject } from './mupdfRaw.js';
import { withDocument } from './mupdfWriter.js';

/**
 * Every font the document names, for the one font picker's *In this document* group (the owner's B2.8): the fonts of every
 * page's resources, of the form XObjects those draw, and of the form's default resources, by the name each states.
 *
 * ## The name a font STATES, subset tag and all
 *
 * The picker strips a subset's tag and says the font is partial (`FontPicker.tsx`), so the tag travels as the document
 * wrote it and is decided in one place. A font with no `/BaseFont` names nothing a person could choose and is left out.
 *
 * ## Bounded, and says so
 *
 * {@link MAX_FONT_FAMILIES} names, the picker's own list bound, and a walk that stopped there says it stopped. Form
 * XObjects are followed to {@link MAX_FORM_DEPTH} and each once, so a form that draws itself ends the walk rather than the
 * host.
 */

/** How deep a form XObject drawing a form XObject is followed: past any real document, short of a crafted cycle's cost. */
const MAX_FORM_DEPTH = 8;

/** One font the document names, as the picker lists it. */
export interface DocumentFontName {
  readonly name: string;
  /** Whether its name carries a subset tag: it holds only the characters the document uses. */
  readonly partial: boolean;
}

/** The fonts, and whether the walk stopped at its bound. */
export interface ListedDocumentFonts {
  readonly fonts: readonly DocumentFontName[];
  readonly truncated: boolean;
}

/** A subset's tag, six capitals and a plus (PDF 32000-1, 9.6.4). */
const SUBSET_TAG = /^[A-Z]{6}\+/u;

function resolved(object: PDFObject): PDFObject {
  return object.isNull() ? object : object.resolve();
}

/**
 * Reads every font name the document's pages, their forms and its form fields name, each once, in the order first met.
 *
 * @param bound every caller passes none; a case passes a small one to reach the stop on a small document
 */
export function readDocumentFonts(session: MupdfSession, bound = MAX_FONT_FAMILIES): Promise<ListedDocumentFonts> {
  return withDocument(session, (document) => fontsOf(document, bound));
}

function fontsOf(document: PDFDocument, bound: number): ListedDocumentFonts {
  const fonts = new BoundedList<DocumentFontName>(bound);
  const named = new Set<string>();
  /** Objects already walked, by number: a resource dictionary shared by every page is read once. */
  const visited = new Set<number>();
  const take = (font: PDFObject): void => {
    const base = resolved(resolved(font).get('BaseFont'));
    if (!base.isName()) return;
    const name = base.asName().slice(0, MAX_FONT_FAMILY_NAME);
    // ROOM IS ASKED ONLY FOR A NAME NOT YET LISTED, so a document naming exactly the bound's fonts is not called cut short.
    if (name === '' || named.has(name) || !fonts.room()) return;
    named.add(name);
    fonts.add({ name, partial: SUBSET_TAG.test(name) });
  };
  const walk = (resources: PDFObject, depth: number): void => {
    const dictionary = resolved(resources);
    if (!dictionary.isDictionary()) return;
    if (resources.isIndirect()) {
      if (visited.has(resources.asIndirect())) return;
      visited.add(resources.asIndirect());
    }
    const fontDictionary = resolved(dictionary.get('Font'));
    if (fontDictionary.isDictionary()) fontDictionary.forEach((value) => {
      take(value);
    });
    if (depth >= MAX_FORM_DEPTH) return;
    const xobjects = resolved(dictionary.get('XObject'));
    if (!xobjects.isDictionary()) return;
    xobjects.forEach((value) => {
      const form = resolved(value);
      // THE REFERENCE IS ASKED, never the dictionary it resolves to: MuPDF's `pdf_is_stream` answers only for an indirect
      // object, so the resolved dictionary of every form reads as no stream and the walk would skip them all.
      if (!value.isStream() || resolved(form.get('Subtype')).asName() !== 'Form') return;
      if (value.isIndirect()) {
        if (visited.has(value.asIndirect())) return;
        visited.add(value.asIndirect());
      }
      walk(form.get('Resources'), depth + 1);
    });
  };
  const pages = document.countPages();
  for (let at = 0; at < pages && !fonts.answer().truncated; at += 1) {
    walk(document.findPage(at).getInheritable('Resources'), 0);
  }
  // THE FORM'S DEFAULT RESOURCES: the fonts a field is drawn in are the document's too.
  walk(document.getTrailer().get('Root', 'AcroForm', 'DR'), 0);
  const { items, truncated } = fonts.answer();
  return { fonts: items, truncated };
}
