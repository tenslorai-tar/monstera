# ADR-0255 — A region too large for Claude is read in tiles, and joined

- **Status:** Accepted
- **Date:** 2026-10-17
- **Amends:** `docs/ARCHITECTURE.md` §3's *Finding a table* row and the network recognition route (ADR-0052's 2026-09-12
  addition): a Claude read of a region past the model's image limits becomes several requests, joined in `main`.
- **Decided by:** the owner's decision of 2026-10-17 (IIIIIII-8, option a): tile large regions for Claude's OCR and
  table read, and join the text.

## What it replaces

Claude reads an image without resizing only within its model's limits (`claudeImageLimits`: an edge and a count of
28-pixel patches). `claudeRasterScale` lowers the raster's scale until a region fits, and below `MIN_SNAPSHOT_SCALE`
(72 dpi) it answers nothing, so `prepare` refuses: *"too large for … to read without resizing, even at the smallest
snapshot scale"*. Recognition reads characters, so a lower floor is the wrong answer (IIIIIII-8): the region's text
would be read from pixels too coarse to hold it. A large page or a large drawn region is refused today, for text and for
tables.

## Decision

1. **Where no scale at or above the floor fits, the region is read in tiles.** The region (a drawn box, or the page's
   own box) is cut into a grid of tiles, each read at the scale a region that fits would have been read at (the route's
   ceiling, `AZURE_RASTER_SCALE`), each as large as the model's limits allow at that scale. Neighbouring tiles OVERLAP by
   a band (`TILE_OVERLAP_POINTS`), so a word or a row cut by one tile's edge is whole in the next. Each tile is
   rasterised by the snapshot route a region already takes and sent as its own request, one after another; a refusal of
   any tile refuses the read, naming the tile, rather than answering with part of the region (*preserve, never drop*).
   The tile count is bounded (`MAX_CLAUDE_TILES`); a region past it is refused as too large, as now.
2. **The text is joined by position, in `main`, by one function.** Each tile's lines come back in page coordinates
   through the route's one converter. The overlaps are split at their middles, so every point of the region belongs to
   exactly one tile's CORE; a word is kept from the tile whose core holds its box's centre, and dropped from the others.
   Lines are then joined across a vertical seam where they share a row (their boxes overlap by at least half the smaller
   height and meet at the seam): one line, its words in reading order, its text joined with a space.
3. **A table is read in full-width bands, and its rows carry their place.** Claude's table answer gains each row's top
   and bottom in the image, in pixels, which the band's converter takes to page points. A row is kept from the band whose
   core holds its centre. A table that reaches the bottom of one band's core and one that starts at the top of the next
   band's core, with the same number of columns, are one table: the second's rows follow the first's. Anything else is a
   table of its own. A page too wide for a full-width band at the floor scale is refused as now: the column structure
   cannot be read in pieces.
4. **Nothing changes for a region that fits.** It is one request, as now; tiling is taken only where `prepare` would
   have refused.

## Rejected

- **A lower floor for Claude.** It fits the model by reading characters from pixels too coarse to hold them; the
  finding's own reason.
- **Refusing, as now.** The owner's principle: a person is never refused because of their document.
- **Tiles without overlap.** A word or row cut by an edge would be read as two halves, or not at all.
- **Joining a table across bands by matching its rows' text.** A table repeats rows legitimately (blank rows, repeated
  values), so equal text is no evidence of the same row; position is.
- **Sending the tiles at once.** One request at a time keeps the read within a key's rate limit and the refusal of one
  tile from racing the others; the cost is time, which the read's own progress shows.
