# Architecture Decision Records

Every amendment to `docs/ARCHITECTURE.md` under rule B4 is recorded here, and
so is every decision a future reader would otherwise have to reverse-engineer
from the code.

## Why these exist

The expensive question in an inherited codebase is never "what does this do" —
it is "why is it like this, and what happens if I change it". An ADR answers
that in the place where it will still be found in three years.

The **rejected alternatives** section is the load-bearing one. A decision
recorded without its rejected alternatives reads as arbitrary, and the next
person re-derives the same options from scratch, or worse, adopts one that was
already ruled out for a reason nobody wrote down.

## Format

One file per decision, numbered sequentially, never renumbered:

```
NNNN-short-kebab-case-title.md
```

**"Never renumbered" is not tidiness, and here is the mechanism** (finding
UU-1). A renumber cannot be caught by link-checking, because **both targets
exist**: `check:docs` verifies that a link resolves, and no check can verify it
resolves to the *decision the sentence means*. The reader lands on a real ADR
that says something else, which reads as authoritative — **strictly worse than a
broken link, because a broken link announces itself.**

So a renumber is a **manual sweep of every prose reference**, done in the same
commit and never deferred, and it is a cost to weigh before splitting or merging
an ADR rather than a chore afterwards. It has been paid once: ADR-0022 was split
into 0022 (the process type) and 0023 (the mechanism), and three references in
`scripts/research/` still pointed at 0022 for questions 0023 answers.

The cheapest way to avoid the sweep is not to need it: **number a decision when
it is written, and split by writing a NEW number rather than by moving an old
one.**

Each contains:

- **Status** — Proposed / Accepted / Superseded by ADR-NNNN. ADRs are never
  deleted or edited to say something different; a reversal is a new ADR that
  supersedes the old one, and the old one stays as the record of what was
  believed and why.
- **Date**
- **Context** — the forces at play, including what was actually verified versus
  assumed.
- **Decision** — what is now true.
- **Rejected alternatives** — each with the reason it lost.
- **Consequences** — including the unpleasant ones. An ADR that lists only
  benefits is marketing.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-agpl-on-the-microsoft-store.md) | AGPL-3.0 on the Microsoft Store | Accepted; mechanism corrected 2026-08-17 |
