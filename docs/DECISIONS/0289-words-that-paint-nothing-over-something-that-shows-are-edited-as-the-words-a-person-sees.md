# ADR-0289 — Words that paint nothing over something that shows are edited as the words a person sees

- **Status:** Accepted
- **Date:** 2026-11-07
- **Amends:** [ADR-0181](0181-right-to-left-text-is-written-in-drawing-order-and-read-back-as-typed.md) Decision 9 (*an edit of
  recognised words, set invisibly over their picture*) and its stated bound (*recognised words are edited as a scan only where
  they lie over an image object*), and [ADR-0187](0187-a-scans-edited-words-are-covered-where-the-ink-is-with-the-paper-that-is-there.md)'s
  limit on what is covered.
- **Relates:** [ADR-0179](0179-a-paragraph-is-the-editors-unit-and-a-reflow-keeps-each-word-in-its-own-style.md) (invisible text
  over nothing stays invisible), [ADR-0176](0176-a-page-holding-type-3-text-is-edited-in-its-own-content-stream-by-mupdf.md)'s
  corrections of 2026-10-25, [ADR-0271](0271-the-edit-text-editor-is-rebuilt-on-the-kept-writer.md)'s correction of 2026-10-26.
- **Context:** The owner's decision of 2026-11-07. A corpus page draws its heading's words as white filled shapes on a blue
  ground, and lays over them a Type 3 font of 46 letters none of which paints anything, so that the words can be selected.
  Measured on that page on 2026-11-06: a new word saved black on blue, because the writer took the words for ordinary text in
  the page's own colour, `0 0 0 rg`, which no letter of that font ever showed. The drawn words stayed where they were. The
  owner: *treat it the way we already treat a scan's recognised words; the person must be able to change the words they can
  see, with no refusal.*

## Is this the right question

*How do we add a second check beside `overAScan` for a font of empty letters over a drawing?* That is the wrong question, and
it would be the fourth opinion about one thing. Today's check asks two things of the shape a recogniser happens to write:
render mode 3, and an image object. Neither is what makes these words a scan's. What makes them one is what a person sees:

- **The words paint nothing.** Render mode 3 is one way to do that; a font whose letters are empty is another.
- **What a person reads there is something else that the page draws.** A picture is one such thing, and a drawing is another.
  A form that holds either is a third, and a page walk that lists objects by kind does not enter a form.

The second half is a question the page as drawn already answers, without naming a kind of object at all.

## Decision

1. **The one rule (`wordsThatShowUnder`, `paperColour.ts`).** A run is words over what shows when **every operator of it paints
   nothing**, and **the page as drawn shows something in its box**: pixels that differ from the background round the box, by the
   one test ADR-0187 already has for ink (`INK_THRESHOLD`, against the plane fitted to the ring). Both writers take it. There
   is no second check by object kind: `overAScan` and `recognisedOverPictures` no longer look for an image.
2. **A font of empty letters says so (`PageFont.paintsNothing`).** A Type 3 font every letter of which has a procedure that sets
   its width and paints nothing. It is the whole font and not a letter, since a real font's space is an empty letter. **It is no
   face for a word that is to be seen**, by the rule `carrier` already applies, and the closest normal face is taken. A letter
   drawn as an image mask, or by any operator this does not recognise, is a letter that paints.
3. **The new words take the colour of the words they replace, read from the same pixels.** The ink's colour in the box, from the
   pixels furthest from the background, which leaves out a stroke's soft edge. This replaces the colour in force in the
   content, which on such a page is one no letter ever showed. It is the scan route's colour too: on a scan it is the ink the
   page's words were scanned in, where it used to be whatever the recogniser's layer set. A colour the person chose with a mark
   wins over it, as it does over any source colour.
4. **The cover and the visible line are ADR-0187's and ADR-0271's**, unchanged: the old ink is covered with the background that
   is there, a plane fitted to the ring and a grid where it shades, above what drew it and below the new words; the line an edit
   reaches is drawn whole; a line it does not reach is left as its bytes.
5. **What stays:** invisible text with nothing showing under it stays invisible with nothing covered (ADR-0179), a word typed
   into a run of empty letters over nothing that shows included, since such a word goes to another font and is set in render
   mode 3. A page with no such runs is drawn for nothing: the page is rastered only where an edited block has a run that paints
   nothing.

## Limits stated now

- **A full picture with nothing in the box.** Recognised words over a blank stretch of a scan used to count as a scan, because
  they lay over an image, and an edit drew them. They now stay invisible, because a person sees no words there to change. The
  fixture in `editCatalogue.mjs` that drew one flat grey picture changes for this reason.
- **Something drawn after the words.** The raster holds the whole page, and a cover stands where the words stand. Words laid
  under a picture, or under visible text drawn later, are found to have something showing, and the cover and the new words stay
  beneath it, so what the person sees does not change. It did not change before this decision either.
- **Text at an angle in a frame** (ADR-0273) keeps its old answer, no scan: the run's box there is in the frame's space and the
  raster's map is the page's.
- **Ink of several colours in one run** takes the middle of them: one new word has one colour.

## Rejected alternatives

- **A second check beside `overAScan`, for empty letters over path objects.** It would leave pictures and drawings as two
  answers to one question, it would still not enter a form, and any drawn rectangle under hidden text would count: a page whose
  first instruction fills it white would turn every hidden word visible.
- **Offering to place new text, or saying the words cannot be changed.** The two options first brought to the owner, and neither
  was taken: a person is never refused because of their document.
- **Removing the white drawn words rather than covering them.** It would need the words' shapes told from every other shape on
  the page, and it changes what the page drew, which ADR-0187 keeps: nothing is dropped, and one Undo puts the page back.
- **The colour of the first ink pixel found, or the median of all of them.** The soft edge of a stroke is a mix of ink and
  background, so a median of everything reads lighter on a dark ground and darker on a light one.

## Correction, 2026-11-07: the editor draws the same colour

Decision 3 said what is written and was silent about what is typed. Run on the corpus page, the saved words were white and the
words being typed were black, because the editor draws a run in the colour PDFium read for it, which is the one no letter ever
showed. The read on open (`document.blockFaces`, ADR-0271) now carries the colour for each font (`BlockFont.ink`), from the same
`paintsNothingIn` and `inkShowingIn` the writer takes, and the editor draws in it (`inkOfFaces`). Not a second reading of the
page in the renderer, which would be a second opinion about what the writer will do (B3a).

## Correction, 2026-11-07: no fixture changed

The first limit above says the fixture in `editCatalogue.mjs` *changes* because it draws one flat grey picture. That was read from
the fixture's one-line description and not run. Its picture has ink where the words are, and all 25 catalogue cases pass on the
rule unchanged. The limit itself stands: recognised words over a blank stretch of a scan now stay invisible.
