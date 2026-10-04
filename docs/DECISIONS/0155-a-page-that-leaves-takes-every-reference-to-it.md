# ADR-0155 — A page that leaves takes every reference to it

- **Status:** Accepted
- **Date:** 2026-10-04
- **Decided by:** the owner, in the follow-up to 12a on the cloud-4 list: *"Deleting pages clears every reference to
  the deleted pages, in the same apply as the page delete (the same place ADR 0151 removes the widgets and prunes the
  field tree). Do not stop at outline entries and links. First list, from the PDF specification, every kind of
  reference that can name a page object, measure each one with a fixture, and clear each one."* With the local
  agent's L1 from its live review of main: after a delete, bookmarks and links to the deleted page are still there
  and go nowhere.
- **Amends:** [ADR-0151](0151-every-full-save-collects-and-a-deleted-page-takes-its-fields.md). Its mechanism 3 says
  that once the widgets are out and the tree is pruned, *"the widget, its answer and the whole deleted page are
  orphans"*. That holds only when nothing else names the page. This completes its decision 1 and corrects its
  field pruning, which `/AcroForm /CO` defeats.
- **Supersedes:** `pageExtract.ts`' 12b rule that a bookmark or link to a page not taken *"stays and goes nowhere"*,
  and its `cutPagesLeftBehind`, which becomes the last step of the one rule below.

## The problem, measured

Measured 2026-10-04 against MuPDF 1.28.0, with `@cantoo/pdf-lib` reading the saved bytes back by walking every
indirect object rather than the catalog. Each fixture is three pages; page 2 alone draws a unique string, and one
reference of one kind names page 2. Page 2 is deleted and the document saved, which collects (ADR-0151).

| what names page 2 | page objects after | page 2's text in the file |
|---|---|---|
| nothing (the control) | 2 | no |
| an outline entry's `/Dest`, its `/A` GoTo, or a `/Dest` by name | 3 | **yes** |
| a link's `/Dest`, its `/A` GoTo, or a `/Dest` by name | 3 | **yes** |
| the catalog's `/Dests`, or the `/Names /Dests` tree | 3 | **yes** |
| `/OpenAction`, as a destination or as a GoTo action | 3 | **yes** |
| a structure element's `/Pg`, a marked-content reference's `/Pg`, an object reference's `/Pg` | 3 | **yes** |
| an article thread's bead | 3 | **yes** |
| a reply's `/IRT`, or a popup's `/Parent`, naming an annotation on page 2 | 3 | **yes** |
| the `/Names /Pages` tree | 3 | **yes** |
| a GoTo in a page's `/AA`, an annotation's `/AA` or the catalog's `/AA` | 3 | **yes** |
| a Hide action naming an annotation on page 2 | 3 | **yes** |
| a GoTo reached through another action's `/Next` | 3 | **yes** |
| a field with its widget on page 2, listed in `/AcroForm /CO` | 2 | no, but **the field's answer is** |

Twenty-two kinds, and every one keeps the deleted page and what it draws. The last row is ADR-0151's own pruning:
the field leaves `/Fields`, and the calculation order still names it, so its value is written.

The same measurement on the other commands that take pages out or bring pages in:

| what ran | page objects | page objects the document has | the left-out page's text |
|---|---|---|---|
| *Insert from PDF* of a source's page 1, whose link names its page 2 | 5 | 4 | **yes** |
| *Replace page* on page 2, which an outline entry names | 4 | 3 | **yes** |

A graft follows every reference, so the source's page 2 came in with the link; the replaced page stays because the
bookmark still names it.

**The visible half is the same defect.** A bookmark or link that names a page the document no longer holds is drawn
and goes nowhere.

## The decision

1. **One rule, in one function, for every command after which a page may be outside the document:** delete, replace,
   merge and *Insert from PDF*, the undo of an insert or a duplicate, and an extract's new file. A page is *outside*
   when it is a page dictionary that is neither a leaf of the page tree nor a named template (`/Names /Templates`,
   whose pages are outside the tree by design). The function runs after the tree is rewritten, in the same apply.
