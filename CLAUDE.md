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

  **KNOWING THE RULE IS NOT A DEFENCE, and this is the third domain to pay for
  that sentence.** The escape guard paid seven times and the emitted-template
  scan seven, each time by an author who had the rule on the page. B3a is the
  same: the check written to catch a second opinion about the advisory
  register's symbols *was itself a third one*, inside an hour, written by the
  author who had just consolidated the other two (OOO-1). It spelt
  `claim.symbols ?? []` where the two existing callers spelt `?? [name]`, and
  reported a correct entry as a defect on its first run.

  So the remedy is never *be careful here*; it is **make the rule a named thing
  with callers.** A rule that lives in call sites and prose is a rule the next
  caller re-derives — and a helper sitting beside a bare inline expression is the
  same trap one step on, because the choice between them is a paragraph someone
  has to read and reject rather than two names they pick from (QQQ-3). B5 over a
  comment: make the wrong choice visible, not explained.
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

  **A FIGURE IN A COMMENT CARRIES THE NUMBER, THE DATE, AND WHERE IT WAS READ.**
  Without all three it is a guess wearing a measurement's clothes, and nothing
  downstream can tell the two apart — which is the whole defect, not the
  inaccuracy. Measured: `ci.yml` said MuPDF's libraries "take ~10 minutes to
  build" from the day the cache step was written. Six days later XXX-1's decision
  turned on that figure and it was one step from rejecting a job that turned out
  to be affordable. Read from the Actions API it is **336s** — and the two cold
  builds the decision then paid came in at 340s and 294s. The corrected comment
  names the run it was read from, which is the shape to copy.

  **AND A LABEL CARRIES THE COMMAND THAT ESTABLISHED IT.** Same sentence with a
  different noun: a classification without one is a guess wearing an
  observation's clothes. *Orphan* needs the command line that showed no living
  parent; *contaminated* needs the reading that showed the contamination;
  *build-dependent* needs the two builds.

  Two withdrawals in two commits on 2026-08-24 were the same shape, and neither
  was carelessness — in each, a category was assigned from **the single property
  that had actually been measured**, and the label then travelled into documents
  where it read as observed:

  | the label | what was measured | what was assumed |
  |---|---|---|
  | *orphaned* processes | a start time two days old | that no parent was alive — both were, and they were the editor's MCP server |
  | sequence *causes* the slowdown | 308s alone against 598s ninth | that position was the difference — the same script measured 1.5s and 9.4s at the **same** position |

  AAAA-8's tell covers both — *what else is different about the odd point?* — and
  was not reached at the moment of writing, twice in two commits, which is this
  project's standing evidence that **a tell is not a mechanism**. Naming the
  command is what makes the gap visible in review, because the reviewer can see
  that no command is named. *Be careful* is not checkable; a missing citation is.
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
packages/nodemode/  runs in NODE MODE and is not the document engine: the engine
                    host's reader thread and what it needs. The Electron binary
                    may be the runtime; Electron's APIs are not there
                    imports: shared, contract — NEVER Electron
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

**This map has TWO axes and the tree above is one of them.** It classifies by
what a package is *about*; the second is which runtime mode a module executes in
([ADR-0024](docs/DECISIONS/0024-execution-mode-is-a-placement-axis.md)). They
usually agree, and the first module where they disagreed is the engine host's
reader — Win32 pipe plumbing *for the shell*, executing where the shell's API
surface does not exist. Ask both questions.

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
  was handed (invariant 25). **All four now have a mechanism, and two of them
  decide the process type** ([ADR-0022](docs/DECISIONS/0022-the-engine-host-is-a-process-we-create.md)):
  network and filesystem come from an AppContainer, which `utilityProcess.fork`
  cannot create, so **the engine hosts are processes we create** — `CreateProcessW`
  running the Electron binary in Node mode. The host body lives in
  `packages/kernel`; the factory that creates it lives in `apps/desktop/`.

  **The rule that got us there is worth more than the decision:** *only
  kernel-enforced mechanisms contain native code.* Node's permission model is
  enforced inside Node's own filesystem bindings, so a `CreateFileW` walks past
  it — measured. **Ask who enforces a containment mechanism before asking what it
  denies.**

  The host's pipe is a trust boundary and the host is hostile by that invariant's
  own premise. It registers into `packages/contract`'s discipline; a second
  validated-boundary discipline beside it is the defect (B3a).

