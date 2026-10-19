# ADR-0253 — A failure is called *out of memory* only when that is proven

- **Status:** Accepted
- **Date:** 2026-10-17
- **Amends:** `docs/ARCHITECTURE.md` §5 (a declared failure `out-of-memory` on the three channels that change a
  document, an event `app.memory-low`, and two channels, `app.rendererEnded` and `document.held`) and §6 (a renderer
  that ended is reloaded and given back the documents `main` holds).
- **Decided by:** the owner's decision of 2026-10-17, locked before the launch build: tell the person plainly when a
  failure is caused by low memory, but only when it is proven — from the renderer's own `render-process-gone` reason, an
  engine host ended by its memory limit, and Windows' low-memory reading; anything else stays the existing *Something
  went wrong* with its reference and the crash report offer. The messages are the owner's, with the real figures and a
  *Try again* button; low memory before a failure is one calm notice per episode. Measure what Monstera needs and put
  the minimum and recommended memory in the System requirements article.

## What is proven, and where it is already known

A trace of the code on 2026-10-17 (file and line in the session's record) found the evidence in three places, and none
of it reached the person:

| evidence | where `main` has it | what the person saw |
|---|---|---|
| an engine host killed at its memory budget | `engineHostConnection.ts`' `reasonFor` names the ending `memory-budget` when the sampler killed it; the call is rejected with `HostConnectionLost`, whose `termination.code` says so | `commandHandlers.ts` matched no class, so the boundary answered `internal`: *Something went wrong inside Monstera* |
| the renderer ended out of memory | `render-process-gone` with `reason: 'oom'` | a log line; the window stayed dead, and nothing reloaded it |
| Windows low on memory | `memoryPressure.ts`, once per low spell | a log line |

## Decision

1. **A host's memory kill is a declared failure, `out-of-memory`, on the channels that change a document**
   (`document.execute`, `document.undo`, `document.redo`). `commandHandlers.ts` maps `HostConnectionLost` whose
   termination is `memory-budget` to it, and to nothing else: a host that crashed for any other reason stays `internal`,
   with its reference, and reaches the owner as it did. Its detail is the computer's figures read at that moment —
   total and available physical memory — and nothing about the document.
2. **The message names the computer only when the computer was short.** Where available memory was below the low line
   (`MEMORY_PRESSURE.belowFraction`, 10%) when the host was killed, it is the owner's sentence: *"Monstera ran out of
   memory. This computer has N GB of memory, and other programs were using most of it. Your document is unchanged. Close
   some programs or tabs, then try again."* Otherwise the host reached its own budget (3 GiB, §9.17) on a computer with
   room to spare, and blaming the computer would be false; the sentence then drops that clause: *"Monstera ran out of
   memory. This computer has N GB of memory. Your document is unchanged. Close some programs or tabs, then try again."*
   Closing documents still helps, since every document's session shares the one host. *Try again* sends the same command
   again.
3. **A renderer that ends is reloaded, and given back what `main` holds.** On `render-process-gone` other than a clean
   exit, `main` reloads the window and keeps why it ended. The new renderer asks `main` (`app.rendererEnded`, answered
   once) and then:
   - for `oom`, shows the memory message with the figures `main` read when it ended; *Try again* gives the window its
     documents back;
   - for anything else, shows *Something went wrong* with the reference of the log entry `main` wrote, and gives the
     documents back at once. The crash report offer is the start screen's, as before.
   The documents come back through `document.held`, which answers each open document's id, version, length, name and
   whether it is unsaved, from `main`'s own records: the renderer holds no path and invents no state.
4. **Low memory before any failure is one calm notice per low spell.** `main` sends `app.memory-low` once each time the
   reading falls below the line, and the renderer shows it as a toast: *"This computer is low on memory. Closing other
   programs will keep Monstera running smoothly."* The next one waits for the reading to recover first.
5. **The figures are the computer's own**, read by `main` with `os.totalmem()` and `os.freemem()` when the failure
   happened, rounded to whole gigabytes for total memory. Nothing guesses.

## Rejected

- **Call every host crash low memory.** It hides real defects from the owner, which the decision forbids.
- **One universal failure code beside `internal` on every channel.** Every channel's answer type would gain a member
  that no read shows a person; the three channels above are where a failure reaches a person as a dialog.
- **Blame the computer whenever the host hit its budget.** False on a computer with memory to spare.
- **Leave a dead renderer for the person to restart.** The documents are safe in `main`; the window is what failed.

## Proofs

- `commandHandlers.test.ts`: a host ended at its memory budget answers `out-of-memory` with the figures; CONTROL: a host
  that ended with `connection-lost` answers `internal`.
- The renderer: `out-of-memory` opens the memory window with the computer's figures, naming other programs only when
  available memory was low; *Try again* sends the command again; CONTROL: `internal` opens *Something went wrong*.
- A renderer ended with reason `oom` is reloaded and shows the memory window, and its documents come back; CONTROL: one
  ended with `crashed` shows *Something went wrong* with its reference.
- `app.memory-low` is sent once per low spell; CONTROL: a second low reading in the same spell sends nothing.

## Consequences

- A renderer crash no longer leaves a dead window: whatever the reason, the window comes back with its documents.
- What Monstera needs is measured and written into the System requirements article with its date and source.

## Correction, 2026-10-19 — the notice is told once per RUN; Decision 4's "once per low spell" told on every action

**What happened.** The owner's test of 0.1.16.0 on a second Windows 11 computer (8 GB, other programs running) showed
the notice on every action and again every few minutes (the owner's review of 0.1.16.0, R15).

**The mechanism, measured.** Decision 4 keyed the notice to the low SPELL, and a spell ends at the first reading at or
over the line: the line has no band and no least length. So a computer whose available memory sits at the line starts a
new spell every time it crosses, and each spell sent `app.memory-low`. Forced in `compositionHost.test.ts`: the reading
taken under and back over 10% ten times, an edit between each → **ten notices** before this correction, one after. The
owner's own readings were not taken, so the failure log line now carries the available and total MiB at each crossing.

**Decision 4 now reads:** low memory before any failure is ONE calm notice PER RUN of the application. `main` holds
whether it has told (`composition.ts`), so a renderer renewed (ADR-0252) or reloaded (this ADR's Decision 3) does not
tell again; a new run that is low is told again. The renderer shows it at the next moment no dialog is open and no text
editor is open, never over either. The words are unchanged. **Giving memory back stays per spell**: each crossing still
asks the idle hosts to stop, which is the grain that work wants. The reviewer's default, which the owner kept.

**The proof that replaces Decision 4's:** ten crossings with actions and the renewal's memory release between them send
one `app.memory-low` and ten log lines; CONTROL: a fresh run that is low is told again.
