# ADR-0269 — Text inside a form is edited in the form's own content, as text on the page is

- **Status:** Accepted
- **Date:** 2026-10-24
- **Supersedes:** [ADR-0232](0232-packed-text-is-unpacked-by-the-edit-that-changes-it.md) Decision 5 and its correction
  of 2026-10-24 (the note about packed text and the *Unpack it* button, offered where it keeps the page), and
  [ADR-0266](0266-edit-text-writes-only-the-edited-blocks-own-instructions.md)'s correction that text packed inside a
  form is not offered for editing. ADR-0232 Decisions 1 to 4 (reading and editing a page unpacked by PDFium) stay
  unreached, as that correction recorded.
- **Amends:** `docs/ARCHITECTURE.md` §3's in-place editing row.
- **Decided by:** the owner, 2026-10-24: *"I do not approve a button or a note about unpacking … a person who clicks text
  with Edit text simply expects to edit it … Make text inside a form XObject editable in place, by the same rule as item
  3: the operator writer changes ONLY the edited words' own bytes INSIDE that form's content stream; nothing else on the
  page or in the form is rewritten. If that form is used anywhere else … first give this placement its own copy so no
  other place changes. Never PDFium's page rewrite, never a visible unpack step."*

## Context

The operator writer (ADR-0176, ADR-0266) edits a page's own content stream, and PDFium's reading names the runs it
edits; PDFium's object walk does not descend into a form XObject, so text a form draws is read as characters no object
holds and was offered by unpacking it — PDFium promoting the form's objects onto the page and writing the page again.
Measured on 2026-10-24 (ADR-0232's correction): that promotion moved 121 of the brochure fixture's 576 characters and
took nothing out of the owner's documents 3 and 6.

Read on 2026-10-24 (scratch `formShape.mjs`), the shapes this must handle: document 3 draws each page through one form
of 2,111 and 2,662 showing operators, with forms nested inside it, several of them holding text, every one a
transparency group (`/Group`), each used in one place — which is why PDFium promoted nothing; document 6 draws 59 of its
operators through one form with no group; the brochure fixture draws its pull quote through one form.

## Decisions

1. **Every placement of a form whose own stream shows text is read as a page of its own.** A placement is the path of
   `Do` operators from the page down to the form — each a resource name and which occurrence of it — and the CTM in effect
   at the last one, times the form's `/Matrix`. MuPDF builds, in memory and saved nowhere, a document of one page per
   placement: the page's boxes and rotation, the form's resources, and as content the form's own stream inside
   `q <that matrix> cm … Q`. PDFium reads each such page as it reads a page; its blocks are offered among the page's own,
   in the page's user space, each carrying its placement (`form`).
2. **An edit of such a block is `editTextOperators` carrying `form`.** The MuPDF writer builds the same wrapped content,
   runs the operator edit on it with the form's fonts and PDFium's pre-read of the same placement's page, and writes the
   result back as the form's stream, the wrapper's bytes taken off again unchanged. A font the edit adds goes into the
   form's `/Resources /Font`. Nothing else is written: not the page's content, not another form, not the form's other
   operators — the operator writer's own rule (ADR-0176 Decision 4) applied to the form's stream.
3. **A form used in more than one place is copied for this placement first**: a new stream with the same dictionary and
   content, under a fresh name in the resources of the stream that places it, and that one `Do`'s operand renamed to it.
   That name is the one byte changed outside the form; the copy is what is edited, so no other placement changes.
4. **It is read back as every operator edit is**: the structural check on the wrapped content (every operator outside the
   edit byte for byte, every inserted one reading as the words drawn), and MuPDF's reading of the real page holding each
   line the edit set.
5. **The note about packed text and the *Unpack it* button are removed.** `promoteFormObjects` stays registered, sent by
   no surface. A form's text a placement's page does not yield blocks for (text set at an angle, say) is said as text on
   the page is.
6. **A block in a form pushes nothing and is pushed by nothing**: ADR-0249's columns are the page's, measured among the
   page's blocks.

## Rejected

- **Unpacking automatically** (the owner's first answer A): measured, it moves text on the brochure and does nothing on
  documents 3 and 6.
- **Inlining the form into the page's content**: it rewrites the page's stream for every form it touches, and drops what
  a transparency group composites as one.
- **PDFium's page rewrite**: ADR-0266.

## Correction, 2026-10-25 — a form's `/BBox` grows to hold the words written in it

Decision 2 wrote only the form's stream, and measured on the brochure fixture that is not enough: its pull-quote form
has `/BBox [0 -4 260 18]`, 22 points round one 14-point line, and a form draws nothing outside its `/BBox` (ISO 32000-2,
8.10.1). A replacement that made the line longer wrapped its last word to a second line below −4, and that word was
written and not drawn — the person's typing, out of sight, which the owner's rule of ADR-0270 forbids as surely as a
refusal.

**So the form's `/BBox` is the one other value an edit in a form writes**: after the stream, it becomes the union of the
box it had and every character the form's content now draws, read by MuPDF from the form's content alone in its own
space. It only ever grows, and only where the form's own text lies; nothing that was drawn stops being drawn. What it
can show that was not shown before is content of the same form lying inside the grown strip and outside the old box —
content the form's author clipped — and that is stated rather than ruled out: none of the 9 placements in the corpus and
the brochure (scratch `formDepth.mjs`, 2026-10-25) is a case of it, and a form edited is copied first (Decision 3), so no
other placement shows it.

Rejected: wrapping at the box's width and stopping at its foot, which drops words; and moving the text up to stay inside
the box, which moves the words the person did not edit.

## Correction, 2026-10-25 — a placement is read in the state the form inherits at its `Do`

Decision 1's wrapper was the placement's matrices alone, and a form is drawn in the whole graphics state in effect at its
`Do` (ISO 32000-2, 8.10.1), text state and colour included. Measured on the brochure fixture: its page sets `0.3 Tc`
before the pull quote's `Do`, so the quote is drawn wider on the page than PDFium read it on a page of its own, and an
edit laid out against the narrower reading moved its last letter — 33 to 35 pixels outside the block on every edit of it.

**The wrapper opens each step with the instructions in effect at that `Do`** — the text state, the line state and the
colour, as the content scanner already records them for a text operator — before the step's matrices. One that names a
resource of the holder is left out (`Tf`, `gs`, a colour space by name and the colours set in it), since the form's own
resources need not hold the name, and a form that uses those sets them itself. Measured after: every edit of the
brochure's form blocks disturbs nothing.

## Correction, 2026-10-25 — a form's block pushes the blocks below it in the same form

Decision 6 had a form's block push nothing, and measured on document 6 that is the page's rule left out rather than a
rule: 7 of its form blocks' added words wrapped onto the table cell below, up to 11 points away, where a block of the
page's own content in the same place pushes that cell down (ADR-0249) and disturbs nothing. **A form's block pushes as
the page's do, among the blocks of its own placement**: `pushesOfPage` over that placement's blocks, read in the same
page box, the blocks below named by their place in the page's whole list. A push never crosses a stream, for the reason
a join does not (one command writes one stream). Nothing outside the form pushes into it or is pushed by it.
