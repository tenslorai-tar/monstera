# ADR-0119 — A detailed log records each request by its name, outcome and time

- **Status:** Accepted
- **Date:** 2026-09-28
- **Amends:** `docs/ARCHITECTURE.md` §8's *Observability* clause, which names one always-on rotating log and no level.
- **Decided by:** the founding record's Part F, *"Advanced: reveal log · log verbosity"* (`BUILD-PROMPT.md`:629), and
  the owner's afternoon list of 28 September, item 2.

## The problem

The log (`shellLog.ts`) takes lifecycle failures, incidents and three rare notices. That is what a person needs when
something broke; it is not what a person needs to report *"it was slow"* or *"it did something I did not expect"*,
which is the question a detailed log answers: what the application was asked to do, in what order, and how long each
took.

Two constraints decide the shape:

1. **Privacy.** §8 says this is an application whose audience reads the network tab, and a log is the file a person
   attaches to a report. A request's parameters carry text a person typed, annotation contents, field values and
   search queries. None of that may reach a line.
2. **Wiring.** A line per feature is a second place every feature is wired — the pathology §7 forbids — and the one
   forgotten is the one a report needs.

## Decision

1. **A setting, `advanced.log-detail`: *Problems* (the default) or *Detailed*.** Problems is today's log exactly.
2. **Detailed adds one line per renderer request: the channel's name, its outcome — `ok` or the declared failure
   code — and the milliseconds `main` took to answer.** For `document.execute` the line also names the command's
   kind, a member of a closed enum — the one thing a person reporting a problem most needs and the only parameter
   that carries no content. Nothing else from the parameters or the answer is written: no names, no paths, no text.
3. **Recorded where every request crosses, once:** `registerContractHandlers`, around the wrapped handler. A channel
   added tomorrow is logged by being registered. The command's kind is read by the channel's own schema, never by a
   cast of the untrusted value (B3a).
4. **Except `document.readRange`.** PDF.js asks for the document's bytes in ranges, so its count follows the bytes
   the viewer reads rather than anything a person did, and lines for it would fill the log's cap with the transport.
   It is excluded by name, with the reason at the exclusion.
5. **Into the same log, through the same write.** A detailed line beside a failure is the failure's context, in
   order; a second file would put them apart. The cap is unchanged, so a long detailed session rotates the oldest
   lines out as any other would.
6. **Read at start and on every settings save.** `main` reads the stored value when the log is made and again when
   the renderer saves settings, so turning it on takes effect for the next request rather than the next start.

## Rejected

- **Parameters, redacted.** Redaction is a list of what is sensitive, and the next field added is the one missing
  from it.
- **A line per feature, written where each feature runs.** The second wiring place.
- **Levels named after a logging library (`info`, `debug`, `trace`).** Words for developers. The two choices say what
  a person gets.
- **A separate detail file.** It separates a failure from what led to it.

## Consequences

- `shellLog.ts`' note that the log *"is not a general logger and must not become one"* is narrowed: it stays
  synchronous, and the detailed lines are opt-in, bounded by the same cap, and carry no content.
- §8's *Observability* clause names the setting; the amendment log and the ADR index carry the row.
