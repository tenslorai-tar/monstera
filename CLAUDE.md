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
- **When you present me options,** first state whether the question itself is the right one. All the options can share a false premise.

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
- **B3a One resolver per authority.** Many readers are fine; **many opinions
  about what an external authority said are not.** Where a tool, format or
  service already defines how a question is answered, exactly one module here
  implements that answer and everything else calls it.

  Three instances in one day, and none of them looked like a bug from inside the
  file that had it:

  | authority | the second opinion | what it cost |
  |---|---|---|
  | `git diff --name-status` | one parser used `-z` and consumed 3 fields for `R`; the other split on tab | a proof moved *and edited* appeared in no audit column |
  | the watermark's own validity rule | `readWatermark` required a sha; `watermarkAt` accepted any string | a fail-closed became a fail-open on the path a fix created |
  | npm's shim resolution | we implemented "npm beside node" and not "then follow the global prefix" | `npm --version` said 11.17.0 while the guard resolved 11.6.2 |

  Each half was correct in isolation, which is why review passed over all three.
  **The finding is the second opinion, not the wrong one** — patching whichever
  half is currently failing leaves the next caller free to write a third.

  The tell: you are about to reimplement a rule that something else already owns.
  Ask what that thing does, implement *its* rule in one place, and have the other
  callers take it. A partial reimplementation is the dangerous shape, because it
  agrees with the authority most of the time.
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
  function components only. `eslint-plugin-react-hooks`' full recommended set is
  registered against `packages/ui` and every rule in it is an **error**,
  including the four the plugin ships as warnings — verified by
  `npm run proof:lintrules`, which reads the set from the plugin so a version
  that adds a rule widens the check on its own. The
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
native/             C source we compile: the MuPDF shim, a security PoC harness
                    outside every tsconfig and ESLint rule — the compiler is the
                    only check, so its rules live in the file headers
