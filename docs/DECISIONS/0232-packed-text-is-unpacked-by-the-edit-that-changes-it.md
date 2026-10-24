# ADR-0232 — Packed text is unpacked by the edit that changes it

- **Status:** Accepted
- **Date:** 2026-10-12
- **Amends:** [ADR-0096](0096-text-is-edited-in-place-on-the-page-in-blocks-that-reflow.md) (a block edit may move a
  page's forms onto it before it writes) and the *Normalize-then-edit for text inside Form XObjects* row of
  `docs/FEATURES.md` (the separate *Unpack it* step is no longer how packed text becomes editable).
- **Decided by:** the owner's B1.26, approved in the text editing review's Phase 4: *text inside Form XObjects is edited
  directly, with no separate Unpack step*.

## Where it stood

PDFium's object walk does not descend into a form, so text inside one is found by the text page and named by no object:
the editor counted it (`unaddressable`) and offered *Unpack it*, a command of its own (`promoteFormObjects`) that moves
every form's content onto the page. A person had to find that sentence, press it, and then edit. The promotion is its own
command because it renumbers the page's objects, and PDFium cannot build a form back.

Two facts make a single step sound:

1. **The promotion is deterministic.** The same bytes promoted twice give the same objects in the same order, which
   `pageContent` already relies on: it promotes in the host's in-memory copy and reads, and nothing is saved.
2. **A block edit's undo is a checkpoint** (`editTextBlock` is not invertible), and its replay re-applies the intent to
   the same bytes. A promotion inside the edit is restored by the same checkpoint and replayed by the same intent.

## Decision

1. **The read unpacks in memory, only where text is packed.** Main's text-block read asks the PDFium host once as
   before. When that answer counts characters no object holds and the page's writer is `objects`, it asks again with
   `unpack`: the host promotes the page in its in-memory copy, reads, and saves nothing. The answer says `unpacked`, and
   its blocks are named by the promoted page's objects. A page with no packed text, or one whose forms carry no text, is
   read exactly as before and never promoted.
2. **The edit unpacks in the same command.** A block edit sent from an unpacked read carries `unpack: true`, and the
   PDFium apply promotes the page and then writes the edit, on one loaded page, answering one image: one command, one
   undo step. The version check is unchanged: the edit names the indices the read answered at that version.
3. **Every read that names an unpacked page's objects takes the same flag**: the run fonts the editor draws a block
   in are read from the promoted page too, so an index means one object everywhere.
4. **Packed text nobody edits is never moved.** Reading is in memory; only an edit sent from the unpacked read changes
   the page, and only the page it edits.
5. **The note and its button stay for what is still packed after an unpacked read**: a page whose writer is
   `operators` (Type 3 text) is not unpacked by the read, so it keeps the sentence that says so.

## Rejected

- **Unpacking when the editor opens a page.** It changes the document, marks it modified and adds an undo step when a
  person has only looked.
- **Unpacking every form on every edit.** A form that carries no text, a logo placed on every page, would be copied
  onto each page a person edits, and a page with no packed text would change for nothing.
- **Keeping the separate step.** It is what the owner's B1.26 removes.

## Correction, 2026-10-24 — no page is read unpacked, and *Unpack it* is offered only where it keeps the page

**Decisions 1 to 4 are unreached since [ADR-0266](0266-edit-text-writes-only-the-edited-blocks-own-instructions.md)'s
correction**: every page's Edit text changes go to the operator writer, and a page is read unpacked only where PDFium
writes it, which is now none. PDFium's unpacking write was measured disturbing every edit of a page with text in a form.

**Decision 5's button is a defect where it does nothing or moves text** (the owner, 2026-10-24: *"Offer it only where it
promotes the text without changing anything else on the page (check that before showing it); elsewhere do not show
it"*). Measured on the button's own command, before any edit: the owner's documents 3 and 6 kept every character in its
forms, so the button did nothing; the generated brochure's pull quote came out, and 121 of the page's 576 characters
moved 0.3 to 0.9 pt, 12,574 pixels changed, because the promotion's page rewrite drops the gaps a `TJ` writes.

**So Decision 5 is now:** where a page's plain read finds characters no object holds, the PDFium host tries the
promotion on its own copy of the read (`unpackKeepsThePage`): drawn at 144 dpi, promoted, saved, opened and drawn again.
The read says `unpackable` only where fewer characters are held in forms after it and the two drawings are the same in
every pixel; the editor offers *Unpack it* only then. Elsewhere the note stays, without the button, saying plainly that
the text is held where the editor cannot edit it. Measured: a page of text placed in a scaled form is offered; the
brochure's page and the owner's documents 3 and 6 are not.
