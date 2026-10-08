# ADR-0202 — A whole page may be read by a service when the person chose these pages for an export

- **Status:** Accepted
- **Date:** 2026-10-08
- **Amends:** [ADR-0052](0052-a-second-recogniser-arrives-on-demand-and-reads-a-region.md) Decision 1 — *a network engine reads a
  region only; a network recognition of a whole page is not a value the request type can hold* — and
  [ADR-0118](0118-recognition-on-export-is-a-setting-applied-as-the-searchable-export-applies-it.md), which recognises with
  Tesseract alone before an export.
- **Found by:** the owner's order of 2026-10-08, Step 7: *"I have a handwritten document and I want it to become digital", as Word
  or Excel, for ALL pages at once, without drawing boxes.*

## Context

A handwritten page is read by Claude or Azure, since the local engine that could was removed (ADR-0085). Those engines are
offered for **a region the person dragged**, and ADR-0052 made the whole page unrepresentable on purpose: a network engine sends
what it is given to a service, and a page-scoped request from a surface that did not mean it would send more of the document
than the reader asked about. The rule is right for the OCR dialog's *page* scope and for every automatic path.

It makes a document of forty handwritten pages forty dragged boxes. The person who chose *Export to Word* and *this document is
handwritten*, with Claude as the reader, has asked for the pages to be sent. What the rule protects against is a send nobody
asked for, and there is none here.

## Decision

1. **`ocrPage` may carry `wholePage: true` for a network engine,** instead of a `region`. The contract refuses it for any other
   combination: with a region, with Tesseract (whose whole page is simply no region), or a network engine with neither. The
   request type gains the arm B5 keeps honest — a network engine with `wholePage: true` and no region — so *a network read of a
   whole page* is expressible only by naming it.
2. **Only the handwritten-or-scanned export sends it,** after the dialog has said, beside the choice, that the pages are sent to
   the service named. The OCR dialog's page and document scopes still read with Tesseract alone, and the region tool is
   unchanged.
3. **The page is the region,** taken in the host: `engine/snapshotRegion`'s `rect` becomes optional, and absent is the page's own
   displayed box (`frame.crop`), the same raster and the same frame fields a dragged region returns, so the text lands on the page
   through the one converter.
4. **The export walks the pages, writes the text into the document, and exports from it** — ADR-0118's order, for the same
   reasons: one command per page (ADR-0035), real progress and a Cancel that leaves correct work behind, and a file that is
   written from the document as it now is. The walk is ONE undo step (ADR-0200). A cancelled walk writes no file.
5. **Excel keeps its table reading** (ADR-0086) for a service, because a table is read as cells and not as lines of text. That
   read happens in main while the workbook streams, so it has no per-page walk to step: two small channels give it what the
   walk gives Word — `document.exportProgress` (pages read of pages asked, which the renderer polls while the export is in
   flight) and `document.cancelExport` (a flag main checks between pages, after which the temporary file is removed and the
   export answers `cancelled`). For Tesseract it takes the recognise-first walk of Decision 4. Both nothing but counts and a
   flag: no text, no path.

## Rejected alternatives

- **Dropping the region requirement for every caller.** The check that stopped a stray send would be gone from the OCR dialog and
  anything added after it.
- **A region computed by the renderer.** It does not hold the page's box in PDF user space (`document.pageTextLayer` says so);
  computing it there is the second opinion B3a forbids, and the host holds the frame.
- **Reading the pages inside the export in main and never writing text.** No progress or Cancel the person can use (there is no
  main-side cancellation), and a document the person reads again would ask the service again.

## Consequences

- `ocrPageSchema`, `RecognitionRequest`, the host's `engine/snapshotRegion`, `RegionRequest` and `snapshotRegion`, and the
  composition's network read take the whole-page arm. The reading of **a re-run on a page that already has recognised text** is
  unchanged: it appends another invisible layer (ADR-0198's neighbour finding, stated in the OCR help).
- The Word and Excel dialogs gain the choice; the commands run the walk; the help articles say what is sent.

## Correction, 2026-10-08

The Consequences above say a re-run on a page with recognised text appends another invisible layer. That stopped being true
the same day: `applyOcrPage` now removes the layers Monstera's own reading wrote (a content stream opening `q BT 3 Tr` whose
every font is the glyphless font) before writing a whole-page reading, in the same command and so the same undo step. A
region read still adds to the page, a text the document had before is never removed, and a reading that finds nothing keeps
what the page had. The statement above is kept as written; this is the record that it no longer holds.
