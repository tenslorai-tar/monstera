# ADR-0017 — The security substrate: invariants 24 and 25

- **Status:** Accepted
- **Date:** 2026-08-18
- **Amends:** `docs/ARCHITECTURE.md` §9, adding **invariants 24 and 25**. B4
  amendment; both land before the components they constrain.
- **Derived from:** [the threat model](../security/THREAT-MODEL.md), §4.2 and
  §4.4. Neither invariant is a policy someone thought of — each is a row from
  §3's consequence ordering.

## Context

The threat model ranks eleven boundaries by what happens when each fails. Two of
its top three are properties of components that **do not exist yet**:

- **Row 2, engine host containment.** Invariant 20 already puts native engine
  code in utility processes, and that contains a *crash*. A memory-safety bug
  that reaches code execution inherits everything the process has, and MuPDF's
  advisory history is memory-safety bugs.
- **Row 3, active content on open.** A PDF is a program as well as a page, and
  MuJS is linked into the shim.

Row 1 — update feed integrity — is not addressed here; it belongs with the
updater, which is Stage 10.

## Decision

Add invariants 24 (active content) and 25 (engine host containment), stated in
`docs/ARCHITECTURE.md` §9 with their threat-model references.

**Both are written before `DocumentService` and `CommandBus`, deliberately.** The
sequencing was resolved on 2026-08-18 because two orderings in `docs/JOURNAL.md`
contradicted each other: four of the threat model's owed items are properties of
those two components, and building the components first turns all four into
restrictions fitted underneath finished code.

## Why 25 is policy before mechanism, and how that is kept honest

The utility hosts do not exist. `electron` is not a dependency and
`apps/desktop/src` is a bare `index.ts`. An invariant with no mechanism decays
into a note, so it gets a **forcing function and a scheduled test**, which are
different things:

- **The forcing function** is a declaration in
  `docs/security/engine-advisories.json` (`engine-host-containment`). The day
  shipped code names `utilityProcess` or `MessageChannelMain`, the verdict
  expires and the build fails naming invariant 25. Verified by control: planting
  the symbol in `apps/desktop/src` turns `check:advisories` red with that
  message.

- **What it forces** is a `docs/FEATURES.md` row: integrity level, job object
  limits and network denial **asserted against a running process**. Not against
  the options passed to `fork` — a flag that did not take effect and one that did
  are indistinguishable until it matters, which is why the compiler-mitigations
  check reads the PE image rather than the build flags. "No network" is asserted
  by a connection attempt from inside the host failing, because that is evidence
  and a configuration value is not.

**The limit, stated rather than glossed:** the trigger catches *"a utility host
was written"*. It cannot check *"and it was contained"*. It is a prompt, and
without the row it would be a prompt to write another note.

One thing worth recording because it was checked rather than assumed: the
expiry mechanism is a `git grep` over path globs
(`scripts/lib/verdict.mjs`), **not** the C walker that derives the OCR doors. It
reads TypeScript exactly as it reads C. The initial proposal to "reuse the
existing mechanism" would otherwise have meant building a second walker for a
second language — a different amount of work, discovered mid-task.

## Why 24 is pinned now rather than when it can be violated

It is probably already true, and that is the argument, not a reason to wait. The
open path is small today; Stages 3 and 4 add annotations, form actions and
JavaScript-bearing widgets, each arriving with a plausible reason to run
something on open.

"Nothing calls it today" is a claim this project has twice found resting on a
guard that did not exist: `pdf_subset_fonts`, and the EPUB handler that the
`"not a PDF"` check refused only *after* parsing the file.

Its test is also a row, and the row names the trap: **a proof that the JavaScript
did not run is worthless if the same result appears when the JavaScript is
absent.** The control is the same document opened by something that does run it.

## Rejected alternatives

**Wait for the components, then add the invariants.** Rejected — it is the
retrofit this project exists to prevent, and the sequencing note gives the four
specific items it would have damaged.

**Assert containment against the options passed to `utilityProcess.fork`.**
Rejected: it verifies what we asked for, not what happened. The same reasoning
that moved the mitigations check into the PE image applies unchanged.

**Pin the exact CSP in this amendment** (threat model §4.13). Rejected *for now*
and recorded rather than dropped. The renderer does not exist, so the policy
would be a guess, and an invariant relaxed in its first week teaches that
relaxing invariants is normal. It is a "record now, build with its stage" item.

**Skip the forcing function and rely on the invariant being read.** Rejected:
that is the state every one of the threat model's owed items was in before this
document, and the reason four of them were about to be built underneath.

## Consequences

- The build fails the day a utility host is created, until containment is
  implemented. That is the intent, and it will be inconvenient exactly once.
- Two rows in `docs/FEATURES.md` are now owed that were previously good
  intentions. Neither can be marked done without the assertion it names.
- Invariant 24 constrains the open path before there is much of it, which is
  cheap now and is the whole reason for the timing.
- The invariant count moves to 25; `CLAUDE.md` is updated in this commit, and
  `check:docs` verifies the two agree.
