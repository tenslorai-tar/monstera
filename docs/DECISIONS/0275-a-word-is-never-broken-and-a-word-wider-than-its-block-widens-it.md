# ADR-0275 — A word is never broken, and a word wider than its block widens it

- **Status:** Accepted
- **Date:** 2026-10-29
- **Decided by:** the owner, cloud run 25's item 25a, 2026-10-29: *the writer never breaks inside a word, and a word
  wider than its box grows the box.*
- **Supersedes:** [ADR-0179](0179-a-paragraph-is-the-editors-unit-and-a-reflow-keeps-each-word-in-its-own-style.md)'s
  rule that *a word wider than the measure is broken last, by grapheme* (its Proofs, `paragraphFlow.test.ts`). Nothing
  else of ADR-0179 changes.

## Context

A reference marker such as *[13] [1]* is a block about 17 pt wide. A person who opened one, pressed End and typed
*" with added words"* got, through the kernel, the words chopped two letters to a line (the local agent's corpus run on
the owner's document at cea3c7bb, 2026-10-28). The mechanism is ADR-0179's last resort, `breakWide` in
`paragraphFlow.ts`: a word wider than a whole line is broken between grapheme clusters, so in a block narrower than a
word every word is cut wherever the measure falls. The editor did the same on screen, by `overflow-wrap: break-word` on
its surface, so the two agreed, and both were wrong in the same place.

The repository already held a second opinion about the same question: PDFium's writer (`pdfiumFfi.ts`, the wrap rule
of `editTextBlock`) says *a single word wider than the block is left as it is: there is nowhere to break it.* Two
writers, two answers.

## Decisions

1. **A word is never broken between its letters by Edit text** — not by the editor, not by either writer. A line still
   ends only where `breakOpportunities` allows; between the characters of a script written without spaces that is
   between characters, as before, because each character there is a word for breaking.
2. **A word wider than its block's measure widens the measure to that word, for the whole block.** The editor's surface
   is at least as wide as its longest word (`min-content`) and does not break a word, and its frame takes the width its
   words reach, so the person sees the box grow. The operator writer raises a paragraph's limits to the widest word of
   the new words (`planBlock`), so every line of the block wraps at the width the editor shows and the two still break
   each line in one place. PDFium's writer already leaves such a word whole; Edit text routes no page to it since
   ADR-0266, and its rule now agrees with this one.
3. **The block's other bounds are unchanged.** A one-line block still grows right to its reach (`oneLineReach`) before
   it wraps; a measure the person gave is still the measure, unless a word is wider than it, which widens it as above.

## Rejected alternatives

- **Break the word, as ADR-0179 did.** It is what the person saw: their words cut into pieces of two letters, read back
  as many short words, which no search finds.
- **Make the type smaller until the word fits.** It changes a size nobody asked to change, and a long address in a
  narrow column would be set at an unreadable size.
- **Refuse the edit.** ADR-0270: Edit text never refuses what a person typed.

## Proofs

- `paragraphFlow.test.ts`: a word wider than a whole line is set on a line of its own, whole, and the paragraph's other
  lines wrap at the widened measure. **Control:** ADR-0179's case, which broke the same word by grapheme, is the case
  this one replaces; with `breakWide` restored it fails.
- The rendered case for 25a: the editor's frame over a reference marker grows as words are typed past its edge.
