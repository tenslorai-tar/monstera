# ADR-0130 — A document's size never refuses an action: glyphs join at the host, long lists cross in parts

**Date:** 2026-10-01
**Status:** accepted. **Amends `docs/ARCHITECTURE.md` §3.2's PDFium text read** (the host answers the engine's
facts and groups nothing — [ADR-0049](0049-the-editor-groups-its-own-engines-runs-and-a-person-confirms-the-grouping.md))
for ONE join, and **adds to §2's contract** the rule for a list that grows with the document. The architecture
amendment is this commit; the builds follow in their own (B4).

---

## The problem, in one sentence

The owner's rule (2026-10-01): Monstera works the way Acrobat and PDF-XChange do, and a person is never told an action
cannot be done because of their document — and three caps here do exactly that.

| cap | where | what a real document meets |
|---|---|---|
| `ENGINE_TEXT_OBJECTS_MAX` = 8,192 runs a page | `pdfiumChannels.ts` | a page drawn one glyph per text object — 60 lines of 140 characters is 8,400 objects — is *"more text than can be outlined at once"*, and the rest cannot be edited |
| `MAX_FORM_FIELDS` = 4,096 | `channels.ts` | *"Only the first 4,096 form fields are listed"* |
| `MAX_DESTINATIONS` = 4,096 | `channels.ts`; the kernel's walk stops at 4,096 with no flag | an outline past 4,096 entries is cut **in silence** |

Each number was written as *past what a real document carries*, and each was a guess about real documents standing in
for a bound against a hostile peer. The two questions have different answers and need different numbers.

## Decision 1 — the PDFium host joins a run's glyph objects before it answers

A producer that positions every glyph draws one text object per glyph, and `engine/text-runs` answered one run per
object. **The host now joins consecutive objects into one run** when each next object is the one after it in the
page's own object order, is set in the same style (size, colour, the face flags, upright), sits on the same line (its
bottom within a fifth of the size of the run's) and starts where the run ends (no gap wider than the size, no overlap
deeper than a quarter of it). The joined run is named by its FIRST object's index and carries its LAST, so it says
exactly which objects it is; its text is theirs in order, its box their union.

**The same join, in the same module, expands a named run when an edit applies.** `editTextBlocks` walks the page again,
joins by the same function, and replaces each named first index with its members — so a command still names runs, the
contract's command shapes do not change, and an edit is applied to exactly the objects the person was shown as one run.
The command is refused if the document moved since the read (it already carries the version), which is what keeps the
read's join and the apply's join the same join.

**Why this is not ADR-0049's grouping returning to the engine.** ADR-0049 kept LINES and BLOCKS in `main` because an
engine's opinion of a line disagreed with what a person sees (52.9% verbatim). Joining glyph objects that abut on one
baseline in one style is below that question: no reading of the page makes them two runs. `textLines.ts` still groups
runs into lines and blocks, and a person still confirms what an edit changes.

**Rejected:** raising `ENGINE_TEXT_OBJECTS_MAX` — the renderer's `MAX_TEXT_OBJECTS` (512, *a chooser of 8,192 rows is not
a chooser*) would then be the wall, one hop on; ranges in the command (`{first, last}`) — every command, its prior and its
undo would change shape for a fact the host can recompute; joining in `main` — `main` would need the page's object order
and adjacency, which only the walk has, and the expansion at apply would be a second join in a second process (B3a).

## Decision 2 — a list that grows with the document crosses in parts

`document.formFields` and `document.destinations` answer a PART: the renderer asks from an offset, `main` answers at
most a part's worth beginning there and the offset of the next part, or none when the list is complete. A panel asks
until there is none. Each call stays bounded — invariant 11's own terms, *per operation* — and the list is as long as
the document.

`main` reads the whole list from the host (a file answer, ADR-0125) for each part it serves; the read is the same read
that already crosses today, and caching it per version is a later economy, not a correctness question. A part is
answered against the version the list was read at, and the renderer's loop restarts if the version moves under it.

**Rejected:** one larger bound — the same guess, later; an event stream — a second protocol beside the request seam for
three lists; a renderer-held cursor in `main` — state per renderer per list, with a lifetime nobody owns.

## Decision 3 — a count bound on a document's content is a hostile-host bound, derived

What stays on each host answer is a bound against a HOSTILE peer (invariant 25), and it is derived rather than guessed:
`ENGINE_ANSWER_FILE_MAX_BYTES` (8 MiB, ADR-0125 Decision 3, `main`'s spend on one answer) divided by the SMALLEST
well-formed item the answer can carry. No real document reaches it, because real items are larger than the smallest
and real pages are not 8 MiB of one list. The walks that produced the lists drop their real-document caps
(`MAX_LISTED_FIELDS`, the outline walk's silent `MAX_ENTRIES`) to that bound, and say so when they reach it.

## The rest of the class, recorded rather than fixed here

The audit of every document-driven refusal, truncation and cap — 38 of them, what each does today — is
`docs/JOURNAL.md`' entry of 2026-10-01, *No document-size refusals*. This ADR fixes the three the owner named and sets
the rule each of the others is measured against: a cap a real document can reach is a defect owed a part or a join;
a cap only a hostile peer can reach is a bound, and says what it is derived from.

## Correction, 2026-10-01 — the join rule as built differs from Decision 1's wording in two clauses

Decision 1 says the next object must be *the one after it in the page's own object order* and that its *bottom* must
be *within a fifth of the size of the run's*. The build (`textRunJoin.ts`, commit ef15da04) does neither, and both
changes were forced by a measurement rather than chosen:

- **Next among the page's RUNS, not next object.** A line drawn one glyph per object carries a space drawn with no ink
  between words, which the walk holds no run for; requiring index + 1 broke every such line at its first space. A
  joined run therefore carries its `members`, and an object between two of them is never one (`membersOf`).
- **Overlapping height, not matching bottoms.** A descender's ink reaches a fifth of the size below its neighbours'
  (`g` at 12 points, 2.5 points), and comparing bottoms broke a real line at its first `g`. Two glyphs are on one line
  when their heights overlap by 0.3 of the size; a line at tight leading does not.

The rest of Decision 1 stands as written. Its text is left as the decision was taken; this note is the rule.
