# CLAUDE.md — operating rules for anyone (human or agent) working on Monstera

This is the **derived operational digest**. It is the short version you keep in
your head. It is not the law.

| Document | Status | Changed by |
|---|---|---|
| `BUILD-PROMPT.md` | **Immutable founding record.** Never edited after its first commit. | nobody |
| `docs/ARCHITECTURE.md` | **Living law.** Wins wherever it diverges from the founding record. | B4 amendment, in its own commit, naming the founding clause it supersedes |
| `CLAUDE.md` (this file) | Derived digest. | updated in the same commit as any amendment affecting it |

Three documents, one truth — not three truths. If this file and
`docs/ARCHITECTURE.md` disagree, **the architecture document is right and this
file is stale**; fix it in the same commit.

---

## Rule 0 — read this before every fix

> **This app is going public for the whole world to see and read its code. When
> you hit a problem, a bug, or an issue, do not quickly find a workaround —
> investigate the root cause of the problem and fix it from the root. When you
> encounter an issue, your first intuition must not be a workaround; it must be
> investigation.**

This governs every other rule here. In practice:

- **State the mechanism in one sentence before you change a line.** If you
  cannot, you have not finished investigating. "chokidar holds a directory
  handle open for `ReadDirectoryChangesW`, and an open handle blocks RENAME" is
  a mechanism. "the build was flaky" is not.
- **A workaround is legal only when the root cause is proven to lie outside
  this repository**, and the commit message names the cause and says why the
  workaround is the correct response.
- **Banned reflexes:** retrying with different flags until something passes ·
  `catch {}` that swallows the problem · special-casing the input that failed ·
  bumping a timeout · disabling the check that went red · widening a type to
  make an error disappear.
- **Fix the class, not the instance.** Closing one vulnerable handler and
  leaving its six siblings is the classic half-fix.
- **Be equally suspicious of things that work.** A green check that does not
  verify what it claims is worse than a red one — an `available: true` for a
  binary that cannot be spawned, a timestamp request whose response is
  discarded, a UI test that proves a button dispatches into the void.

Every entry in `BUILD-PROMPT.md` Part K is a mechanism someone found instead of
patching around. Add to it; do not re-pay for it.

---

## The process rules, in one line each

- **B1 Root cause over symptom.** See Rule 0.
- **B2 Every fix ships a proof with a control case.** The control reproduces the
  original bug without the fix, so the proof fails if the guard is removed. A
  bug fix without a control case is not finished. Proofs run in CI from day one.
- **B3 One writer per concern.** Any property of a document has exactly one
  component permitted to write it (the writer-of-record matrix). Many readers
  are fine. Two writers is how a codebase acquires sidecar hacks and
  cross-parser identity joins.
- **B4 Architecture change control.** If a feature cannot be built by
  registering into an existing seam — **STOP**. Do not bend the seam in place.
  Amend `docs/ARCHITECTURE.md` first, in its own commit, with the rationale and
  the rejected alternatives, then build. Amendment commit and feature commit are
  always separate.
- **B5 Make illegal states unrepresentable.** Prefer a type or capability token
  that cannot express the bug over a runtime check that catches it. A renderer
  that cannot name a filesystem path needs no path allowlist.
- **B6 Comment culture.** Comment only where the *why* is non-obvious, and state
  the **mechanism**, never the history of who fixed what.
- **B7 TypeScript strict everywhere; `any` is an error, not a warning.** React
  function components only. All four React Compiler ESLint rules are errors. The
  single sanctioned exception: `any` is confined to one typed adapter module per
  native boundary (`mupdfRaw.ts`, `pdfiumFfi.ts`), which alone may carry a
  file-level lint disable. No premature abstractions inside modules.
- **B8 Commit discipline.** Commit after each working, proven unit — never in
  stage-sized batches. Bump the version on every packaged build; never reuse a
  number. Never build installers unless asked. Never commit binaries.
- **B9 i18n and a11y are substrate, not features.** A lint rule bans literal
  user-facing strings in JSX. Every dialog uses the one `<Dialog>` primitive.
  These cannot be retrofitted across tens of thousands of lines.
- **B10 Develop in public.** Every push is permanent — GitHub retains commits by
  hash even after a history rewrite, so there is no later scrub. Never commit a
  secret, a binary, or an unvetted fixture. **Never force-push or rewrite
  published history on `main`.** A bad commit is corrected by a new commit that
  says what was wrong.

---

## Repository map and the boundaries the module graph enforces

