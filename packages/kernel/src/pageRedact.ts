import { MAX_REDACT_MATCHES_PER_PAGE, type PdfRedactImages } from '@monstera/contract';
import type * as mupdf from 'mupdf';

import type { CaptureResult } from './commandLog.js';
import type { Apply, MupdfSession } from './engineSeam.js';
import { withDocument, withDocumentRemoving } from './mupdfWriter.js';

/**
 * Burning redact marks into the document — the other half of D3 row 131's mark.
 *
 * ## Every number here is MuPDF's own, and none of them is guessed
 *
 * `PDFPage.applyRedactions(black_boxes, image_method, line_art_method,
 * text_method)`, read from `mupdf/dist/mupdf.js` on 2026-09-12 and executed the
 * same day. The four constants that matter:
 *
 * | | |
 * |---|---|
 * | `REDACT_IMAGE_NONE` | **0 — never used here.** It leaves the covered image pixels in the file, under a black box |
 * | `REDACT_IMAGE_REMOVE` | 1 |
 * | `REDACT_IMAGE_PIXELS` | 2 |
 * | `REDACT_LINE_ART_REMOVE_IF_COVERED` | 1 |
 * | `REDACT_TEXT_REMOVE` | 0 |
 *
 * ## The two that are NOT choices, and why they are not
 *
 * **Text is always removed.** `REDACT_TEXT_NONE` exists and is the failure this
 * command is for: a redaction that draws a box over text a reader can still
 * select. Offering it would be offering the defect.
 *
 * **Line art is always removed if covered.** MuPDF's third option —
 * `REMOVE_IF_TOUCHED` — deletes a path that merely crosses the mark, which
 * takes away content nobody marked; and `NONE` leaves drawn content under the
 * cover. The middle one is the only one that means *this region*.
 *
 * Both are written as constants with the reason beside them rather than as
 * payload fields nobody would know how to set (B5 over a settings page).
 */

/** MuPDF's `pdf_redact_options` values, by the name the binding gives them. */
const IMAGE_METHOD: Readonly<Record<PdfRedactImages, number>> = {
  remove: 1,
  pixels: 2,
};

/** `REDACT_LINE_ART_REMOVE_IF_COVERED`. See the header. */
const LINE_ART_REMOVE_IF_COVERED = 1;

/** `REDACT_TEXT_REMOVE`. See the header — the other value is the defect. */
const TEXT_REMOVE = 0;

/**
 * The page indices a scope names, against a document that knows its own count.
 *
 * `'all'` stays `'all'` on the wire (invariant L11) and becomes a range here,
 * which is the one place the document's page count is known — so nothing
 * upstream has to hold a number that a command running before it could have
 * changed.
 */
function scopedPages(document: mupdf.PDFDocument, pages: 'all' | readonly number[]): number[] {
  const count = document.countPages();
  if (pages === 'all') return Array.from({ length: count }, (_unused, index) => index);
  // REFUSED rather than clamped. A page index this document does not have is a
  // renderer working from a stale count, and silently skipping it would burn in
  // some marks and report that it burned in all of them.
  for (const page of pages) {
    if (page >= count) {
      throw new Error(
        `applyRedactions names page ${String(page)} of a document with ${String(count)} pages.`,
      );
    }
  }
  return [...pages];
}

/**
 * How many redact marks a page carries.
 *
 * Read BEFORE the burn-in, because `applyRedactions` consumes them — measured
 * 2026-09-12: a page with one mark answers zero annotations afterwards. So a
 * count taken after would report every page as having had nothing to do.
 */
function redactMarksOn(page: mupdf.PDFPage): number {
  return page.getAnnotations().filter((annotation) => annotation.getType() === 'Redact').length;
}

/**
 * Burns every redact mark on the scoped pages into the document.
 *
 * **`withDocumentRemoving`**, which is what makes the next serialise collect.
 * §4 puts redaction on the removal row by name, and ADR-0008 rule 1 says why:
 * an incremental save leaves the covered content readable by walking the xref
 * chain. This is the one command where getting that wrong produces a document
 * that looks redacted and is not.
 */
export const applyApplyRedactions: Apply<'mupdf', 'applyRedactions'> = (session, command) =>
  withDocumentRemoving(session, (document) => {
    for (const index of scopedPages(document, command.pages)) {
      const page = document.loadPage(index);
      // A PAGE WITH NO MARKS IS SKIPPED rather than redacted with nothing.
      // `applyRedactions` on a page with no `/Redact` rewrites its content
      // stream for no reason, which on a document-wide pass is every page.
      if (redactMarksOn(page) === 0) continue;
      page.applyRedactions(
        command.cover === 'solid',
        IMAGE_METHOD[command.images],
        LINE_ART_REMOVE_IF_COVERED,
        TEXT_REMOVE,
      );
    }
  });

/**
 * A COUNT IS NOT OFFERED, and this is the record of that rather than an
 * omission.
 *
 * *Burn in 4 marks on 2 pages* is a better confirm sentence than *are you
 * sure*, and it is reachable: this module could count the same annotations the
 * apply walks. What it would cost is a query channel of its own — the session
 * is in the contained host — and what it would buy is a number beside a
 * sentence that already says the thing that matters, which is that the content
 * goes and the undo is a checkpoint.
 *
 * So the dialog names the **scope** and what redaction does, and claims no
 * number it cannot support. The trigger for revisiting it is a second caller:
 * the moment anything else needs to know how many marks a document carries,
 * the channel is owed anyway and this becomes free.
 */

