# ADR-0262 — A command declares the pages it changes, and only a checked declaration may name fewer than all

- **Status:** Accepted
- **Date:** 2026-10-23
- **Amends:** `docs/ARCHITECTURE.md` §4 (what a command's answer carries) and §6 (what a page surface redraws when the
  version moves); `commandDeclarations.ts`' declaration gains one field.
- **Decided by:** the owner's LOCAL-FIX-SESSION-4, N2, 2026-10-23: *"a field in every command's answer, plus undo and
  redo, declared once per command kind, so a command cannot be added without saying which pages it changes. 'All
  pages' is a legal answer … Add a check that, for every command kind on a fixture, compares each page's drawing
  before and after against the declaration: a page that changed but was not declared is a red case."* The owner's
  answer 2 of the same day: a kind declares a fixed rule, or that the writer reports the pages it changed.

## The problem, measured

Measured 2026-10-21 (R19 item 3, fix-session-3's REPORT): on every version the thumbnail strip redraws every mounted
card, and the main view every page in its margin, whatever the command changed. The cards hold the drawing slots the
changed page waits for, so a mark on page 3 waits behind drawings of pages 1 to 8 that did not change.

## Decision

1. **Each declaration says which pages its command changes** (`pages`), in the NEW version's page numbering:
   - `'all'` — the whole document may change, or its pages move (merge, OCR of every page, protection, a delete, a
     move, an insert). Always legal.
   - `'none'` — nothing any page draws changes (a layer's name, an author's name, the tab order).
   - a rule — a function from the command to the pages it changes (`addAnnotation` → its page).
   - `'reported'` — the writer answers the pages it changed, where the command alone cannot say (the owner's answer 2).
2. **The answer carries them.** `document.execute`, `document.undo` and `document.redo` answer `changedPages`: `'all'`
   or a list. Undo and redo answer the declaration of the entry they step over, read from the log, since the same
   pages change back.
3. **Only a CHECKED declaration may name fewer than all pages.** A declaration that names too few leaves an old page
   on screen, which is the failure this ADR's check exists for; a declaration of `'all'` costs only time. So the check
   — each command kind run on a fixture by its writer, every page drawn before and after, and a page that changed
   outside the declaration a red case — names the kinds it covers, and a kind it does not cover must declare `'all'`.
   That rule is a test over the table, so a narrower declaration added without a case is red.
4. **The surfaces redraw only what changed.** When the page shows a newer view, a page whose index is not in the
   changes since the version it was drawn from keeps its drawing and counts as drawn from the new view; the changes of
   versions the renderer did not hear of make it `'all'`.

## Rejected

- **Comparing drawings in the renderer** to decide what to redraw: it is the redraw being avoided.
- **Deriving the pages from the bytes that changed**: a shared resource (a font, a form's appearance) changes no page
  object and changes every page that uses it.
- **Declaring the narrow rule everywhere at once**: sixty declarations of which a wrong one is invisible until a
  person sees an old page.

## Proof

The check of Decision 3 and its rule over the table; a rendered case per surface that a change on one page redraws
that page only, with a control (the declaration forced to `'all'` redraws them all); the time per change before and
after on a 5-page and a 60-page document.
