# ADR-0247 — Page pixels are held for the pages in use, under one memory limit

- **Status:** Accepted
- **Date:** 2026-10-15
- **Amends:** [ADR-0129](0129-an-open-documents-view-lives-until-it-closes.md) as corrected for item 13c (what a page on
  show holds), and `PageList.tsx`'s margin of one viewport either side.
- **Decided by:** the owner's cloud run 4, item 13d, and addendum 4's item 7: *"one app-wide memory limit (Automatic =
  25% of physical memory, adjustable in Settings); only pages in use are cached, plus one page ahead; thumbnails and
  search data are made on first use. Set no absolute figures."* The model is PDF-XChange's documented one. The shapes
  below are this run's.

## Where it stood

Item 13d's first part (`41dd18df`) capped page draws at two at once and gave a minimised window's pages back after
30 s; item 13c gave back a tab's pages while it is behind. The page on show still mounted a canvas for every page
within one viewport of the screen, either side: up to three screens of page pixels. Nothing counted those pixels and
nothing could limit them, so the run file's "one budget" had no place to live.

## Decision

1. **A page's canvas is mounted while the page is IN USE: on screen, or the one page ahead.** On screen is a second
   observation of the slots the reading list already watches, with no margin. Ahead is the page after the last one on
   screen, or the page before the first when the last scroll went up. Every other page in the old margin keeps its
   slot, its size and its lighter layers (text, annotations, fields), and holds no pixels. A page scrolled to arrives
   drawn when it was the page ahead, and is drawn on arrival otherwise.
2. **One limit, in one place: `pixelLedger.ts`.** Every canvas that holds page pixels (the reading list's pages and
   tiles, the thumbnails, the loupe and Compare) registers its backing bytes there, and unregisters when it releases
   them. The ledger answers one question: may the page ahead be drawn within the limit, given what is held? A page on
   screen is always drawn, because it is in use; the limit decides what is held beyond it.
3. **The limit is a setting, *Memory for pages*: Automatic, 512 MB, 1 GB, 2 GB or 4 GB.** Automatic is a quarter of the
   computer's physical memory, which `main` reads (`os.totalmem()`) and `app.info` carries as `physicalMemory`. The
   owner set the quarter; it is not measured here, and the Windows memory walk is where it is read.
4. **First use, stated rather than built.** The thumbnails are mounted only while the Pages tab is chosen
   (`DocumentPanel` renders the chosen tab alone) and draw only the rows on screen (item 13c). Search reads a page only
   when a query runs (`documentSearch.ts`, `FindBar.tsx`, `document.searchPage`). Both are proven by cases.

## Rejected

- **Keeping the one-viewport margin and capping it by the limit.** The margin is what the run file calls caching pages
  not in use; a cap would leave it full on every machine with memory to spare, which is every machine at a quarter.
- **A least-recently-shown cache of drawn pages.** It holds history, which is what 13c removed.
- **Counting PDF.js' own caches against the limit.** Its decoded images, fonts and glyphs are not measurable from
  outside; `pageResidency.ts` already releases a page's when no surface holds it, and that is the lever there is.
- **A setting in megabytes typed by hand.** Five choices cover the range a person would choose from, and a free number
  invites one below what a single page on screen needs, which the limit cannot honour anyway.

## Not verified

The quarter as a default, and what the page ahead saves against the margin it replaces, are figures for the Windows
memory walk (item 13f), not this container.

## Correction, 2026-10-15 — the margin never reached past the screen

*Where it stood* says the page on show mounted a canvas for every page within one viewport of the screen. Measured the
same day, on the build before this decision: at 1280 × 800 with pages 260 pixels tall, the two pages crossing the scroll
box held canvases and the page starting 28 pixels below it held none. The reading list's observer has the window as its
root, and a slot inside the scroller is clipped by the scroller before a margin applies, which `useVisiblePages`
already said of itself. So before this decision the list drew the pages on screen alone, and a page scrolled to arrived
blank. Decision 1 therefore ADDS the page ahead rather than taking a margin away; the first rejected alternative
rejected something that was not there. The ledger, the limit and the rest stand. `PageList.tsx`'s header, which carried
the same claim, now says so, and its `MARGIN` is `0px`, which is what it was doing.

## Correction, 2026-10-15 — the page ahead is the next page, not the next in the scroll's direction

Decision 1 chose the page before the first on screen when the last scroll went up. Building it, the direction had to be
state the list renders on, and a scroll must not render the list (`PageList.test.tsx`, row 303's case, which counted
two renders a turn). So the page ahead is the page after the last on screen, in reading order, always. Scrolling up, a
page arrives drawn on arrival, as every page did before this decision.

## Proofs, 2026-10-15

`pixelLedger.test.ts` (the count, the limit, Automatic as a quarter of physical memory, and a page ahead asked about
itself counted once) and `pagesInUse.pw.ts` (on screen plus one ahead and none beyond; a limit below the screen still
draws the screen and refuses the page ahead; thumbnails and search made on first use). The list subscribes to the
decision about the page ahead, never to the count: a count snapshot rendered every list in every tab for each canvas
sized anywhere, and `tabSwitchRenders.pw.ts` went red that way, which makes it this subscription's control.