/**
 * Marks every occurrence of a term for redaction.
 *
 * ## The geometry comes from MuPDF's OWN search, and that is not a second
 * opinion
 *
 * `textSearch.ts`'s header records that it deliberately does not call MuPDF's
 * `search`, and gives the reason: the application's search spans line breaks
 * and consumes the one structure that export and extraction also consume. It
 * also records that **the two answer different questions** — *where in this
 * document's text*, as a line and an offset, against *where on this page*, as
 * quads.
 *
 * This is the caller that needs the second question. A mark built from a line
 * and an offset would cover the whole **line**, because the substrate reports
 * no per-character geometry — so a search for a name would redact the sentence
 * around it. Measured 2026-09-12: `page.search` answers a hit whose box is
 * x 46.0–91.5 inside a line whose box is x 20 and 333 wide.
 *
 * ## A hit is a LIST of quads, and each one gets its own mark
 *
 * MuPDF answers one hit as an array of quads, because a match that wraps is two
 * boxes on two lines. Marking the union of them would cover everything between,
 * which on a wrap is the right-hand end of one line and the left of the next —
 * and everything in between is the rest of both.
 */
export const applyMarkMatchesForRedaction: Apply<'mupdf', 'markMatchesForRedaction'> = (
  session,
  command,
) =>
  withDocument(session, (document) => {
    for (const index of scopedPages(document, command.pages)) {
      const page = document.loadPage(index);
      const hits = page.search(command.query, MAX_REDACT_MATCHES_PER_PAGE);
      if (hits.length >= MAX_REDACT_MATCHES_PER_PAGE) {
        // REFUSED, NOT TRUNCATED, and nothing is marked on this page. MuPDF
        // answers up to `max_hits` and says nothing about whether it stopped,
        // so a full result and a capped one are the same value — and for a
        // redaction, *some matches were not marked* is the failure the feature
        // exists to prevent. Marking a prefix would report success.
        throw new Error(
          `page ${String(index)} carries at least ${String(MAX_REDACT_MATCHES_PER_PAGE)} ` +
            `matches for this term, which is the point past which this build cannot tell a ` +
            `complete result from a truncated one. Nothing was marked.`,
        );
      }
      for (const hit of hits) {
        for (const quad of hit) {
          const annotation = page.createAnnotation('Redact');
          // THE QUAD'S OWN BOUNDS. MuPDF answers eight numbers — four corners,
          // upper-left first — and a `/Redact` takes a rectangle, so the mark
          // is the box that contains the quad. On an unrotated page they are
          // the same four numbers; on a rotated one the containing box is what
          // a rectangle can say.
          const xs = [quad[0], quad[2], quad[4], quad[6]];
          const ys = [quad[1], quad[3], quad[5], quad[7]];
          annotation.setRect([
            Math.min(...xs),
            Math.min(...ys),
            Math.max(...xs),
            Math.max(...ys),
          ]);
          annotation.update();
        }
      }
    }
  });

/**
 * Reports that marking by search has no prior state worth recording.
 *
 * `addAnnotation` inverts because it adds exactly one annotation and knows
 * where. This adds as many as the document has matches, and an inverse would
 * have to name every one of them in a walk its own creation moved — which is
 * `deleteFormFields`' shape without its bound.
 */
export const captureMarkMatchesForRedaction = (
  session: MupdfSession,
): Promise<CaptureResult<never>> =>
  withDocument(session, () => ({
    captured: false,
    reason:
      'marking by search adds one annotation per match, and an inverse would have to name every ' +
      'one of them in a walk the creation itself moved',
  }));

/** Refuses to invert, for {@link captureMarkMatchesForRedaction}'s reason. */
export const invertMarkMatchesForRedaction = (): never => {
  throw new Error(
    'markMatchesForRedaction is declared non-invertible. Undo restores the checkpoint.',
  );
};

/**
 * Reports that a burn-in's prior state is not recorded.
 *
 * **The one refusal in this codebase where recording would be the defect.**
 * Every other `captured: false` here is about size; this is about what the
 * prior state *is* — the content somebody asked to have removed. A capture is
 * serialised into main's command log, so recording it would put the redacted
 * text back in memory under a command whose whole purpose was taking it out.
 */
export const captureApplyRedactions = (session: MupdfSession): Promise<CaptureResult<never>> =>
  withDocument(session, () => ({
    captured: false,
    reason:
      'a burned-in redaction cannot be recorded as prior state: the prior state is the content ' +
      'that was removed, and a capture is serialised into the command log',
  }));

/**
 * Refuses to invert, for {@link captureApplyRedactions}'s reason.
 *
 * `CommandPrior['applyRedactions']` is `never`, so this is unreachable by
 * construction and exists because the spec table requires the member.
 */
export const invertApplyRedactions = (): never => {
  throw new Error(
    'applyRedactions is declared non-invertible: its prior state is the content it removed, ' +
      'which must never reach the command log. Undo restores the checkpoint.',
  );
};
