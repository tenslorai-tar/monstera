# ADR-0138 — A command whose intent can outgrow a frame crosses in a file

- **Status:** Accepted
- **Date:** 2026-10-02
- **Amends:** [ADR-0125](0125-an-answer-that-grows-with-the-document-crosses-in-a-file.md)'s first addendum, Decision
  7, which routed one request through a file (`engine/invert`'s), and its second addendum's point 10, which pinned
  five command-carrying channels in the frame as exceptions to the request rule. `docs/ARCHITECTURE.md` §5 gains an
  amendment row.
- **Decided by:** round 4's item 5c: *`createFormField` reaching past the frame (DDDDDDD-10); 22 command kinds cannot
  be measured against the frame: make each one measurable or bounded, and list them.*
- **Relates:** [ADR-0044](0044-an-image-reaches-the-engine-the-way-the-document-does.md) (the snapshot directory is
  the door into a host), the owner's decision D (a request this side cannot send is refused as that call, and ends
  nothing).

## Context

`hostRoutes.test.ts` checks every framed request against the frame at its schema's worst, and pinned the five
channels that carry a command as exceptions, because a command object was not `.strict()` and so read as unbounded
whole. The stage audit asked kind by kind with `.strict()` forced on, and found `createFormField` past the frame and
22 kinds still unmeasurable.

Three things were wrong with that reading, measured 2026-10-02 in a temporary diagnostic over each host's wire union:

1. **Forcing `.strict()` in the test measured a schema that does not exist.** The wire parses the command as
   declared. A top-level command object that is not strict accepts extra keys, so on the side the JSON is parsed
   against, every one of the 53 kinds was unbounded, not 22.
2. **It read the output side of each transform.** A `DocVersion` is a number on the wire and a brand after the parse,
   and the output side cannot represent a brand, so fifteen kinds were unmeasurable for their `version` alone. Three
   more (`mergeDocument`, `replacePage`, `importPageAsLayer`) were unmeasurable for a `DocId` with no length bound.
3. **It measured the renderer's union, not each host's.** A kind is carried on its writer's channel, and the five
   channels belong to three writers whose routes can differ.

Read correctly, the MuPDF writer's 35 kinds all fit the frame: the largest is `addAnnotation` at 247,050 bytes at
worst. The others do not, and not only in the command:

| channel | what admits more than a frame | worst | written plainly |
|---|---|---|---|
| `engine/applyPdfLib` | `createFormField` | 202,356,029 B | 33,928,509 B |
| `engine/applyPdfLib` | its pre-read: an outline (generate a table of contents) | 12,836,865 B | 2,351,105 B |
| `engine/applyPdfLib` | its pre-read: a recognised page (OCR text layer) | 1,826,885,725 B | 442,765,405 B |
| PDFium `engine/apply`, `engine/capture` | `replaceTextObject` | 12,601,952 B | 2,116,192 B |
| PDFium `engine/apply`, `engine/capture` | `editTextBlock` | 4,589,655,126 B | 4,568,683,606 B |

The pre-read rows are a person's ordinary action refused today: a page of dense print recognised by OCR, or a long
outline, reaches the frame through values `main` already holds, and the call is refused as too large.

## Decision 1 — every command is closed, and the route rule reads the wire's side

Every command object is `.strict()` at its top, as every nested object in `commands.ts` already said it was, and the
two that were not nested-strict (`placeAnnotation`'s placements, `createFormField`'s placements) now are. A `DocId` is
bounded at 64 characters (`DOC_ID_MAX_CHARS`; main mints 43). `hostRouteViolations` reads a request's params with
`io: 'input'`, the side the JSON is parsed against. Every command kind then has a worst, and MuPDF's `engine/apply` and
`engine/capture` drop out of the exception list: the general request rule checks them like any other framed channel.

## Decision 2 — the pdf-lib and PDFium command channels take their params in a file

`engine/applyPdfLib`, and PDFium's `engine/apply` and `engine/capture`, are file-requested by ADR-0125 Decision 7's
route: main writes the params into the session's snapshot directory, which the host may only read, the frame names
the file and its size, and the host reads it under `ENGINE_ANSWER_FILE_MAX_BYTES` (8 MiB) and dispatches it through
the same `wrapHandler`. A capture stays file-answered, so it is the first channel routed both ways; `channel.ts`
declares that with one function rather than by hand, so its answer route still adds `answer-too-large` by
construction.

The route is declared per channel, never chosen by size at the moment of sending, which is ADR-0125's rule and
ADR-0044's: a threshold is the generous maximum that quietly accommodates the payload nobody decided to send.
`coreEngineChannels` takes the command route as a declared input per engine, so MuPDF's stays `frame` and PDFium's is
`file`, and a MuPDF kind that grew past the frame turns the request rule red rather than changing a route silently.