- **Plain Node never loads Electron — it spawns the pinned binary by name.** The
  import IS the download: `index.js` ends with
  `module.exports = getElectronPath()`, which fetches when the binary is absent,
  through an `install.js` that reads `electron_use_remote_checksums` and so
  bypasses our pin. `--ignore-scripts` defers that to first use rather than
  closing it. **The launcher lives in `scripts/`** — under `apps/desktop/` it is
  invisible to both enforcers at once, since ESLint's boundary is per-package and
  exempts `desktop` while the scan's root stops at `scripts/` (invariant 26).

  **`apps/desktop/src/` is exempted as a PROXY for "runs inside Electron", and
  the proxy has now failed FOUR times** — a module vitest imports; the engine
  host, which runs the Electron binary under `ELECTRON_RUN_AS_NODE=1` and so *is*
  Node; and a **worker thread**, measured 2026-08-25. The answer is placement,
  not another clause: anything that runs in Node mode lives outside `desktop`,
  where `MAY_IMPORT_ELECTRON` already makes the specifier a red build. Ask which
  **mode** a file runs in, never which directory it sits in.

  **The fourth is the one where the import SUCCEEDS**, and it is why the axis is
  now written into `docs/ARCHITECTURE.md` §1 rather than applied per occurrence
  ([ADR-0024](docs/DECISIONS/0024-execution-mode-is-a-placement-axis.md)). A
  `worker_threads` Worker inside Electron main has `process.versions.electron`
  **set** and `process.type` **undefined**, and `import('electron')` there yields
  a module carrying **no `app`** — against main's control in the same run, which
  carries one. The other three broke at the import; this one returns an object
  and fails later at the first property access, where nothing points back at it.

  **So where Node-mode code goes is part of the map, not a rule you recall.**
  `packages/nodemode` holds it where its subject is not the document engine; the
  document engine's own Node-mode code stays in `packages/kernel`, which is
  unmoved. Harness and probe files are in scope by the same test — which mode
  they run in, not that they are harnesses.

- **Distribution is the Microsoft Store only.** No direct download. The
  two-flavour seam is kept deliberately — flavour switch, `WebUpdateProvider`
  registered with nothing behind it, signing certificate as an empty config
  value — so adding a signed download later is a config change, not an
  amendment. **Do not delete it as dead code** (ADR-0018). Windows updates Store
  apps; the app never installs its own package and never overrides a user who
  disabled automatic updates.

- **The renderer's CSP is pinned in `docs/ARCHITECTURE.md` §9.27, and that
  document is the writer of record.** `apps/desktop/src/windowPolicy.ts` holds
  the derived form and `proof:rendererpolicy` fails when the two differ — so
  loosening the policy is an amendment, which is the whole point of pinning it.

  **§9.17 holds the pen for the memory budgets the same way** — every
  pen-holding concern in this repository puts it in a document, and the axis
  that actually varies is whether the derived side keeps a **copy**.
  `memoryBudgets.mjs` parses §9.17's line, so there is no copy and the check
  points at prose instead (`check:docs` rejects a section that restates its own
  number). A renderer cannot parse markdown, so the CSP is copied — and a copy
  that exists must be proven equal, which is what `proof:rendererpolicy` and
  `proof:composition` are. **Copy only where the reader cannot reach the source.**
  All B3 (invariant 27,
  [ADR-0019](docs/DECISIONS/0019-the-renderers-csp-is-pinned.md) and its
  2026-08-23 correction).

