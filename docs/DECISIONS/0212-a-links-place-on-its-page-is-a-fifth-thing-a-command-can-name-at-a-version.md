# ADR-0212 — A link's place on its page is a fifth thing a command can name at a version

- **Status:** Accepted
- **Date:** 2026-10-08
- **Amends:** the `targets` axis of the command declarations (`CommandTargets` in `engineSeam.ts`, anchored by
  `commandDeclarations.test.ts`), by one member. It is the same move as
  [ADR-0041](0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md) (annotation), the field and text-object
  members, and [ADR-0062](0062-a-page-edited-in-another-application-leaves-as-a-named-file-and-returns-by-the-one-open-route.md)'s
  correction (page).
- **Found by:** the owner's list of 2026-10-07, item 5.5 — *change the outline of a link that already exists, its style and its
  colour, from the Links panel.*

## Context

`addLink` writes a link and a thin outline (item 11). Nothing changes one afterwards: a link is not an annotation in MuPDF's
model (`pageLinks.ts` says why), so the annotation walk, the select tool and the Properties tab never see it, and
`document.pageLinks` answers with bounds and a target and no identity.

A command that changes an existing link has to name which one. The only name there is is **its position in `getLinks()` for a
page**, which is MuPDF's own order and the one `readLinkAddress` already names a link by (ADR-0167). That position is read at a
version, and a link added or removed since renumbers the page's links, so an outline applied to a stale position would land on
a neighbour. The `targets` axis exists to say exactly this, and the paragraph in `engineSeam.ts` that introduced the second
member predicted the shape: *each walk is its own index space, and the refusals are separate sentences*.

## Decision

1. **`CommandTargets` gains `'link'`.** `setLinkOutline` declares it, and the bus refuses it stale as it refuses the other four.
   A fifth type beside `NamesAPage`, `NamesAnAnnotation`, `NamesAFormField` and `NamesATextObject` says which kinds name this
   walk, and `commandDeclarations.test.ts`'s mutual-assignability tie is widened by it, so a kind declaring `'link'` that is not
   in `targetVersionOf` fails to compile.
2. **`setLinkOutline` is a command, not a style on `styleAnnotation`.** A link has no annotation index, so folding it in would
   make two index spaces read as one — the confusion the axis exists to prevent. Its payload is a page, a position, an outline
   from a closed set of four (`none`, `thin`, `thick`, `dashed`) and an optional colour, and `document.pageLinks` reports each
   link's current outline and colour so the panel can show what is there.
3. **Undo is the checkpoint the bus takes (ADR-0037)**, as `addLink`'s is: a link has no identity to restore to, and writing one
   would be a handle nothing else needs.
4. **A link whose outline the document brought and the four do not name reads back as `other`** and keeps it until a person
   chooses one: *preserve, never drop*.

## Built and measured, 2026-10-08

- **One writer of a link's outline** (`writeOutline` in `pageLinks.ts`, B3): `addLink`'s border and `setLinkOutline` both write
  `/Border` and `/C` through it. It **deletes `/BS`**, and that fixed a defect `addLink` had since item 11: MuPDF's `createLink`
  writes a `/BS /W 0`, the format makes `/BS` win over `/Border` (PDF 32000 §12.5.2), so a link added "thin" was stored and then
  overridden — drawn with no outline by every reader that follows the rule. The earlier proof read `/Border` alone through
  pdf-lib; the new case reads the page's links back (the listing follows the same rule) and was red before the fix.
- **Proofs** (`pageLinks.test.ts`, eleven cases with controls, read back through pdf-lib): thick on the second link leaves the
  first untouched; dashed writes the dash as the border's fourth entry; `none` keeps the colour; a colour alone keeps the outline;
  a colour the link has is never replaced by the default; a foreign `/BS` reads as `other`, is removed when an outline is chosen
  and is left alone when only a colour is; a page whose `/Annots` has a note before its links counts links, not entries.
- **The panel** (`LinksPanel.test.tsx`): each row's choice sends the command naming that page, that position and the version the
  list was read at; `other` is shown while it is the state and is never a choice. Seen in a window by nobody yet.
- **The hostile-host bound moved**: every link carries a required `outline`, so the smallest link grew from 67 to 84 bytes and
  `ENGINE_PAGE_LINKS_MAX`, derived from it, from 123,300 to 98,600 (ADR-0130 Decision 3's derivation, re-run).

## Rejected alternatives

- **Declare `'annotation'` for it.** Passes the type check and says an annotation index and a link position are the same kind of
  thing, which the walks' disjointness (a page with links answers zero annotations) disproves.
- **Name the link by its bounds.** Two links may share a rectangle, and a moved link would be silently a different one; the
  position and the version are what the format's own order and the bus's own check can honestly say.
- **Make links annotations so the Properties tab covers them.** Measured in `pageLinks.ts`: `createAnnotation('Link')` makes a
  different object that cannot be followed. It would be a rewrite of how links exist for the sake of one control.
