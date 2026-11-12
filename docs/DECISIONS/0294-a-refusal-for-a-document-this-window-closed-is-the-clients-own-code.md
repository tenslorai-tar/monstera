# ADR-0294 — A refusal for a document this window closed is the client's own code, and the one door shows nothing for it

- **Status:** Accepted
- **Date:** 2026-11-12
- **Decided by:** the owner, 2026-11-12: *convert the code in the client, and keep one door* — the client answers its
  own code, `reportProblem` accepts it and shows nothing, and the problem dialog's props refuse it, so going around the
  door is a compile error.
- **Amends:** §5's renderer types (*generated or type-derived from the contract*): the renderer's `ContractClient` is
  the contract's client with one renderer-only failure added, and it is built only by the wrapper that answers it.

## Context

[ADR-0292](0292-whether-a-document-is-unsaved-is-answered-beside-a-running-read.md) let `document.unsaved` answer
beside a running read. Before it, the question waited for every read in the document's lane, so by the time a close
was sent nothing this window had asked about the document was still waiting. After it, the close (a lane write) runs
ahead of a read that is still queued ([ADR-0274](0274-a-documents-lane-runs-a-write-before-a-queued-read.md)), and
that read answers `document-not-open`.

Measured 2026-11-12, `scripts/research/editOpenCost.mjs` on document 2, `_review/walks/edit-open-cost/2026-11-12T13-58-37`,
`logs/shell.log`: leaving the block editor starts two `document.textBlocks` reads; `document.unsaved` answers in 0–1 ms;
`document.close` runs after the first read and before the second, which answers `document-not-open` 2.5–3.4 s after it
was asked. Edit text's read reports every refusal (`App.tsx`, `textMode.read`), so a person who closed a document saw
*That document is no longer open*, and that dialog took the next open's presses: rounds 2, 4 and 6 of 7 failed. The
release before ADR-0292 (`2026-11-12T12-13-53`) shows `document.unsaved` answering after both reads, 647–3,092 ms.

The answer is correct. What is wrong is reporting it: this window let the document go. But `document-not-open` cannot
say which: the same code answers a document `main` lost while this window still shows it, and that one must be said
(`documentTransport.ts`: a range refused in silence left a tab *Opening the document…* for ever). Only the code that
sent the close knows, and every answer for a document crosses the client.

Readers decided this one at a time: `readOnlyFile.ts` never reports `document-not-open`, `documentTransport.ts`
always does, Edit text's read did. A reader written tomorrow would decide it again.

## Decisions

1. **The client answers `document-closed-here`** for a call whose `docId` this window has sent `document.close` for,
   where `main` answered `document-not-open`. The code is the renderer's alone: it is never on the wire and no handler
   can produce it. Every other answer, including an `ok` that arrives after the close, passes unchanged. The window
   counts as having closed a document from the moment it sends the close, because `releaseTabs` has already taken its
   tab off the screen.
2. **The renderer's `ContractClient` carries the code in its type**, on exactly the channels that declare
   `document-not-open`, and only `closedHereClient` builds one. The app's client (`bridge.ts`) and the browser shim are
   both built through it, so a test sees what the application does.
3. **`reportProblem` is the one door, and it shows nothing for the code.** It accepts the code beside every problem the
   command-problem dialog can show; the dialog's props do not accept it, so handing such an answer to the dialog
   directly does not compile. No report site changes.
4. **A comparison with `'document-not-open'` the compiler cannot see is read by hand.** Where a reader takes
   *not open* to mean *nothing is there to lose* — the close's own unsaved question above all — the new code must mean
   the same, or a document this window closed reads as unsaved.

## Consequences

- Closing a document while a read about it is queued says nothing, as it did before ADR-0292, and the close does not
  wait for the read.
- A document `main` lost while this window shows it is still reported, because this window sent no close for it.
- Copying a refusal into other props keeps the code with it, so the compiler follows it there.

## Rejected

- **A helper each reader calls.** The rule would live in call sites, and the next reader would not know it.
- **The client never answering such a call.** The renderer has 34 `finally` blocks, and some hold things the window
  shares — the page-draw slots (`drawSlots.ts`), the progress indicator (`task.end()`), the in-flight counts — which
  would be held for ever.
- **Marking the answer and checking the mark at `ask`.** A dialog that builds its props from a refusal drops the mark,
  so only a scan would hold it; a code travels with the value.
- **Making the close wait for this window's reads first.** That is the wait ADR-0292 removed.
