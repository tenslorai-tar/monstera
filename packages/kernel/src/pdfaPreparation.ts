import { MAX_PDFA_LEFT_OUT, type PdfaLeftOutKind } from '@monstera/contract/host';

import * as mupdf from './mupdfRaw.js';
import { redrawPage } from './pageAnnotations.js';

/**
 * A copy of a document made ready for Ghostscript's PDF/A pass (ADR-0075's 2026-10-13 correction, the owner's N7):
 * each annotation given what PDF/A requires so the converter keeps it, and what cannot be kept removed HERE and named
 * by kind and page, so the person is told what left in our words and never the converter's.
 *
 * ## The rules are Ghostscript's and ISO 19005's, measured rather than recalled
 *
 * - **Non-printing is dropped.** Ghostscript 10.02.1 left out a Popup carrying no `/F` as *"set to non-printing"*
 *   (measured 2026-10-13); ISO 19005-2 6.3.2 requires the Print flag. So a mark shown on screen is given it.
 * - **A pop-up cannot be kept as one.** Given the Print flag, the Popup was written but `pdfwrite` dropped the
 *   comment's `/Popup` and the Popup's `/Parent`, leaving a window tied to nothing. So it is removed and named; the
 *   comment and its text stay, and readers open their own pop-up for a comment.
 * - **A mark hidden from view is removed and named**: PDF/A requires Hidden, Invisible and NoView clear, which would
 *   show it in the archive though it was not shown on screen.
 * - **Sound, Movie, Screen, 3D and RichMedia are forbidden** (6.3.1; RichMedia is not an ISO 32000-1 type).
 * - **A mark with no appearance is given MuPDF's**, since PDF/A requires one (6.3.3).
 *
 * Links and form fields are left as they are: a link needs neither flag nor appearance, and a field's appearance is
 * the forms writer's.
 */
export interface PdfaPreparation {
  /** Marks that were shown on screen and are now also printed, so PDF/A keeps them. */
  readonly printed: number;
  /** Marks that had no appearance and were given MuPDF's. */
  readonly drawn: number;
  /** What was removed, one entry per page and kind with its count, in page order. At most {@link MAX_PDFA_LEFT_OUT}. */
  readonly leftOut: readonly { readonly page: number; readonly kind: PdfaLeftOutKind; readonly count: number }[];
  /** How many removed items lie on entries past {@link MAX_PDFA_LEFT_OUT}: counted, so nothing removed goes unsaid. */
  readonly leftOutMore: number;
}

/** ISO 32000-1 Table 165's flag bits this preparation reads. */
const FLAG = { invisible: 1, hidden: 2, print: 4, noView: 32, toggleNoView: 256 } as const;

/** The subtypes PDF/A refuses outright, by the kind they are named as. */
const FORBIDDEN: Readonly<Record<string, PdfaLeftOutKind>> = {
  Sound: 'sound',
  Movie: 'movie',
  Screen: 'movie',
  RichMedia: 'movie',
  '3D': '3d',
};

/** Left as they are: neither needs what a mark needs, and a field's appearance is the forms writer's. */
const UNTOUCHED = new Set(['Link', 'Widget']);

/** What one annotation dictionary is, decided once for the walk below. */
function verdictOf(annotation: mupdf.PDFObject): PdfaLeftOutKind | 'untouched' | 'mark' {
  const subtype = annotation.get('Subtype');
  const name = subtype.isName() ? subtype.asName() : '';
  if (name === 'Popup') return 'comment-popup';
  const forbidden = FORBIDDEN[name];
  if (forbidden !== undefined) return forbidden;
  if (UNTOUCHED.has(name)) return 'untouched';
  const flags = flagsOf(annotation);
  if ((flags & (FLAG.hidden | FLAG.invisible | FLAG.noView)) !== 0) return 'hidden-mark';
  return 'mark';
}

function flagsOf(annotation: mupdf.PDFObject): number {
  const flags = annotation.get('F');
  return flags.isNumber() ? flags.asNumber() : 0;
}

/**
 * Prepares `document` in place. The caller holds a COPY opened for this and writes it out afterwards; nothing here may
 * run on a document a person has open.
 */
export function prepareForPdfa(document: mupdf.PDFDocument): PdfaPreparation {
  let printed = 0;
  const removed = new Map<string, { page: number; kind: PdfaLeftOutKind; count: number }>();
  const pages = document.countPages();

  for (let page = 0; page < pages; page += 1) {
    const annots = document.findPage(page).get('Annots');
    if (!annots.isArray()) continue;
    // FROM THE END, so a deletion leaves the indices still to visit where they were.
    for (let index = annots.length - 1; index >= 0; index -= 1) {
      const annotation = annots.get(index);
      if (!annotation.isDictionary()) continue;
      const verdict = verdictOf(annotation);
      if (verdict === 'untouched') continue;
      if (verdict === 'mark') {
        annotation.delete('Popup');
        const flags = flagsOf(annotation);
        if ((flags & FLAG.print) === 0 || (flags & FLAG.toggleNoView) !== 0) {
          annotation.put('F', (flags | FLAG.print) & ~FLAG.toggleNoView);
          printed += 1;
        }
        continue;
      }
      annots.delete(index);
      const key = `${String(page)}:${verdict}`;
      const entry = removed.get(key) ?? { page, kind: verdict, count: 0 };
      removed.set(key, { ...entry, count: entry.count + 1 });
    }
  }

  // AFTER THE DICTIONARIES, so MuPDF draws only what stays: an appearance made where a mark has none, through the
  // kernel's one redraw (`redrawPage`, ADR-0103), which keeps a blend and a caret's size as every other redraw does.
  let drawn = 0;
  for (let page = 0; page < pages; page += 1) {
    const loaded = document.loadPage(page);
    const bare = loaded.getAnnotations().filter((annotation) => annotation.getObject().get('AP').isNull());
    if (bare.length === 0) continue;
    // DIRTIED FIRST: an update alone left a mark with no appearance as it was (measured 2026-10-13), because MuPDF
    // synthesises only for an annotation it has marked as changed, and setting its flags to themselves marks it.
    for (const annotation of bare) annotation.setFlags(annotation.getFlags());
    redrawPage(loaded, bare, document);
    drawn += bare.filter((annotation) => !annotation.getObject().get('AP').isNull()).length;
  }

  const ordered = [...removed.values()].sort((a, b) => a.page - b.page);
  const leftOutMore = ordered.slice(MAX_PDFA_LEFT_OUT).reduce((sum, entry) => sum + entry.count, 0);
  return { printed, drawn, leftOut: ordered.slice(0, MAX_PDFA_LEFT_OUT), leftOutMore };
}