The full invariant list (L1–L27) is in `docs/ARCHITECTURE.md`. A regression
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
     covers over 250 cases in both directions, including the exact command that
     caused occurrence 6 and the ordinary commands this project runs constantly,
     because a guard that blocks `echo` or `sed -n` is a guard someone turns
     off. It also **pins the false positives that stay** — a redirect whose
     owner is ambiguous across a compound is refused deliberately, and a
     disposition nobody wrote down is one that gets relitigated by whoever it
     inconveniences.

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
  denies (`npm run proof:escapeguard`). What no proof could reach was the
  agent's own hook table. That is now executed rather than asserted.

  **And it fires constantly, which is the number that was never counted.** One
  session's transcript, read on 2026-08-23: **65 denials**, of which 27 were
  `node -e`/`-p`, 15 `sed -i`, 6 `python -c` and 5 a heredoc into a file. Four
  were false positives the guard has since been corrected for, and about four
  are live ones it refuses on purpose. Everything else was the reflex the rule
  names, reached for without thinking, and stopped.

  The point is not the total. It is that both the handoff note and the reviewing
  seat had carried the figure as **six**, recalled rather than counted, and were
  wrong by an order of magnitude in the direction that makes the guard look
  incidental. **Count from the transcript.** Anything else is a memory of the
  denials that happened to be memorable.

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
  the latter, and the handoff is exactly what failed. Run the probe verbatim and
  record it either way; `silent` is the finding, and it means this section
  overstates what is in place and is corrected in the same commit.

  ```
  node -e "console.log('hook test')"
  ```

  ```
  npm run probe:hook -- blockEscapeResolvingWrites@PreToolUse fired
  ```

  **The record holds one entry per registered hook — keyed by script AND event,
  because that pair is what a settings file registers — and the set of entries
  that must exist is derived from `.claude/settings.json`.** So a hook registered
  later arrives owing its own evidence instead of inheriting the escape guard's,
  and so does the same script wired to a second event.
  A single outcome was right while one hook was registered and became a widening
  the moment a second was, with no sentence anywhere overstating anything: the
  claim was in the data shape.

  The recorder reads the session's start time from its own transcript rather
  than taking your word for it, and refuses a **silent** result from a session
  older than the configuration. `docs/FEATURES.md` carries the gate; claiming it done without
  the evidence turns `check:docs` red.

  The one safe exception is a script that manipulates bytes **numerically**
  (`0x07`, byte arrays), because nothing in that path resolves an escape. That
  is how `docs/JOURNAL.md` was repaired: the corrupt bytes are invisible to
  every editor, so there was no string to match on.

  **And the tool this rule sends you TO is not exempt.** Three `Write` calls on
  2026-08-23 emitted a control character into a string literal — `0x01` once and
  `0x00` twice, always where a space belonged, always invisible. The hook cannot
  see them: it governs shell tools, and this is a byte nobody typed appearing in
  a file-editing tool's output. `guardFiles.mjs` blocked the third at commit; the
  first two were found by **luck** — an `Edit` that could not match text a `Read`
  had just displayed, and a `grep` that reported a source file as binary. So the
  guard's coverage is sound and its LATENCY is the gap: nothing looked between
  the write and `git add`, which is the window in which you run the file and
  misdiagnose the symptom.

  **`scripts/hooks/reportControlCharacters.mjs` now closes that window, and it
  REPORTS rather than prevents.** A PostToolUse hook runs after the write, so
  `guardFiles.mjs` at commit remains the only fail-closed gate on this class and
  is unchanged by the reporter existing. Registered for `Write` and `Edit` on
  2026-08-24, and **observed being invoked by the harness the same day**.

  **Its trigger cannot be produced on purpose, so it was given a second one.**
  The byte is one nobody can author — a deliberate attempt on 2026-08-23 emitted
  two ordinary spaces where `0x01` and `0x00` were intended — which would have
  left the only certifying event the defect recurring, and a gate whose expiry
  may never fire reads as pending while covering nothing. **Any `Write` under
  `.claude/hookprobe/` makes the hook say it ran**, then continues into the
  ordinary scan unchanged: a second *trigger*, never a second detector, so a
  probe file carrying a real byte is still reported as one.

  What that certifies is **invocation** — the harness ran it — and the record
  says so in a field rather than in prose, because a firing that quietly came to
  stand for detection as well is the same widening one layer down. Detection is
  `proof:reportControlCharacters`, whose fixtures build the bytes numerically.

  Three tells and the repair, all measured 2026-08-23 against a file carrying one
  NUL: reading it renders the byte as nothing, so the text on screen looks
  correct; **an edit cannot match a span containing it**, because the search text
  would have to contain the byte, and the failure reads as a stale file rather
  than a corrupt one; a whole-file rewrite clears it. So the repair is to rewrite
  the file whole, or — where it is too large to retype — `git checkout HEAD --
  <path>` and re-apply. `guardFiles.mjs` prints this at the point of rejection,
  which is where you meet it.
