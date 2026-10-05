# ADR-0169 — A PDFium rewrite is saved only when it reads back as edited, and a refusal says which step refused

- **Status:** Accepted
- **Date:** 2026-10-05
- **Decided by:** the owner, Part B of the text-editing rebuild, Phase 0: *"nothing lost: after any PDFium page rewrite
  (7 commands) reopen and require untouched text objects unchanged, else refuse and save nothing (prove with
  chromium-type3.pdf, case per command, control); plain sentence per reason from a fixed step code (open, page, text
  object, set text, matrix, generate, save, read-back), host forwards code + PDFium error number; "This page uses a font
  Monstera can't rewrite yet, so nothing was changed"; fix hand-made Type 3 case message; typed words stay on refusal;
  text-not-writable names characters; replace takes editor safety (fallback, read-back, push later runs); empty
  replacement; no-match replace makes no new version; password docs reach PDFium."*
- **Amends:** ADR-0009 §9's 2026-08-19 decision that a declared failure is *a code, and the code is the whole of what
  happened*, by letting a code carry a declared detail (Decision 4); ADR-0096 and ADR-0097's read-backs, which read
  what was written and nothing else (Decision 1); and `pdfiumHandlers.ts`' rule that a refusal's cause is discarded.
- **Keeps:** ADR-0047's byte-image shape, ADR-0096's blocks and ADR-0097's standard-font twin, ADR-0149's held outcome,
  ADR-0153, ADR-0154, and ADR-0156's `replaceTextAt` and Spelling panel.

## The problem

A page that carries a Type 3 font loses text whenever PDFium rewrites it, and every refusal on the way says
*Something went wrong*.

Measured 2026-10-04 by the local agent on main 0ea30eed with PDFium 155.0.8044.0 (`scripts/research/fontKindEdits.mjs`),
and again on 2026-10-05 in a cloud session on PDFium 155.0.8044.0's Linux build under Electron 43.7.7 in Node mode, with
the same results:

- `FPDFPage_GenerateContent` writes a Type 3 text object with no `Tf`, no text and no `ET`
  (`CPDF_PageContentGenerator::ProcessText` names a font only for Type 1, TrueType and CID fonts). On the committed
  Chromium print, `packages/testing/fixtures/text-edit/chromium-type3.pdf`, deleting the heading's last character saved a
  page whose text objects went from 60 to 1.
- The editor's read-backs read only what was written, so an edit that wrote nothing new is reported done. Replace text,
  recolour, move and delete, each applied to the Helvetica line of the hand-made Type 3 page, erased both Type 3 lines
  (3 text objects to 1, and to 0 for delete) and answered success.
- The hand-made Type 3 page refuses with *the page's font cannot carry the text*, which is wrong. A probe written for
  this decision (2026-10-05, the same Linux build) shows the live edit **accepted** and its read-back on the live page
  passing; the save then dropped both Type 3 objects, and the refusal came from `applyEditTextBlock`'s read-back of the
  reopened bytes, which compared the write's index against a page that no longer had it.
- Every other refusal reaches the person as `internal`, because `pdfiumHandlers.ts` maps anything that is not a typed
  refusal to `engine-refused`, discards the cause, and `main` turns `engine-refused` into an incident.

## Decision 1 — the saved bytes are compared with the page as it was edited

Every page a PDFium session regenerates records, at the moment it is generated, its text objects in page order: what
each one says and the base name of the font it is set in, with the text objects inside its Form XObjects in their place.
`serialise` saves, reopens what it saved, reads each regenerated page the same way, and answers the bytes only when
every page reads back as recorded.

The record is taken where generation happens and checked where bytes leave the adapter. So no command can save bytes
the check did not read: there is one route from an edited page to bytes, and the check is on it. No command declares
what it touched, and an undo is checked by the same route as the edit it undoes.

**Why the page as edited, rather than the page before minus what the command named.** A before-and-after comparison
needs every command to state which objects it may change, and two of the eight decide that while they run
(`replaceAllText` by matching, `replaceTextAt` by the point). Stating it twice is a second opinion about one decision
(B3a). The edited page in memory is already the statement: generation's only job is to write it down, and the check asks
whether it did.

## Decision 2 — what the difference means

- A text object the edit did not write is missing, or reads differently: the rewrite lost text. The edit is refused at
  step `read-back`, nothing is answered and nothing is saved, and the person reads *This page uses a font Monstera
  can't rewrite yet, so nothing was changed.*
