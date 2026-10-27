# ADR-0273 — Text set at an angle is edited in its own frame

- **Status:** Accepted
- **Date:** 2026-10-27
- **Decided by:** the owner, 2026-10-27: *find out which is true in the rebuilt editor … fix every one that can be
  fixed, so the block opens and the writer writes it, with the catalogue's expectations holding*, under the owner's rule
  *never refuse an edit*.
- **Supersedes:** [ADR-0181](0181-right-to-left-text-is-written-in-drawing-order-and-read-back-as-typed.md) Decision 7
  (*the editor says what it cannot edit, by kind*) and the rule it rests on, `isEditedInPlace` in `textLines.ts`
  (*an editor cannot be placed along an axis the page is not set on*). Amends the block edit's two text bounds
  ([ADR-0142](0142-a-text-edit-carries-one-list-of-objects-and-one-text.md)'s `MAX_EDIT_TEXT`, and
  `MAX_INSERT_TEXT`).

## Which was true

The help said text that is turned, slanted or mirrored, or that runs up or down the page, *can't be edited in place*,
and the catalogue (shapes 18 and 30) requires turned and slanted text to be edited with nothing refused. **The help was
true of the rebuilt editor, and the catalogue's requirement was met by nothing a person can reach**, measured
2026-10-27 on this cloud machine:

- the read leaves every run that is not upright out of the blocks before grouping (`composition.ts`, `isEditedInPlace`),
  so no outline is drawn and nothing opens; the editor says one sentence per kind;
- the operator writer refuses such a run at its first position (`placed`, `transformed / not-upright`);
- the catalogue's writer walk filters the same runs before grouping, so shapes 18, 21 (a turned page whose text is set
  turned to read upright) and 30 answer *NOT SENT: the grouping offers no block*. `proof:editcatalogue` passes because
  it proves the expectations against the catalogue's own correct edit, never through the read or the writer.

## Decisions

1. **A run set at an angle is read in its frame.** Its frame is the turn, slant or flip its text matrix and CTM give its
   letters: the linear part, scaled to unit length along the line. In its frame the run is upright, so it is grouped by
   the grouping every upright run takes (`groupIntoBlocks`), with the runs of the same frame only, and its block crosses
   to the editor with its `frame` and every box and baseline in the frame's coordinates. Upright text has no frame and
   is read exactly as before. One grouping serves the editor's read and the catalogue's walk, so the two cannot disagree
   about what a block is (B3a).
2. **The editor draws a framed block turned, slanted or flipped as the page draws it**, through the one page transform
   with the frame composed before it: its corner placed where the page puts it, and a CSS matrix made from the transform
   itself, never from an angle worked out apart. A drag, a nudge and a handle are measured back through the same
   transform, so a move is a move in the block's own frame.
3. **The writer lays a framed block out as the upright block it is in its frame.** Every position it works out comes
   from a text matrix times a CTM, and every new object is placed through the inverse of the CTM where it stands. Seen
   through the frame's inverse a framed block is upright, so the frame is applied once, to the CTMs and the marked rules
   the writer reads, and the layout is the upright one, untouched: the matrices it writes come out multiplied by the
   frame. **No second layout.** An upright edit reads no frame and is byte for byte what it was (the catalogue's writer
   walk before and after: identical on every upright shape).
4. **Nothing is left out for its angle, so nothing is counted for it.** The contract's `rotated` and `angled` counts and
   the four sentences that named them are removed; a field that could only ever read zero is an illegal state kept
   representable (B5).
5. **An added box carries as much as the person types into it, to what one command can cross.** `MAX_INSERT_TEXT` was
   4,096 on the ground that an added box is typed by hand; a paste past it failed the wire's schema and reached the
   person as *Something went wrong*. The two text bounds share the 8 MiB file a writer command crosses in
   (`commands.test.ts`, at the worst encoding): the block edit's `MAX_EDIT_TEXT` goes from 786,432 to 524,288 characters
   (the densest page measured holds a few thousand), and an added box's from 4,096 to 131,072.
6. **A form placement's read that was cut is said.** A form's own `truncated` was not read, and placements past the
   contract's path bounds were dropped without a word; both now set the page's `truncated`, which the editor says.

## What still stops an edit, and why each is impossible to honour

- **A page whose content and PDFium disagree about its text objects** (`numbering`). Which instructions draw the run the
  person edited cannot be known; writing a guess changes words the person did not touch.
- **A font that states no width the layout needs** (`unknown-width`). Every glyph after the gap would be placed by a
  guessed advance and so move; ADR-0270's guarantee that nothing outside the edit moves forbids it.
- **A line drawn through a clip the new object cannot share** (`lines-under-different-ctms` where the windows differ).
  One new object has one clip; writing the line outside its clip shows words the page hid, or hides words it showed.
- **A CTM with no inverse where the new object stands** (`singular-ctm`, `content-end`). Such text is drawn at no size;
  there is no space to place a word in.
- **A protected document that cannot be saved with its protection as it was** (`protection-not-reproducible`). Writing
  it would drop the protection, and the owner's rule is *preserve, never drop*.
- **A signed document the person chooses to keep verifying** (`held`). The person's own answer, not a refusal.
- **A command past the 8 MiB a writer command crosses in** (Decision 5's bounds). Past 131,072 characters in one added
  box, or 524,288 in one block edit, there is no file to carry it in; neither holds on a page anyone can read.

## Rejected

- **Open a framed block level, over the page, and write it back turned.** Simpler to draw, and the person loses the
  place they were editing: the words they type are not where the page shows them.
- **Teach the writer to lay out along any axis.** A second layout beside the upright one, every rule of which (wrap,
  justify, rise, decorations, covers) would have to be written twice and agree. Decision 3's one coordinate change
  reuses the one layout.
- **Keep the counts at zero.** A count that cannot be anything but zero is read by a surface as a fact about the page.
