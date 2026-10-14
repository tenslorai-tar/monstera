# ADR-0244 — Arrange reorders an object through PDFium's own list

- **Status:** Accepted
- **Date:** 2026-10-14
- **Decided by:** the owner's cloud run 4, Part 4 item E6: *"Add Arrange (bring forward, send back) to Properties."*

## The mechanism

What is drawn later is drawn on top, so an object's place in front of or behind another is its place in the page's
order. PDFium keeps each object with its own graphics state and clip, so taking one out of its page's list and putting
it back one place on keeps everything about how it is drawn and changes only what is drawn over what.

## Decision

1. **One command, `arrangePageObject`**: a page, an object's index in PDFium's walk, `forward` or `backward`, and a
   version. It moves the object one place in the page's list (`FPDFPage_RemoveObject`, then
   `FPDFPage_InsertObjectAtIndex`), regenerates, and reads back as every PDFium edit does. Undo moves it back.
2. **It does not keep the object walk**: every object between the two places changes index. The selection follows the
   object to its new index, since the command says where it went, and is otherwise dropped, ADR-0153 Decision 4's rule.
3. **Bring forward and Send backward are two commands in Properties and the object's menu**, shown for one object of
   page content that has a neighbour in that direction. A block of several objects, and a placed picture, whose writer
   is the annotation one, do not offer them.
4. **A page PDFium cannot write back is refused in words**, as a text move is ([ADR-0240](0240-an-objects-placement-is-edited-where-it-is-drawn.md)
   Decision 4): reordering regenerates the page's content, and a font it cannot re-encode loses text.

## Rejected

- **Moving the object's bytes in the content stream with MuPDF**, as ADR-0240 places one. A drawn object depends on
  the colour, line and `gs` state and the clip in force where it stands; at another place those can differ, so the move
  would have to rebuild every one of them, and a clip it cannot rebuild would be a second refusal. This is the route
  that would lift Decision 4's limit, and it is recorded as the follow-up.
- **To front and To back.** The owner asked for one step each way, which is what a crowded page needs.
