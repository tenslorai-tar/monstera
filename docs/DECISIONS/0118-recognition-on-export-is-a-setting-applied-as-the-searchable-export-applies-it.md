# ADR-0118 — Recognition on export is a setting, applied as the searchable export applies it

- **Status:** Accepted
- **Date:** 2026-09-28
- **Amends:** [ADR-0073](0073-a-table-is-the-engines-table-read-asked-as-its-own-table-writer-asks.md)'s rejected
  alternative *"Recognising image-only pages automatically inside the export"*, for the exports named below and only
  while a person has turned the setting on.
- **Decided by:** the founding record's Part F, *"OCR: … auto-OCR scanned pages on export"* (`BUILD-PROMPT.md`:619-620),
  and the owner's afternoon list of 28 September, item 2.
- **Relates:** the searchable export (`recogniseText.ts`, D6 row 5), whose walk and whose effect on the open document
  this reuses.

## The problem

A scanned page is a picture, so every export that writes a document's **text** writes nothing for it: plain text,
text with its layout, Word. Part F asks for a setting that recognises those pages first.

ADR-0073 refused exactly that for the Excel export, and its reason is the one this decision has to answer rather than
step round: *"Recognition is applied to the document … doing it silently inside an export is the hidden mutation that
row refused."* Recognition here is `ocrPage`, a command on the open document — undoable page by page, and what makes
the searchable export's copy searchable. Writing the text layer into the exported copy alone would need a write path
that does not reach the live session, which is the *which bytes win* question `savePipeline.ts` carries as an open B4.

## Decision

1. **A setting, `ocr.recognise-on-export`, off by default.** Off is the behaviour every export has today, and turning
   it on is the person choosing, in advance and in words, that exports recognise first — which is what separates this
   from the *silent* mutation ADR-0073 refused. Its description says the open document gains the text too.
2. **The exports it reaches are those whose output is the page's text or the document itself:** plain text, text with
   layout, Word, and PDF/A — a PDF/A whose scanned pages carry a text layer is a searchable archive, the searchable
   export's result in the archival form. **Not** PowerPoint and page images, whose output is a picture of each page
   (`presentationDocument.ts`); **not** Excel, where ADR-0073 point 5 measured that a recognised layer reaches the
   table read as an unruled table (0 of 2 whole) — recognising for it would change the open document and the
   workbook not at all.
3. **The walk is the searchable export's, called, never copied** (`recogniseScope`): the image-only pages only, one
   `ocrPage` each, with progress and a cancel in the status bar. The languages are the ones the OCR dialog would open
   on — the stored set's provisioned members, else the first provisioned model — through one function both call.
4. **The effect is the searchable export's: the text stays in the open document, undoable page by page, and is
   reported.** After an export that recognised anything, the recognition outcome says how many pages gained text.
   An export that recognised nothing reports nothing, since nothing changed. A cancelled walk writes no file — half a
   document's scanned pages recognised in a file a person asked to carry the text is the searchable export's refused
   pair — and reports what was done.
5. **A machine with no recognition model exports as it would with the setting off**, since a refusal would put a
   problem dialog in front of an export that can still be written. The release notice declares all fourteen models
   for the installed build (`scripts/release/nativeComponents.json`); that the package carries them is not yet
   observed, because no package has been built, and the test package's installed-only checks are where it is.

## Rejected

- **Recognise into the exported copy only.** The better effect, and the open *which bytes win* B4 answered underneath
  a setting — the failure this project exists to prevent. It remains the route if that B4 is taken.
- **On by default.** An export would then change the open document for a person who never chose it — ADR-0073's
  hidden mutation with a setting beside it.
- **Every export.** Recognition that cannot change the output is a mutation with nothing bought.
- **Ask in each export.** A question before every export is the form ADR-0073 point 4 and `IMAGE_PAGES_SETTING` both
  refused; the searchable export is there for the one-off.

## Consequences

- `docs/ARCHITECTURE.md` has no row naming recognition inside an export, so nothing there changes; the amendment log
  records this, and the ADR index gains the row.
- ADR-0073 carries a dated correction pointing here.
