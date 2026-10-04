# ADR-0163 — A burn-in also takes the outline, the tags' text on a burned page, and private application data

- **Status:** Accepted
- **Date:** 2026-10-04
- **Amends:** nothing in `docs/ARCHITECTURE.md`. It widens what `applyRedactions` removes, inside the command it
  already is, as [ADR-0079](0079-a-burn-in-removes-every-copy-of-what-the-mark-covers.md) did, and adds no seam,
  channel or payload field.
- **Found by:** CR-DOC-14 (redaction leaves outlines, structure-tree text and other non-content copies).

## Measured, 2026-10-04

Each fixture carries the secret drawn on the page under the mark, and one more copy of it. Read back with pdf-lib
after a burn-in through `applyApplyRedactions`, against a serialise that burns nothing, which finds every copy.

| where the copy was | after the burn-in |
|---|---|
| an outline item's `/Title` | **left** |
| a structure element's `/Alt` and `/E`, the element tagging the removed text | removed, by MuPDF |
| the same element's `/ActualText` | **left** |
| a covered annotation's `/Contents`, when a structure element points at the annotation | **left** |
| the page's `/PieceInfo`, and the catalogue's | **left** |
| an inline `/ActualText` in the content stream, `BDC` with no `MCID` | **left** |

Two of these are MuPDF's, read in its 1.28.0 source, `source/pdf/pdf-op-filter.c`:

- `update_mcid` writes the edited ActualText into **`/Alt`** (line 872: `PDF_NAME(Alt), tag->actualtext.utf8`), so the
  element's `/ActualText` keeps the removed text while `/Alt` receives what was meant for it. And it runs only for a
  tag that something flushed into the output; a tag whose whole content was removed is popped from the pending list
  with neither string written.
- An inline property list is kept as it arrived (`bdc->raw`); only an `MCID` leads to the strings the filter edits.

The third is this build's: `removeCoveredObjects` deletes the annotation from the page, and the structure tree's
object reference (`/OBJR`) still names it, so the collection that finishes a removal keeps it, `/Contents` and all.

## Decision

1. **Every object reference in the structure tree to an annotation the burn-in deleted is removed**, so nothing
   keeps the annotation alive and the collection takes it. An element left with no content loses its `/K`.
2. **Every structure element whose content is on a burned page loses `/Alt`, `/ActualText`, `/E` and `/T`**, and so
   does each of its ancestors. The element is found through the page's `/StructParents` entry in the parent tree,
   which is the format's own map from a page's marked content to its elements. The tags themselves stay, so the
   document remains tagged. **The page is the unit, not the mark**, for `/Thumb`'s reason: MuPDF's filter is what
   knows which characters went, it does not report them, and what it writes is not to be relied on (above). This
   build cannot tell which element's text was under a mark, so it takes the text alternates of every element on
   the page.
3. **A burned page's `/PieceInfo` goes, and any burn-in removes the catalogue's.** Private application data is a
   format for whatever an application chose to keep, an editor's whole original artwork included; no region maps
   to it.
4. **The page's named marked-content property lists lose `/ActualText`, `/Alt` and `/E`**, under `/Resources`
   `/Properties`, on a burned page, by Decision 2's reason.
5. **Any burn-in removes the document outline**, and `/PageMode /UseOutlines` with it. ADR-0079 Decision 4's reason,
   unchanged: no region maps to a title, and matching the removed text against one is a search whose silence is the
   reassuring answer.

## What this costs, said plainly

A redacted document loses its bookmarks, and the alternate text of every tagged element on a redacted page, a
figure's description included. A person using a screen reader hears less on those pages. The tags stay, so reading
order and roles do not change.

## Rejected

- **Scrubbing the outline titles that contain the removed text.** ADR-0079's rejected alternative for metadata, for
  the same reason: another spelling survives it and the check reports success.
- **Removing the whole structure tree.** It takes every page's tags for a mark on one, and a tagged document is the
  accessible one.
- **Keeping the alternates of elements whose text was not under a mark.** It needs the characters MuPDF removed per
  element, which its filter does not report; deciding it here would be a second opinion about MuPDF's own
  redaction.
- **Patching MuPDF's source.** No patch mechanism exists in this repository and the vendored source is pinned
  unmodified; adding one is a provisioning decision with its own review, and the owner's.

## What remains, and it is MuPDF's

**An inline `/ActualText` in a content stream on a burned page survives** (the last row above). Reaching it needs
the content stream parsed and rewritten, and this build's only parser of content streams is MuPDF's: the binding
exposes no processor, and a second parser here is the second opinion B3a forbids. The two routes are a shim export
that runs MuPDF's own filter with a processor dropping those keys, or MuPDF fixing both defects upstream. Either is
a native change and is put to the owner rather than taken inside this decision.

## The question left for the owner

Keep the bookmarks as an option in the redaction confirm dialog, off by default, as the title is (ADR-0079,
answered 2026-09-21)?
