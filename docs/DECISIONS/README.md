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
| [0004](0004-toolchain-versions.md) | Toolchain versions, and two deliberate steps back from "latest" | Accepted |
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
| [0023](0023-how-the-contained-engine-host-is-built.md) | How the contained engine host is built | Accepted; corrected 22 times, 2026-08-22 to 2026-08-28 — read the corrections before the body |
| [0024](0024-execution-mode-is-a-placement-axis.md) | Execution mode is a placement axis, and `packages/nodemode` is the Node-mode side | Accepted; a cost read off a file rather than paid, corrected 2026-08-25 |
| [0025](0025-mains-baseline-budget-is-derived-from-what-it-must-catch.md) | `main`'s baseline budget is derived from what it must catch, and 96 MB was not | Accepted; the ceiling, `R`'s runtime and the drift attribution corrected 2026-08-27 |
| [0026](0026-a-declaration-is-not-an-implementation.md) | A declaration is not an implementation, and the kernel's public surface carries no native binding | Accepted |
| [0027](0027-a-development-grant-belongs-to-provisioning.md) | A development grant belongs to provisioning, not to the application | Accepted; corrected 2026-08-27 — the grant is necessary and not sufficient, and the set is reshaped |
| [0028](0028-main-holds-the-process-creation-binding.md) | `main` holds the process-creation binding, and §9.17's `main` clause is amended to say so | Accepted; §9.17 not yet amended |