assets/             brand source artwork; the icon set is generated from it
docs/               ARCHITECTURE.md (law), FEATURES.md, DECISIONS/ (ADRs)
```

Boundary violations are **red builds**, not review comments — enforced by ESLint
import restrictions and per-package tsconfigs. `native/` is the exception and it
is a real one: no tsconfig and no lint rule reaches it.

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

- **A filename never selects native code.** The shim names the entry point it
  wants; it never hands a path to a format dispatcher. MuPDF's
  `fz_new_document_writer` picks its writer from a file extension, so `.ocr`
  starts Tesseract with nothing naming an OCR symbol. Banned set derived, not
  listed (invariant 23).

- **Opening a document runs none of its content.** No embedded JavaScript, no
  automatic action, no external fetch, no embedded file to disk — until the user
  asks, for that item. MuJS is in the shim; the interpreter is present whether or
  not anything calls it (invariant 24).
- **An engine host contains a compromise, not only a crash.** Lowest workable
  integrity level, job object limits, no network, no filesystem beyond what it
  was handed. Policy before mechanism, because the hosts are `DocumentService`'s
  to create (invariant 25).

- **Distribution is the Microsoft Store only.** No direct download. The
  two-flavour seam is kept deliberately — flavour switch, `WebUpdateProvider`
  registered with nothing behind it, signing certificate as an empty config
  value — so adding a signed download later is a config change, not an
  amendment. **Do not delete it as dead code** (ADR-0018). Windows updates Store
  apps; the app never installs its own package and never overrides a user who
  disabled automatic updates.

The full invariant list (L1–L25) is in `docs/ARCHITECTURE.md`. A regression
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

- **Never write *any* file through a tool that resolves escape sequences.** Not
  a shell heredoc, not `printf`, not `sed`, not an inline `node -e` or
  `python -c`. Use the file-editing tools. This rule used to say "prose or
  documentation", and that scoping was wrong: the mechanism is that *the tool
  rewrites the bytes on the way past*, which has nothing to do with what the
  file contains. It has now happened **seven times**. The first five:

  1. backticks swallowed a package name;
  2. `\a` and `\b` became BEL and BACKSPACE, and the text rendered as though the
     characters had simply vanished;
  3. `\n` inside a template literal became a real newline;
  4. `sed` was used to edit a markdown file — it survived, but only by luck;
  5. `printf` turned `\v` in `Build\vcvars64.bat` into a vertical tab and `\2`
     into an octal escape, so a build path became `Visual Studio␂2\Buildcvars64.bat`
     and a toolchain was wrongly diagnosed as broken.

  Note that 5 was a **batch file** — neither prose nor documentation — which is
  exactly why the old scoping failed. Only two of the five failed loudly.

  There has since been a sixth: `node -e` used to rewrite a check's call site,
  which ate the backslashes out of a regex and turned a `\n` in a template
  literal into a real newline.

  And a seventh, on 2026-08-18: `printf` with a redirect, to write a one-line
  fixture while reproducing a lint defect. It resolved the `\n` — occurrence 3's
  mechanism exactly. The file was a throwaway and the newline was wanted, so
  nothing was damaged; that is precisely why it belongs in this list. Six of the
  seven caused real harm and one did not, which tells you the mechanism fires
  whether or not the outcome happens to matter, and that judging by outcome is
  how you conclude a habit is safe.

  **Mechanism, not intention.** Two mechanisms now, and the second exists
  because the first sentence of this paragraph used to end differently.

  1. `guardFiles.mjs` scans every staged text blob *in full* for C0 control
     characters. That catches the class in item 2 — the one that reaches review
     unnoticed. It cannot catch items 1, 3, 5 or 6, because a swallowed word and
     a real newline are ordinary text.
  2. **A PreToolUse hook makes the banned path unavailable rather than
     forbidden.** `.claude/settings.json` registers
     `scripts/hooks/blockEscapeResolvingWrites.mjs` against `Bash` and
     `PowerShell`; it rejects `node -e`/`--eval`, `python -c`, inline
     perl/ruby/php, `sed -i`, `echo`/`printf`/`awk` writing to a file or `tee`,
     unquoted heredocs, heredocs redirected into a file, and the PowerShell
     equivalents (`Set-Content`, `Out-File`, `@"` here-strings). It fails closed
     on an unreadable payload, and there is no override — an escape hatch here
     would be a workaround with a config flag on it. `npm run proof:escapeguard`
     covers 51 cases, including the exact command that caused occurrence 6 and
     the ordinary commands this project runs constantly, because a guard that
     blocks `echo` or `sed -n` is a guard someone turns off.

  This paragraph used to say that for the classes the control-character scan
  cannot see, "the rule is the only defence, so it is written as an absolute
  rather than a preference." **Five of the six occurrences happened while it
  said that.** A rule an agent must recall at the moment of composing a command
  is not a defence; the hook is. The rule stays as written — it is still what
  tells you *why* — and in any session where the hook is live it is no longer
  what stops you.

  **The hook has now been observed to fire: 2026-08-18T06:45Z.** It denied a
  `node -e` call, unprompted, in the middle of ordinary work — not a probe, not
  a test, exactly the situation the mechanism exists for. Recorded in
  `docs/hook-probe.json`; `check:docs` fails if the Stage 0 gate row claims this
  without the evidence.

  Its parts were already proven — the script denies, the tracked settings
  register it for both shells, and the configured command string run verbatim
  denies (`npm run proof:escapeguard`, 51 cases). What no proof could reach was
  the agent's own hook table. That is now executed rather than asserted.

  **There has now been a seventh: `printf` with a redirect, 2026-08-18.** This
  paragraph previously ended by telling you to treat the rule as the only thing
  standing between you and a seventh occurrence. It was written at 00:18 and the
  seventh happened at about 01:20, in the same session, by the agent that wrote
  it. That is the whole argument for the hook, demonstrated rather than argued:
  **writing the rule down, and having just written it down, does not put it in
  reach at the moment a command is composed.** Seven for seven. The guard covers
  `printf` with a redirect and would have blocked it; it was not loaded, for the
  reason in limit 1 below.

  Three limits worth knowing.

  1. **A newly registered hook does not take effect immediately, and the delay
     is not explained by process lifetime.** Both halves of that were measured
     in one session. The settings landed at 00:18 on 2026-08-18; at about 01:20
     a `printf` redirect the guard covers ran unimpeded; at 06:45 a `node -e`
     in the same session was denied. Same session id, same transcript, no
     restart in between — so the hook table changed underneath a running
     process, and "read once at startup" is not what happens.

     What triggers the reload was not established and is not guessed at here.
     The practical rule is the useful part: **after registering a hook, do not
     assume it is live, and do not assume it is dead either.** Probe it, and
     read the result with limit 2.
  2. **The two outcomes are not symmetric.** A denial is self-certifying:
     nothing that failed to load the guard can be blocked by it, so a denial
     settles the question whatever the session's age. A command that *runs* is
     ambiguous — a broken guard and an unloaded one look identical. Disambiguate
     that case with `npm run proof:escapeguard`: if it passes and the command
     still runs, the guard is sound and this session has not picked it up.

     The recorder enforces exactly that asymmetry, and it did not at first: it
     rejected both outcomes from a session older than the configuration, which
     would have discarded the first denial this project ever observed.
  3. The hook governs shell tools only: `Edit` and `Write` are deliberately
     untouched, which is what makes failing closed safe, since a bug in the
     guard can always be repaired through the very tools the rule prefers.

  **This is a Stage 0 exit gate**, not a note someone carries forward — it was
  the latter, and the handoff is exactly what failed. In a session whose process
  started after `.claude/settings.json` last changed, run the probe verbatim and
  record it either way; `executed` is the finding, and it means this section
  overstates what is in place and is corrected in the same commit.

  ```
  node -e "console.log('hook test')"
  ```

  ```
  npm run probe:hook -- denied
  ```

  The recorder reads the session's start time from its own transcript rather
  than taking your word for it, and refuses a session older than the
  configuration. `docs/FEATURES.md` carries the gate; claiming it done without
  the evidence turns `check:docs` red.

  The one safe exception is a script that manipulates bytes **numerically**
  (`0x07`, byte arrays), because nothing in that path resolves an escape. That
  is how `docs/JOURNAL.md` was repaired: the corrupt bytes are invisible to
  every editor, so there was no string to match on.
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

