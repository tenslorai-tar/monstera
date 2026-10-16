import { PDFDocument, ParseSpeeds } from '@cantoo/pdf-lib';

import type { ByteImage } from './engineSeam.js';

/**
 * The one way a byte-image command opens a document with `@cantoo/pdf-lib`.
 *
 * ## `updateMetadata: false`, and it is what makes `reproducible: true` TRUE
 *
 * pdf-lib defaults to `updateMetadata: true`, which rewrites `/ModDate` and
 * `/Producer` on every save. A command that declares `reproducible: true` and
 * loads with the default is **mis-declared**: re-running it against the same
 * document produces different bytes, and §3a's replay reads that declaration.
 *
 * Measured 2026-09-07 with two applies separated by 1.1 seconds:
 *
 * | command | same bytes | `/ModDate` |
 * |---|---|---|
 * | `generateToc` (unpinned) | **no** | `172400Z` → `172401Z` |
 * | `insertImagePage` (unpinned) | **no** | `172401Z` → `172402Z` |
 * | `watermarkPages` (pinned) | yes | `172402Z` → `172402Z` |
 *
 * ## Why a function rather than a rule, and a rule as well
 *
 * The knowledge was already in this repository and had already been paid for:
 * `docs/FEATURES.md`'s watermark row records that `updateMetadata: false` is
 * what makes its `reproducible: true` true, and that **the byte-equality case
 * cannot see the stamp**, because two saves normally land inside one clock
 * tick. Four call sites had the flag and two did not — the class was left while
 * the instance was fixed, which is Rule 0's *fix the class, not the instance*.
 *
 * So the choice is a name rather than a paragraph somebody has to read and
 * reject (QQQ-3), and `monstera/no-unpinned-pdf-load` makes the bare form
 * unavailable rather than discouraged — because a helper sitting beside a legal
 * inline call is the same trap one step on.
 *
 * ## Loaded for an incremental update (ADR-0127)
 *
 * A command's result is its input with one revision appended, written by
 * {@link appendRevision}: a whole rewrite of a 127,082-object document costs
 * 192–239 s where the append costs a fraction of the load, and ADR-0008's
 * conditions 2, 3 and 5 were executed before it was allowed. `commit()` refuses a
 * document not loaded this way, so the two helpers are one route.
 *
 * ## Parsed without a timer wait every 100 objects
 *
 * `parseSpeed` defaults to `ParseSpeeds.Slow`, a zero-delay timer per hundred objects parsed — the reading half of
 * {@link WITHOUT_YIELDS}' mechanism. Pinned for the measurement `monstera/no-unpinned-pdf-load` carries.
 */
export function openForWriting(image: ByteImage): Promise<PDFDocument> {
  // NO EXEMPTION AND NO DISABLE. This call pins the flag, so it passes the rule
  // on its own merits — unlike `geometry.ts` under `no-bare-y-flip`, where the
  // legal spelling is textually identical to the banned one and a file
  // exemption is the only thing that separates them.
  return PDFDocument.load(image, { updateMetadata: false, forIncrementalUpdate: true, parseSpeed: ParseSpeeds.Fastest });
}


/**
 * The one way a pdf-lib command writes its result: the input, byte for byte, with one revision appended (ADR-0127).
 *
 * ## A form is the caller's to refresh
 *
 * `save()` regenerates the appearance of every field a command changed; the incremental route turns that off
 * (pdf-lib forces `updateFieldAppearances: false` there), so a command that creates or changes a field calls the
 * form's `updateFieldAppearances()` before this. A command that never asks for the form has nothing to refresh, and
 * asking for it here would create an `/AcroForm` in every document.
 *
 * @param options `useObjectStreams: false` where a reader of the result needs a classic cross-reference table
 */
export function appendRevision(document: PDFDocument, options: { readonly useObjectStreams?: boolean } = {}): Promise<Uint8Array> {
  return document.commit({ ...(options.useObjectStreams === undefined ? {} : { useObjectStreams: options.useObjectStreams }), ...WITHOUT_YIELDS });
}

/**
 * pdf-lib writes WITHOUT handing the event loop back every 50 objects (`objectsPerTick`, its default 50).
 *
 * Each hand-back is a `setTimeout(0)`, and on Windows a timer is not due before the clock's next tick: measured on the
 * Windows build machine (KKKKKKKK-2, 2026-10-15), 7,178 objects saved in 3,963–4,194 ms with the default and in
 * 129–138 ms without it, about 28 ms a wait. Everything that writes with pdf-lib here runs in a host process or a test,
 * where no screen waits on the loop between two objects, so the waits are pure cost; a large CSV import paid it on every
 * part it composed. Spread into every pdf-lib serialisation, which `pdfLibSession.test.ts` holds to this module.
 */
const WITHOUT_YIELDS = { objectsPerTick: Number.POSITIVE_INFINITY } as const;

/**
 * The one way a pdf-lib document is written WHOLE — a new document a host composed, or a test's fixture — without
 * the timer yields ({@link WITHOUT_YIELDS}). A command's result is {@link appendRevision}'s instead.
 */
export function wholeFile(document: PDFDocument, options: { readonly useObjectStreams?: boolean } = {}): Promise<Uint8Array> {
  return document.save({ ...(options.useObjectStreams === undefined ? {} : { useObjectStreams: options.useObjectStreams }), ...WITHOUT_YIELDS });
}