What it costs: one write, read and removal of a file per command on those two writers. Measured on the Linux cloud
machine, 2026-10-02, with `node:fs/promises` over 1,000 runs: 0.38 ms median for 1 KB, and 2.2 ms median over 50 runs
for 1.6 MB. **Windows is not measured**, where a virus scanner may sit on every file write; the local agent measures it
there.

## Decision 3 — `createFormField` carries many simple fields, or one field of any kind

What sends it: a drawing tool sends exactly one field of any of the five kinds, and flat field detection sends a
page of text fields. No caller sends several choice fields, and that combination is the whole of the 202 MB: 256 fields
of 256 options of 512 characters. So `fields` is either a list of up to `MAX_CREATED_FIELDS` text, check box or radio
fields, or a list of exactly one field of any kind. Its worst is then under the file ceiling, and the shape says what
the callers already do (B5).

## Decision 4 — a file-requested channel fits the file ceiling at its worst, with its exceptions pinned

The request rule gains its second clause: a file-requested channel's params must fit the 8 MiB ceiling at their
schema's worst. Pinned by exact set, so a channel that joins is red and one that leaves must be taken off:

- **`engine/invert`, both hosts:** its params are a capture's answer, which crossed under the same ceiling, so the
  route that brought the value bounds it. The schema cannot say so.
- **`engine/applyPdfLib`'s pre-read, by the same argument:** a recognised page is `engine/ocr-page`'s answer and an
  outline is `engine/destinations`', both file-answered under the ceiling. The rule checks the channel with `reads`
  left out, so the command half is held to the ceiling.
- **PDFium's `engine/apply` and `engine/capture`: open, and the owner's.** `replaceTextObject` and `editTextBlock`
  admit more than the ceiling, because each multiplies per-entry bounds whose real limit is a total: a page's runs
  are named once across a whole edit, and its text is a page's. The schema has no way to state a total, so the walk
  reads the product. A real page's edit is far under the ceiling, and above it the call is refused as itself (decision
  D) and ends nothing. The structural remedy is the drawing's (ADR-0133's correction): one list of indices and one
  text per command, each with its own bound, and where each entry starts. That reshapes two commands, their kernel
  writer and the editor, so it is proposed here and not taken under this record.

## Rejected

- **Forcing `.strict()` in the check.** It measures a schema the wire does not parse, which is how 31 open kinds read
  as measured.
- **Raising the frame.** ADR-0125 rejected it, and it would still not hold a recognised page.
- **Routing every command channel through a file, MuPDF's included.** It costs a file per rotate for nothing: MuPDF's
  kinds fit the frame, and the rule now proves it on every run.
- **Choosing the route by size when sending.** ADR-0125's rejected *generic spill by size*.
- **Lowering the field and option bounds until `createFormField` fits the frame.** At 256 text fields the name bound
  would have to fall to about 120 characters at worst, which refuses a person a long field name to keep a transport
  constant, and the pre-read rows above would still not fit.

## Correction before building, 2026-10-02 — the pre-read refusal is reasoned, not observed

The Context says the pre-read rows are *a person's ordinary action refused today*. That is stronger than its
evidence: the figures are schema bounds, and no document here was run to a refusal. What is measured is that the
schema admits more than a frame, written plainly as well as at worst, so a large enough outline or recognition is
refused by `client.ts`; how large a real dense page's recognition is was not measured. The decision does not rest on
it, because ADR-0125 routes by what the schema admits and not by what a corpus has produced.

## Correction, 2026-10-02 — Windows measured: a params file costs about 15–24 ms, not 0.4

Decision 2's *Windows is not measured* is answered, on the owner's machine, the same way the Linux figure was read —
`node:fs/promises` write, read and removal of one file, 1,000 runs at 1 KB and 50 at 1.6 MB, two runs of each:

| folder | 1 KB, median (p95) | 1.6 MB, median (p95) |
|---|---|---|
| a scratch folder under the development profile, beside the hosts' session areas | 21.9 and 23.7 ms (59–65) | 29.0 and 30.5 ms (38–95) |
| `%TEMP%` | 15.1 and 15.4 ms (22–26) | 23 ms, and 199 ms in a first run (p95 774) |

against Linux's 0.38 ms and 2.2 ms. A control with no file reads 0.001 ms, so the timer separates the work. What makes
a small file cost forty to sixty times Linux's here is not established; a virus scanner inspecting each new file is the
hypothesis, not a finding. So every PDFium and pdf-lib command pays roughly 15–30 ms on Windows for its params, and a
first call after a quiet spell can pay far more.

**The route works live on Windows**: on the development build at the merge of `7dfa3421`, an edit (PDFium's apply)
and a page's recognition (pdf-lib's `ocrPage`) each crossed in a params file through real contained hosts, were saved,
and read back — the marker in the edited text, 293 words on a page that had none (`scripts/research/installedCheck.mjs
--build dev --steps edit,ocr`). The proofs that start real hosts or the real library pass here too —
`hostFileAnswersLive`, `hostRecovery`, `composeHostLive` and the five PDFium proofs — but none of them sends a params
file, so they say nothing about this route on their own.