- Every text object the edit did not write reads back, and one it wrote reads differently: the font the write was saved
  in cannot carry those characters (ADR-0097's twin collapsing into a page font is the measured case). It is
  `text-not-writable`, naming the characters.

This replaces `applyEditTextBlock`'s own read-back of the reopened bytes. The two read the same bytes for the same
question, and keeping both would let them disagree about which sentence a person reads.

A count comes first: a page that reads back with fewer text objects than were recorded has lost text, whichever objects
they were, so the hand-made Type 3 page says the read-back sentence and not the font one.

## Decision 3 — a refusal names its step, from a fixed set of eight

Every refusal of a native call in the PDFium adapter names one step and the number `FPDF_GetLastError` answered at that
moment:

| step | what refused |
|---|---|
| `open` | `FPDF_LoadMemDocument64` |
| `page` | loading a page, or its text page |
| `object` | finding, making, inserting or removing a page object |
| `set-text` | `FPDFText_SetText` |
| `matrix` | reading or setting an object's matrix |
| `generate` | `FPDFPage_GenerateContent` |
| `save` | `FPDF_SaveAsCopy` |
| `read-back` | Decision 2's comparison |

The owner's list says *text object*; the step is `object`, because move, recolour and delete name images and paths as
well as text, and a sentence about text would be wrong for them.

A throw that names no step is a fault in this application (an empty list, an index the caller could not have been
handed) and stays `internal`.

## Decision 4 — a declared failure may carry a declared detail

ADR-0009 §9 made a renderer-facing failure a code, with nothing beside it but an incident id on `internal`. That keeps a
native library's text off the wire, and it is kept. What it cannot carry is a fact the person needs and the code cannot
hold: which characters a font cannot show, and which step refused.

So a code may carry a **detail**, declared once for the code across every boundary:

- the type is declared in `@monstera/shared` beside `Failure`, and the schema in `@monstera/contract`, which `satisfies`
  the type, so the two cannot differ;
- `Failure<C>` and `DeclaredFailure<C>` require the detail for a code that has one and forbid it for a code that has
  none, so a handler cannot forget it and cannot invent one;
- the boundary validates it with the code, in both directions, with `.strict()` schemas;
- a detail is **never text a native library produced**: an enum, a bounded integer, or characters the person typed.

Two codes carry one:

- `text-not-writable` carries `characters`: the distinct characters of what was written that are absent from what was
  read back, at most 32, in the order typed. The host computes them and `main` forwards them. A hostile host can name
  characters, which it could already write into the document; it cannot name a path, and the length is bounded.
- `edit-refused` carries `step` (Decision 3) and `engineError`, the number PDFium answered. It is declared on the PDFium
  host's `engine/apply`, `engine/capture` and `engine/invert` and on `document.execute`, so the host forwards the step
  and the number, `main` forwards both, and the renderer says the step's sentence and shows the step and the number as
  the reference, where `internal` shows its incident id.

## Decision 5 — what a person reads, and the words they typed stay

Each step has one sentence, ending *so nothing was changed*. `read-back` is the owner's sentence. `open` with PDFium's
password error says the document is protected by a password; the others say which part of the work refused.

The in-place editor keeps the typed words on **every** refusal, not only on `text-not-writable` and the signed-document
question (ADR-0149). It stays open over the block with the refusal's sentence beside the words, and Escape puts the page's
text back. A refusal that closed the editor threw the words away, which is the owner's *preserve, never drop* broken by
the one surface built for typing.

## Decision 6 — a replacement is written the way the editor writes

`replaceTextAt` and `replaceAllText` write through the editor's safety rather than a bare `FPDFText_SetText`:

- a replacement the object's font cannot carry is written in its standard-font twin (ADR-0097), and refused only when the
  twin cannot carry it either, naming the characters;
- Decision 1's read-back covers it, as it covers every rewrite;
- a replacement wider than the word it replaces moves the runs after it on the same line by the difference, so the line
  does not overprint itself; a narrower one moves them back.

A replacement may be empty: replacing a word with nothing deletes it. A replacement that matches nothing, or changes
nothing, makes no new version and nothing is written. It is refused before the bus records an entry, and the person reads
that nothing matched.

## Decision 7 — a password document reaches PDFium

ADR-0055 lets a password cross into the MuPDF host for the one attempt that opens a document, and keeps it nowhere.
PDFium is handed the canonical image, which a protected document keeps protected, and `main` then rebuilds the MuPDF
session from PDFium's bytes. Both steps need the password, and neither has it. So today a protected document refuses
every PDFium command, as *Something went wrong*.

This decision makes the refusal true first: `open` with PDFium's password error has its own sentence. How the edit
reaches PDFium without the password persisting anywhere changes how a byte-image result is adopted, so it is decided
in its own ADR, written before it is built.

## Rejected

- **Each command declaring the objects it may change, compared before and after.** Decision 1 says why: two commands
  decide it while they run, and the declaration would be a second statement of that decision.
- **Detecting a Type 3 font before the edit and refusing.** The public API has no call that names a font's type, and a
  check keyed on the one known mechanism would pass the next one. The comparison sees any loss, whatever causes it.
- **Writing a Type 3 object's text back by hand after generation.** That is Phase 1's MuPDF-side writer, which the owner
  placed there, and it needs its own seam.
- **Encoding the step and the number in the code** (`edit-refused-generate-0`). Sixty-four codes that every surface
  must list, for a value the renderer reads as two fields.
- **A query for the unwritable characters after the refusal.** It would run the write a second time to find what the
  first one already knew.
- **Keeping the cause as text and forwarding it.** The cause is PDFium's diagnostic about a file this design treats as
  hostile; the step and the number are this application's own reading of it.

## Consequences

- Every PDFium save of an edited page costs one reopen and one read of each regenerated page. It is bounded by the pages
  the command regenerated, and a command that regenerates nothing pays nothing.
- A Type 3 page cannot be edited until Phase 1, and says so instead of losing text.
- `Failure` now has a detail axis. A code that gains one is a compile error at every site that builds it, which is the
  point.

## Correction, 2026-10-05: the comparison is a multiset, and PDFium rewrites only the streams that changed

Two measurements made while building Decision 1, on PDFium 155.0.8044.0's Linux build. Neither changes the decision;
both change how it is read.

- **Generation does not keep page order.** A line promoted out of a Form XObject is last among the page's text objects
  in the session and first in the saved bytes, with every object present and unchanged. A comparison by position
  refused that faithful save. So Decision 1's *reads back as recorded* is a comparison of what each text object says and
  is set in as a multiset, with the count first; the record is still taken in page order, and the order is not
  compared.
- **PDFium rewrites only the content streams that hold a changed object.** A promotion on a hand-built Type 3 page whose
  form was drawn into a content stream of its own kept both Type 3 lines, because the stream holding them was not
  rewritten. So the loss needs a changed object in the same stream as the Type 3 text, which is every case measured
  above, and a page whose Type 3 text sits in a stream nothing changed is saved, correctly. The proof's promotion case
  joins its page into one stream so that it is the case that loses text.

## Correction, 2026-10-05: `edit-refused` is declared on every route an edit takes in `main`

Decision 4 names `document.execute` as the renderer-facing channel. Building the sentences found three more routes the
same refusal travels, each of which would have turned it into `internal`:

- **`document.undo` and `document.redo`** declare `edit-refused` and `text-not-writable`, because an undo of a PDFium
  edit runs the same rewrite and Decision 1's read-back, and a redo re-runs the edit.
- **`document.editCopy`'s problem** carries `edit-refused` with its detail, as it carries `text-not-writable`.
- **One rule in `main` maps them**, `editRefusalOf` and its narrower `rewriteRefusalOf` (`apps/desktop/src/editRefusals.ts`):
  the copy route had spelt its own list and knew four of the direct route's codes.

The renderer reads every problem's sentence through one function, `problemMessage`, since `edit-refused`'s sentence is
the step's rather than the code's.

## The owner's answer, 2026-10-05: a Replace that would need the line refuses

**This supersedes Decision 6's first and third bullets**: a replacement is not written in its standard-font twin and does
not move the runs after it. Its read-back (the second bullet), the empty replacement and *nothing to replace* stand.

P0 asked that Replace take the editor's safety: its twin-font fallback, its read-back, and moving the runs after a
changed word. The owner's answer: *"not in P0e. For now, Replace refuses safely whenever it would need whole-line
knowledge: typed words kept, the reason shown, nothing changed. The real fix belongs to P1 (fonts) and P2
(paragraphs)."*

- **The twin font is already a refusal.** A character the run's font cannot draw reads back as something else, and
  `replaceTextObjects` throws `TextNotWritableError` naming the characters before anything is generated (CR-NAT-10).
  A Replace never falls back to a twin, so it never needs the line for that.
- **Moving later runs is the new refusal, `replace-moves-line`.** A text object keeps its origin when its string
  changes, so a wider replacement draws into the object after it on its line and a narrower or emptied one leaves a
  gap. Under `line: 'held'`, `replaceTextObjects` reads each object's characters before and after the sets and throws
  `ReplaceMovesLineError` before anything is generated when a replaced object's advance end moves by more than a
  quarter point and another object follows it on its line (`replaceLineRule.ts`). One such replacement refuses the
  whole command. Both Replace commands hold the line; so does `replaceTextObject`, which nothing dispatches and which
  has no line knowledge either. Only an undo writes `'as-written'`, since the strings it puts back are the line as it
  was.
- **The end is the ADVANCE's, not the ink's.** Measured on PDFium 155 (Linux): `WID` and `WDI` are one width in
  Helvetica and end their ink at different places, and a rule reading ink refused the second; `FPDFText_GetLooseCharBox`
  spans each character's advance, and with it the second is written.
- **A change to 64f24233's behaviour, stated:** an empty replacement deleting a word that is its own object, with text
  after it on the line, was written and left a gap. It is refused now; one that ends its line is still removed.
- **Erring towards refusal.** *Follows on its line* is any object whose ink overlaps vertically by more than half the
  shorter height and starts to the right of the replaced one's start, so text in another column on the same baseline
  counts. The refusal writes nothing and names Edit text, which moves the line.

Proof: `proof:pdfiumcommand` (84, real library) holds both commands refused, wider and emptied, with the same-width
`WDI` written as the control, and a replace-all refused whole while its other matches had nothing after them;
`replaceLineRule.test.ts` holds the rule's geometry. Mutations: the rule off, and a zero tolerance, each turn both
command cases red. The code travels as `nothing-to-replace` does, and the find bar keeps both typed fields.
