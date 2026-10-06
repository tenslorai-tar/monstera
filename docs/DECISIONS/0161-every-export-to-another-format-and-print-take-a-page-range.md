# ADR-0161 — Every export to another format, and Print, take a page range

- **Status:** Accepted
- **Date:** 2026-10-04
- **Amends:** [ADR-0074](0074-printing-is-mupdfs-raster-through-the-system-print-dialog-and-gdi.md) Decision 1, whose
  system print dialog was the only place pages were chosen, and the contract channels `document.exportWord`,
  `document.exportPowerPoint`, `document.exportExcel` and `document.exportText` and the host channel `engine/word`, each
  of which converts every page.
- **Decided by:** the owner's answer to cloud-3, item 9d of cloud-4: *"Page range: yes. 'Every page / Select pages' on
  the Word, PowerPoint, Excel and Text exports, and on Print (the owner asked for every export and Print; amend
  ADR-0074 as needed)."*
- **Relates:** the *Export page images* dialog and the second-document dialogs, which already carry the row
  (`PageRangeChoice`); `packages/contract/src/pageSet.ts`, the one wire shape for a set of pages.

## Context

Read on 2026-10-04: Word, PowerPoint, Excel and Text each convert every page at every layer, and PowerPoint and Text
open no dialog at all. Print is the exception. Main already prints the pages a person picks in the Windows print
dialog (`PD_PAGENUMS`, decoded by `chosenPages`), but the application could not say where that choice starts.

## Decision 1 — the four exports carry the pages, required, down to the writer

Each of the four channels takes `pages`, a `PageSet`, and requires it, so a caller cannot forget it and convert
everything. *Every page* is sent as the whole set. Main expands it with `pagesOf`, the rule *Export page images* uses,
and each writer walks only those pages: the Word host's composition (so `engine/word` takes them too), the slides, the
table pages and the service's pages, and the plain text's pages. Layout text is `pdftotext -layout` over the whole
file, so it runs once per run of consecutive pages, `-f` to `-l`, and the parts are joined with the form feed that
already separates its pages.

## Decision 2 — the row is in each export's dialog, and PowerPoint and Text get one

Word's dialog and Excel's review take the row; Excel's review still lets a person look at any page, and the row says
which pages' tables are written. PowerPoint and Text, which opened nothing, open a dialog holding the row (Text's one
dialog serves both of its commands). The row is `PageRangeChoice`, the one the other dialogs use.

## Decision 3 — on Print, the row is where the system dialog STARTS, and the system dialog decides

Two places choosing pages for one print would be two writers. So the application's row is the starting value of the
Windows dialog's own *Pages*: main passes it as the dialog's page ranges with `PD_PAGENUMS` set, the person sees it
there and may change it, and what the system dialog answers is what prints, as before. A choice with more runs than
the dialog's 64 ranges cannot be shown there; main then sets `PD_NOPAGENUMS`, so the system dialog offers no page
choice of its own, and the application's pages print exactly.

## Rejected

- **Optional `pages`, defaulting to everything.** A caller that forgot it would convert the whole document with
  nothing to say it did; required, the omission does not compile.
- **The row on Print instead of the system dialog's choice.** The system dialog would still offer *Pages*, and a
  person who changed it there would print something other than what it showed.
- **A page range only in Settings.** A choice made per export, not a preference.
- **Splitting the PDF to the chosen pages before layout text.** A second writer of a document image for a read, where
  `pdftotext` already takes a first and last page.

## Correction, 2026-10-04, as built

Two sentences above say something other than what was built, and both are corrected here rather than edited.

- **Layout text is ONE `pdftotext` run, not one per run of pages.** It runs from the first chosen page to the last,
  `-f` to `-l`, and keeps the chosen pages by counting the form feeds that end each page (`keptPages` in
  `layoutText.ts`). One run starts one contained converter rather than one per run of pages, and the pages between
  two runs are read and dropped, which costs the converter their text and nothing else. *Every page* passes no
  `-f` or `-l` and is the converter's output unchanged.
- **PowerPoint and both text exports share one dialog BODY, under three declarations.** *Text's one dialog serves both
  of its commands* was the plan; each export has its own dialog title, which a person reads to know which export
  they started, so `exportPages.ts` declares `dialog.export-powerpoint`, `dialog.export-text` and
  `dialog.export-layout-text` over one `ExportPagesBody`, whose only difference is what a page becomes.