| [0002](0002-brand-mark-treatment.md) | Brand mark treatment — composite logo used as supplied | Accepted |
| [0003](0003-token-role-typing-and-declared-pairings.md) | Token role typing: five categories and declared pairings | Accepted |
| [0004](0004-toolchain-versions.md) | Toolchain versions, and two deliberate steps back from "latest" | Accepted; `lucide-react`'s licence corrected 2026-08-28, and the component-test vehicle added the same day |
| [0005](0005-ui-foundation-libraries.md) | UI foundation: Base UI, Zag machines, Lingui, zustand | Accepted |
| [0006](0006-engine-capability-spike-results.md) | Engine capability spike results, and the matrix amended to match | Accepted; corrected 2026-08-16, the same day |
| [0007](0007-memory-budgets-and-the-document-size-ceiling.md) | Per-process memory budgets, and the measured document-size ceiling | Accepted; largely withdrawn by correction 2026-08-17 |
| [0008](0008-save-mode-is-determined-by-purpose.md) | Save mode is determined by the purpose of the save, not by a default | Accepted |
| [0009](0009-document-identity-and-the-command-log.md) | Document identity, the command log, and the engine seam | Accepted; the identity mechanism corrected four times, 2026-08-18/19 |
| [0010](0010-native-mupdf-through-an-ffi-shim.md) | Native MuPDF through an FFI shim; WASM withdrawn | Accepted; instruments corrected 2026-08-17 |
| [0011](0011-engine-upgrade-cadence.md) | When the native engine is upgraded, and when it is not | Accepted |
| [0012](0012-memory-budgets-are-machine-read-from-the-invariant.md) | The memory budgets are machine-read from invariant §9.17 | Accepted |
| [0013](0013-pdfa-export-and-text-extraction-engines.md) | PDF/A-2b export gets a matrix row and no binary; the Poppler conditional is dropped | Accepted |
| [0014](0014-ocr-stays-inside-the-engine.md) | OCR stays inside the engine: Tesseract and Leptonica are kept | Accepted |
| [0015](0015-a-filename-may-not-select-a-native-library.md) | A filename may not select a native library (invariant 23) | Accepted |
| [0016](0016-the-document-handler-set-is-named.md) | The document handler set is named, not inherited | Accepted |
| [0017](0017-the-security-substrate.md) | The security substrate: invariants 24 and 25 | Accepted |
| [0018](0018-distribution-is-the-microsoft-store.md) | Distribution is the Microsoft Store | Accepted |
| [0019](0019-the-renderers-csp-is-pinned.md) | The renderer's CSP is pinned as invariant 27, and `'unsafe-inline'` is dropped rather than pinned | Accepted; the contrast it argues from corrected 2026-08-23 |
| [0020](0020-the-preload-is-bundled.md) | The preload is bundled to CommonJS and enters the contract by a leaf export | Accepted; one stated reason corrected 2026-08-21 |
| [0021](0021-the-canonical-image-is-retained.md) | The canonical image is retained, one per open document, under a supplied ceiling | Accepted |
| [0022](0022-the-engine-host-is-a-process-we-create.md) | The engine host is a process we create, not a utility process | Accepted; two stale references corrected 2026-08-22/23 |
| [0023](0023-how-the-contained-engine-host-is-built.md) | How the contained engine host is built | Accepted; corrected 22 times, 2026-08-22 to 2026-08-28 — read the corrections before the body. Decision 15 (2026-09-01) puts invariant 25(c) on the startup check |
| [0024](0024-execution-mode-is-a-placement-axis.md) | Execution mode is a placement axis, and `packages/nodemode` is the Node-mode side | Accepted; a cost read off a file rather than paid, corrected 2026-08-25 |
| [0025](0025-mains-baseline-budget-is-derived-from-what-it-must-catch.md) | `main`'s baseline budget is derived from what it must catch, and 96 MB was not | Accepted; the ceiling, `R`'s runtime and the drift attribution corrected 2026-08-27, and a bound withdrawn 2026-08-28 when `perf:gate` turned out never to have run in CI |
| [0026](0026-a-declaration-is-not-an-implementation.md) | A declaration is not an implementation, and the kernel's public surface carries no native binding | Accepted |
| [0027](0027-a-development-grant-belongs-to-provisioning.md) | A development grant belongs to provisioning, not to the application | Accepted; corrected 2026-08-27 — the grant is necessary and not sufficient, and the set is reshaped |
| [0028](0028-main-holds-the-process-creation-binding.md) | `main` holds the process-creation binding, and §9.17's `main` clause is amended to say so | Accepted; §9.17 amended 2026-08-28 |
| [0029](0029-how-the-registries-are-built.md) | How the registries are built: registration is a value, not a side effect | Accepted as a design; nothing built |
| [0030](0030-a-remote-writer-does-not-open-from-an-image.md) | A remote writer does not open from an image, and the bus never asked it to | Accepted |
| [0031](0031-the-renderer-reads-the-document-by-demand-paged-ranges.md) | The renderer reads the document by demand-paged byte ranges, not a per-version snapshot | Accepted; §2 amended 2026-08-29; **corrected 2026-08-30** — Decision 1's *"the view model already carries bounded structured data"* was false when written, and ADR-0032 is where it stopped being |
| [0032](0032-the-view-model-is-a-scoped-query.md) | The view model is a query scoped to the pages the renderer draws, not a delta the command returns | Accepted; §2 amended 2026-08-30 |
| [0033](0033-a-ratio-budget-governs-a-process-that-holds-bytes.md) | A ratio budget governs a process that holds bytes, not one that parses them | Accepted 2026-09-01 — answers the failed `mupdf-host` gate per `BUILD-PROMPT.md:680`; §9.17 restated to `3 GB, base 128 MB`, the multiple withdrawn. Gives up amplification detection, stated in the ADR |
| [0034](0034-the-text-substrate-owns-the-engines-options-not-its-own-clusterer.md) | The text substrate owns the engine's options, not a clusterer of its own | Accepted 2026-09-02 — discharges ADR-0013's unexecuted columns-and-tables half by measurement; supersedes `BUILD-PROMPT.md` Part E2's mechanism, §3.2 amended. `FZ_STEXT_SEGMENT` on, `TABLE_HUNT` off with a trigger. **Addition 2026-09-02** — Part E2's *"deep tuning lands with Stage 5"* had lost its subject when the constants went, so tuning becomes a scored choice among the engine's options, and a Stage 5 post-pass that reads GEOMETRY to decide grouping is the second extraction path K.0 bans |
| [0035](0035-extracted-text-is-never-resident-in-main.md) | Extracted text is never resident in main, and search is a per-page query | Accepted 2026-09-02 — answers D1's invariant-11 gate for the first channel that could break it; §9.17's `main` clause amended. Measured at **3.59×** the file size for a text-heavy document, against a 1.5× budget |
| [0039](0039-a-byte-image-writer-round-trips-the-live-session.md) | A byte-image writer round-trips the live session | Accepted 2026-09-04 — amends §2 and §8's seam so the seven content-generation rows routed to `@cantoo/pdf-lib` become buildable. Its input is the live writer's `serialise`, never main's canonical image, which OOOOO-1 measured as stale for the life of an open document; its result replaces the live session through ADR-0037's restore path and becomes main's canonical image. A pdf-lib session is minted per call and never stored, which makes *which bytes win* unaskable rather than answered. Takes the byte-refresh ADR-0032 rejected, on the trigger that ADR wrote: the cost was one serialise per command where none was performed, and is now none per command on a path that already performs one |
| [0038](0038-a-dialog-answers-the-command-that-opened-it.md) | A dialog answers the command that opened it | Accepted 2026-09-04 — amends §7's dialog registry row, which had no way for a dialog to produce a value. An entry may declare a **result schema**; `ask` returns a promise settling with the parsed result or `undefined` on dismissal, and the **command** dispatches. The gate is then structural rather than a rule: a dismissal produces no value to apply. `resolve` is not a prop, because a function in a `.strict()` validator is B7's `any` argument one layer down |
| [0037](0037-checkpoint-restore-and-the-replay-that-is-not-needed.md) | Checkpoint restore, and the replay that is not needed | Accepted 2026-09-04 — chooses invariant 18 clause (ii)'s mechanism once both its triggers had fired. `CheckpointRestoreNotBuiltError`'s two stated reasons were stale: the ownership question was answered on 2026-08-28 (the supervisor), and the replay §4 describes is **empty for every terminal entry**, because the checkpoint is minted immediately before the command it is stored on and undo is last-applied-first. That property expires as a compile error, not silently |
| [0036](0036-the-error-boundary-is-the-one-class-component.md) | The error boundary is the one class component | Accepted 2026-09-03 — amends B7's *"React function components only"* with a second confined exception, `monstera/no-class-components` enforcing it. React 19.2.8 declares `getDerivedStateFromError` on `StaticLifecycle` alone; there is no error-boundary hook, and an uncaught throw unmounts the whole tree. **Corrected 2026-09-03**, the same day: placement below the state is necessary and not sufficient — the remounted scroller reports its seeded first page over the preserved one, so the retry re-issues `goTo` |