```
packages/shared/    branded types, geometry, Result, pure utils
                    imports: nothing internal
packages/contract/  THE IPC contract — every channel defined once, zod schemas
                    imports: shared
packages/kernel/    headless document engine: DocumentService, CommandBus,
                    engine adapters, undo log, save pipeline, OCR, export
                    imports: shared, contract — NEVER Electron, NEVER React
packages/ui/        React app, per-document stores, registries, PDF.js
                    imports: shared, contract — NEVER kernel, NEVER Node
packages/testing/   fixture corpus, proof harness, browser shim
apps/desktop/       Electron shell — the ONLY package that imports Electron
scripts/            provisioning, release tooling, git hooks
docs/               ARCHITECTURE.md (law), FEATURES.md, DECISIONS/ (ADRs)
```

Boundary violations are **red builds**, not review comments — enforced by ESLint
import restrictions and per-package tsconfigs.

The kernel having zero Electron imports is not aesthetic: it makes the whole
document pipeline unit-testable in milliseconds. **A test that must fake
`DOMMatrix` or a window bridge just to exercise a save is evidence the boundary
is wrong** — fix the boundary, not the test.

---

## Non-negotiables you will trip over

- **Main owns the document.** The renderer holds an opaque `DocId` and a
  `DocVersion`. It never holds a filesystem path or mutable document bytes.
- **Mutations are commands, reads are queries.** `deletePages([3,5])` is bytes
  of intent regardless of file size. Bytes cross once per *version*, never once
  per *operation*. Any design where payload size scales with document size per
  operation is wrong.
- **FileHandles, not paths.** A string path in a renderer-facing type is a
  compile error. The rejected alternative — a runtime path allowlist — fails
  open at every handler that forgets to call it.
- **PDF.js is never a source of truth.** It renders. Annotation and form models
  come from the kernel.
- **Coordinates are branded types** (`PdfPoint`, `FitzPoint`, `ViewportPoint`,
  `XObjectPoint`, `RasterPoint`). One `PageTransform` converts. **A bare y-flip
  is banned by lint** — an inline flip silently assumes rotation 0 and a zero
  CropBox origin.
- **State is per document** — one store instance per `DocId`, dropped on close.
  This makes the cross-tab corruption race unrepresentable *by shape*.
- **Design tokens only.** No raw hex, no magic pixel values, no emoji as icons,
  anywhere. Contrast-bearing colors are **computed at the point of use** via
  `onColor(brand, background, minRatio)`; **storing a derived color is a
  defect**.

The full invariant list (L1–L16) is in `docs/ARCHITECTURE.md`. A regression
against any of them is a defect regardless of what the tests say.

---

## How a feature lands: registration, not wiring

A feature is finished when it is **registered**, not when it is wired.
Registries: commands (with `placements[]`), dialogs, settings, annotation types,
tools, AI providers, update providers, import/export formats, cloud providers.

The ribbon, floating toolbar, context menus, command palette, shortcut map and
start-screen shortcuts are all **projections** of the command registry. **There
is no second place where a feature is wired.** A hand-maintained layout file for
any surface is exactly the second wiring place the registry exists to forbid.

If a feature cannot be registered into an existing seam → **B4**. Stop and amend
the architecture first.

---

## Definition of done (per feature, no exceptions)

Registered (no bespoke wiring) · contract entries exist and validate · kernel
logic unit-tested · a proof with a control case covers its invariant · strings
are i18n keys · dialogs use the primitive and pass the a11y lint · configurable
behavior is in the settings registry · `docs/FEATURES.md` row updated · comments
state mechanisms only · committed as a working unit.

### The wired-tools rule (absolute)

**A control that renders but does nothing is a defect, not a placeholder.**

Never register a command without a working `run`. Never mount a button for an
unimplemented command — the registry's `when` predicate hides what does not
exist yet. Done for a tool means end-to-end: click it → use it on a real
document → observable, correct effect → survives save and reopen.

**Wired is proven by a pair of tests, and neither alone counts:** a kernel-level
proof that the command produces the document effect and survives round-trip,
**plus** a UI-level test that the control dispatches exactly that command. The
UI test runs against the browser shim, whose kernel is stubbed — alone it would
prove only that a button dispatches into the void, which is the display-only sin
wearing a green check.

---

## Standing rules from the project owner

These were given directly and bind every agent on this project.

- **Never edit prose or documentation through a shell heredoc or an inline
  `node -e` / `python -c`.** Use the file-editing tools. Shell and language
  escaping silently produced wrong output **three times in one day** here:
  backticks swallowed a package name, `\a` and `\b` became control characters
  that render as though the text simply vanished, and `\n` inside a template
  literal became a real newline. Only one of the three failed loudly. The
  control-character guard catches one class; the other two look like ordinary
  text and reach review unnoticed.
- **Research versions, never recall them.** Fetch the registry or the release
  API. Assumptions lost badly on the first attempt: two GitHub Actions were
  majors out of date, ESLint was at 10 rather than 9, TypeScript at 7, Vite at 8.
  A package rename made a stable library look like an RC. Use the latest
  available version unless a conflict is recorded in an ADR.
