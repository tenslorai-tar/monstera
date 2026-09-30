# ADR-0125 — An engine host's answer that grows with the document crosses in a file

- **Status:** Accepted
- **Date:** 2026-09-30
- **Decided by:** the owner's result for MSIX 0.1.5.0 (2026-09-30): *"Edit text … fails on the owner's own PDFs …
  Find the mechanism in one sentence, by measurement … Fix the root cause with a control … Check the same failure
  class for every contained process."* And the rule stated there: *"never raise a limit without that measurement."*
- **Amends:** `docs/ARCHITECTURE.md` §5 (the engine host's pipe). It extends the route
  [ADR-0044](0044-an-image-reaches-the-engine-the-way-the-document-does.md) takes for an answer that grows with what a
  person dragged, from bytes to every answer that grows with a document.

## Context

**The mechanism, measured.** In the installed 0.1.5.0, Edit text ended the PDFium host on two of the owner's files.
The host's own diagnostic, written at the moment of each failure:

```
MONSTERA_HOST_ENDED unsendable-response: A response could not be framed:
RangeError: Frame of 663815 bytes exceeds the maximum of 262144.
```

The same answer was measured in this process, on the same file, with the kernel's own `textRuns`: page 1 answers
**663,744 bytes**, which is 663,815 with the frame's envelope. The page is drawn as **2,499 text objects for 2,854
characters**, 2,148 of them one character or less, and each run crosses with its full style and 17-digit coordinates,
**266 bytes a run**. So: *the document draws almost every glyph as its own text object, the text-runs answer grows with
the number of objects, and one page's answer is 2.5× the frame the host must send it in.* It is not the job object,
not memory, and not PDFium: nothing crashed, the host refused to send what it could not frame and ended itself. The
same file fails the same way in development, since nothing in this path is packaging-specific.

**The class, measured two ways** (`scripts/research/hostAnswerSizes.mjs` and `scripts/research/hostSchemaBounds.mjs`,
2026-09-30, both carrying positive controls):

| what | reading |
|---|---|
| The owner's file | `engine/text-runs` 663,744 B (253% of the frame), `engine/page-objects` 527,132 B (201%) |
| A generated page, 1,600 glyphs, one object each | `text-runs` 382,365 B (146%), `page-objects` 273,696 B (104%) |
| A generated form of 3,000 text fields | `engine/form-fields` 531,355 B (203%). **On the MuPDF host, which holds the document** |
| A generated outline of 10,000 entries | `engine/destinations` 305,291 B (117%), after the reader's own cap of 4,096 entries |
| The corpus, 11 documents | largest answers 31%, 24%, 18% of the frame: nothing over, and nothing that is one of these shapes |
| Every host channel's result schema | **18 of 45** admit more than a frame at their declared maxima; `engine/capture` and `engine/page-geometry` admit an unbounded answer |

`engine/page-text`'s own schema allows **8 MB** a page against a 256 KiB frame, which makes the class plain. The
channel declares an answer the transport cannot carry, and the two bounds sit in different files with nothing
comparing them.

**Why the frame is not the thing to change.** `ENGINE_HOST_FRAME_MAX_BYTES` bounds what crosses a boundary whose
far side is hostile by invariant 25. Its own header says it exists so that *"a frame this size cannot be a document by
accident"*, and that its bound is removed by payload shape, never raised. A page's text has no natural size. The owner's
page is not unusual in kind: one object per glyph is what some generators emit, a CV builder among them. No fixed
frame fits a read like this, and a larger one spends the property the constant exists for.

## Decision

1. **Every engine host channel's answer takes one of two routes, and the route is declared.** Either the answer is
   **bounded by its shape**, meaning its result schema admits no more than one frame at worst case, or it is
   **written into the session's granted output directory** and the frame carries only its byte count. ADR-0044's
   route for a raster, `engine/render-page`'s and `engine/extract`'s shape, now serves every answer that grows with
   a document.
2. **A file answer is declared once, beside its channel**: the channel's result is `{ bytes }`, its params carry the
   name main minted (`into`), and its answer schema sits in a map of file answers that main validates against. The
   validation is `boundary.ts`' own envelope parse, reached through a sibling of `acceptAnswer`, as ADR-0099 did for
   the one answer that arrives by another route. **There is no second parse at a call site** (B3a).
3. **A file answer has a ceiling, and the number comes from a measurement.** `takeOutput` reads a file whole, which is
   right for a document image and wrong for a structured answer from a hostile host. The ceiling is
   `ENGINE_ANSWER_FILE_MAX_BYTES` = **8 MiB**, derived from the channels' own count caps times the per-item sizes
   measured above:

   | channel | count cap | measured per item | at the cap |
   |---|---|---|---|
   | `engine/text-runs` | 8,192 runs | 266 B | 2.18 MB |
   | `engine/form-fields` | 4,096 fields | 177 B | 0.73 MB |
   | `engine/destinations` | 4,096 entries | 74.5 B | 0.31 MB |

   8 MiB is **3.7×** the largest of these. An answer above it is refused by name, as `answer-too-large`; it never
   ends a host or poisons a document. Main checks the file's length against the frame's `bytes` and the ceiling
   **before** reading it.
4. **The route is checked, not remembered.** `check:hostanswers` computes each frame-answered channel's worst-case
   encoding from its schema, at six bytes a character (the length of a `\u` escape). It fails when that exceeds the
   frame or cannot be bounded. It carries its positive control, a channel known to be over, and its proof mutates a
   bound. This is `hostSchemaBounds.mjs` promoted from research to a check with callers.
5. **Converted:** every channel the schema walk found over the frame. `engine/page-geometry` instead gains the
   `.max` its request already implies (512 pages), which brings it under the frame by shape.

## Rejected

- **Raising the frame maximum.** It moves the bound and spends the property the constant exists for, and no fixed
  value fits a page's text. 663 KB today is one ordinary CV.
- **Chunking an answer across frames.** Refused by the frame constant's own header: reassembly, ordering and partial
  state, at the one boundary invariant 25 calls hostile.
- **Compacting the text-runs payload only** (a style table, rounded coordinates). Measured shape: about 45 bytes a run
  instead of 266, so a dense one-object-per-glyph page of 6,000 glyphs is over again. It moves the bound; it does not
  remove it.
- **A generic spill by size**, where the body writes any answer that does not fit into a file. ADR-0044 rejected
  this for commands as *"the generous maximum that constant warns about, with a file behind it"*. For answers it is
  the same: which answers may be large is a decision per channel, and a declared route is what makes it one.
- **Truncating the editor's reads to fit.** An edit names objects, and a page missing half its runs is edited wrongly
  rather than refused.

## Consequences

- The PDFium host answers `text-runs` and `page-objects` through a file, so Edit text works on the owner's documents.
  The generated one-object-per-glyph page is the control: with the route removed, the live host ends exactly as it did
  in the owner's install.
- The MuPDF host's long forms, long outlines, dense pages and large captures no longer end the host that holds a
  document.
- **The other contained processes, for this class.** The compose host's answers are all bounded, at most 97 B by the
  schema walk. Ghostscript, Poppler and ONLYOFFICE answer through files by construction, so no frame reaches them.
- **The neighbouring class, a job-object LIMIT a document exceeds, read from each limit's own comment.** Poppler's 1 GB
  and 10 minutes are measured, with 25× the memory of a 2,000-page document. The engine hosts' 3 GB is §9.17's budget,
  measured against a 200 MB scan at about 510 MB. **Ghostscript's 1 GB is not a reading**: its comment says its memory
  was not measured. **ONLYOFFICE's 2 GB was measured only at its floor**, one-sentence files at 330–352 MiB, with *"a
  document of photographs rises from there"*. Both are measured in this range, on heavy inputs, before the next
  package, and recorded in the journal.

## Correction before building, 2026-09-30 — the route is carried by the transport, not by each channel's schemas

Decision 2 as first written gave each file-routed channel an `into` in its params and a `{ bytes }` result. Reading
the code to build it showed two things that decide the form. First, the host's runtime has exactly one place every
answer passes through (`runtime.ts`' `answer`), and the client exactly one (`client.ts`' `call`). Second, the
per-channel form reshapes every converted channel's handler, remote reader, fake and test, about eighty files, and
leaves sixteen copies of the same file handling. That is B3a's shape: the rule living in call sites.

**So the route is declared on the channel, `answer: 'file'` beside its schemas, and carried by the transport.** The
client mints the name and sends it beside the params, since host params are strict and the name is not the channel's
business. For a file-routed channel, the runtime writes a successful answer's envelope into the session's granted
output directory and frames only its byte count. The client takes the file under the ceiling, checks its length, and
hands the parsed envelope to the same `acceptAnswer` a framed one goes through. A failure is small and stays in the
frame. Handlers and readers keep their types, and the route is still a per-channel declaration. Its form changes;
Decisions 3 to 5 stand unchanged.

## Addendum, 2026-09-30 — undo's pair: a capture's answer, and the same prior sent back as `engine/invert`'s request

**What was left out, and why it could not be by the answer route alone.** `engine/capture` answers a command's prior
state, main keeps it in the undo log, and undo sends it back as `engine/invert`'s *request*. So its size decides two
crossings in opposite directions. Measured with the kernel's own `localMupdfExecution.capture`, rotating every page
of a generated document:

| pages | capture answer | the intent it undoes |
|---|---|---|
| 1,000 | 38,937 B | 3,939 B |
| 6,000 | 238,937 B | 28,939 B |
| **10,000** | **398,937 B, 1.5× the frame** | 48,939 B |

A prior is about **40 bytes a page** against the intent's 5, so it crosses the frame at about 6,580 pages. The frame
constant's own header treats 20,000 pages as in range. Today such a rotate ends the MuPDF host at its capture and
poisons the document; and were the capture to get through, its undo could not be framed.

**Decided.**

6. **Both captures are `file`-answered**, MuPDF's and PDFium's, by Decisions 1 to 3. PDFium's prior is the
   replaced runs' text, up to `PDFIUM_PRIOR_TEXT_MAX` = 65,536 characters each.
7. **`engine/invert`'s params cross in a file, on both hosts.** A channel declares its request route beside its
   answer route. For a `file`-requested channel, main writes the params into the session's **snapshot** directory,
   the one the host is granted only READ on: ADR-0044's door for an asset, by which the document itself arrives. The
   request names the session, the file and its size in place of `params`. The host reads the file under the same
   8 MiB ceiling, requires the parsed params to name the same session, and dispatches them through the same
   `wrapHandler`; main removes the file when the call ends. The ceiling holds with room: at the intent bound, a
   rotate of 43,600 pages, a rotation prior is 1.74 MB.

**Rejected.** A compact prior encoding, grouping pages by prior value: rotation priors group, but crop and resize
priors carry a box per page and differ page to page, so it moves the bound without removing it. Refusing to capture
above a page count: it makes a large command un-undoable by a number, where the file route makes it ordinary.

**Built 2026-09-30** (e43a29b8). `proof:hostfileanswers` rotates every page of a generated 10,000-page document and
undoes it through the real MuPDF host; the first and last pages read 90 and then 0. Its control is the input: the
prior is measured with the kernel's own capture and must be larger than a frame.

## Addendum, 2026-09-30 — the rule is a check, and what it found

**The rule became a test** (e5af7d96). `hostRoutes.test.ts` walks every contained host's channel map with
`hostRouteViolations` in `@monstera/contract`. A frame-answered channel must fit the frame at its schema's *worst*:
six bytes a character, the length of a `\u` escape, with the envelope measured off its own shapes. A file-answered
channel must declare `answer-too-large`. Its controls read `engine/text-runs` over a frame, and they report that
channel re-declared framed, as 0.1.5.0 shipped it. The walk reads zod's own JSON Schema, the reader invariant L11's
sweep already took, and that sweep's `unboundedMembers` moved beside it so both callers share one reader (B3a).

**What it found, measured over the three hosts' 45 channels:**

8. **Every answer is on a route that carries it.** The 17 channels whose results a frame cannot carry at worst are
   all file-answered. `engine/flat-fields` is the one that fits written plainly (104 KB) and does not at worst
   (432 KB), which is why the rule reads the worst.
9. **A capture above the ceiling is the bus's checkpoint, never a failed command.** The capture result has no bound.
   Its priors are per page, and where a prior reads the document's own strings (a page transition's entries) the
   document chooses their length. `answer-too-large` on a capture is a prior this build cannot *record*, and the
   bus already answers that with a checkpoint, as it does for a `/Rotate` it cannot read. Refusing the person their
   edit because its undo record is large would be the wrong answer. `priorTooLargeToRecord` is the one statement of
   this, and both remote writers take it.
10. **The request direction has one bound that stays, and it is not this record's to remove.** Five channels frame
   params that carry a *command*: MuPDF's apply, capture and applyPdfLib, and PDFium's apply and capture. Of the
   50 command kinds, the only members with no bound are the 15 page lists, which is finding AAA-1's stated bound in
   `hostProtocol.ts`: a whole-document selection meets the frame at about 43,600 pages. The test pins those five by
   exact set per host. An anchor case beside it requires every unbounded command member to be a page list, so an
   unbounded text field cannot hide behind an entry written for page lists.

**Open, and the owner's.** `hostProtocol.ts` says the frame *refuses* a selection past that bound. What happens in
the code is not a refusal of that call. `client.ts` ends the connection with `unsendable-response` when a request
cannot be framed, so every session on that host goes to recovery. The request was never written, so nothing on the
host side needed ending. Answering it as a refusal of that one call would be Decision 3's rule turned round. It
reaches only past a stated bound 2.2× beyond any document that exists, so it is recorded here rather than changed
under this ADR.
