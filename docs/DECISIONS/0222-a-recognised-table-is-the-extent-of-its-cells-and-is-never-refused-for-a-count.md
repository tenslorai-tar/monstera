# ADR-0222 — A recognised table is the extent of its cells and is never refused for a count

- **Status:** Accepted
- **Date:** 2026-10-09
- **Amends:** [ADR-0086](0086-a-scanned-table-is-read-by-a-service-that-answers-tables.md) Decision 3's reading of a service's
  grid — *a cell outside the declared grid refuses the table rather than being placed by a rule of ours* — and the stated
  rule of `recognisedTables.ts` that a grid which does not fit itself refuses the whole answer.
- **Found by:** the owner's recording of 2026-10-08 (22:13): *Handwriting to Excel with Claude fails every time.*

## Context

`readTablesThroughClaude` and `readTablesThroughAzure` give every table to `recognisedTable(rows, columns, cells, …)`, which
refused the table when any cell lay outside the declared `rows × columns` or two cells claimed one place. The owner's page
(`Handwritten table.pdf`) is a plain four-column table: *Names, Hours, Minutes, Seconds*. Claude merged the first two header
words into one cell, declared **three** columns, and returned **four** cells in each data row. The check read the fourth as
"a cell at row 0, column 3 … lies outside its 7×3 grid" and refused the whole table; the Excel export said *The tables were not
read*, and the message beneath it said the service could not read the page, which is not what happened: it read the page, and
this build refused what it read.

The mechanism: **the declared counts are the service's summary of its own cells, and the summary is the part a language model
gets wrong** — it counts what it sees as a header, not what it returned. The cells carry the positions, so the counts add no
information the cells lack, and a check of the cells against the counts can only turn the model's miscount into a refusal of
correct data.

## Decision

1. **The grid is the extent of the cells returned**: rows and columns are the largest `row + rowSpan` and `column + columnSpan`
   any cell reaches. The service's own counts are not read (the function no longer takes them). A place no cell covers is an empty
   cell. A header with fewer cells than the rows is therefore written whole, as the same sheet a person would draw.
2. **Only what cannot be placed at all is refused**: a table with no cell, a row or column that is not a whole number from zero,
   a grid over the bound, a cell's text over the bound. A span that is not a whole number of at least one is read as one.
3. **Two cells claiming one place do not refuse the table.** The second claimant's words are joined onto the first at that place,
   so nothing the service read is dropped (*preserve, never drop*), and a span that would cover a place already taken is cut back to
   the places still free. The first claimant keeps its place, because choosing otherwise would be this build deciding which of two
   answers the service meant; joining decides nothing.
4. **Each table is its own answer.** One table that cannot be placed no longer takes the others with it: the callers keep the
   tables that were placed and refuse only when none was (the unchanged `service-refused` outcome).
5. **A message says what happened.** *The service could not read this page* is said only where the service could not; a read
   that returned something this build could not place says *the service read the page but this build could not place its table*.

## Rejected alternatives

- **Keep the refusal and ask the model for a better count.** The instruction already asks for counts; a prompt cannot make a
  model's count agree with its cells every time, and the next miscount would refuse the next page. The check was the defect.
- **Use the larger of the declared and the returned extents.** It adds empty trailing rows and columns the service never
  returned, which is this build inventing structure for a sheet a person then has to delete.
- **Repair a conflict by choosing a winner.** Dropping the second cell loses words a person can see on the page.

## Consequences

- `recognisedTable(cells, maxCells, maxText)`; both service readers and their tests are updated; ADR-0086's Decision 3 is
  corrected by pointer.
- The proof is the ragged answer itself: a header with three cells over rows of four is written whole as 4 columns; the control
  is the same answer under the old rule, which refuses.