- **Verify every claim by executing it. Do not assert.** Separate what was run
  from what was assumed, and treat the second list as unfinished. A type
  declaration is not behaviour: MuPDF declares `rearrangePages`, and running it
  showed it destroys forms.
- **Never build features on top of architecture that a feature has shown to be
  wrong.** If a feature reveals the architecture is wrong, the architecture
  changes first, via B4, in its own commit. Retrofitting structure under
  features already built is the specific failure this project exists to prevent.
- **Ask rather than assume.** When the build prompt is silent or two readings
  lead to materially different work, stop and ask the owner. Decisions taken
  this way are recorded as ADRs.
- **Do not rush.** Nothing is chasing this build. A wrong foundation costs more
  than a slow one.

## The stage audit — run it after every substantial unit of work

Not a formality. **Every item below is here because it caught something real**,
and each was found by auditing rather than by a failing test — which is the
point: these are the failures that do not announce themselves.

Run this at the end of a stage, before starting the next, and write the findings
into `docs/JOURNAL.md`. Fixing one of these early costs an hour; finding it after
features are built on top costs a rewrite.

**1. Classify every fix you made: root cause, or workaround?**
Go back through the session's corrections one at a time. For each, state the
mechanism in one sentence. If you cannot, it was a workaround wearing a fix's
clothes. Specifically look for:
- A repair that could **regenerate** — if the same action recreates the problem,
  you fixed a symptom. (The lockfile was "fixed" by regenerating it; adding one
  dependency two hours later broke it again. The fix was a guard, not a repair.)
- An **override or escape hatch standing in for missing coverage** — that is a
  workaround with a config flag on it. (`MONSTERA_GITLEAKS` existed so
  contributors on unpinned platforms had a route; the fix was to pin all ten.)
- A **loosened check**. Widening a type, disabling a rule, raising a limit, or
  exempting a role means the check was right and the code was wrong.

**2. Was it verified against the easy shape only?**
This has bitten three times in one day and is the most reliable source of
false confidence. Ask what the *hard* shape is and test that too:
- flat page tree → **nested** page tree (the reorder was wrong on nested)
- one platform's lockfile → **every** platform (`npm ci` validates the whole file)
- an already-provisioned tool → a **cold** machine (the proof needed a scanner)
- a flat object → one with **inherited** attributes, rotation, or a CropBox origin

**3. Would CI have caught it?**
If not, say so and close the gap. A defect CI cannot see is waiting for a
contributor, not for you. (Provisioning worked from PowerShell and failed from
Git Bash; the guards job runs on Linux, so CI was structurally blind to it.)

**4. Are the proofs non-vacuous?**
Mutate the thing each proof guards and confirm the proof goes red. A proof that
cannot fail is a green check that verifies nothing. When a mutation *doesn't*
turn it red, find out why before concluding the proof is vacuous — the build may
have failed and left stale output for the proof to test.

**5. Executed, or asserted?**
Separate the two explicitly. Anything in the "asserted" column is not a finding,
whatever confidence it was written with. (Content composition was moved to a
different library by swapping a name in a table; nobody had run it.)

**6. Did architecture change *before* the feature, or underneath it?**
If a feature revealed the architecture was wrong, the architecture is what
changes — via B4, in its own commit, with an ADR. Retrofitting structure under
features already built is the failure mode this project exists to prevent, and
it never announces itself: it arrives as one reasonable-looking exception.

**7. Do the documents still match the code?**
`docs/FEATURES.md` rows, `docs/ARCHITECTURE.md`, `CLAUDE.md`, and any ADR whose
evidence has since changed. An ADR is corrected by a **dated correction
section**, never by editing it to look right — what was believed at the time is
part of the record.

## Commands

```bash
npm run proof:guards      # prove the pre-commit guards still catch what they claim
npm run guard:staged      # file policy against the index
npm run guard:tree        # file policy against every tracked file (CI mirror)
npm run scan:secrets      # full-history gitleaks scan
node scripts/provision/gitleaks.mjs   # install the pinned secret scanner
```

Hooks are enabled automatically by the `prepare` lifecycle script
(`core.hooksPath` → `.githooks/`). If a commit is rejected because the scanner
is missing, **provision it — do not bypass the hook.** `--no-verify` on this
repository is a Rule 0 violation with a permanent, public consequence.

---

## Build order

Stage 0 (walking skeleton — the architecture, whole) → 1 viewer core → 2 page
management → 3 annotations → 4 forms → **SHIP 1.0** → 5 text editing → 6 OCR →
7 security & signatures → 8 import/export/convert → 9 AI & cloud → 10 ship.

**No feature work before Stage 0 exits.** Do not start a later stage to escape a
blocked earlier one — invoke B1 or B4 instead. Progress and stage actuals are
recorded in `docs/JOURNAL.md`.