- **An emitted-source template carries no backtick — and that is now a check, not
  a rule.** A `String.raw` holding a program we write to disk is the one place
  prose and code share a delimiter, and a backtick pair inside closes the literal
  and reopens it, so the parser blames whatever follows. It has happened **seven
  times**: the third in a file whose own header carried the rule against it, and
  the fourth **one commit after the check shipped, by the agent that wrote the
  check, in the same session**. **Written down is not a mechanism** — the same
  sentence the escape guard paid for seven times, and occurrence 4 says the
  stronger version: *having just mechanised a rule does not put it in reach at
  the moment a comment is composed either.*

  **Occurrence 5, and it is the one that pays WW-4 back.** Same author, same
  shape — a property name quoted in a comment, written while documenting a
  *different* finding in the same file. The difference is what stopped it: 4 was
  stopped by a hand-run `node --check`, which is a person remembering; 5 was
  reported by `check:emittedtemplates` at the right line during an ordinary
  check run, and WW-4 had already put that scan in pre-commit against the index,
  so it could not have reached a commit. **Expect a sixth.** The count is not
  going to stop rising, and it does not need to — the point of the move was that
  the count stops mattering.

  **The sixth arrived one commit later**, two backtick pairs in a single comment
  recording a negative result about something else entirely, both caught by
  `node --check` before anything was staged. The prediction cost nothing to make
  and was right within a commit, which is the argument finished rather than a
  joke at my expense: occurrences 1–4 were stopped by luck or by someone
  remembering, 5 and 6 by mechanisms, instantly. **Read a rising count as the
  guard being load-bearing, and be suspicious of a stretch where it stops
  rising.**

  **A seventh followed on 2026-08-23** — four pairs in one comment, quoting API
  names in prose, written while recording a finding about a GPU flake. The scan
  named all four lines from the pre-commit set before anything was staged.

  **Three in a row (5, 6, 7) were composed while documenting something else**,
  and that is the sharpest thing this list says. The occurrences do not happen
  while writing emitted source; they happen while writing PROSE about an
  unrelated finding, in a file that happens to contain an emitted region. The
  attention is on the finding, and the backtick is a habit of writing about
  code — which no amount of the rule being on the page interrupts.

  **That reading is the argument for where the check runs, and it moved
  (WW-4).** The scan does see occurrence 4 — fed the broken text it names the
  exact line — but it ran only on the Guards job, so what actually stopped that
  commit was a hand-run `node --check`: me remembering, which is the thing a
  mechanism replaces. And a CI-only guard catches the defect *after* the commit
  is public, which B10 makes permanent. It is now **in the pre-commit set**,
  scanning the **index** rather than the working tree — a guard reading the disk
  passes a commit whose staged content is broken.
  `check:emittedtemplates` scans the region and `proof:emittedtemplates`
  proves it can see; the scan carries its own positive control and refuses to
  report when blinded, because it is run by hand on the day someone needs an
  answer and CI is not there. The rule bans backticks in the emitted **code**
  too, and that is what makes it checkable: a parser cannot help, since the stray
  pair has already closed the template by the time one runs.

  **`String.raw` is the MARKER for emitted source, and under `scripts/research/`
  a multi-line plain template is itself a finding** (VV-1). Widening the scan to
  every template was tried and measured: 36 reports, nearly all openers whose
  terminator is not a bare backtick-semicolon, because *where a template ends
  cannot be determined textually* — the same wall the parser hits. Marking the
  class makes it decidable, and the marker is right on its own merits, since
  escape processing is the last thing a program body wants.
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
instrument files — across `scripts/` **and** `packages/*/src/`, since a
filesystem probe once landed under the latter and appeared in no column (X-1).

Source files come in **two** columns — added, and changed — and both are read
for the same reason: an instrument that arrives is one to resolution-test, and
an instrument whose behaviour moved is one to re-test. There was one column for
a long time and it reported **added files only**, which is **WW-2**, fixed
2026-08-22.

**AA-1's ruling was right in form and its stated basis was too wide, corrected
2026-08-22.** It closed the granularity axis as a stated limitation on the
grounds that the mandated compensation — *read the modified-proofs diffs* — had
surfaced every instance across five ranges. That compensation reaches
instruments **that are proofs**. It reaches nothing else: a non-proof instrument
that changed appeared in no diff the disclosure sent anyone to, so for that
class there was no compensation to print, and the distinction the ruling rested
on did not apply to it.

So the added-vs-changed half was a **defect**, not a limitation, and it joins
pattern (W-1), root (X-1) and state (Z-1) as an axis of this classifier that was
fixed rather than ruled.

**Five axes now, all five defects**, because DDD-1 arrived the same way one
range later: the proofs columns carried *added, modified, removed* and the
source columns carried *added, changed* — so a 636-line research instrument was
**deleted** and named in no column at all. The transferable form is not the
instance: **when one half of a classifier carries three states and the other
half carries two, the asymmetry is the finding.** Nobody audits for a column
that does not exist; they read the columns that do, and an absent column reports
nothing in exactly the voice of an empty one. That is item 4b's *found nothing*
arriving in a renderer rather than in a search.

What remains a stated limitation is genuinely narrower: an instrument arriving
as a **function inside a file the columns do name**. The compensation is to read
that file's diff — which the ruling assumed and, for non-proofs, did not have
until WW-2.

The distinction that made the ruling safe was: **a compensation the instrument
prints at the point of use is a mechanism; a compensation you must recall is
not.** So does its trigger: **it becomes a defect the first time an instrument is
found late that reading those diffs did not surface.** With one correction
learned from WW-2 — **catching one by running it does not count as the limit
holding.** All four converted instruments in the range that produced WW-2 were
caught that way, and reading it as the trigger not firing is precisely how a
stated limitation becomes permanent.

**THAT CRITERION HAS NOW BEEN FALSIFIED ONCE, and it is written here rather than
left absolute, because a rule shown to fail and still stated without qualification
is the exact shape this section exists to catch.** On 2026-08-24 a printed
compensation, at the point of use, did not stop a push that reddened `main`:
`checkLocal.mjs` ended every run with *"This set cannot see a provisioning-keyed
branch or a proof registered only in a workflow"*, and the break was in a proof
registered only in a workflow.

