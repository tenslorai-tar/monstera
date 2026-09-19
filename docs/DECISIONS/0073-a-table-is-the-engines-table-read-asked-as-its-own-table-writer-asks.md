# ADR-0073 — A table is the engine's table read, asked as the engine's own table writer asks

- **Status:** Accepted
- **Date:** 2026-09-17
- **Amends:** `docs/ARCHITECTURE.md` §3, adding a row for table detection, and
  §3.2's text-substrate rule, which gains a third per-consumer read. No existing
  writer changes.
- **Corrects:** the 2026-09-10 `TABLE_HUNT` reading recorded in
  [ADR-0013](0013-pdfa-export-and-text-extraction-engines.md) and §3.2, which asked
  the engine a question its own table consumer does not ask. Both carry a dated
  correction.
- **Relates:** [ADR-0034](0034-the-text-substrate-owns-the-engines-options-not-its-own-clusterer.md)
  (the substrate owns the engine's options and implements no clustering),
  [ADR-0065](0065-a-tagged-documents-structure-is-the-engines-read-on-its-own-request.md)
  (a named read on the existing page-text channel),
  [ADR-0072](0072-office-open-xml-exports-are-written-by-this-build-over-fflate.md)
  (the `.xlsx` parts are this build's own),
  [ADR-0052](0052-a-second-recogniser-arrives-on-demand-and-reads-a-region.md) and
  [ADR-0057](0057-a-network-recogniser-is-keyed-by-engine-and-a-providers-key-is-the-providers.md)
  (the recognisers).
- **Context:** D10's *Excel: table detection (automatic / force-OCR / local
  handwriting / Azure / Claude)* (`BUILD-PROMPT.md`:501-503, the fifth engine added
  by the owner on 2026-09-12). ADR-0034 gave `TABLE_HUNT` a trigger: *"The first
  feature whose subject is a table owes the reading this ADR did for prose."* This
  is that feature.

## The gap

§3 has no row for finding a table. The route that looks open is a grid built over
the substrate's lines, which is the clusterer ADR-0034 refused. The route the
record points at is the engine's own `FZ_STEXT_TABLE_HUNT`, and the only reading
of it said it made things worse.

## Measured, 2026-09-17 (MuPDF 1.28.0, the npm build the kernel loads)

Scratch probes, not committed. Fixtures were generated in the probe, so the right
grid is a fact about the generator. The corpus is the owner's eleven documents;
their names and text are not recorded.

1. **The option alone splits every table into two-column pieces.**
   `segment,table-hunt` on six generated grids (3×3, 3×3 narrow, 5×8 ruled and
   unruled, 6×12 and 4×10 under a paragraph): **every table came back two columns
   wide**, the remaining columns left outside it as plain regions. MuPDF 1.28.1,
   published 2026-09-06, gave the same six answers in a scratch tree.
2. **MuPDF's own table consumer asks differently.** Its CSV document writer,
   `source/fitz/output-csv.c` in the 1.28.0 source this project provisions, sets
   `FZ_STEXT_COLLECT_VECTORS`, `FZ_STEXT_ACCURATE_BBOXES`, `FZ_STEXT_SEGMENT` and
   `FZ_STEXT_TABLE_HUNT`. The mechanism is in `stext-table.c`:
   `fz_table_hunt_within_bounds` proposes a candidate table for every *raft* of
   vectors on the page and for every segmentation region. **Without
   `FZ_STEXT_COLLECT_VECTORS` the page has no vectors, so ruling lines propose
   nothing** and only segmentation's regions are tried — and segmentation had
   already cut the table at its gutters. The option's name in the parser is
   `vectors`.
3. **Asked that way, ruled tables come back whole.** `vectors,accurate-bboxes,
   segment,table-hunt` on the same fixtures: **all four ruled grids exact**
   (3×3, 3×3, 5×8, 6×12). **Both unruled grids still two columns wide**, because
   an unruled table has no vectors to propose it.
4. **The product's options do not disturb it.** The substrate's set plus
   `vectors,accurate-bboxes,table-hunt` found the same tables as the CSV writer's
   set on every fixture and on every corpus document.
5. **On the corpus**, over every page: the table read finds 13 tables in three
   documents; the option alone found 15 in five. Read cell by cell, the table read's
   finds are ruled tables on the page — a five-column claims table and a document
   header block. **Every find the option alone made in the other three documents was
   not a table** — numbered and bulleted lists, a two-column article and a résumé's
   dated entries, each read as a two-column grid — and the table read reports none
   of them. The
   largest page answer is 52,299 characters, **0.62%** of
   `ENGINE_PAGE_TEXT_MAX_BYTES`.
6. **A cell whose text wraps comes back as two rows.** On the claims table a
   two-line cell is two table rows with the other columns empty in the second. That
   is the engine's grid, and it is what the review grid (the next row) exists to
   let a person fix.

## Decision

1. **A table is the engine's.** `vectors` and `accurate-bboxes` join
   `STEXT_OPTIONS` as named members, and a third named read, `table`, is the shared
   set plus `vectors`, `accurate-bboxes` and `table-hunt` — the CSV writer's set,
   taken rather than re-derived. It is a per-consumer read exactly as `structure`
   is, and never part of `STEXT_OPTION_STRING`.
2. **The existing page-text channel carries it**, by its closed `read` field. The
   host composes the option string from the name; no request carries one.
3. **One reader of the JSON.** The table view is a third view over the substrate's
   `walkBlocks`, beside `linesOf` and the structure view. It reports each `Table`
   element's rows and cells as text, in the engine's order, and adds no geometry
   rule of its own.
4. **The automatic engine reads the page's text as it is.** An image-only page has
   no text to find a table in, and the export says which pages those were rather
   than recognising them underneath the user.
5. **The four recognising engines are not decided here, and the reason is
   measured.** A scanned table's rulings are pixels, not vectors, so a recognised
   text layer reaches the engine as an unruled table — reading 3's case, 0 of 2
   whole. A table from recognised words is therefore either a recogniser that
   answers tables itself (Azure's `prebuilt-layout` model, a table schema asked of
   Claude) or a grid over word boxes, which ADR-0034 refuses. The handwriting, Azure
   and Claude recognisers also read a **region** by their own ADRs. Which route is
   the owner's; the row records the four engines as blocked on it.

## Rejected

- **A grid of our own over the substrate's lines.** ADR-0034's rejected clusterer,
  and reading 5 shows the engine already separates a ruled table from a list, which
  a line grid would have to learn.
- **`table-hunt` without `vectors`.** Reading 1: every table two columns wide.
- **Turning the table read on for the shared substrate.** It changes which
  characters form a line on every page holding a table, for consumers that read
  lines.
- **Recognising image-only pages automatically inside the export.** Recognition is
  applied to the document (the searchable-export row says so and is undoable page by
  page); doing it silently inside an export is the hidden mutation that row refused.

## Consequences

- `docs/ARCHITECTURE.md` §3 gains the row, §3.2 names the third read and carries the
  correction, the amendment log gets a line, and `docs/DECISIONS/README.md` the index
  row. ADR-0013 carries a dated correction of its 2026-09-10 reading.
- The feature commit adds the two members and the `table` read, the table view with
  cases on generated grids (a ruled grid whose third column is the separating
  assertion, since reading 1's two-column answer is what a read without `vectors`
  produces), the request mapping, and the query in `main`.

## 2026-09-19 — Decision 5 is superseded by ADR-0086

The owner took the route this ADR left open: a scanned table is read by **Azure's Layout model**
and by **Claude asked for structured output**, and Tesseract is dropped for tables because its
only table would be the grid over word boxes this ADR and ADR-0034 refuse
([ADR-0086](0086-a-scanned-table-is-read-by-a-service-that-answers-tables.md)). Decisions 1–4 —
the automatic engine and its `table` read — are unchanged.
