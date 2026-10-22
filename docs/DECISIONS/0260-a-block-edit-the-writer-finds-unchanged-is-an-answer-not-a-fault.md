# ADR-0260 — A block edit the writer finds unchanged is an answer, not a fault

- **Status:** Accepted
- **Date:** 2026-10-22
- **Amends:** the contract's `document.execute` failures, by one code, `text-unchanged`; ADR-0096's block edit, whose
  writer threw a plain `Error` when its plan wrote nothing. Keeps ADR-0169 Decision 6's `nothing-to-replace` as a
  replacement's alone, and the editor's own *unchanged* judgement (`commitTextBlock`) as the first of the two.
- **Decided by:** the owner, 2026-10-22 ~12:50, answering the question of ~11:55 (`owner-questions.md`): option (a),
  with the condition *"never a stuck editor, never a silent loss"*.

## Context

The text walk's step 9 (a handwritten scan recognised from Edit text's note, then a word edited) failed in 2 of 4 solo
runs. The PDFium host's log of a failing run: `layOutBlocks` threw *"A block edit on page 0 changed nothing"* as a plain
`Error`, so the host answered `engine-refused`, main answered `internal` with an incident, the person read no sentence
of their own, and the editor stayed open with nothing to say (the walk waited 120 s).

Two opinions about one question. The renderer sends an edit only when the words or their formatting differ from the
block it read (`commitTextBlock`); the writer diffs the same words, by the same join, against the page's objects and
generates nothing when nothing differs. Where the renderer sent and the writer found nothing to write, one of them was
wrong, and the person was told neither.

Measured on the step's own recognised page (`recognised.pdf`, the host's snapshot, 7 recognised blocks), in process:

| the words sent | blocks written | blocks answering *changed nothing* |
|---|---|---|
| the block's words exactly | 0 | 7 |
| the block's words, trimmed (three end in a space) | 3 | 4, the four with nothing to trim |
| the block's words and ` (walked)` | 7 | 0 |

So on that page the writer refuses exactly the words that are the page's, and writes any that are not, to a trailing
space. The failing runs' edits reached the writer carrying the page's own words: the ` (walked)` the walk typed was not
in them. Why the renderer then judged a change (keys typed before the editor took them, or formatting carried from an
earlier step) was not captured: with a capture in the host, eight runs of the step on 2026-10-22 sent four edits, all
written, and four sent none (a 2 by 3.5 px block the press missed).

## Decision

1. **The writer decides between the two cases itself, from the edit.** Where its plan wrote, removed, placed and inserted
   nothing, it compares each block's words with the words the page holds for the runs the block names, by the join the
   renderer used (`paragraphsOfLines`, soft breaks as spaces). Every block's words equal, and no block carrying marks,
   paragraph settings, a place or a push, and no added box: `BlockUnchangedError`. Anything else, `EditRefusedError` at
   step `set-text`: the person sent a change and none of it could be written.
2. **`text-unchanged` crosses every boundary as a code** — the PDFium host's `engine/apply`, main's `document.execute` —
   for `nothing-to-replace`'s reason: it is not a fault, so it is never `internal` and never an incident.
3. **The editor closes on it with nothing changed and nothing said**, as it does when it judges the words unchanged
   itself: `sendBlockEdit` answers `unchanged`. No version moves, no dialog opens.
4. **The other case keeps the existing refusal**: *"Monstera couldn't write that text onto the page, so nothing was
   changed."* under the words, with *"Press Esc to put the text back."*, and the editor stays open with what was typed.

## Rejected

- **Reusing `nothing-to-replace`.** No contract change, but the person would read a replacement's words for an Edit text
  commit, and the code would mean two things to every reader of it.
- **Closing the editor on any edit the writer wrote nothing for.** Silent where the words differ: the person's typing
  disappears with no sentence, which is the loss the owner ruled out.
- **Making the renderer's judgement agree and dropping the writer's.** The renderer cannot see the page's objects; the
  writer is the one that knows whether its plan wrote anything. Both judgements stay, and the second one now answers.

## Proof

Kernel: an edit carrying a block's own words answers `BlockUnchangedError`; the same edit with a mark answers
`EditRefusedError` at `set-text`; control: one changed word writes. Host: the code crosses `engine/apply`. UI: the
editor closes on `text-unchanged` and keeps the words and the sentence on the refusal. Then the text walk, alone.
