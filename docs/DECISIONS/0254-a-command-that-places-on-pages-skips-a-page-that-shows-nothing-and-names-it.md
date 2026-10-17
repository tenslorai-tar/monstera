# ADR-0254 — A command that places on pages skips a page that shows nothing, and names it

- **Status:** Accepted
- **Date:** 2026-10-17
- **Amends:** `docs/ARCHITECTURE.md` §5 (an engine read, `engine/pages-showing-nothing`, and a required field of
  `document.execute`'s answer, `skippedPages`).
- **Decided by:** the owner's decision of 2026-10-17 (PPPPPPP-12, option a): stamp every page that has an area, and
  say which pages were not stamped.

## What it replaces

Since `8f322ba7` (CR-COR-01) a header and footer, Bates numbers, a watermark and a page background place what they draw
on the page as the reader sees it, through `pageBoxes.ts`' `displayedBox`. A page that displays nothing — no `/MediaBox`
of four numbers, or a `/CropBox` that does not overlap it — has no frame to place anything in, and each of the four
refused the whole command naming that page. One such page in a long document stopped every other page being stamped:
a person refused because of their document, against the owner's principle.

## Decision

1. **The four commands stamp every target page that displays something, and leave a page that displays nothing as it
   is.** Each writer asks `displayedBox` of the page, as now; where it answers nothing, the page is skipped rather than
   the command refused. Where every target page displays nothing there is nothing to stamp, and the command is refused
   as before, naming the first page.
2. **Which pages were skipped is read in the document's lane before the command runs**, by one engine read,
   `engine/pages-showing-nothing`, on the MuPDF session every open document has, asking the same `displayedBox` of each
   target page. The writers and the read take the one rule (B3a); the read and the write are in one lane entry, so they
   see the same bytes.
3. **`document.execute` answers `skippedPages`**, the zero-based pages left as they were, required and empty for every
   other command, as `unsealedCopies` is (ADR-0178): a renderer cannot satisfy a required field by not reading it.
4. **The renderer says so**, once, in a notice naming the pages as the person counts them, from one.

## Rejected

- **Carrying the skipped pages out of each writer's answer.** The MuPDF writer's drawn result could carry them, as it
  carries `moved` (ADR-0249), but the page background is a pdf-lib command, whose apply answers bytes alone; carrying a
  note out of it changes every pdf-lib command's signature for one of them.
- **The renderer working out the pages from the view model.** The view model's sizes are MuPDF's own page bounds, a
  second rule about what a page displays; the renderer would name pages by a rule the writers do not take.
- **Refusing, as before.** The owner's principle.

## Correction, 2026-10-17 — the read is a field of the geometry read, not a channel of its own

Decision 2 named a new engine read, `engine/pages-showing-nothing`. What was built is a field, `showsNothing`, on the
existing `engine/page-geometry` read, which already walks the same pages on the same MuPDF session in windows of
`ENGINE_GEOMETRY_MAX_PAGES`; `pageGeometry.ts` answers it from `displayedBox`, the rule the four writers take, so
Decision 2's one-rule property holds unchanged. A second channel would have been a second walk of the page tree with
its own bound and its own schema for the same pages. Everything else in the decision is built as written.

## Correction, 2026-10-17, later — the field is each page's box, not a flag

ADR-0255's tiled read needs each page's displayed box in user space to build its transform. Rather than a second field
beside `showsNothing`, which a host could answer in disagreement with it, the geometry read answers `boxes`: each page's
`displayedBox`, or null where it displays nothing. A stamp leaves the pages whose box is null. The rule is unchanged.