## The stage audit — scoped to a range, not to a moment

Not a formality. **Every item below is here because it caught something real**,
and each was found by auditing rather than by a failing test — which is the
point: these are the failures that do not announce themselves.

**Audit `watermark..HEAD`, not the tree.** `npm run audit:scope` prints the
range: commits, files, proofs added, **proofs modified**, proofs removed, and new
scripts.

The scoping is not a convenience. A tree-wide audit run at the end of a stage was
right for the 43-finding audit, which caught things that had sat for weeks. It is
the wrong shape for what this project's record now says produces most defects —
they arrive **inside the proofs and instruments written an hour earlier to close
the previous defect**: the separator gap that gave the escape guard its only
false negative, the crash the history-reach fix introduced, the `UNDER REVIEW`
verdict that printed in no output, two wrong entries in a licence notice. A
tree-wide sweep finds those by luck; a range-scoped one reads the diff that made
them.

**Proofs modified is the load-bearing column.** A new proof is coverage
arriving. A modified one is a check whose meaning changed, and a fix that quietly
loosened a check looks identical to one that corrected it. Only the diff
separates them, so read each one.

Two mechanisms, because this is otherwise a discipline:

- `docs/audit-watermark.json` advances **only** in the commit that writes the
  findings into `docs/JOURNAL.md`, and `check:docs` fails if its sha does not
  appear there — an audit cannot be claimed without a record.
- `check:docs` also fails once HEAD is more than **one batch** past the
  watermark. The threshold is the median of batches 4–7 measured from this
  repository, not a round number, and deliberately not the maximum: the maximum
  was batch 7, the one stretch plainly too large to audit as a unit.

