# ADR-0174 — A PDFium apply answers the characters it drew as boxes

- **Status:** Accepted
- **Date:** 2026-10-06
- **Amends:** `docs/ARCHITECTURE.md` §3's paragraph on what a byte-image `engine/apply` answers, and what
  `document.execute` answers a successful command with.
- **Relates:** [ADR-0173](0173-an-edits-word-its-font-cannot-carry-is-its-own-piece-in-the-resolvers-face.md) Decision 7
  (the box), [ADR-0172](0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md) Decision 8
  (the box and its report for the composers), [ADR-0047](0047-an-in-place-text-edit-is-a-byte-image-command.md) (PDFium
  is a byte-image writer), invariant 18 (`historyDropped`, the one success field a person is owed today).
- **Context:** Part B Phase 1, the owner's Q5 (a): *draw a visible missing-character box, keep the real character in
  the text, and tell the person which characters are affected and where.* ADR-0173 decides how an edit draws the box.
  Nothing decides how the person is told: a successful command carries nothing past `main` but its version, its length
  and `historyDropped`, at every hop (`pdfiumSpecs.ts`' `apply` answers a `ByteImage`, the host answers
  `{ bytes }`, the bus `{ entry, version, trimmed }`, `document.execute` `{ version, byteLength, historyDropped }`). So
  the edit today refuses a word with a character no face carries, naming it, which tells the person and changes
  nothing; the owner chose the box over that.

## Is this the right question

The question could be put as *how does the renderer find out which characters will be boxes*, and answered with a query
asked before the edit. That premise is the one to refuse: the characters drawn as boxes are decided by the resolver
over the faces the host holds, at the moment it lays out the edit, and a query beside the apply would be a second
computation of the same answer (B3a). Only the apply knows what it drew. So the question is how what the apply did
reaches the person, and the answer has to ride on the apply's own result.

## Decision

1. **A byte-image writer's apply answers what it wrote AND the characters it drew as boxes**: `Applied<'pdfium'>` is
   `{ image: ByteImage; boxed: readonly BoxedInEdit[] }` where it was a `ByteImage`, with `BoxedInEdit` the character
   and the 0-based page it is on. **Required, and an empty list rather than an absent field**, `historyDropped`'s rule:
   a field a person is owed is one a forwarding site cannot drop in silence (ADR-0069). PDFium is the only byte-image
   writer (`writerShapes`), so no other writer's apply changes. `invert` answers the same shape.
2. **The host's `engine/apply` and `engine/invert` answers for PDFium carry the list, capped at
   `MAX_BOXED_CHARACTERS` (64) and counted past it** (`more`), the compose channels' bound and form, so the answer's size
   does not scale with a document. Each entry's character is one code point, the contract's `boxedCharacterSchema`
   rule.
3. **The bus passes it through `Executed`**, required, and **`document.execute` answers it**: `boxed` (at most 64
   entries of a character and a page) and `more`. Undo and redo answer an empty list: a checkpoint restore and a stored
   result draw nothing, and the person was told when the edit was made.
4. **The renderer tells the person once, after the command has succeeded**: the boxed-characters dialog
   (`dialog.boxed-characters`, ADR-0172 Decision 8) names each character and the page it is on, and says the text keeps
   it, so search and copy still find it. The dialog takes an edit's entries beside an import's: one dialog for one
   finding, two kinds of place.
5. **An edit whose characters no face carries is no longer refused for them**: the box is drawn (ADR-0173 Decision 7)
   and the edit is saved, read back like every other.

## Rejected

- **A query asked before the edit.** The second opinion above, and a race with the faces the host holds.
- **A notice the host pushes outside the command's answer.** It would arrive in an order nothing ties to the command's
  success, and a renderer that missed it would show a box with no word about it.
- **Keeping the refusal.** The owner chose the box (Q5 a); the refusal stays only where the box cannot be made, a face
  with no U+25A1, which the bundled set does not have.
- **A general `notices` field on every command.** One field a person is owed, typed, is checkable; a bag of notices is a
  channel any command can put anything on, and nothing reads its contents' shape.

## Consequences

- Every forwarding site from `pdfiumSpecs.ts` to `document.execute` names the list, and a site that dropped it fails to
  compile.
- The fakes and test executions that answer a PDFium apply answer `{ image, boxed: [] }`.
- Replace (ADR-0173 Decision 9) reports its boxes the same way when it takes the pieces.
