# ADR-0065 — A tagged document's structure is the engine's, read on its own request

- **Status:** Accepted
- **Date:** 2026-09-14
- **Amends:** `docs/ARCHITECTURE.md` §3, adding one row to the writer-of-record
  matrix, and §3.2's text-substrate rule, which gains a second per-consumer
  opt-in. No existing row changes.
- **Relates:** [ADR-0034](0034-the-text-substrate-owns-the-engines-options-not-its-own-clusterer.md)
  (the substrate owns the engine's options),
  [ADR-0035](0035-extracted-text-is-never-resident-in-main.md) (extracted text is
  never resident in `main`; per-page queries),
  [ADR-0013](0013-pdfa-export-and-text-extraction-engines.md) (the text-extraction row).
- **Context:** D8's *reading-order / tagged-PDF inspection* (`BUILD-PROMPT.md`:491,
  and :712 puts it in Stage 8). The founding record says nothing more than those
  words. The *accessibility check* beside it will read the same structure, and its
  standard is undecided.

## The gap

§3 has no row for reading a tagged document's structure tree, and MuPDF's type
surface declares no structure-tree API: `mupdf.d.ts` was searched on 2026-09-14,
with a member known to be present as the control, and names nothing for
`/StructTreeRoot`.

The route that looks open is a walker of our own over the object model. That is
this build interpreting the PDF standard's structure vocabulary itself — the role
map, marked-content identifiers, the parent tree — which is a second opinion about
an authority, in the shape ADR-0034 rejected for reading order. So this is a B4:
the concern has no writer, and the obvious one is the wrong one.

## Measured, 2026-09-14 (`MuPDF 1.28.0`, the npm build the kernel loads)

Scratch probes, not committed. Fixtures were generated in the probe (B10); the
corpus is the owner's eleven-document set, and its names and text are not recorded.

1. **The engine already reads the structure, behind an option.**
   `toStructuredText('structured').asJSON()` returns `"type":"structure"` blocks
   carrying the raw and the standard role names, nested, with the text inside. An
   untagged page is unchanged by the option.
2. **It orders content by the structure TREE**, independent of both content-stream
   order and position on the page. A fixture whose tree lists MCID 1 before MCID 0
   read tree-first on a page whose visual order matched the tree and on one whose
   visual order matched the stream. Without the option the engine follows the stream.
3. **The product's own read cannot see it.** The substrate's options
   (`segment,preserve-images`) already produce structure blocks: segmentation's own,
   role `Div`, in stream order. `structured` alone and the product options plus
   `structured` both give the tag roles (`Document`, `P`) in tree order, identical on
   the fixture. The control was that `structured` alone must reproduce reading 2,
   and it did. A first size instrument that compared byte counts could not separate
   these reads — 733 B against 729 B — and was replaced by this one, which compares
   roles and order.
4. **On the corpus, 4 of 11 documents are tagged.** Their pages return the standard
   vocabulary — Document, Part, Sect, H1–H3, P, Table, THead, TBody, TR, TH, TD, L,
   LI, Lbl, LBody, Figure — nested up to six deep. **On 5 of the 8 pages carrying
   text, structure order differs from stream order**, which is the reading an
   inspection exists to show. One document is scanned pages, each tagged only as a
   Figure, with no text.
5. **Size is not the constraint.** Over the tagged corpus pages read (the first five
   of each), the product options plus `structured` gave 289 to 33,315 B per page,
   growing up to about 60% over the product read. The largest is **0.397%** of
   `ENGINE_PAGE_TEXT_MAX_BYTES` (8 MB).

## Decision

1. **The structure is the engine's.** `structured` joins `STEXT_OPTIONS` as a named
   member and is requested **only** by the structure read — a per-consumer opt-in,
   exactly as `TABLE_HUNT` is. It is **never** part of `STEXT_OPTION_STRING`: on the
   five corpus pages in reading 4 it would reorder search, the text layer, word
   count and spell check, none of which asked for tree order.
2. **One option string for the read: the product set plus `structured`.** Reading 3
   shows the combination keeps the tag roles and tree order, so the structure read
   differs from the substrate's by exactly one named option, and keeps
   `preserve-images`, the option that separates *no text* from *a picture of text*.
3. **One reader of the JSON.** `parsePageText` stays the one parser of MuPDF's
   structured-text JSON. The inspection needs what it flattens away — role, raw
   name and depth — so the substrate gains a structure-preserving view **over the
   same walk**, exported beside `linesOf` and `plainTextOf`. Not a second JSON
   reader, and not a new field on `TextBlock` that the shipped consumers would have
   to ignore.