**The watermark never equals HEAD, by construction.** The commit that records an
audit is written after the range it audits, so it cannot be inside it. A one- or
two-commit tail after an audit is the mechanism working. Do not raise it as a
finding, and do not close it with a bookkeeping commit — that commit becomes the
new tail and reproduces the gap one further along. The regress stops at the next
range, which audits the recording commits. The batch-sized thresholds tolerate
the tail deliberately.

Fixing one of these early costs an hour; finding it after features are built on
top costs a rewrite.

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
- a **rich ambient environment** → the bare one the real caller gets

That last one is a distinct axis and it is the quietest, because the difference
is invisible in the diff and in the fixture: **any variable a test inherits from
its runner is a variable the thing under test may be silently depending on.**

Measured. `preCommit.proof.mjs` spawned the hook with the ambient environment,
and it runs under `npm run`, which exports `npm_execpath` pointing at the npm
that started it. A child inherits it. So every hook case took `npmCliPath`'s
FIRST branch — while a real `git commit`, which git runs from an environment
with no such variable, takes the second. The branch a committer actually uses was
exercised by nothing, and the guard and its proof disagreed about which npm
exists without either of them being able to say so. `npm --version` reported
11.17.0 while the hook resolved 11.6.2, in one repository at one moment.

The fix is one line — the proof deletes the variable before spawning — and the
question to carry is the general one: **what else does the harness hand its child
that the real caller does not?**

**And the remedy has its own rule, because the fix above shipped without one and
nothing noticed for a range.** When a HARNESS is corrected, the control asserts
what the harness *passes*, not what the run produces. Measured: with that one
line reverted, all 22 cases still passed and the proof exited 0 — every
assertion reads the hook's output, and the hook succeeds either way, so the
repair was invisible to the entire file. The commit that made it was also one CI
never evaluated, so its whole evidence was a single machine on a single platform.

The reason is general and worth stating as the rule: **a harness fix changes an
input, and assertions look at outputs.** There is nothing downstream to catch it,
so the only case that can is one that reads the harness — here, two lines
requiring the spawned child's environment to carry no `npm_execpath`, with the
variable *set by the case* so it proves the deletion rather than the runner's
luck. Give that case its own vacuity guard too: an empty environment satisfies
"no `npm_execpath`" without proving anything.

**2a. Has a change to HOW something is proven moved the coverage?**
Turning an asserted claim into a **derived** one is a strengthening where the
derivation can run and a weakening everywhere else, because a derivation has a
provisioning condition and an assertion does not.

Measured: invariant 25's symbols moved from `in: null` witnesses to a derivation
from `electron.d.ts`. A misspelt symbol used to fail *everywhere*; it is now
reported as UNVERIFIABLE on the one job that installs nothing. That is correct by
the register's own philosophy — "could not look" is not "looked and found
nothing" — and it is still a reduction, and the commit that made it said nothing.

Not a defect. But a change that has to be **stated**, or the distinction between
*could not look* and *looked and found nothing* gets quietly spent: every
unverifiable line reads as rigour, including the ones that used to be failures.

**3. Would CI have caught it?**
If not, say so and close the gap. A defect CI cannot see is waiting for a
contributor, not for you. (Provisioning worked from PowerShell and failed from
Git Bash; the guards job runs on Linux, so CI was structurally blind to it.)

**4. Are the proofs non-vacuous?**
Mutate the thing each proof guards and confirm the proof goes red. A proof that
cannot fail is a green check that verifies nothing. When a mutation *doesn't*
turn it red, find out why before concluding the proof is vacuous — the build may
have failed and left stale output for the proof to test.

**The DIRECTION of the mutation decides whether it separates anything.** When the
property under test is *"these two agree"*, mutate **towards disagreement** —
because agreement is also what **absence** produces, so a mutation that moves
both sides together is indistinguishable from the bug.

This is item 4b's corollary — *an empty result is a broken lookup, not a clean
one* — arriving inside a comparison rather than a search, which is where nobody
had applied it. It cost a control that protected nothing for a whole range: a
case asserting two churn figures agreed looked up a fixture that could never be
in the set it queried, got `undefined`, and passed. The mutation run against it
made every figure agree, which the missing entry already did. Forcing the figures
to always **differ** reddened it immediately.

