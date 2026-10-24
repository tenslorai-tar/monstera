# ADR-0270 — Edit text writes what the person typed, and never refuses it

- **Status:** Accepted
- **Date:** 2026-10-24
- **Supersedes:** [ADR-0266](0266-edit-text-writes-only-the-edited-blocks-own-instructions.md) Decision 4 (MuPDF's
  reading of the edited lines as a reason to refuse) and Decision 5's premise that the operator writer refuses for its
  read-back; [ADR-0176](0176-a-page-holding-type-3-text-is-edited-in-its-own-content-stream-by-mupdf.md) Decision 6 (the
  two read-backs as gates) where it gates Edit text.
- **Amends:** [ADR-0177](0177-a-word-a-type-3-page-cannot-draw-is-set-in-the-resolvers-face-or-the-box-by-the-mupdf-host.md) — the chain of faces gains a
  last face that ships with Monstera and draws every script; until it ships, the box is that last face.
- **Decided by:** the owner, 2026-10-24: *"WRITE WHAT THE PERSON TYPED, in the best matching font available, and never
  touch anything else. Monstera should not refuse an Edit text change."*

## The problem, in one sentence

Since the whole-page rewrite was withdrawn (ADR-0266), every Edit text refusal left is a check of the writer's own work
that the person pays for: their typing is thrown away because a reader disagreed with the writer about words the writer
set correctly.

## What was measured

`proof:edittext` over the owner's corpus and the repository's fixtures, 2026-10-24, before this decision:

| refusal | where it came from | what it was |
|---|---|---|
| *does not read as the words drawn* | the structural check's word comparison | 157 edits of document 4 and Replace all on documents 11 and 12, every one correct: the check read several blocks' words in the wrong order (fixed in b373ae54) |
| *MuPDF's reading does not hold N lines* | ADR-0266 Decision 4 | the link-marker refusals of document 2: MuPDF reads a raised marker as a line of its own |
| *no font can draw this character* | ADR-0177's chain ending | document 2's four refusals |

Each was a correct write refused by a reader; none was a page changed outside the edit. The structural comparison
(every operator outside the edit byte for byte) has refused nothing in the corpus since the operator writer became the
default.

## Decisions

1. **The edit is written as the person typed it, and kept.** Neither read-back refuses it: not MuPDF's reading of the
   edited lines, not the structural check's reading of the inserted words. A difference either finds is a writer defect
   and goes to the diagnostics log (`shellLog.ts`, through the shell's failure sink) with the page and what differed —
   never to the person. The checks still run on every write: they are how the defect is found.
2. **The one guarantee stays, proven structurally and not by pixels:** every byte of the page outside the edited block's
   own instructions is the page's as it was; lines a longer paragraph pushes down move by their position alone, their
   own operators carried byte for byte (ADR-0249, ADR-0266 Decision 1). It is checked on every write (`checkOperatorEdit`)
   and a failure is logged as a writer defect; it never rejects the person's typing. `proof:edittext` counts every such
   failure and every read-back difference over the corpus and the fixtures, and must read 0.
3. **There is always a font.** A word is set in the run's own font where it draws the letters; else a sibling of the same
   face on the page; else the closest similar face, bundled or installed on the computer (ADR-0176 Decision 5,
   ADR-0177); else a face that ships with Monstera and draws every script; else — until that face ships — the character's
   box (ADR-0177 Decision 7), which the person is told about as now. *No font can draw this character* is never a
   reason to refuse: where a face cannot set a word whole (its codes used up, a glyph missing), the next face is asked,
   and the box ends the chain.
4. **What is left that can still stop an edit is named, and each is a writer defect, not the person's:** a page whose
   object numbering PDFium and the content disagree about, a font that states no width the layout needs, a line drawn
   through a clip the inserted object cannot share, and an arranged block its new place would crop. Writing past any of
   them would change bytes outside the edit, which Decision 2 forbids; so each still leaves the page as it was and says
   the owner's one plain line, is logged, and is counted by the proof, which must read 0 for each over the corpus.
   Measured 2026-10-24 on documents 4, 8, 11 and 12: 0.

## Rejected

- **Keeping the read-backs as gates and fixing each reader's disagreement as it is found** (what the round did until
  now): every fix is right, and the person still pays for the next one before it is found.
- **Dropping the checks**: then a writer defect is invisible until a person sees a damaged page.
- **Writing past Decision 4's four cases**: each would touch bytes outside the edit, which is the one thing the owner's
  rule forbids.

## Proofs

- `textOperatorEdit.test.ts`: an edit MuPDF's reading disagrees with is KEPT and its difference is answered for the log;
  CONTROL, the same edit with no difference answers none.
- `operatorEdit.test.ts`: a character no face carries is set as its box and the edit is made; CONTROL, the page's own
  font carrying it sets it in that font.
- `proof:edittext`: the corpus table's *refused* and *disturbed* columns, and a *logged* column counting read-back
  differences and structural failures, all 0.

## Consequences

- The person is never told an edit could not be written because of a reading; the log is ours.
- A writer defect now shows as a logged line and a proof count rather than a refusal; the proof is the gate.
- The face that ships with Monstera and draws every script is a new dependency, asked in `owner-questions.md` with its
  measurement before it is added; the box stands in until it ships.