So **printed is necessary and not sufficient**, and the property that separates a
mechanism from a note is not where the text appears — it is whether the text is
**specific**. That sentence was true on every run, named nothing and asked for
nothing, so by the third reading it was furniture. The version that stops you
names the three proofs this run's changed files actually reach, which is
derivable without running any of them.

The test to apply to any printed compensation: **could it have been printed
before you made your change?** If yes it is a disclaimer, and you are relying on
someone reading the same sentence differently the fourth time. `check:docs`'
budget lines, the audit-scope disclosures and the sweep's index warning all pass
that test — each names a number or a file that this run computed. The sentence
that failed did not.

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

**Answer it from a RUN, and never from what the range was about.** This question
has been answered from the workflow file rather than from a run once — for 138
commits, in which every run died at `npm ci` — and from *neither* once, which is
worse and is finding AAAA-29: a range whose subject was a local harness, a
gitignored cache and a route a person types was written up as *none of this runs
in CI*, while all three of its proofs were unconditional steps on both matrix
legs and had been green on two platforms since the push. **The subject of a
change does not tell you where its checks run**, and a *no* here is the answer
that reads as candour, so nothing about writing it prompts a second look.

Both halves are computable in under a minute, so compute them:
`scripts/lib/affectedProofs.mjs` names the proofs a changed set reaches (it
carries its own positive control), and each of those resolves to a workflow by
path — after which the run's own step lines say whether they executed. Where the
answer really is *no*, say which half is uncovered: *the board is not the
mechanism here* invites the next reader to skip writing a case, and that is the
opposite of what a genuine gap calls for.

**And ask it the other way round, because the answer is not symmetric: is there
a defect THIS MACHINE cannot see?** A check whose behaviour depends on
provisioning has two worlds, and the developed-in one is the richer one — so it
is the one that hides the defect. The tell is a branch keyed on whether
something is installed.

Measured (ZZ-1): `advisoryRegister.proof.mjs` locates "a verdict carrying a
witness" and mutates it. A witness gained by a **derived** claim made it pick
that one, and three mutations that assert *a witness problem is a hard failure*
became *unverifiable* instead — which the register's own design calls correct,
because a derivation that cannot run has not looked. Green here, red on Guards,
which installs nothing. **The fix is not to remember this**: the locator now
excludes derived claims from one shared list, and a control asserts on every
runner that the verdict it picked is not one of them.

The general shape, and it is wider than provisioning: **any branch keyed on the
presence of something has a side that never executes wherever that thing is
always present** — and that side is a specification nobody has read. Provisioning
is the common case here; a cached artefact, an environment variable the runner
sets, a file an earlier step wrote are the same shape.

Twice now, both times a provisioning branch producing green-here-red-there: the
electron-import coverage move recorded under item 2a, and ZZ-1 above.

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

**And the same rule applies to the FIXTURE, not only to the mutation: never
build a fixture the bug also handles correctly.** A case whose expected output
the defect would produce anyway separates nothing, and — unlike a vacuous proof —
it fails no mutation test unless you happen to run the one it is blind to. Its
name tells you it is covered.

Twice on 2026-08-20, in different files, on different mechanisms, hours apart:

| the case | the fixture | why it separated nothing |
|---|---|---|
| "a timed-out run is not green" | `CI=timed_out, Guards=skipped` | the predicate under test asked whether the summary contained `=success`. With no success anywhere it answered correctly, for the wrong reason. |
| "the listener passes `args[0]`" | `'not an object'`, asserting the call is refused | a listener that drops the argument passes `undefined`, which the schema also refuses. The case survived the exact mutation it existed to catch, while two unrelated cases went red. |

Both were fixed the same way: **assert something only the correct path
produces** — a success beside the bad conclusion, and a diagnostic naming the
value that actually reached the parse.

The tell is that the fixture contains none of the thing the defect keys on. Ask
what the broken version would print for *this input*, before writing the
assertion.

**For a NEGATIVE probe the rule has a sharper form, and it is the transferable
one: build the input from something that would SUCCEED if the guard were
absent.** A probe that asserts "this was refused" is worthless when its input
would have failed anyway — refusal and impossibility produce the same
observation, and the case then passes on a machine where the guard has been
deleted.

Three occurrences, and the third is why this is stated as a rule about *inputs*
rather than as advice about URLs:

| the probe | the input | what it could not tell apart |
|---|---|---|
| "CSP blocks the fetch" | `https://example.invalid/` | blocked by policy · DNS failure |
| "navigation off the document is refused" | `https://example.org/` | refused by the guard · no network on the runner |
| — | any unreachable target | the guard working · the guard deleted |