4. **The existing per-page channel, with a closed request field.** `engine/page-text`
   gains one field naming the read, a closed enum (`substrate`, the default, and
   `structure`), which the host maps to an option string composed in the substrate
   module. A free option string never crosses the wire to `fz_parse_stext_options`.
   Reading 5 is why no sibling channel is needed: the existing byte bound carries the
   largest page read with more than two hundred times to spare. `main` parses and
   bounds the answer, one page at a time (ADR-0035); the renderer receives roles,
   nesting and line counts for that page, never the document's text.
5. **What the inspection shows** is the page's structure tree, and where its order
   differs from the drawing order. It claims neither order correct: a tree that
   disagrees with the stream may be a well-tagged multi-column page or a badly
   tagged one, and saying which is the accessibility check's job.
6. **The accessibility check reads this structure** once its standard is decided.
   This ADR decides the read, not the rules.

## Rejected

- **A `/StructTreeRoot` walker of our own.** A second opinion about a standard the
  engine already resolves, and a partial one — the role map and the parent tree are
  where a partial reimplementation agrees with the authority most of the time.
- **Turning `structured` on for the shared substrate.** Reorders four shipped
  consumers on real tagged documents (reading 4: five of eight pages).
- **`structured` alone, without the product options.** It drops `preserve-images`,
  and without that option MuPDF reports no image blocks at all (measured 2026-09-10,
  the table in `textStructure.ts`'s note on the option), so a Figure-only page would
  read as an empty one. That consequence is carried from the earlier reading and was
  not re-measured on a structured read. The read would also differ from the
  substrate's by three options where one is needed.
- **A sibling channel for the structure.** Duplicates the page-text channel's
  one-page discipline, bound and failure classification to carry a read the existing
  bound already fits.
- **Waiting for a MuPDF structure API.** The capability is present today, behind an
  option the engine's own parser names.

## Consequences

- `docs/ARCHITECTURE.md` §3 gains the row and §3.2's substrate rule names the
  second opt-in. The amendment log gets a line. `docs/DECISIONS/README.md` gains the
  index row.
- **The feature commit** adds the `structured` member, the composed option string,
  the structure-preserving view with its tests, the request field and its host
  mapping, the query in `main`, and the inspection panel with the wired pair. Its
  kernel proof uses a generated fixture whose tree order and stream order differ, so
  a read that silently fell back to the substrate's options is red rather than
  equal.
- **A second reader of the same JSON exists and must not be copied.**
  `packages/kernel/src/flatFields.ts` parses `toStructuredText().asJSON()` itself,
  with no options and top-level blocks only. It is correct today because it asks for
  no options, and it is queued as its own task because moving it onto the substrate
  could change which fields it proposes. The inspection takes the substrate's reader.

## Correction, 2026-09-14 — Decision 5 is not built, and Decision 4's field has no default

Two sentences of this ADR were wrong on the day the feature was built. Both were
found by measuring before wiring, not by review.

- **Decision 5 said the inspection shows where the structure order differs from the
  drawing order.** Measured that day with a scratch probe through `parsePageText`,
  the product's own reader, and a generated control whose lines are the same and
  whose order differs. Over the 12 tagged corpus pages carrying text:
  - the structure read and the shared read hold **identical characters on all 12**;
  - they hold **the same lines on only 4**. On the other 8, the structure read breaks
    the same characters into more lines.

  A comparison of line sequences would therefore report *order differs* where only
  line breaking does. A character-level alignment would be an algorithm of ours over a
  page's text, which this ADR did not decide.

  So the inspection shows the tree: roles, nesting, each element's own line count,
  the lines outside every tag, and the images. **It does not compare orders.**
  Reading 4's *5 of 8 pages* stands as a measurement against stream order. It is not
  something the product shows.
- **Decision 4 called `substrate` the default.** The field is **required**. Every
  caller names the read it means, so a forgotten field is a schema refusal rather
  than the shared read.

One reading this ADR did not have decides how the view is built: a page's structure
blocks include segmentation's own.
- Under the structure read, every structure block on every page of the seven untagged
  corpus documents is raw `Split`, standard `Div` (first five pages of each).
- None on the four tagged documents is.

The view therefore walks through `Split` blocks rather than listing them. A document
that names one of its own elements `Split` is read as segmentation's, which
`textStructure.ts` states as a limit.
