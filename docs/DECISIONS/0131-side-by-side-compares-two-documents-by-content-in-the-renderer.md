# ADR-0131 — Side by Side compares two documents, matching pages by content, in the renderer over reads it already has

- **Status:** Accepted
- **Date:** 2026-10-02
- **Replaces:** the compare pane inside split view (FEATURES row 66, *"on the tabs above"*), and the implementation
  decision in `packages/ui/src/commands/compareDocuments.ts`, *"PAGE BY NUMBER, and the dialog says what that cannot
  see"*. Neither was law; both are recorded here because each was a deliberate choice with a stated reason.
- **Relates:** [ADR-0031](0031-the-renderer-reads-the-document-by-demand-paged-ranges.md) (one parser and one range
  transport per version), [ADR-0035](0035-extracted-text-is-never-resident-in-main.md) (main never holds a document's
  extracted text), [ADR-0034](0034-the-text-substrate-owns-the-engines-options-not-its-own-clusterer.md) K.0 (one
  extraction path), [ADR-0089](0089-a-two-document-ask-carries-one-window-per-document-inside-one-bound.md) (the
  two-document ask, whose second document came from the compare pane).
- **Context:** the owner's decisions of 2 October. Compare is to be the old app's *Side by Side*, and its differences a
  real comparison as Acrobat's is: today it compares words only, page *i* against page *i*, so one inserted page marks
  every page after it as different.

## Decision

1. **Side by Side is its own surface, filling the window below the title bar.** A header (*Side by Side · Compare two
   open documents* · Close; Esc closes) over two equal halves. Each half has its own toolbar — a list of every open
   document, the current one included with its unsaved edits; *Open another PDF…*; its own zoom — and scrolls its own
   pages continuously, drawing them lazily. Split view no longer carries a compare pane: it is one document (row 65).

2. **Each half is a page list over its own `DocumentView`.** A second document is a second parse by necessity, as the
   compare pane already said; each view binds its own range transport, so main refuses a range for any other version
   (ADR-0031). The half showing the current document reads main's canonical image, which is what holds the unsaved
   edits. A document opened from the half's button goes through main's open path and arrives as an open document like
   any other; the renderer never holds its path or its bytes. The old app read whole files into the renderer; that is
   the one thing not copied.

3. **The comparison runs in the renderer, one pair of pages at a time, over three reads that exist.** The kernel's
   text layer (`document.pageTextLayer`: lines with boxes in display space at scale 1), the annotation list
   (`document.annotations`, once per document), and a small raster of each page drawn by PDF.js from that half's own
   view. Main reads nothing new and holds no text (ADR-0035). The matching and the diffing are pure functions in
   `packages/shared` (`pageCompare.ts`), tested without a renderer. **No channel is added and no seam moves**, so there
   is no amendment.

4. **Pages are matched by content.** A page's signature is its words. The two sequences are aligned by a dynamic
   program that maximises total similarity, where similarity is the Dice coefficient of the two pages' word multisets
   and a pair may match only above 0.5. A page with fewer than three words — a scan, a full-page picture — is compared
   by its small grayscale raster instead. A page left unmatched is reported as **inserted** (right only) or **removed**
   (left only), and every page after it is matched to its counterpart rather than shifted. The thresholds are chosen,
   not measured, and are named constants beside the code.

5. **Four kinds of change on a matched pair, each boxed on BOTH pages.**
   - **Text:** lines aligned first, then a token-level longest common subsequence over each run of changed lines;
     removed tokens are boxed on the left page, inserted on the right. Tokens are the platform segmenter's, the one
     `wordCount.ts` reads (B3a), punctuation included, so `fox.` against `fox,` is a change and a line of Chinese is
     not one token.
   - **Layout:** a line present on both pages whose box moved more than six points, a word inside an edited run that
     moved to another line, and a page whose size changed.
   - **Annotations:** matched by kind and overlapping rectangle; reported added, removed, or changed (contents, colour,
     or rectangle).
   - **Images and graphics:** cells of the two rasters that differ, and that no text or layout box on that page
     explains, merged into rectangles.

6. **A summary list jumps to each change.** One row per change in page order, naming its kind and its page on each
   side; choosing a row takes both halves to those pages, where the marks are drawn.

7. **Bounds.** At any moment two pages' lines and two rasters are held, plus one signature per page — the alignment
   needs them all at once, so a signature is word hashes and, for a page matched by its picture, a 32 × 32 ink grid,
   never text or a raster. The alignment table is pages × pages, so it is
   banded past 4,000,000 cells: a band of 400 pages beyond the difference in length. A document is never refused for
   its length (the owner's principle). The list holds at most `MAX_COMPARE_CHANGES` rows and says when it stopped.

## Stated limits

- **A word's box is estimated** inside the kernel's line box by its share of the line's characters, so in a
  proportional font a narrow-letter word is boxed slightly off. Exact boxes need character positions from the kernel,
  which is a new channel; it is left until the owner has seen this comparison.
- **The visual comparison is coarse:** rasters at half a pixel per point (a Letter page is 306 × 396 pixels), compared
  in eight-point cells, so a change smaller than a few points can be missed or merged with a neighbour.
- **A scan has no words**, so its pages are matched and compared visually only.

## Consequence for ADR-0089

The two-document ask took its second document from the compare pane. Side by Side fills the window, which covers the
Assistant tab, so **that ask has no route until the owner decides where it belongs**; the panel, the contract and their
cases are unchanged. Carried as a question.

## Rejected

- **Comparing in main or in an engine host.** Main must not hold extracted text (ADR-0035); a host comparing two
  documents would need both sessions in one host, which is a new seam for no gain the renderer cannot give.
- **PDF.js' text for word boxes.** A second extraction path, which K.0 bans: the words compared would not be the words
  searched and copied.
- **Matching page *i* with page *i*.** The behaviour the owner rejected.