The second was written **four commits after** the first was found, in the same
file, by an author who had the first one's comment on screen. "Do not use a
remote URL" was the instance and did not transfer; *the input must be one the
absent guard would let through* is the form that does. Both were fixed the same
way — the loaded document plus a query string: on disk so it loads with no
network, different href so the guard refuses it.

**And an artefact whose failure is announced on a channel nobody subscribes to
is unproven, however many checks read it.** Two proofs passed *correctly* about
a preload that had never executed, because the defect was not in the file they
read — a sandboxed preload is loaded as CommonJS and the ESM one was refused on
Electron's `preload-error` event, which nothing was listening to. *Configured is
not run*, arriving at the artefact level. So when a runtime announces a failure
class, subscribing to it is part of shipping the thing that can fail — and the
diagnostic that catches it in a harness has not been shipped until the product
subscribes too.

**MUTATE THE BRANCHES NO FIXTURE REACHED, NOT THE ONES THE SUITE EXERCISES.**
Mutation testing naturally aims where the cases already go, and those are the
guards least likely to be unproven. The ones worth checking are the branches
nothing arrives at — so **disable each branch in turn and see whether anything
notices**, rather than picking the ones that look important. Three found that
way and each was a different animal: a branch **no code in the repository can
reach** (JJJ-1's `.catch()` chain — kept, because the fact it encodes is true
and deleting it would produce a false positive the day someone writes that
shape); a branch **reachable and load-bearing with no case at all** (NNN-2's
terminate-once guard, where the second call would also overwrite the reason and
blame this build for the peer's bytes); and a branch whose **effect no assertion
on that module's surface can observe** (NNN-3). Only the second is a missing
case. The first is documentation, the third is a property that belongs one layer
out — and *all three look identical* until you ask why the mutation stayed
green, which is the step to not skip.

**AND ASK IT OF THE FIXTURE SET, NOT ONLY OF EACH FIXTURE.** A case is
one-sided when it is wrong; a **set** is one-sided when every case holds the
same argument constant, and then no individual case looks wrong at all.
Measured (NNN-1): every case in the host factory's file held the assign call at
`true`, so the file asked thoroughly whether a *yes* can be overruled by the
membership read and never once whether a *no* can be. A factory that trusts a
no and never reads passed all twenty-one. **The tell is an input that is a
constant across an entire file** — especially one the code under test claims not
to trust.

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
scope, **the wrong window**: all of them report the same clean result as a
genuine absence. And in security and compliance work, "found nothing" is nearly
always the answer you were hoping for, so nothing about it prompts a second look.

**The window is the sixth axis, and it is the one nobody writes down: a line is
not a unit of meaning.** A line-scoped search silently inherits the text's
wrapping, and then reports the absence it caused. Two on one day, from two
different tools, neither pattern wrong:

- `grep -A3` for `status` in a GitHub runs payload, where `status` sits **five**
  lines below the field being anchored on. Structurally pinned at zero — for a
  completed run, a queued run, a cancelled run, and a repository that does not
  exist.
- a plain `grep` for a phrase in `CLAUDE.md` that is **wrapped across a line
  break**. The phrase is there; no line contains it.

The remedy is not a wider window, which only moves the boundary. It is to search
a unit the text actually has — a field, a record, a parsed node — or, for prose,
to accept that any multi-word pattern may straddle a break and match on a
fragment that cannot.

**This project already paid for that lesson once and did not generalise it.**
`withdrawnPhrases.mjs` lists the line break as its third false negative and
states the mechanism in its own header: *this repository hard-wraps prose, so any
declared phrase long enough to wrap escaped in silence — and the longer the
phrase, the likelier it wraps, which is backwards.* Its conclusion is the remedy
above, in the same words: **build the unit, normalise it, match against it.**

So the two instances on 2026-08-20 are the third and fourth, and they landed in
tools nobody thought of as searches — a `grep -A` window and an ad-hoc `grep`.
The fix stayed inside the one check that had been bitten. That is Rule 0's *fix
the class, not the instance*, where the instance was fixed properly and the class
was never named, which is the version that leaves no trace to find later.

**And "the answer sits where the pattern cannot reach" recurs after being written
down.** The OCR list below already carries a parser that read prose as C and a
pattern that could not match a definition at column 0. It happened again on
2026-08-20: `grep "function checkWriteTarget"` reported nothing for a symbol that
exists as a **class method**, and a finding was nearly filed against a correct
cross-reference. Recorded because an axis that recurs *after* documentation tells
you the documentation was not the mechanism — the positive control was.

So a search-shaped instrument is not finished until it must **locate something it
is known to be able to find**, every time it runs, or its silence is worthless.
Put the control in the instrument, not only in its proof: the proof runs in CI,
and the instrument gets run by hand on the day someone needs an answer.

This is 4a's sibling and it is not covered by it. 4a asks whether two values that
differ are reported as different; 4b asks whether the instrument can see anything
at all. An empty result passes 4a vacuously.

**The one failure this rule cannot catch: a STALE answer.** A cached response
contains the known-present anchor too. The positive control passes, the
instrument is sound, and the answer is still wrong — so this is the single place
where "locate something you know is there" is not enough, and knowing that is
what stops it being trusted past its reach.

Measured, twice on 2026-08-20, on the instrument that reports whether `main` is
green: an HTTP response cached for fifteen minutes read exactly like a current
board with the last two pushes not yet made.

**Staleness is separated by FRESHNESS, not by presence**, and freshness means a
marker that can only move one way and that **postdates your own action**:

- anchor on something you *just did* — a sha you just pushed, a row you just
  wrote. A payload older than the action cannot contain it, so requiring it is a
  freshness test. An anchor that was already true before you acted is not.
- assert monotonic progress. A run's status never goes backwards; `completed`
  does not become `in_progress`. A reading that regresses against one you already
  took is a stale copy, and must be reported as **stale** rather than as *not
  yet* — those are the same output otherwise.

`scripts/lib/boardStatus.mjs` does both, and its proof's load-bearing case is the
regression one, because every other case there is caught by the anchor.

**And the reassuring answer is not always "found nothing".** For a WAITER it is
*"not yet"*; for a diff it is *"no change"*; for a comparison it is *"they
agree"*. Ask what output you were hoping for, and put the control on that one —
the shape generalises past searching, which is where it was first found.

Back to the plain case — an instrument that **could not see**, as distinct from
the stale one above, which saw an old answer. Five instruments in this project
failed that way, and every one of them returned the reassuring answer:

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

**4c. Does this check DERIVE its extent from the set it governs?**

> **Derive from a set only when the failure you fear makes that set BIGGER. When
> the failure makes it SMALLER, the count must come from somewhere the failure
> cannot reach.**

A hand-kept list fails loudly on growth and cannot see shrinkage. A derived count
is the exact inverse: it tracks growth perfectly and agrees with any shrink,
because a number computed from a collection cannot disagree with that collection.
Neither is stronger; they are opposites, and **the defect is not the derivation —
it is that nobody asked which direction the danger ran.** That question was asked
in none of the three instances below.

Three in one range (2026-08-24), and none was visible from inside its own file:

| the roster | what it derived from | what went quiet |
|---|---|---|
| the hook presence requirement | the settings file that registers the hooks | unregister a hook and delete its entry: the requirement leaves with it |
| `runDocumentRules`' pass count | the rule array it iterates (`cases: chosen.length`, replacing a literal `9`) | delete a whole document rule and the count agrees |
| the mechanism key | the script filename, where a *(script, event)* pair registers | one script on two events, one certificate |

The remedy in each case is an **anchor**: an independent claim the shrinker has
to touch separately. **All three were fixed in the range that found them** — the
documents became the anchor for the first (`claimedHooks`), `EXPECTED_RULES` in
`documentRuleScope.proof.mjs` for the second, and the key widened to
*script@event* for the third. The table above is a record of three defects, not a
list of three live ones; it is kept because the **shape** is what recurs, and it
has recurred in a different form every time.

**This is deliberately NOT a scan, and the reasoning is recorded so the next
reader does not assume the class is watched.** Measured: 37 `createRoster` call
sites, **three** with a non-literal `cases:`, of which two derive from a literal
array declared eight lines above them under a provisioning condition — visible in
the same diff hunk, and correct. So a scan for that shape would be quiet and
cheap. It would also have caught **one of the three findings above**, because the
other two involve no roster and no count, and the three share no textual shape at
all. A check covering the shape that has already been found, over a class that is
two-thirds undecidable, is a class that **reads as watched and is not** — which is
precisely what the first row of that table was. The rule above is what transfers;
ask it of every roster you write.

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
evidence has since changed.

**This item is range-scoped like every other, and that has a hole no amount of
care closes: a document can be falsified by a commit that never touches it.**
Measured (NNN-4). Three documents stated the memory budgets' writer of record
backwards; the claim became false the day `memoryBudgets.mjs` was written, and
**no range has ever changed both the sentence and the code that refutes it**, so
no range-scoped sweep could reach it. It was found by review, not by an audit.
Nor could a check help: it is a claim about a *direction*, and both directions
parse — and the citation made it worse, since pointing at an ADR that says the
opposite **resolves**, and therefore passes every link check (UU-1).

The compensation is narrow enough to actually run: **a range that STATES a
cross-document relationship must sweep every other statement of that
relationship.** It fires on an addition the scope columns already name — here
`budget.ts` asserted the correct version inside the same range as the false ones
— and the sweep is a few greps. It becomes a defect the first time a false
cross-document claim is found late that this sweep would not have surfaced.

**How you correct one depends on what kind of document it is, and getting this
backwards damages the thing you were trying to protect.**

| document | a correction |
|---|---|
| `docs/JOURNAL.md` entries, ADRs, recorded findings, the watermark's `audited` text | **appends a dated correction. Never edits.** What was believed at the time is the record, and editing it destroys evidence. |
| `docs/FEATURES.md` rows, `docs/ARCHITECTURE.md` | **edits the body to be currently true.** History goes in a correction note below, or the amendment log. |

The difference is what the document *is*. A journal entry records a moment. A
FEATURES row is a **live specification of what is owed**, and a false body means
the specification is lying — a correction underneath does not repair that,
because a reader takes the body as the contract and may never reach a note three
paragraphs down. **That is item 7 at document scale**, and row 283 nearly became
its worst instance: a body asserting a property obtained, one correction
retracting a withdrawal, and a second retracting the retraction, with the stale
claim still holding the contract position.

Both halves have been got wrong in one day, in opposite directions — an edit to
already-recorded audit text that had to be reverted, and a false FEATURES body
left standing under two corrections. Ask which kind of document it is first.

**A CROSS-REFERENCE THAT STILL RESOLVES CAN STILL BE WRONG, and no check can see
it** (finding UU-1). When a document is split, renumbered or given a sibling,
every prose reference to it must be swept **by hand, in the same commit**.
Link-checking cannot help: both targets exist, so `check:docs` passes while the
reader lands on a real document that says something else — **worse than a broken
link, which at least announces itself.** Weigh that sweep before splitting an
ADR; the way to avoid it is to split by writing a *new* number rather than by
moving an old one. `docs/DECISIONS/README.md` carries the same rule where the
next renumber will be considered.

**Ask it of the changed function's own comment first, and ask it precisely:
when a commit removes a behaviour, does that comment still assert the behaviour
EARLIER IN ITS OWN TEXT?** This is where the answer has hidden twice, and it is
checkable in the diff you are already reading.

**AND ASK IT OF THE CLAIM YOU ARE WRITING, IN THE COMMIT YOU ARE WRITING IT —
because a claim can be false the moment it is made, and nothing looks at that.**
Every sweep in this section hunts a statement that *became* false: NNN-4's
cross-document sweep, the ADR-split reference sweep, the compound-claim reading
above. All of them need something to have changed. **A claim recorded more
strongly than its evidence supported was never true, so no sweep will ever find
it** (finding AAAA-8).

Measured: three readings of an AppContainer behaviour were written up as a
*client versus server* split. Two of the three came from CI images and the third
from a developer machine, so the one client point was also the one
not-a-CI-image point and both explanations fitted equally. It went into four
documents in one commit and was caught by review, not by any check — and could
not have been, since nothing about it changed.

The tell is a claim that names ONE axis where the evidence varies on two, and
the question is the cheapest in this section: **what else is different about the
odd point?** Ask it while writing, or nobody asks it at all.

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

**Where a claim's EXPIRY lives is decided by what expires it.** Both mechanisms
exist and putting a claim in the wrong one is how it stops being watched:

| the claim expires when | it belongs in |
|---|---|
| shipped code names a symbol | `docs/security/engine-advisories.json` — the register's whole mechanism is *"the day shipped code names X"* |
| an event happens — packaging, a release, an elevated read, a stage beginning | a `docs/FEATURES.md` row, with the trigger written into the body |

A symbol scan cannot see an event, so an event-expiring claim parked in the
register becomes a verdict that will never fire — green, and reading as
coverage. That is not hypothetical: `engine-host-containment` watched
`utilityProcess` until ADR-0022 made it a symbol shipped code can never name,
and it sat green for a range. Premise P1 was considered for the register at the
same time and refused for this reason; it lives on the packaging row.

## Commands

```bash
npm run proof:guards      # prove the pre-commit guards still catch what they claim
npm run proof:secretscan  # prove the secret scan cannot be silently disarmed
npm run proof:escapeguard # prove the escape-resolving-write hook blocks and permits correctly
npm run check:emittedtemplates  # no emitted-source template carries a backtick
npm run proof:emittedtemplates  # prove that scan can see, refuse and tolerate
npm run check:stackowner  # only an owner renders a thrown value's stack (needs node_modules)
npm run proof:stackowner  # prove that scan can see, refuse and separate
npm run check:jobplacement  # every module-needing step sits in a job that installs
npm run proof:jobplacement  # prove that scan can see, refuse and tolerate
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
