# ADR-0089 — A two-document ask carries one window per document, inside the one bound

- **Status:** Accepted
- **Date:** 2026-09-22
- **Amends:** nothing. It widens `ai.ask`, which [ADR-0088](0088-an-ask-about-a-document-carries-a-bounded-window-read-in-main.md)
  shaped, and reads each document through the same `askWindow` in that document's own lane.
- **Relates:** [ADR-0035](0035-extracted-text-is-never-resident-in-main.md) (no resident text in
  `main`), ADR-0088 (the window, the page frame, the citations),
  [ADR-0083](0083-the-contextual-panel-holds-tabs-and-the-assistant-is-one.md) (one conversation
  per document).
- **Context:** the owner's assistant design of 2026-09-15: with two documents side by side the
  panel asks **Left · Right · Both** before sending, remembers the answer for the conversation,
  lets it be changed from the *Asking about* line, and never asks with one document. Split view's
  *focus follows the pane*, which the row said it needed first, landed on 2026-09-22.

## Decision

1. **`ai.ask` gains an optional `alongside`**: a second `about`, naming a **different** document
   in the **same** scope, `page` or `document`. The two carried scopes — a selection, a comment —
   never pair: each belongs to the one document it was made in. The schema refuses the other
   shapes rather than `main` deciding what they mean.

2. **The two windows share the one bound.** Each is read with half of `MAX_ASK_CONTEXT`, in its
   own document's lane, one after the other, so `main`'s resident text is what ADR-0088 already
   bounded — one window's worth plus a page — whatever the two documents' lengths.

3. **The page frame names the side, and only when there are two.** A paired window marks pages
   `[Left page 3]` and `[Right page 3]` and asks for citations as `[Left p. 3]` and `[Right p. 3]`;
   a one-document ask keeps `[Page 3]` and `[p. 3]`. The markers and `citationsIn` stay in
   `askAbout.ts`, the one place ADR-0088 put the frame, and a round trip through both is what the
   cases assert. *Left* and *Right* are words to the model, not interface text: they name where
   each document sits on the screen, which is what the person chose by.

4. **What went is answered for both.** The answer gains `alongside`, the second window's pages,
   characters and cut, present exactly when the ask had one; the turn shows both lines.

5. **The choice is the conversation's**, held in the document's store beside its turns and dropped
   with them. There is **no default**: with two documents shown and nothing chosen, Send waits for
   the choice rather than guessing — *Both* would send a document the person did not pick, and
   *Left* would answer a question about the right one with the wrong file. With one document shown
   the choice is not offered and not consulted.

6. **Right means the compared document.** Its page comes from the compare pane, which reports its
   own position to its own owner — never to the status bar, whose commands act on the first
   document (the compare row, 2026-09-22). A turn records the sides it was asked of and the right
   document's id, and a right-hand citation is a link only while that document is the one on the
   right, so a link never takes a person to a page of a file that has since changed places.

## Rejected

- **A list of documents.** The design names two, placed left and right; a list admits any number,
  and a bound divided by *n* is a window of nothing long before *n* is large.
- **One frame for both documents.** `[p. 3]` from a paired answer names two pages, and a link
  would have to guess which.
- **Defaulting to Both, or to the focused pane.** Either sends text on a choice nobody made, and
  BUILD-PROMPT's consent rule is that document content goes to a provider only on an explicit
  action.

## Consequences

- A paired whole-document question is answered from each document's first pages, half the window
  each, and both lines say how many — ADR-0088's consequence, twice.
- A fifth scope added to the contract must say whether it pairs; the schema's refinement is
  written over the scope names, so it is not silently pairable.