So for a comparison, ask which mutation the *bug* would be indistinguishable
from, and run the other one.

**4a. Has every instrument passed a resolution test — BEFORE it measured
anything real?**
Not after, and not "it looked plausible". Feed it two values you know differ by
the smallest amount that would change a decision, and confirm it reports them as
different. This is mandatory and it takes under a minute.

A blind instrument and a vacuous proof are the same failure wearing different
clothes: both report a number nobody can distinguish from the answer they hoped
for. Four instruments in this project failed exactly that way, and all four would
have died at this step:

- a `setInterval` peak sampler that cannot fire while a synchronous FFI loop
  holds the event loop, reporting 63 MB for a walk that cost 526 MB —
  *reproducibly*, which is what made it convincing;
- a cache reader that searched a debug dump from the start and bound to the first
  cached item instead of the summary, reporting 98,065 bytes for a 75 MB store —
  and reading correctly only when the store was empty, which every early
  checkpoint happened to be;
- allocator counters that clamped an underflow to zero, so the failure state was
  identical to "everything was freed" and a fault confirmed the hypothesis;
- a harness printing MB to two decimal places, which rendered a 21,500-byte store
  and a 10,000-byte delta as the same `0.01 MB` — it could not distinguish the
  two numbers it existed to compare.

Prefer designs where the failure is unrepresentable over designs that check for
it: monotonic totals cannot underflow, so no guard is needed. And prefer counting
inside the component over an OS-level proxy — RSS cannot tell "the engine retains
this" from "the allocator is sitting on it".

**4b. Is the instrument a SEARCH? Then it needs a positive control that finds
something known-present, on every run.**

A search — a grep, a symbol scan, a reachability walk, a call-graph query — has
one output for every way it can be broken: **"found nothing"**. A wrong pattern,
an empty input set, a parse that silently ate the file, the wrong root, the wrong
scope: all of them report the same clean result as a genuine absence. And in
security and compliance work, "found nothing" is nearly always the answer you
were hoping for, so nothing about it prompts a second look.

So a search-shaped instrument is not finished until it must **locate something it
is known to be able to find**, every time it runs, or its silence is worthless.
Put the control in the instrument, not only in its proof: the proof runs in CI,
and the instrument gets run by hand on the day someone needs an answer.

This is 4a's sibling and it is not covered by it. 4a asks whether two values that
differ are reported as different; 4b asks whether the instrument can see anything
at all. An empty result passes 4a vacuously.

Five instruments in this project failed exactly this way, and every one of them
returned the reassuring answer:

- the OCR reachability walk, **four times in a row** — direct-call edges only, a
  parser that read prose as C, a pattern that could not match a definition at
  column 0, and a scan that swallowed the declarations it was searching. Each
  reported "nothing reaches Tesseract". Two of the four were live at once and
  each concealed the other;
- the H3 widget probe, which read `/T` off the widget alone and reported "no
  field name" for a fixture whose fields were named — the same shape, and its fix
  was the same: make the fixture's own known-present data the control.
