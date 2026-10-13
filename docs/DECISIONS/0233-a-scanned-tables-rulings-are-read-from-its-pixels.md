# ADR-0233 — A scanned table's rulings are read from its pixels

- **Status:** Accepted
- **Date:** 2026-10-13
- **Amends:** [ADR-0073](0073-a-table-is-the-engines-table-read-asked-as-its-own-table-writer-asks.md) Decision 5 (a
  scanned table reaches the table read as unruled words) and
  [ADR-0202](0202-a-whole-page-may-be-read-by-a-service-when-the-person-chose-these-pages-for-an-export.md) Decision 5 (the built-in reader takes the
  recognise-first walk into the engine's table read). Corrections are dated under both.
- **Decided by:** the owner's O2, on the cloud run of 2026-10-12: a printed scan with a clean ruled table, read on this
  computer, ended *"No tables with ruled lines were found in this document, so no file was written."*

## Where it stood

*Export tables to Excel → Printed scan, read on this computer* runs Tesseract over the chosen pages, writes their words
into an invisible text layer, and then asks MuPDF's table read — the one the export asks of any page. That read proposes
a table from the page's **vector** paths (ADR-0073 reading 2: *"Without `FZ_STEXT_COLLECT_VECTORS` the page has no
vectors, so ruling lines propose nothing"*). A scan's rulings are pixels inside an image, so they never reach it: the
recognised words arrive as an unruled grid, which ADR-0073 measured whole for 0 of 2 tables, and the export finds no
table. ADR-0073 Decision 5 named this gap; ADR-0202 Decision 5 then routed the built-in reader into it.

## What was measured

On a fixture built for the purpose (`packages/kernel/src/scanTableFixture.ts`): a ruled 3 × 4 table drawn with vectors,
rendered to a 200 dpi grey picture by MuPDF and made the whole of a page, as a scanner writes it.

| reading | vector original | the scan |
|---|---|---|
| ruled cell sides MuPDF's table read reports | > 0 | **0** |
| grids the ruling finder below reads from the page raster at 150 dpi | — | **1**, 5 row edges, 4 column edges, every side ruled |

The controls: a page of 28-point words with an underline and one lone half-page rule gives no grid (the finder saw
both rulings, and they meet nothing), and a solid filled box gives none.

## Decision

1. **The rulings are read from the page's pixels, in the engine host.** `rasterRulings.ts` thresholds the page raster
   (Otsu's level, `pageSkew.ts`' one answer) and keeps runs of ink at least half an inch long and at most four points
   thick, joining a gap of a point — lengths in inches of the page, so any resolution finds the same rulings. Horizontal
   and vertical rulings that meet form a grid; at least two of each make a table. Nothing is tuned to a document.
2. **A cell's words are its characters, not its lines.** A recognised layer is written word by word and MuPDF joins a
   row's words into one line across the rulings, so `scanTables.ts` walks the structured text and puts each character in
   the cell its centre is in. A cell's lines are the runs of its characters on one line.
3. **It is a read of its own, `engine/scan-tables`**, beside `engine/page-fills`, answered as a shape this build owns and
   bounded by the channel's schema. The raster never leaves the host (§9.17).
4. **Main uses it only where the engine saw no ruling and the page holds a picture.** `pageTables` asks the engine's read
   first; on a page with an image and no ruled side in that answer, it asks for the scanned tables, and where they make a
   table, those are the page's tables. A page whose rulings are vectors keeps the engine's answer, so no table is read
   twice. Every consumer of `pageTables` — the review grid, the workbook, the first pass that decides *no tables* — takes
   the scanned tables as it takes the engine's.
5. **Recognised words are set in the writers' default font.** The layer's glyphless font is no font a reader has, so
   `baseFontName` answers Calibri for it, for the workbook and the Word export alike.
6. **The Recognition dialog says what happened to the document**: the text of N pages was read and added to it, so it
   can be searched and copied, and Undo takes it out. One body, for every caller of the dialog.

## Rejected alternatives

**A grid inferred from the words' boxes** (ADR-0086's rejection, and still rejected): the gutters between words are where
a column might be, and a table without rulings is split at them. The rulings are the evidence a grid exists; this reads
them where they are.

**Send the scan to Azure or Claude.** Those need a key, send the page away, and are already offered; a printed scan read
on this computer is the choice a person makes not to.

**Draw the recognised rulings into the page as vectors, then ask MuPDF.** A second writer of the page's content for a
read, and a document changed by an export that need not change it.

## Consequences

- A scan tilted by more than about three quarters of a degree breaks a long ruling into runs shorter than half an inch
  per pixel row, and its grid is not found; *Straighten* first. Stated rather than solved.
- A table whose rulings are partly missing has those sides unruled in the workbook, and its cells are not merged: a span
  the engine would have named is not inferred from an absent ruling.
- `scripts/proofs/scanTable.proof.mjs` asks the question of real Tesseract output, in CI, where the models are
  provisioned; `packages/kernel/src/scanTables.test.ts` asks it of a layer placed at the words' true places on every run.