2. **Each kind is cleared the way its own structure says, so nothing is left going nowhere:**

   | kind | what happens |
   |---|---|
   | outline entry whose destination is outside | removed; with children it stays as a heading with no destination, so the children are kept. `/Count` is recomputed on every changed ancestor, its sign (open or closed) kept |
   | link whose `/Dest` is outside, or whose actions are all removed | removed from its page |
   | an action chain anywhere (`/A`, every `/AA`, `/OpenAction`) | a GoTo to an outside page, a Thread action to a removed bead or thread, and a Hide's targets on an outside page are taken out of the chain; the rest of the chain stays, and an emptied key is deleted |
   | `/OpenAction` as a destination | deleted, so the document opens at its first page |
   | `/Dests`, `/Names /Dests`, `/Names /Pages` | the entry is removed, and a tree's `/Limits` stay right |
   | structure tree | content items on outside pages are removed, an element left with no content is removed, and so are their `/ParentTree` and `/IDTree` entries; an element that keeps content elsewhere loses only its `/Pg` |
   | article thread | beads on outside pages are unlinked; a thread with none left is removed |
   | annotations on kept pages | a reply's `/IRT` to an annotation that left is deleted, and the reply stays as a comment of its own; a popup whose parent left is removed; a `/P` naming an outside page names the page that holds it |
   | `/AcroForm /CO` | a field no longer in the field tree is removed from it, for every caller of the pruning, `deleteFormFields` included |
   | anything else | a walk of every object from the trailer replaces any reference still naming an outside page with null (12b's walk, now the last step). A kind this list does not know can then keep what it names, never the page |

3. **A replaced page's destinations follow the page that replaced it.** For *Replace page*, an outline entry, a link,
   a named destination or `/OpenAction` that named a replaced page names its replacement; everything that belonged to
   the old page's content (structure, beads, its annotations' relations) is cleared as for a delete. Where a run of
   pages is replaced by a different number, the *n*-th replaced page is followed by the *n*-th page placed, or by the
   last one placed.
4. **Undo restores every reference exactly.** A delete, a replace and a merge are undone from the checkpoint the bus
   took before them (ADR-0037), not by an inverse, so nothing here adds prior state. The undo of an insert or a
   duplicate is itself a removal and runs the rule: what it takes out is a page added by the command being undone, and
   every command after it has been undone first.

## What is left, stated

- **Page labels name pages by position, not by reference**, so they keep no page in the file. They are also left as
  they were: measured, after deleting page 1 of a document numbered *i, ii, 1*, `/PageLabels` still reads `[0 /r 2 /D]`
  and the remaining pages read *i, ii*. The same is true after a move, an insert or a duplicate. That is a defect of
  every page-order command, and it is a separate item.
- **A signed document's ordinary save appends** (ADR-0151's first limit), so the earlier revision still holds the page
  and every reference to it.
- **The fallback's null is the format's *absent***, not a repair. A private structure that named the page now names
  nothing, which is what is true of it.

## Rejected alternatives

- **MuPDF's `rearrangePages` with the structure kept.** It holds the rules for outlines and links this follows
  (`pdf-clean-file.c`'s `strip_outline` and the link loop in `pdf_rearrange_pages_imp`, MuPDF 1.28.0), and it rebuilds
  the catalog from `/Type`, `/Pages`, `/Outlines`, `/OCProperties` and the structure tree alone. The form, the
  open action, the threads, the page labels and every other catalog entry go. That is ADR-0006's reason for banning it,
  read in the source.
- **Clear outline entries and links only.** The owner's L1, and the measurement's other twenty kinds still keep the
  page and its text.
- **The null walk alone**, as 12b did. It frees the page, and leaves every bookmark and link drawn and going nowhere,
  which is L1.
- **Clear a replaced page's destinations as a delete does.** It drops a bookmark the person did not remove, for a
  page that is still there under a different object.
- **Leave the source's dead links when pages are inserted.** The measurement's insert row: the page left out comes in
  with them.
