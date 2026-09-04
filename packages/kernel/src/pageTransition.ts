import type { CommandOfKind } from '@monstera/contract';
import type { PDFDocument, PDFObject } from 'mupdf';

import type { CaptureResult } from './commandLog.js';
import type { Apply, Invert, MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
import { pagesOf } from './pageScope.js';

/**
 * Presentation transitions — the page's `/Trans` dictionary.
 *
 * ## Why this is MuPDF and not the byte-image writer
 *
 * `/Trans` is an entry in the **page dictionary**, so setting one writes a page
 * attribute in place: `cropPages`' operation with a different key, and
 * `rotatePages`' before that. Nothing is drawn and no content stream is opened,
 * which is what separates it from the three commands routed to
 * `@cantoo/pdf-lib`. *Transitions* sounds like presentation, and grouping by
 * what a feature is called rather than by what it writes is how a page
 * attribute ends up going through a whole-document rewrite.
 *
 * That classification is also why this one is **invertible** where every
 * drawing command is not: the prior state is one small dictionary rather than a
 * page's whole content stream.
 *
 * ## `/S /R` AND NO `/Trans` ARE DIFFERENT DOCUMENTS THAT RENDER IDENTICALLY
 *
 * This is the trap the whole module is arranged around. PDF 32000-1 Table 161
 * gives `/S /R` — *replace* — as the style meaning *no visible transition*, and
 * a page carrying no `/Trans` at all also shows no transition. A reader cannot
 * tell them apart; a producer, a diff and the next command can.
 *
 * So the capture records **absence as a value** ({@link PriorTransition}), and
 * the inverse restores absence by **deleting the key** rather than by writing
 * `/S /R` back. Writing it back renders identically and leaves the document
 * asserting that somebody chose *no transition*, which is the same class of
 * defect `rotatePages` records for a `/Rotate` a page inherited.
 */

/**
 * One entry of a `/Trans` dictionary, in a form the log can hold.
 *
 * **Three scalar kinds, and that is complete for a well-formed `/Trans`.** PDF
 * 32000-1 Table 161 gives the dictionary eight possible entries — `Type`, `S`,
 * `Dm`, `M` (names), `D`, `SS`, `Di` (numbers; `Di` may also be the name
 * `/None`) and `B` (boolean) — and every one of them is a scalar. So a value
 * this cannot express is a `/Trans` the specification does not describe, which
 * is exactly what {@link captureSetPageTransition} refuses rather than
 * silently dropping.
 *
 * **Text was the first shape and it does not work**: MuPDF's JavaScript API
 * offers `newName`, `newReal`, `newString` and `newDictionary` and no
 * string-to-object parser, so a raw dump could be captured and never restored.
 * The type is what it is because of what the authority can take back.
 */
export type PriorTransitionEntry =
  | { readonly key: string; readonly kind: 'name'; readonly value: string }
  | { readonly key: string; readonly kind: 'number'; readonly value: number }
  | { readonly key: string; readonly kind: 'boolean'; readonly value: boolean };

/** A page's own `/Trans` before the command ran (ADR-0009 §3). */
export type PriorTransition =
  | { readonly present: false }
  /**
   * The dictionary's own entries — **all of them, not the two this writes**.
   *
   * A page may carry `/Dm`, `/M` or `/Di` from another producer, and an inverse
   * restoring only `/S` and `/D` would silently drop them: the undo would leave
   * a document neither the user nor the producer ever made. Recording what was
   * there is the only shape that cannot do that.
   */
  | { readonly present: true; readonly entries: readonly PriorTransitionEntry[] };

/** One page's prior own-state, in the order the command named its pages. */
export interface PriorPageTransition {
  readonly page: number;
  readonly prior: PriorTransition;
}

/** The PDF style name each declared style maps to (Table 161). */
const STYLE_NAMES: Readonly<Record<CommandOfKind<'setPageTransition'>['style'], string>> = {
  replace: 'R',
  dissolve: 'Dissolve',
  fade: 'Fade',
  box: 'Box',
  blinds: 'Blinds',
};

/** The page object, refusing an index this document does not have. */
function pageObject(document: PDFDocument, page: number, total: number): PDFObject {
  if (!Number.isInteger(page) || page < 0 || page >= total) {
    throw new RangeError(
      `Page ${String(page)} is outside this document, which has ${String(total)} page(s). ` +
        'Page indices are zero-based.',
    );
  }
  return document.loadPage(page).getObject();
}

/**
 * Reads one page's `/Trans`, as a value that can express absence — or reports
 * the entry it could not record.
 *
 * `null` for the entry means *this dictionary holds something outside Table
 * 161's scalars*, and the caller turns that into a refusal. It is not an
 * error: a `/Trans` carrying an array or a nested dictionary is a document this
 * command cannot undo, and ADR-0009's 2026-08-19 decision is that such a case
 * is an ordinary outcome the bus answers with a checkpoint.
 */
function transitionOf(object: PDFObject): PriorTransition | null {
  // `isNull()` ALONE. MuPDF's `get` answers with a null object rather than
  // `undefined` for a key a dictionary does not have, so an `=== undefined`
  // beside this is a branch the type says cannot run — and lint says so.
  const existing = object.get('Trans');
  if (existing.isNull()) return { present: false };

  const entries: PriorTransitionEntry[] = [];
  // COUNTED, NOT FLAGGED, and the reason is the checker rather than taste: a
  // `let unreadable = false` assigned inside this callback is narrowed to
  // `false` at the point it is read, because TypeScript cannot see that
  // `forEach` ran the closure — so the guard it was written to be became a
  // constant, and lint reported the branch as always falsy. Two counts cannot
  // be narrowed away.
  let seen = 0;
  existing.forEach((value, key) => {
    seen += 1;
    // A NUMERIC KEY means this is an array rather than a dictionary, which is
    // not a `/Trans` at all — it is left uncounted in `entries` and the
    // comparison below refuses it.
    if (typeof key !== 'string') return;
    // NAME BEFORE NUMBER, because `isNumber` is false for a name and the
    // reverse is not something to rely on: the order states which test decides.
    if (value.isName()) entries.push({ key, kind: 'name', value: value.asName() });
    else if (value.isNumber()) entries.push({ key, kind: 'number', value: value.asNumber() });
    else if (value.isBoolean()) entries.push({ key, kind: 'boolean', value: value.asBoolean() });
  });

  // EVERY ENTRY RECOGNISED, or none of it is recordable. A partial capture
  // would produce an inverse that restores some of a dictionary, which is a
  // document neither the user nor the producer made.
  return entries.length === seen ? { present: true, entries } : null;
}

/**
 * Reads every named page's own `/Trans`, before anything is written.
 *
 * Refuses the whole command when one page is out of range — `pageCrop.ts`'s
 * ordering, and for its reason: a capture that recorded four pages and then
 * threw on the fifth would leave the bus holding a prior state for a command
 * that never ran.
 */
export const captureSetPageTransition: (
  session: MupdfSession,
  command: CommandOfKind<'setPageTransition'>,
) => Promise<CaptureResult<readonly PriorPageTransition[]>> = (session, command) =>
  withDocument(session, (document) => {
    const total = document.countPages();
    const captured: PriorPageTransition[] = [];
    for (const page of pagesOf(command.pages, total)) {
      const prior = transitionOf(pageObject(document, page, total));
      if (prior === null) {
        // NOT A THROW. A `/Trans` holding a value Table 161 does not describe is
        // a document, not a caller getting it wrong — so this is the outcome
        // ADR-0009's 2026-08-19 decision put in the type, and the bus answers it
        // with a checkpoint. An out-of-range page still throws, because that is
        // the caller.
        return {
          captured: false,
          reason:
            `page ${String(page)} carries a /Trans entry that is not a name, number or ` +
            `boolean, so its prior state cannot be recorded in a form MuPDF can restore`,
        };
      }
      captured.push({ page, prior });
    }
    return { captured: true, prior: captured };
  });

/**
 * Restores each page's prior `/Trans`, **deleting the key where there was none**.
 *
 * The delete is the whole of §3 on this key: a page that carried no transition
 * must come back carrying none, and writing `/S /R` renders identically while
 * saying something the document never said.
 *
 * Takes prior state and not the command, so an inverse cannot be computed from
 * intent — see {@link Invert}.
 */
export const invertSetPageTransition: Invert<'mupdf', 'setPageTransition'> = (session, inverse) =>
  withDocument(session, (document) => {
    const total = document.countPages();
    for (const { page, prior } of inverse) {
      const object = pageObject(document, page, total);
      if (!prior.present) {
        object.delete('Trans');
        continue;
      }
      const dictionary = document.newDictionary();
      for (const entry of prior.entries) {
        dictionary.put(
          entry.key,
          entry.kind === 'name'
            ? document.newName(entry.value)
            : entry.kind === 'number'
              ? document.newReal(entry.value)
              : document.newBoolean(entry.value),
        );
      }
      object.put('Trans', dictionary);
    }
  });

/**
 * Writes `/S` and `/D` into each named page's `/Trans`.
 *
 * ## Every page is validated before the first is written
 *
 * `pageCrop.ts`'s ordering again: a command naming one page this document does
 * not have changes nothing, rather than transitioning the pages before it and
 * then throwing. Here it matters more than it does for a crop, because a
 * MuPDF session is mutated **in place** — there is no private parse to discard,
 * so a partial write is a document the user is left holding.
 *
 * ## The dictionary is REPLACED, not merged
 *
 * A page carrying `/Dm` and `/M` from another producer, set to `dissolve` —
 * which has neither axis — would otherwise keep entries that mean nothing for
 * the new style, and a later reader would find a dissolve with a dimension.
 * Replacing states exactly what the user chose. What that costs is recorded in
 * {@link PriorTransition}: the inverse restores the whole prior dictionary, so
 * the discarded entries come back on undo.
 */
export const applySetPageTransition: Apply<'mupdf', 'setPageTransition'> = (session, command) =>
  withDocument(session, (document) => {
    const total = document.countPages();
    const pages = pagesOf(command.pages, total);
    const objects = pages.map((page) => pageObject(document, page, total));

    for (const object of objects) {
      const dictionary = document.newDictionary();
      dictionary.put('Type', document.newName('Trans'));
      dictionary.put('S', document.newName(STYLE_NAMES[command.style]));
      dictionary.put('D', document.newReal(command.durationSeconds));
      object.put('Trans', dictionary);
    }
  });