- **the audit-scope report itself**, whose proof-classification matched
  `*.proof.mjs` and `proofs/` only and was therefore blind to every `*.test.ts`
  — which is where most of this project's controls live. Measured: a range that
  added 254 lines of test carrying its strongest control reported "proofs ADDED:
  none", and a test file at +312/−77 whose controls had changed meaning appeared
  in no column. The instrument that scopes every audit had the blind spot in the
  column it calls load-bearing. **A file-naming convention is not a check**, and
  that is the general form: whenever a classifier decides what an instrument
  looks at, its rule needs a control for the things it must *exclude* as well as
  the things it must find — otherwise "counts the right files" and "counts
  everything" and "counts almost nothing" all produce output that reads fine.
  **And it recurred one range later by SCOPE rather than by filename shape**: the
  same report's instrument column was scoped to `scripts/`, while a filesystem
  probe — an instrument in the plainest sense — landed under `packages/*/src/`.
  Fixing a classifier's *pattern* and leaving its *root* is half a fix, and both
  halves report "found nothing" identically.
  **And a third time, one range later again, by STATE.** The same report parsed
  `git diff --name-status` with no `-z` and recognised `A` and `M`, so a renamed
  proof arrived as one entry whose path was two paths joined by a tab and landed
  in *no* column — measured at `R100` and at `R090`, the second being a check
  that changed address *and* meaning. A deleted proof was dropped the same way,
  and that one can fire today. **A classifier has three axes and they fail
  independently: what it matches, where it looks, and which states it
  understands.** Pattern, root, state — fixing any one and stopping is a half
  fix, and every version reports "found nothing" in the same voice.
  The general form is worth more than the three instances: **when two files hold
  two opinions about the same porcelain, the finding is the second opinion, not
  the wrong one.** Both parsers here had been written by hand; one was correct
  and had a control, and patching the other in place would have left the next
  caller free to write a third. The parser now lives once, in
  `scripts/lib/gitScope.mjs`, which already exists because two guards
  independently asked git a question whose answer was not the thing they
  guarded.

Corollary, and it is where three of the four hid: **an empty intermediate result
is a broken parse, not a clean input.** Throw. A seed set, a symbol table, a file
list or a root set that comes back empty must never be allowed to look like an
answer.

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

**Ask it of the changed function's own comment first, and ask it precisely:
when a commit removes a behaviour, does that comment still assert the behaviour
EARLIER IN ITS OWN TEXT?** This is where the answer has hidden twice, and it is
checkable in the diff you are already reading.

The shape is always the same, and it is not carelessness — it is what writing a
good explanation does to you. The author adds a new section saying what changed
and why, and leaves the original paragraph standing. The stale half then sits in
the position a reader treats as **the contract** — the "what this function does"
paragraph — while the correction lives in a later section a skimmer never
reaches. And the person who reads that contract is precisely the one deciding
whether the removed behaviour may come back.

Both occurrences were inside the range being audited, in the file the range's
headline change rewrote, and item 7 passed over both:

- `publish` said the swap was decided by "a destination that runs and reports
  the pinned version" **eighteen lines above** the new section explaining that
  it no longer spawns the destination at all — and cannot, since the parameter
  is gone.
- the same comment excused a surviving quarantine directory as one "the next run
  cleans up", when no run had ever cleaned one up.

**And this is the detectable signal, sharper than "re-read the first
paragraph": look for a sentence where the change invalidated ONE CLAUSE OF A
COMPOUND CLAIM.** Those are the ones no reader flags. `--force` still meant
exactly what that sentence said it meant, so the live clause vouched for the
dead one beside it — nothing about reading it feels wrong, because the part you
check is the part that is still true.

A wholly false sentence is caught by the next person who reads it. A half-true
one is not caught by anybody, which is why it is the shape worth searching for
by hand.

## Commands

```bash
npm run proof:guards      # prove the pre-commit guards still catch what they claim
npm run proof:secretscan  # prove the secret scan cannot be silently disarmed
npm run proof:escapeguard # prove the escape-resolving-write hook blocks and permits correctly
npm run proof:advisories  # prove the advisory register cannot pass while unreadable
npm run guard:staged      # file policy against the index
npm run guard:tree        # file policy against every tracked file (CI mirror)
npm run scan:secrets      # full-history gitleaks scan
node scripts/provision/gitleaks.mjs   # install the pinned secret scanner
```

**There is one way to suppress a secret-scan finding**: an `[allowlist]` entry
in the tracked `.gitleaks.toml`, in its own commit, naming the finding and why
it is not a secret. Inline `gitleaks:allow` comments and `.gitleaksignore`
fingerprint files are both closed mechanically, because neither ever appears in
a diff. A `.gitleaksignore` anywhere makes the scan **refuse to run** — no
gitleaks flag can neutralise it, so refusing is the only honest option.

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
