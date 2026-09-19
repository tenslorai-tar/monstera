# ADR-0086 — A scanned table is read by a service that answers tables, and Tesseract is not a table engine

- **Status:** Accepted
- **Date:** 2026-09-19
- **Decided by:** the owner, in the reviewing seat's block of 2026-09-19 (*"Azure through its
  Layout model, which returns table structure itself, and Claude asked for the table as
  structured output. Tesseract is dropped for tables"*).
- **Supersedes:** `BUILD-PROMPT.md`:502, *"table detection: automatic / force-OCR / local
  handwriting / Azure"*, in its **force-OCR** engine (the local-handwriting engine left with
  [ADR-0085](0085-handwriting-is-read-by-a-service-and-the-local-engine-is-removed.md)); and
  [ADR-0073](0073-a-table-is-the-engines-table-read-asked-as-its-own-table-writer-asks.md)
  Decision 5, which left the recognising engines undecided.
- **Keeps:** ADR-0073's automatic engine, unchanged; [ADR-0052](0052-a-second-recogniser-arrives-on-demand-and-reads-a-region.md)'s
  and [ADR-0057](0057-a-network-recogniser-is-keyed-by-engine-and-a-providers-key-is-the-providers.md)'s
  placement of network recognition in `main`, the keys, and Azure's delete of every result.

## Why

ADR-0073 measured the reason the engines were undecided: a scanned table's rulings are pixels,
so a recognised text layer reaches MuPDF's table read as an unruled table, and splits at its
gutters (0 of 2 whole). What remained were two routes — a recogniser that answers tables itself,
or a grid built over recognised word boxes, which is the clusterer
[ADR-0034](0034-the-text-substrate-owns-the-engines-options-not-its-own-clusterer.md) refuses.

Tesseract answers words and lines and no table structure, so the only table it could produce is
that grid. The owner dropped it for tables rather than admit the clusterer.

## Decision

1. **Three engines for a table export**: automatic (ADR-0073, MuPDF's table read of the page's
   text), **Azure** and **Claude**. The export's engine is chosen in its dialog; the network
   engines are offered only where their key is stored, as every network feature is.
2. **Azure is its Layout model**, `prebuilt-layout`, through the one Azure client
   (`ocrAzure.ts`): the same endpoint and key, the same `Retry-After` polling and the same delete of
   every result. Its `analyzeResult.tables[]` carries each cell's `rowIndex`, `columnIndex`,
   `rowSpan`, `columnSpan` and `content` (REST reference, api-version 2024-11-30, read
   2026-09-19). The service answers the table; nothing here builds one.
3. **Claude is asked for the table as structured output**, through the one Claude client
   (`ocrClaude.ts`): the same model and key, a JSON schema whose cells carry row, column, the two
   spans and the text. The shape is Azure's on purpose, so one reader turns either answer into
   the export's table, and a schema that cannot express a span cannot be answered with one.
4. **What is sent is each page the person chose, whole.** The OCR tool reads a **region**
   because a region is what the reader drew (ADR-0052); an export names **pages**, and the
   dialog says, before anything is sent, that those pages go to the service. Each page is
   rasterised in the engine host and redrawn smaller where it exceeds the service's byte limit
   (`rasterWithinLimit`), as the region recognisers are.
5. **Merges come from the spans.** A cell whose `rowSpan` or `columnSpan` exceeds one is written as
   a merged range in the sheet. MuPDF's table read reports no spans, so the automatic engine
   writes none — the styled-output row's merges are the network engines'.
6. **Fills stay a stated limit.** Neither service reports a cell's background: the Layout
   model's cell carries structure and content only (same reference), and the Claude schema asks
   for none, because a colour read from a raster by a model is a guess the workbook would state as
   a fact.
7. **Runs in `main`**, for ADR-0052's 2026-09-12 reason: invariant 25 gives the engine host no
   network. What crosses back is one page's table at a time, for ADR-0035's.

## Rejected

- **Tesseract with a grid over its word boxes.** ADR-0034's clusterer, and the owner's drop.
- **Tesseract's words fed to MuPDF's table read.** ADR-0073's reading 3: an unruled table, split
  at its gutters.
- **A region for the table export.** A table export's subject is pages; asking the reader to draw
  every table before exporting would make the network engines a different feature from the
  automatic one.
- **Reading fills from the raster ourselves.** A second opinion about a colour neither service
  states, written into a file as though it had been read.

## Consequences

- `docs/ARCHITECTURE.md` §3's table row names the three engines; the amendment log gains a line;
  the index gains this row.
- The feature commit adds Azure's Layout request and table reader, Claude's table schema and
  reader, the engine choice in the Excel export dialog with the disclosure, the spans in the sheet
  writer, and cases on fixtures of both services' answers. Both engines run live once before the
  row says done.
