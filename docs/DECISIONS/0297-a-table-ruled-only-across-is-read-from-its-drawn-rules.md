# ADR-0297 — A table ruled only across is read from its drawn rules

- **Status:** Accepted
- **Date:** 2026-11-19
- **Amends:** [ADR-0073](0073-a-table-is-the-engines-table-read-asked-as-its-own-table-writer-asks.md) Decision 1 (*a
  table is the engine's*) and [ADR-0233](0233-a-scanned-tables-rulings-are-read-from-its-pixels.md) Decisions 1 and 4
  (rulings are read only from a scan's pixels, and only on a page holding a picture). `docs/ARCHITECTURE.md` §3's
  *Finding a table* row. Dated corrections are written under both ADRs.
- **Decided by:** the owner's list of 2026-11-19, items 1 and 2: *Export tables to Excel finds no table in the Supply
  Agreement*, and *splits the Annual Programme Report's Volunteers table in two and drops its header*.

## What was measured (2026-11-19, the native engine, `_review/tableProbe.mjs`)

| page | how the table is drawn | MuPDF's table read |
|---|---|---|
| Supply Agreement p1, products | a shaded header band; a stroked hairline under every row; **no vertical rule** | **0 tables** |
| Annual Programme Report p9, Volunteers | a shaded header band; a stroked hairline under every row; **no vertical rule** | **2 tables**, rows 1–2 and 3–6; the header row outside both |

The structured text puts every cell's words on a line of their own on both pages, so the words are there; what is
missing is a table. `stext-table.c` proposes a table from a raft of vectors that encloses cells, or from a segmentation
region. Hairlines across with nothing down enclose nothing, so only segmentation regions are tried: on the Supply page
none holds a consistent grid, and on page 9 segmentation cut at the header band and again mid-table. This is ADR-0073's
*an unruled table is split at its gutters*, arriving on tables that ARE ruled, only across. A shaded band and hairlines
across is a very common way to draw a table, and the owner's rule is that a table a person can see is a table.

The existing reader of rulings, ADR-0233's, cannot see these either: it reads dark ink from pixels, the hairlines are a
light grey (RGB 204, 211, 222) a threshold puts with the paper, and a band's edge is a change of shade, not a line.

## Decision

1. **The drawing's own rules are a ruling's evidence, beside a scan's pixels.** In the engine host, a device pass over
   the page collects every **horizontal** rule the page draws: a stroked or filled shape at most 4 points high and at
   least half an inch long (ADR-0233's own bounds), and the top and bottom edges of a **non-white filled band** at most
   one inch high (a header's shading). Lengths are in points of the page; nothing is tuned to a document.
2. **A table ruled only across is a run of rules of one width.** Rules whose left and right ends agree within 2 points,
   taken in order down the page, make a run while each gap between them is under two inches and holds text. A run of at
   least three rules is two or more rows; its rows are the gaps between its rules.
3. **Its columns are where no character crosses.** Inside the run's box, a column boundary is a vertical stripe at
   least 6 points wide that no character of any row overlaps. At least two columns, or it is not a table. This is the
   one place a grid is inferred from text positions, and it is bounded by the rules: they are the evidence that a table
   exists and where its rows are, which is exactly what ADR-0086 and ADR-0233 said an unruled grid lacks. **An unruled
   table is still not read** (no rules, no run).
4. **The same read answers both.** `engine/scan-tables` — the tables this build reads from rulings — answers the picture
   page's pixel grids (ADR-0233) and the drawing's across-ruled tables, each cell filled character by character as ADR-0233
   Decision 2 fills it. The channel, its shape and its bounds are unchanged; the pixel pass still runs only on a page that
   draws a picture.
5. **Main asks it where the engine saw no column rule, and the engine's tables inside a ruled table give way to it.**
   `pageTables` asks for these tables whenever the engine's answer has no table ruled down (`sawColumnRulings`), not only
   on a picture page. A table this build read replaces every engine table lying wholly inside it; an engine table not
   inside one is kept. A table ruled down as well keeps the engine's answer untouched, so no grid MuPDF reads exactly is
   read again.

## Rejected alternatives

- **Adding vertical rulings from word gaps everywhere** (ADR-0034's clusterer): a list or a two-column article would be
  read as a table. The rules across are required.
- **Overloading `engine/page-fills` with strokes:** that read is a cell's background, and its own control asserts a
  stroke is no background. One read, one meaning.
- **A new channel for the rules:** a second answer to *where are this page's rulings* beside `engine/scan-tables` (B3a).
- **Patching MuPDF's table hunt:** the engine is built from its pinned source and is not ours to fork for one heuristic.
- **Lowering ADR-0233's ink threshold to see light rules:** it would read every shaded panel's edge on a scan as a rule.

## Consequences

- `docs/ARCHITECTURE.md` §3's *Finding a table* row says the drawing's rules are read for a table ruled only across, and
  the amendment log gets the line.
- The feature commit: the rule finder and the run and column rules as pure functions with cases on generated pages (a
  table ruled across, the CONTROL of the same words with no rules, a ruled-down table MuPDF reads, which keeps the
  engine's answer), the host read, and main's merge with its cases.
- **The Word export takes the same tables.** It reads a page's tables in the host from MuPDF's table read directly
  (`wordPictures.ts`), so it missed these tables too. The merge is one pure function, `withRuledTables`, called by main's
  `pageTables` and by the Word export's read alike, so the two exports cannot disagree about which tables a page holds.
