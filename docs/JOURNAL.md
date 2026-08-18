# Build journal

Actual effort per stage, recorded as stages run. Part G fixes baseline
estimates in advance so the Stage 1 trajectory gate has a number to measure
against — **a gate with no recorded baseline is inert**, and one recorded after
the fact is not a baseline, it is a rationalisation.

| Stage | Baseline estimate | Actual | Verdict |
|---|---|---|---|
| 0 — walking skeleton | 15 working days | in progress (started 2026-08-16) | — |
| 1 — viewer core | 10 working days | — | — |

**The gate:** exceeding an estimate by **3×** arms a decision, which is taken in
writing and is one of *continue*, *cut scope*, or *halt and reassess with the
user*. A project with no defined abort condition dies slowly.

---

## Where the build stands

Kept current so any agent can resume without the prior session's context. Status
per item is in [`FEATURES.md`](FEATURES.md); this is the shortlist of what is
next and what is owed.

> ### CLOSED 2026-08-18T06:45Z — the guard fired
>
> **It denied a `node -e` call in the middle of ordinary work.** Not a probe,
> not a test: I was reading a path out of the provisioning module and reached
> for `node -e` without thinking, which is exactly the moment the mechanism
> exists for and exactly the moment a written rule has never once reached. The
> denial is recorded in `docs/hook-probe.json` and the Stage 0 gate row is
> marked done; `check:docs` fails if that row is claimed without the evidence.
>
> Two things I had written were wrong, and the observation is what showed it.
>
> **The process-start model does not hold.** The settings landed at 00:18; a
> `printf` redirect ran unimpeded at about 01:20; a `node -e` was denied at
> 06:45. Same session id, same transcript, no restart between them — the hook
> table changed underneath a running process. What triggers the reload is not
> established, and CLAUDE.md now says so rather than substituting a new guess
> for the old one.
>
> **The recorder had the asymmetry backwards, and it nearly ate the evidence.**
> It rejected *both* outcomes from a session older than the configuration. But a
> denial is self-certifying — nothing that failed to load the guard can be
> blocked by it — while "it ran" is the ambiguous one. As written it would have
> refused the first denial this project ever observed, on the grounds that the
> session looked too old to be trustworthy. Fixed, with cases in both
> directions.
>
> The proof's control also failed the moment the gate was satisfied, because its
> premise had changed: claiming the row done is legitimate now. It removes the
> evidence instead, and restores it. A control that quietly kept passing there
> would have been the more expensive outcome.

> ### The tool-use guard probe was a STAGE 0 EXIT GATE, not a handoff note
>
> It was a handoff note, and the handoff is what failed: the one session that
> could have run it read `/compact` as a new session. A mechanism `CLAUDE.md`
> asserts, that has never been observed to work, must not sit inside a stage
> that closes — so it is now a row in `docs/FEATURES.md`'s Stage 0 table, and
> marking that row done without the evidence turns `check:docs` red
> (`npm run proof:hookprobe`, 13 cases).
>
> **In a session whose process started after `.claude/settings.json` last
> changed**, run this verbatim:
>
> ```
> node -e "console.log('hook test')"
> ```
>
> then record it either way — `executed` is the finding, not a reason to wait:
>
> ```
> npm run probe:hook -- denied
> ```
>
> The recorder refuses what it cannot stand behind: it reads the session's start
> from its own transcript rather than taking your word, and rejects a session
> that predates the configuration outright. If the outcome is `executed`,
> `CLAUDE.md` overstates what is in place and is corrected in the same commit.
>
> **Attempt 1 — 2026-08-18 — the command RAN. Not denied.** Recorded as required,
> and it is not the result the block was written expecting. The mechanism, in one
> sentence: **hooks are read when the process starts, and `/compact` does not
> start a process.** The evidence separating that from a broken guard:
>
> | Observation | Value |
> |---|---|
> | Session transcript created | 2026-08-16 08:29:43 |
> | `.claude/settings.json` first committed (`fc8ae8b`) | 2026-08-18 00:18:39 |
> | `.claude/settings.local.json` | absent |
> | User-scope `~/.claude/settings.json` | no `hooks` key, no `disableAllHooks` |
> | `npm run proof:escapeguard` | 51/51 green, including the wiring cases |
>
> The session predated its own settings file by roughly forty hours. The guard
> was never loaded here, so the probe measured a session, not a guard. The
> local-disarm hypothesis is separately excluded by rows three and four.
>
> **So the claim is still unverified, and the gate stays open.** The correction
> that matters is to the block itself, which said "next session" and treated a
> compaction as one. A compaction keeps the session id, the transcript and the
> hook table; only a genuinely new process reloads settings. That reading is now
> enforced rather than remembered — the recorder compares the session's start
> against the moment the guard's inputs last changed, and refuses when the
> session is older.
>
> **Read the outcome with this rule, because a command that runs is ambiguous on
> its own** — a broken guard and a stale session are indistinguishable from the
> command alone:
>
> - **denied** → the guard is live. Record it and close this block.
> - **runs, and `proof:escapeguard` is green** → the guard is sound, the session
>   predates it. Not a defect; try again in a new process.
> - **runs, and `proof:escapeguard` is red** → the guard itself is broken. Fix it
>   before trusting the standing rule, which is currently carrying the class alone.
>
> That rule is printed by `proof:escapeguard` itself and stated in `CLAUDE.md`,
> so it does not depend on anyone reaching this paragraph.
>
> **Second, still unverified:** whether a `hooks` block in a higher-precedence
> settings scope REPLACES the project's or MERGES with it. The published
> documentation contradicts itself — its precedence table puts
> `.claude/settings.local.json` ABOVE `.claude/settings.json`, while its prose
> claims the project file wins. `scripts/lib/hookIntegrity.mjs` currently
> assumes the table is right and treats any competing `hooks` block as
> disarming. Settle it by writing a local settings file with an empty
> `PreToolUse` array, restarting, and re-running the command above. Attempt 1
> could not touch this either: with no competing block anywhere on the machine,
> there was nothing for precedence to decide between.

**Done and green in CI (Windows + Linux):** pre-commit guards with proofs ·
pinned-hash provisioning · governing documents and ADRs 0001–0011 · monorepo
with import boundaries proven by violation · the IPC contract with compile-time
exhaustiveness · `CapabilityRegistry` · the **native MuPDF seam**, now rebuildable
from a clean checkout by `npm run provision:mupdf` and built in CI.

**The engine decision is settled (ADR-0010).** MuPDF is reached natively through
a koffi-bound flat-C shim, in a utility process, with one held handle per open
document. WASM is withdrawn and `mutool.exe` is not shipped. Do not re-open
this; the measurements are in the ADR, and its instruments were rebuilt and
re-validated on 2026-08-17 (see the correction block at the top of ADR-0010).

**Stage 0 now carries more than its original scope**, and the trajectory gate
must measure against that rather than against the estimate: a full repository
audit (43 findings), the security substrate below, and a threat model still to
be written. Recorded so the 3× abort condition is judged on reality.

### The audit, and where it stands

A multi-agent audit found **43 defects behind an all-green board**. The full
report is an artifact; `docs/JOURNAL.md`'s 2026-08-17 entry records the severity
re-rating and the deferrals. Batches, in the owner's priority order:

- **Batch 1 — class fixes: DONE.** Boundary cases generated from
  `ALLOWED_IMPORTS` (11 hand-written → 148 generated, closing 02/09/19/21 by
  construction) · `tsconfig.scripts.json` type-checking the bootstrap layer and
  the four real defects it hid (07) · document consistency machine-checked
  (26/30/38) · the file policy given every staged change and history reach
  (16/05) · severity re-rated where it rested on reachability.
- **Batch 2 — instruments and ADR-0010: DONE.** Monotonic allocator counters,
  per-context and process-wide · the store scrape deleted for a measured
  footprint · ADR-0010 re-measured with the prediction stated first (held) ·
  compiler mitigations verified in the PE image · engine advisory tracking.
- **Batch 3 — security-bearing guards: DONE.** 03 (there were **four**
  suppression channels, not three; one cannot be closed by any flag and is now
  refused) · 04 (a six-shape capability canary keyed on the binary's hash, and
  the exit-status check deleted) · 17 (one git-resolved root; the tree scope was
  the blind one) · 18 (compare-and-swap publish) · 35 (verified already closed:
  absolute paths on every platform, PATH deliberately not consulted) · 43 (nine
  `bootstrapHooks` cases in `guards.yml`). 06 and 13 were already closed.
- **Batch 4 — the native shim: DONE.** 10 (page geometry taken from MuPDF
  instead of hand-rolled reads) · 24 (the three missing `fz_var`s, and the rule
  that finds them) · 25 (per-section census, with the mirroring claim turned
  into an equation) · 37 (three surviving items; two were already closed by the
  instrument rebuild).
- **Batch 5 — documents: DONE.** 28 (the Stage 0 blocker) · 29 · 27 with
  ARCHITECTURE §8 · 31 · 39 · 41 · 42. **Stage 0 is no longer gated on a
  retracted ceiling.**
- **The escaping class: BUILT, NOT YET PROVEN — and it has now failed once more
  while unproven.** The standing rule was broken six times while claiming to be
  the only defence. The mechanism is a PreToolUse hook in the tracked
  `.claude/settings.json` (`scripts/hooks/blockEscapeResolvingWrites.mjs`, 51
  cases), plus a git-side check that a local settings file has not disarmed it
  (`scripts/lib/hookIntegrity.mjs`, 10 cases). Its parts are proven; that it is
  ever *loaded* is not. See the FIRST ACTION block above.

  **Occurrence 7 — 2026-08-18.** `printf 'export const built = 1;\n' >
  out/index.js`, to build a one-line fixture while reproducing finding 36.
  `printf` resolved the `\n`, which is occurrence 3's mechanism exactly. It was
  harmless — a throwaway file, deleted minutes later, and the newline was
  wanted — and that is not the point: the rule is about the mechanism, not the
  outcome, because the outcome is what varies.

  What makes it worth recording is the timing. It happened roughly one hour
  after `c27faae` amended `CLAUDE.md` to say the rule was *"still the only thing
  standing between you and a seventh occurrence"* — written by the same agent
  that then produced one. This is the strongest evidence yet for the claim the
  hook exists to make: **an agent that has just written the rule down, in the
  same session, still does not recall it at the moment of composing a command.**
  Seven for seven. The hook would have blocked it (`proof:escapeguard` covers
  `printf` with a redirect); it was not loaded, for the reason in the FIRST
  ACTION block.
- **Batch 6 — test infrastructure: DONE.** 15 (the suite read `dist`, so a
  mutation to the source it covered left 27/27 green; aliases derived from the
  workspace globs now put `dist` on no resolution path a test can take) · 33
  (byte source injected, so the entropy the class claims is asserted rather than
  named; a short draw is now refused at mint) · 34 and the `proof:engines` H2
  narrowness (both cases measured something other than what they reported; H3
  was a method-name regex, H2 computed `acroFormGone` and used it only in the
  printed string) · 36 (ESLint's ignore list derived from `.gitignore` instead
  of duplicated, plus `native/**`, whose exclusion two documents asserted and no
  code enforced).
- **Batch 7 — Stage 0 exit: PART DONE.** Closed: koffi (the item did not exist
  as described — see ADR-0010's correction) · NOTICE, generated · the
  Ghostscript decision (ADR-0013) · Poppler, dropped (ADR-0013) · every bundled
  licence, read from the artefact · **licence provenance**, so each of the
  sixteen names the file it was read from · **Tesseract and Leptonica**, with a
  derived door set (`reachability.ocr`) · **the keep-decision** (ADR-0014) ·
  **the AGPL source offer**, README side.

  **STILL OWED:**

  1. **The packaging test — BLOCKED, not forgotten.** `electron` is not a
     dependency and there is no packaging configuration, so this cannot be
     written as anything that runs, and a test that skips is the display-only
     sin wearing a green tick. It owes two assertions, both in its
     `docs/FEATURES.md` row: the unpacked `.node` found through
     `resourcesPath` from a built application (ADR-0010's correction records
     this as a packaging obligation rather than an ABI one), and **`NOTICE`
     present in the installed layout**. The second is compliance: FreeType's
     binary-distribution clause requires its disclaimer in the *distribution*
     documentation, and a file in this repository is not that. `proof:licences`
     covers the content half, so the gap is delivery.
  2. **Leptonica in the threat model**, as the image-format parser on the
     untrusted-document path rather than a footnote to Tesseract. Deferred to
     task #22 rather than left as a note: `check:docs` check 7 now fails if a
     threat model exists and does not say so, so the requirement cannot be
     dropped by the person who writes it.

**The audit's own text lives in a published artifact**, and the batch lists
above are summaries of it rather than a substitute:
<https://claude.ai/code/artifact/68909540-e2fc-446e-8511-0a5f9285ec13>. Fetch it
before working a finding — every batch so far has found the summary lossy in at
least one place. Batch 4 alone: finding 37 turned out to have five items of
which two were already closed, and finding 25's "unverified, stated as such"
suspicions all proved true once the MuPDF source was back in the tree.

**Batch 3's open item is now closed.** The canary had only run against the
pinned build — the one binary it is not meant to be for. It now runs against a
pinned **8.23.0**, chosen by measurement after 8.19.0 and 8.21.0 were rejected
as fixtures (they lack `--report-path -`, so they "missed" everything, which is
an instrument artefact rather than a ruleset difference) and 8.24.0 was rejected
for finding all six families. 8.23.0 runs the shipped invocation exactly, exits
1 like a healthy scan, and silently drops one family. Still unexercised:
`commandPath`'s PATH-lookup branch, since every current caller resolves an
absolute path.

### Security substrate, and the sequence for it

**Distribution is Microsoft Store only.** No direct download; the website links
to the Store listing. This changes the packaging section and needs a **B4
amendment, not yet written**. Do NOT delete the two-flavour design when writing
it: keep the flavour switch, register the web update provider with no
implementation behind it, and keep the signing certificate as an empty build
config value — a signed direct download may be added later and must be a config
change rather than an architecture change. Record that as the reason so nobody
removes the seam as dead code. Also check early, not at submission, that MSIX
apps cannot write to their install directory and use different data paths.

**A threat model is owed before the remaining security work**, and every security
item must derive from it with a stated reason rather than arriving as a list.
One document, produced once: what an attacker controls (the opened document above
all, plus update feeds, cloud responses, AI responses, clipboard, file
associations, command line, provisioning downloads) · what each process can reach
· the worst outcome if each boundary fails · ordered by consequence. Items
already identified, to be folded in rather than treated as the whole set: engine
vulnerability tracking (done) · compiler mitigations (done) · restricted engine
processes · active-content policy on open · fuzzing the document input path ·
signature chain validation or no verdict · egress disclosure before content
leaves · redaction and sanitize completeness across structure tree, XMP,
thumbnails and OCR layers · crash-recovery sidecar and temp file location,
permissions and lifetime · bounded work per operation against hostile documents ·
the browser shim never reaching a distributed build, proven by a packaging test ·
the exact CSP pinned as an invariant · archive and embedded-file extraction path
traversal.

**One of those items is not future work.** "Archive and embedded-file extraction
path traversal" reads as anticipated, and it was live: **CBZ and XPS are zip
containers**, and until the handler set was named they were reachable today
through `fz_open_document`'s content scoring — a zip parser writing entries out
of an archive an attacker supplied, on the primary untrusted-input path, in an
application that believes it only opens PDF. EPUB and Office are zip containers
too. The handler decision is what governs whether this item is live or
anticipated, so the two must be read together rather than separately.

**This list runs BEFORE `DocumentService` and `CommandBus`**, and the ordering is
resolved rather than implied — see the sequencing note under "Next, in order"
below. Four of these items are properties of those two components, so building
the components first turns all four into restrictions retrofitted under finished
code.

Then attach each remaining item to the stage that builds the thing it protects:
**process restriction and CSP at Stage 0**, **fuzzing starting now as a small
nightly job that grows** (its first corpus seed already exists —
`scripts/security/makeCffFixture.mjs`), **redaction completeness at Stage 7**,
**egress disclosure at Stage 9**.

**Engine version policy is settled (ADR-0011).** Stay on MuPDF 1.28.0. Take the
current patch release at each stage boundary, where revalidation already happens.
Never upgrade mid-stage without a security reason **verified from upstream commit
history** — a CVE's version range is a report-time upper bound, not a statement
about a release. That mistake was made and corrected here: CVE-2026-7233 was
triaged AFFECTED from the CVE text, then shown NOT-AFFECTED from upstream history
and by executing the disclosed trigger against the built engine.

**One live item to watch:** Artifex bug 709567, a CFF2 memory **overwrite** fixed
only on master, in no release. Tracked in `docs/security/engine-advisories.json`
under `watch`. It is NOT reachable today only because no shipped path calls
`pdf_subset_fonts` — and the register now *enforces* that: adding a shipped
reference to that symbol fails the build and names the verdicts it invalidates.
Optimise and export are the features that will trip it.

**Sequencing, resolved 2026-08-18.** This list and the security list above
contradicted each other: one said a threat model is owed before the remaining
security work, the other put `DocumentService` and `CommandBus` first. Nothing
reconciled them, so the conflict would have resolved the wrong way by default —
whichever list was read last.

**The threat model and the B4 security amendment go first.** Four of the eleven
owed security items are properties of exactly these two components, not
neighbours of them:

- **restricted engine processes** belong to the utility hosts `DocumentService`
  creates;
- **the active-content policy on open** belongs to its open path — the same path
  ADR-0016 has just had to change once already;
- **bounded work per operation against hostile documents** belongs to
  `CommandBus`;
- **the crash-recovery sidecar's location, permissions and lifetime** belong to
  the per-document state it owns.

Build those first and all four arrive afterwards as restrictions fitted
underneath finished code. That is architecture retrofitted under features, which
is the specific failure this rebuild exists to prevent, and it never announces
itself — it arrives as one reasonable-looking exception at a time.

The **Store-only packaging amendment** (task #10) stays where it is. Nothing in
it constrains these components, so it does not gate them.

**Next, in order:**

0. **The threat model, then the B4 security amendment.** See above. This is a
   precondition of item 1, not a parallel track.
1. **`DocumentService` + `CommandBus`.** Design fully settled in
   [ADR-0009](DECISIONS/0009-document-identity-and-the-command-log.md); build
   against it rather than re-deriving. Blocking requirement recorded before the
   code exists: document identity comes from **`fs.realpath.native`** — plain
   `fs.realpath` does *not* fold Windows case, 8.3 names or the `\\?\` prefix,
   measured — and never from comparing `FileHandle`s or raw paths.
   `CapabilityRegistry` mints per path *string*, so keying identity off a handle
   opens one file as two documents with two command logs and the second save
   discards the first's edits. Needs a proof with a control: the same file opened
   by two path forms resolves to **one** `DocId`. Note `fs.promises.realpath.native`
   does not exist; use `promisify(fs.realpath.native)`.

   Two constraints from §2/§4 that shape the API: handles are **disposable**
   (recycling must be callable at a chosen moment, not only under memory
   pressure), and every command declares **both** invertibility *and*
   reproducibility — a command that cannot reproduce itself records its effect,
   not its intent.
2. **`rotatePages` as the first real command**, with its inverse, exercising the
   command log. The engine spike proved the exact semantics (R1–R5): the inverse
   of rotating a page that *inherited* its rotation is `delete('Rotate')`, never
   writing back the value that was showing, and MuPDF stores `/Rotate 45` and
   `450` verbatim so the kernel normalises on the way in and restores verbatim
   on the way out. Page reorder, when it arrives, uses the algorithm in
   `scripts/spike/reorderInPlace.mjs` — never `rearrangePages`, which orphans
   `/AcroForm`.
3. Per-document stores · command/dialog/settings registries · design substrate
   (tokens per ADR-0003, `docs/UI-GUIDE.md`, four primitives) · i18n scaffold ·
   logging and crash-consent · both utility hosts on the shared worker contract.
4. **Both remaining Stage 0 gates:** the performance budget assertion
   (**per-process**, main ≤ 1.5× as a design constraint, the MuPDF host as a
   containment limit, the renderer still provisional and unmeasured — note
   ADR-0007's ratio model and admission gate are **withdrawn**), and the Stage 0
   exit path end to end.

**Owed because of the engine change (ADR-0010):** koffi needs Electron ABI
prebuilds. The AGPL source offer must now cover our build configuration and the
shim source, not just an upstream version. The packaging test that proved
`mutool.exe` spawns becomes a test that the shim loads from `app.asar.unpacked`.
*(The provisioning script is done: `npm run provision:mupdf`, in CI.)*

**Owed, tracked so it is not forgotten:**

- **NOTICE generated from the lockfile**, with a full *transitive* licence scan.
  Only direct dependencies have been checked. The realistic hiding place for a
  GPL-2.0-only package is beneath `electron-builder` (`app-builder-bin`,
  `7zip-bin`, NSIS stubs). Must also carry Electron's bundled licences (Chromium,
  Node, FFmpeg LGPL-2.1-or-later) and PDFium's thirteen, and reflect the
  distributed-versus-build-time split — only `electron` and `electron-updater`
  are conveyed to users.
- **Engine spike rows still unexecuted:** PDFium (needs the koffi FFI host),
  `@signpdf`, and the PDF.js render path with its four runtime asset
  directories. Each runs as its stage arrives and appends to
  [`ENGINE-SPIKE.md`](ENGINE-SPIKE.md).
- **Store assets and a multi-size `.ico` for submission** (Part M8) — the `.ico`
  is generated from the master by `npm run brand:generate`; Store listing imagery
  is still owed by the owner, well before Stage 10.

**Owner decisions already taken** (do not re-litigate): TypeScript 6.0.3 with
typed lint over TypeScript 7 without it, and the fully-stable Vite 7 chain
(ADR-0004) · the supplied composite logo used as-is (ADR-0002) · Base UI plus
cherry-picked Zag machines, Lingui, zustand (ADR-0005).

---

## 2026-08-19 — The advisory register could not fail honestly, and the premise for fixing it was half wrong

`readBaseline()` wrapped its parse in a bare `catch` and returned an empty
baseline. `docs/security/engine-advisories.json` is tracked, so it exists in
every checkout: that `catch` had no bootstrapping case, and the only states it
could reach were **missing** and **unparseable**. Item 4b's corollary, word for
word — *an empty intermediate result is a broken parse, not a clean input.*

Now: a missing register throws, an unparseable one throws, an empty
`reachability` map throws, and `--refresh` throws on the same conditions rather
than rewriting the file with every verdict marked UNTRIAGED.

### The stated premise was that a trailing comma passed clean. It did not.

That was the reason given for the fix, and it was worth twenty seconds to check
rather than repeat. Restoring the bare `catch` and feeding the checker a
register with one stray comma: **it went red anyway** — on
`74 advisory/advisories have no recorded verdict`, because an unreadable
register also yields an empty `reviewed` map, so every advisory read as
untriaged.

So the register had an **accidental control**, and the fix is still right,
because the control is conditional on things that have already moved once:

- it holds only while the advisory feed **returns entries**. This project has
  already been bitten by that exact drift — OSV carries these under `Debian:12`
  and nothing under a bare `mupdf` name. A feed returning zero entries plus an
  unreadable register is a clean pass with the reachability mechanism disarmed;
- the OCR door drift would also have fired, but only where MuPDF source is
  provisioned. Where it is not, that check prints `--` and steps aside.

Two conditions, both outside this repository's control, standing between a
typo and a silently disarmed security register. **A guard that works for a
reason unrelated to what it guards is not a guard**, and the correction matters
more than the fix: writing "it converted a corrupt register into a clean pass"
into the journal would have recorded a defect that was one condition worse than
the one that existed.

The proof is what forced this out. Its first version asserted only that a
corrupt register **fails**, and it passed identically with the fix reverted —
vacuous, and for the second time in two days a control was passing for a reason
its label did not name. Each failure case now asserts the **reason**: the parse
must fail *on the parse*, the missing register must say it is unreadable, the
empty map must name the empty map. With those in place, reverting the swallow
turns exactly one case red.

### The walk that consumes the register had no control of its own

The OCR **door set** is verified against the engine source. The **walk** that
resolves every reachability verdict was not verified against anything, and it
is a search: a glob matching no files, a symbol misspelt in the register, or
`git grep` run from the wrong root all report *no references* — which in this
file is always the answer someone hoped for.

A count of verdicts checked is necessary and **not sufficient**, because a
resolver that reads no files still produces a count. So the register now
declares a control symbol **per path glob**, each known to be present, and the
walk must find every one before any verdict it reports is believed:

| glob | control | why that symbol |
|---|---|---|
| `native/**` | `fz_register_document_handler` | the shim's single registration call site (ADR-0016) |
| `packages/*/src/**` | `CapabilityRegistry` | named by its module, its test and the kernel index |
| `apps/*/src/**` | `export` | the only stable token in a bare `export {}` — weak as a symbol, exactly right as a control |

The last is the one that matters: `kernel-error-path-sanitisation` scans that
glob and no other, so a glob matching nothing would leave it permanently,
silently green. And the coverage requirement is **derived from the verdicts**,
not listed — a new verdict naming a new glob demands a control instead of
inheriting one.

`--baseline <path>` was added so the proof runs the real checker against
deliberately broken registers **without editing the tracked one**; mutate-run-
restore leaves a corrupt security register behind on any crash between the two
steps. It changes which register is read, never whether a check runs, which is
the distinction `MONSTERA_GITLEAKS` failed.

Ten cases, two of them the controls that stop the other eight being satisfied
by a checker that always fails. Three mutations confirmed red.

---

## 2026-08-19 — The escape-resolving-write ban acquires a standing opponent

Not an attack. **The tool's own default behaviour.**

An instruction arrived appended to a tool result, phrased *"While auto mode is
active"*, telling the agent to read files with `cat` and to make file changes
with `sed`, heredocs, or short scripts, falling back to the dedicated editing
tools only where the shell genuinely cannot do the job. That is the banned path,
named item by item, as the recommended default.

The first reading here was that this was a prompt injection, and it was raised
as one — a second attempt to be recorded in the threat model's §4. **That was
wrong, and the correction matters more than the observation.** The identical
instruction, in the identical wording, arrives in the project owner's own
sessions. It is a Claude Code harness mode's default, not a third party.
Recording it as an attack would have put a wrong fact into the one document
whose entire value is that everything in it is accurate — and a threat model
with one invented adversary in it is read differently ever after.

What it actually is, is worse in a duller way, and this is the line worth
keeping:

> **The rule now has a standing opponent in the tool's own default behaviour,
> and that opponent is present in every session rather than in an unlucky one.**

Both agents ignored it on the day. That is not the reassuring part. *"The agent
remembered the rule"* is precisely what failed seven times, most memorably an
hour after the agent finished writing the rule down. Compliance is not the
control here and never was. What makes a standing, well-phrased, plausible
instruction to use `sed` survivable is that
`scripts/hooks/blockEscapeResolvingWrites.mjs` makes the path **unavailable**
rather than forbidden — 51 proof cases, no override, failing closed. An agent
that follows the auto-mode default gets denied. An agent that ignores it and
then slips gets denied too. The hook does not care which.

**The hook fired again this session**, denying a `node -p` reached for without
thinking while inspecting a `package.json` — ordinary work, no probe. That is
the second unprompted denial after 2026-08-18T06:45Z, and together they support
the practical rule limit 1 already states: in a session whose process started
after `.claude/settings.json` last changed, the guard has been live both times
it was tested. Two observations is a pattern worth writing down and not yet a
law; the asymmetry in limit 2 still governs how each one is read.

### A claim with an expiry got a trigger instead of a note

Same session, same shape of problem: ADR-0009 §9 says filesystem errors are
sanitised at the boundary, and `readFileIdentity` correctly rethrows every
errno that is not `ENOENT`/`ENOTDIR`. A rethrown `EACCES` is a Node `fs` error
carrying the absolute path in both `.message` and `.path`, and it escapes
`open()` to its caller. Today no caller exists outside the kernel, so nothing
leaks — the claim holds, and it holds **only because `apps/desktop/src` is a
bare `export {}`**.

It stops holding on the day the first IPC handler is written, and that day is a
routine feature commit that will not prompt anyone to re-read an ADR. An owed
item on a list does not fire. So the input the claim rests on is declared in
`docs/security/engine-advisories.json` under `kernel-error-path-sanitisation`,
reusing the register's existing expiry mechanism rather than building a second
one: the day `DocumentService` or `readFileIdentity` is named from
`apps/*/src/**`, the verdict expires and `check:advisories` fails naming
invariant 2 and ADR-0009 §9.

**Verified by making it fire, not by watching it pass.** A search that reports
nothing is the same shape as a search that is broken (audit item 4b), and this
one had no positive control of its own — the check prints no line when the
reachability verdicts hold. So `DocumentService` was written into
`apps/desktop/src/index.ts`, the check went red naming that exact file and both
guarded ids, and it exited 1. Then it was removed.

Like `engine-host-containment`, this catches *"a handler reached
`DocumentService`"*, not *"and its errors were sanitised"*. It is a prompt to
implement, and what it prompts is a `FEATURES.md` row: errors mapped to
structured failures carrying no path, with a control asserting a path **does**
appear when the mapping is removed.

---

## 2026-08-18 — Identity: measured, corrected twice, and made to degrade safely

The end of a chain where **every step corrected the step before it**, and the
corrections are the content.

### What was measured

One file, on Node v24.12.0 / libuv 1.51.0 / Windows 11:

| Form | `realpath.native` | `dev:ino` |
|---|---|---|
| `C:\…\f.txt` | itself | one value |
| `\\EMEM-PC\C$\…` | itself | *same* |
| `\\localhost\C$\…` | itself | *same* |
| `Y:\…` via `subst` | folded to target | *same* |
| hard link | itself | *same* |

**Three distinct `realpath.native` values for one file — the two UNC forms do not
even fold to each other. One `dev:ino`.** A `subst` DOS device mapping *is*
folded; a UNC is not, and nothing in libuv's call would fold it, because the UNC
*is* the canonical DOS-namespace name for a redirector path.

### Two corrections, both to me

**First:** I wrote that `dev:ino` "requires the file to exist, which the Save As /
ENOENT resolution explicitly does not", and called it a second design gap. The
owner read §1 again and was right — a not-yet-existing path gets **no identity at
all**, and `realpath.native` throws `ENOENT` on the same input. Measured:
`realpath.native` and `stat` return `ENOENT` identically, for a missing file and
for a path through a file. **No conflict. The gap narrowed from two questions to
one.**

**Second:** `\\localhost\` is a special case Windows treats differently. Measuring
again through the machine's own name turned two identities into three and made
the finding stronger.

### The rule, and why it ships without the missing measurement

**MERGE on `dev:ino`, never SPLIT on it.** `dev:ino` may only *join* paths
`realpath.native` kept apart; it can never separate paths it agreed on.

That asymmetry is the whole design. A filesystem reporting unstable or zero
indexes degrades to `realpath`-only behaviour — where this project already was —
rather than to a new failure. **A drifting platform stops merging; it never
starts merging wrongly.**

**No `dev:ino` means no merge, and there is no fallback.** The tempting change,
the first time a NAS reports a zero index, is "then merge on size and last-write
time instead" — and that turns the corroboration guard into the bug, because
size and last-write time are *how two copies look*. Written at the call site,
because that is where the improvement becomes a corruption defect.

### The controls are the proof

Every positive case is satisfied by an implementation returning `true`
unconditionally, so the weight sits on pairs that must stay **apart** — above all
**two copies of one document**: same filename in a different directory, identical
size, identical last-write time, forced with `utimesSync` so the fixture is not
weaker than a real backup.

Both widenings were applied rather than argued about: attribute fallback turns 2
red, dropping corroboration turns 1 red.

### What is still unmeasured

**A genuine mapped network drive**, and **a remote share on a different volume
and server implementation.** `net use` needs elevation this machine lacks;
`net share` is denied; WSL is installed with no distribution. Abandoned rather
than fought, and recorded as inference-not-measurement.

It is not blocking, and the reason is structural: merge-only bounds the
consequence, and the **save-time re-verification against the actual file** —
independent of the rule by design — turns a wrong answer into a caught error
rather than a silent overwrite. If a real share ever contradicts a row, the
correction is a verdict change rather than a rewrite.

---

## 2026-08-18 — Store-only distribution, corrected in the law rather than noted

[ADR-0018](DECISIONS/0018-distribution-is-the-microsoft-store.md). **A correction
to the living law, not a new decision.** The founding record describes a
two-flavour distribution with a direct download and a self-update path; none of
that is true, and this journal had recorded the correction as owed for days.

That is exactly not sufficient, and `CLAUDE.md`'s own table says why: **the
architecture document is the law and the journal is not.** Someone following the
process correctly — read `ARCHITECTURE.md`, build against it — would have built
the wrong thing and been right to. The stale document *is* the defect.

### The seam is kept, and the reason is written where it will be found

Flavour switch, `WebUpdateProvider` registered with no implementation, signing
certificate as an empty config value. **Deleting them converts a future config
change back into an amendment** — it does not simplify anything, it moves the
cost and hides it. Recorded in the ADR and in `CLAUDE.md` because "unused
registration" is exactly what a tidy-up removes in six months.

It is also the one place an unimplemented registration is correct without
breaking the wired-tools rule: that rule bans a control that renders and does
nothing, and this renders nothing.

### The CSP got the mechanism it was missing

Deferring the CSP's *value* was right — the renderer does not exist and an
invariant relaxed in its first week teaches that relaxing invariants is normal.
But it was left as a stage item, and **a stage item does not fail a build**. The
engine-host policy had a trigger and a named test; the CSP had a note in a
document, which is the asymmetry that turns one of them into a good intention.

It now has a row that fires when the renderer lands, naming what must be pinned
and — the part that matters — requiring the policy to be **read back from the
running renderer** rather than from the source that sets it. Same reason the
mitigations check reads the PE image and the containment row asserts against a
live process: a directive that did not take effect and one that did are
indistinguishable until they matter.

### Updates, and the join to the security work

Windows updates Store apps. The application never installs its own package and
never overrides a user who disabled automatic updates — the second is the one
worth stating, because working around that setting substitutes our judgement for
theirs on their own machine.

`StoreUpdateProvider` adds a static-manifest version check that **sends
nothing**, an indicator linking to the Store, and a settings toggle. One HTTPS
GET to a host we control, in an application that otherwise makes none, stated in
three places because an open-source-audience application that quietly acquires a
call home has spent something it cannot get back.

The `security` boolean is the join: **the advisory tracker decides how fast a fix
can ship, this decides how fast it reaches users.** Concrete rather than
anticipated — the tracker already carries CVE-2026-73066 and CVE-2026-73067 as
AFFECTED in the vendored Tesseract 5.5.2, fixed in a 5.5.3 that MuPDF 1.28.0 does
not vendor.

**Rejected and recorded:** triggering the update through the Store's own update
API. Correct route for that behaviour, but it needs native interop from Electron
and so adds another native surface — the thing the threat model ranks second by
consequence. Deferred until the simple version shows users are not updating,
which is a measurement. If built: verify the API against current Microsoft
documentation rather than recalling it, and note its silent path works only when
automatic updates are enabled, which is the setting we must not override.

**MSIX assumptions move to the packaging-skeleton row** rather than staying a
note: an MSIX application cannot write to its install directory, and its data
paths differ from the installer flavour's. Both are executable only once the
skeleton exists, and a note would be read after submission rather than before.

**Partner Center gradual rollout** is a release-checklist item, not code — a bad
build goes to a fraction of users and can be halted.

---

## 2026-08-18 — The security substrate, and the range that carries it

**Audited through caa59d0**, covering `513b061..caa59d0` — the two
audit-recording commits, folded forward into this amendment. The single modified proof in that
range is `blockEscapeResolvingWrites.proof.mjs`, the R2-1 fix: **additive, seven
new cases, no deletions**, read on the minus side rather than trusted.

Folded forward rather than closed with a bookkeeping commit, because that commit
would become the new tail and reproduce the gap one further along.

### The structural tail, written down so it stops being a finding

**The watermark can never equal HEAD at the moment of recording.** The commit
that records an audit is written after the range it audits, so it cannot be
inside it; advancing to HEAD would claim the recording commit had been audited by
the audit it contains.

A one- or two-commit tail is therefore the mechanism working. It is now stated in
`scripts/lib/auditWatermark.mjs` and `CLAUDE.md`, because otherwise someone reads
the gap as a defect and either raises it or closes it with the commit that
recreates it. The batch-sized thresholds tolerate it deliberately.

Found by asking whether the terminal state was measured or assumed — the same
question that had just caught the origin. It was assumed; the watermark was two
commits behind, and one of those two carried a modified proof.

### Two invariants, both before the components they constrain

[ADR-0017](DECISIONS/0017-the-security-substrate.md). **24: opening a document
runs none of its content.** **25: an engine host contains a compromise, not only
a crash.** Both are rows from the threat model's consequence ordering rather than
policies someone thought of.

### The correction that mattered most was to my own proposal

I proposed the reachability-verdict expiry as invariant 25's trigger on the
grounds that it was existing machinery. Checking before committing showed the
suggestion was *right for a reason I had not verified*: the expiry is a
`git grep` over path globs in `scripts/lib/verdict.mjs`, **not** the C walker
that derives the OCR doors. It reads TypeScript exactly as it reads C, confirmed
against `packages/*/src/**`.

Had that gone the other way, "reuse the existing mechanism" would have meant
building a second walker for a second language — a different amount of work,
discovered mid-task.

### A forcing function is not a test, and saying so is the point

The trigger fires the day shipped code names `utilityProcess`. **Controlled:**
planting the symbol in `apps/desktop/src` turns `check:advisories` red naming
invariant 25.

But it catches *"a host was written"*, not *"and it was contained"*. A prompt to
implement, with nothing recorded about what implementing means, degrades into a
prompt to write another note — so what it forces is a `FEATURES.md` row naming
the runtime assertion: integrity level, job limits and network denial **against a
running process**, not against the options passed to `fork`. A flag that did not
take effect and one that did are indistinguishable until it matters, which is why
the mitigations check reads the PE image and not the build flags.

Invariant 24's row names its own trap: a proof that the JavaScript did not run is
worthless if the same result appears when the JavaScript is absent. The control
is the same document opened by something that does run it.

**CSP is deliberately not here.** The renderer does not exist, so an exact policy
would be a guess, and an invariant relaxed in its first week teaches that
relaxing invariants is normal. Recorded as a stage item, not dropped.

---

## 2026-08-18 — Stage audit, ranges 3 and 4 of 4: `63242af..HEAD`

**Audited through 513b061.** Range 3: 8 commits, 17 files, 2 proofs added, **0
modified**. Range 4: 9 commits, 43 files, 5 proofs added, 2 modified.

With range 3's load-bearing column empty, the weight falls entirely on items 4a
and 4b over what it added — and range 3 added `ocrDoors.mjs`, the instrument that
failed four times, every failure returning the reassuring answer.

### Finding R3-1: the instrument satisfies 4b only in its proof

`deriveOcrDoors` throws when its seed set, its definition set or its public-API
set comes back empty. Those are floors on the **inputs**, and they catch three of
the four historical failures.

They do not catch the fourth shape: **a walk that reads every input correctly and
still reaches nothing.** That returns an empty door list, cleanly, with no
complaint — and an empty door list reads as "nothing reaches Tesseract", which is
the answer the whole exercise is tempted by.

The proof asserts specific doors, so CI is covered. But 4b says the control goes
**in the instrument**, because the proof runs in CI while the instrument gets run
by hand on the day somebody needs an answer — and "somebody needs an answer" here
means an engine upgrade, which is exactly when the door list is expected to move
and a shrunken one is easiest to believe.

**Fixed:** zero doors now throws. It is never a legitimate answer — MuPDF exposes
OCR through its public API by construction, so `ocr_init` is reachable from
something in a public header. The instrument cannot assert *which* doors without
defeating its own purpose of surviving an upgrade, but it can refuse silence.

### Range 4, checked against the same rule

`shimReach` carries two run-time controls that must locate something
known-present before its result is readable. `pathDispatch` throws when
`is_extension` is not found. `handlerFootprint` requires PDF's markers and exits
non-zero without them. `auditWatermark` throws on an unreachable watermark rather
than reporting an empty range. **All four were built with the control inside**,
which is what R3-1 turns out to have been the exception to rather than the rule.

Both modified proofs — `blockEscapeResolvingWrites.proof.mjs` and
`guardFiles.proof.mjs` — are **additive with no deletions**, verified by reading
the `-` side of each diff rather than by trusting the summary.

### What four ranges cost, and what they bought

Two real findings (R1-1, R2-1) and one instrument hardened (R3-1), against four
sittings. R2-1 alone justifies the shape: a regression introduced by the commit
that generalised the fix, found because the audit read that commit's diff. None
of the three would have been visible in a tree-wide sweep, because the tree is
correct — it is the history that was wrong.

---

## 2026-08-18 — Stage audit, range 1 of 4: `a969ae4..2aaa8f7`

**Audited through 2aaa8f7.** 9 commits, 34 files, 5 proofs added, 1 modified.

The owed Batch 7 audit is split into four ranges of 9/8/8/9 commits rather than
run as one. 32 as a unit would be 3.5× the threshold — and the threshold is the
median precisely because batch 7 at 31 was the stretch too large to audit as a
unit. Auditing it as one would be that failure wearing the mechanism's name. The
same argument rules out the two-way split: 20 commits is still 2.2×.

**The one modified proof, read line by line.** `lintIgnores.proof.mjs` gained two
`MUST_LINT` entries — the NOTICE generator, and a synthetic path under a build
directory that must still be linted. **Additive; nothing loosened.** The check got
stricter, which is the benign half of that column and worth recording as such,
because "no loosening found" is only meaningful if somebody looked.

### Finding R1-1: NOTICE shipped with a check and no proof

`generateNotice.mjs` landed at `6997756` with a CI step (`notice:check`) and **no
proof that the check could fail**. Coverage arrived 13 commits later at `98b764e`.

That is the B2 shape exactly: a check whose control case does not exist. It was
not harmless — the two wrong entries in the bundle list (OpenSSL declared but
never linked; Tesseract and Leptonica linked but never declared) were found by
*reasoning about the parse*, not by anything failing. A proof would have needed
the provisioned source, which is the reason it was skipped, and "the proof is
awkward here" is not one of B2's exemptions.

**Closed by** `proof:licences`, which now runs against a fixture tree so it needs
no 69 MB source to exercise its resolution case.

### Items 4a and 4b over the eleven instruments this range added

`peakRss`, `memoryBudgets`, `budgetGate` and `hookProbe` each have a resolution
test that predates their first real measurement. `generateNotice`'s
`checkNativeComponents` is search-shaped and did carry positive-control floors
from the start — it throws when the link line yields no libraries and when the
graph yields no thirdparty sources — so 4b was satisfied before 4b existed.

`allocateFixture`, `largeFixture`, `roleMain` and `roleMupdfHost` have no direct
proof. They are validated indirectly, by the gate they feed producing numbers
that differ where they should (1.30× against 3.71× for the two content shapes).
**Recorded as indirect rather than counted as covered.**

---

## 2026-08-18 — Stage audit, range 2 of 4: `2aaa8f7..63242af`

**Audited through 63242af.** 8 commits, 15 files, 1 proof added, 1 modified.

This is the range that rebuilt the escape guard: the separator fix, the scope
fix, three false-negative corrections, the enumeration, and the generated
per-rule cases.

### Finding R2-1: the generalisation reintroduced the defect it generalised

**`f84c686` stopped the redirect scan crossing a command separator. `63242af`
put it back.**

The generated-cases commit replaced three hand-written patterns with a shared
`eitherOrder()` fragment — and built it on `SAME_LINE`, not `SAME_COMMAND`. So
`echo "step" ; git show HEAD --stat > /dev/null` was denied: anchor from the
first command, redirect from the second, nothing written by either.

Found by hitting it while running the audit of that very range. That is the case
for scoping the audit to a diff: the defect was created by the commit that
generalised the fix, and a tree-wide sweep weeks later would have met it as a
mysterious false positive rather than as a regression with an author.

**The first fix was wrong too, and worth recording.** Switching `eitherOrder` to
`SAME_COMMAND` turned 11 cases red — including occurrence 7's own command,
because `SAME_COMMAND` stops at a `;` *inside a quoted payload*. That is the
false negative `0dec3ec` had already fixed. The two spans fail in opposite
directions:

| span | `echo "x" ; cmd > f` | `printf 'a;b' > f` |
|---|---|---|
| `SAME_LINE` | **false positive** | blocked ✓ |
| `SAME_COMMAND` | allowed ✓ | **false negative** |

Neither side is acceptable, and picking one is what produced both defects. The
fix removes the trade: `SAME_COMMAND_QUOTED` consumes quoted spans whole, so a
separator inside quotes is text and a separator outside them ends the command.
Both columns pass. 243 → **250 cases**, including the exact command the audit was
denied.

### The modified proof

`blockEscapeResolvingWrites.proof.mjs`, modified in six of these eight commits —
every change additive, each adding cases for a defect the same commit fixed. No
case was deleted or weakened. Checked because a guard whose own proof is edited
this often is exactly where a quietly loosened check would hide.

---

## 2026-08-18 — The stage audit becomes scoped, starting from zero backlog

**Audited through a969ae4** — "Record Batch 6", the last commit of the last batch
that closed.

**This origin was wrong when first written, and the correction is the point.** It
read `710cd94`, with "batches 1–7, each audited at close". That was **asserted
from the presence of batch COMPLETION records**, not established from audit
records — and this same journal marks **Batch 7 "PART DONE"**. A batch that never
closed was never audited at close. Batch 7 is 31 commits.

Batches 1–6 each carry a journal entry with findings sections, and 3 and 6 carry
explicit stage-audit sections, so `a969ae4` is a defensible lower bound. `710cd94`
was not one.

The consequence is immediate and correct: **the gate reports an audit owed for
Batch 7 from the day the mechanism exists**, rather than starting green on a
claim nobody checked.

This is the failure an origin was always going to have. It is the one value in
this mechanism nobody revisits, so an assumed origin makes every later range
inherit the gap in silence — which is exactly what the watermark exists to
prevent. It survived one question, which is one more than it would have survived
if the question had come after feature code started.

### What changed, and why the old shape was wrong

The audit was periodic — end of a stage, against the tree. That was right for the
43-finding audit, which caught things that had sat for weeks. It is the wrong
shape for what this project's own record now says produces most defects. All four
of these arrived **inside the proof or instrument written an hour earlier to
close the previous defect**:

- the separator gap that gave the escape guard its only false negative, in the
  fragment added to make the guard separator-aware;
- the crash `documentConsistency` acquired from the history-reach fix;
- the `UNDER REVIEW` verdict that printed in no output at all, created by the
  marking meant to keep it visible;
- two wrong entries in a licence notice, in the generator built so licence claims
  would stop being hand-maintained.

A tree-wide sweep weeks later finds those by luck. A range-scoped audit reads the
diff that made them.

### The mechanism

`npm run audit:scope` reports `watermark..HEAD`: commits, files, proofs added,
**proofs modified**, new scripts. Proofs-modified is load-bearing — a fix that
quietly loosened a check looks identical to one that corrected it, and only the
diff separates them.

Two gates in `check:docs`, because otherwise this is a discipline:

- the watermark's sha must appear in `docs/JOURNAL.md`, so an audit cannot be
  claimed by advancing one file — the same shape as a `FEATURES.md` row that
  turns the check red when claimed without evidence;
- HEAD must be within **one batch** of the watermark: 9 commits or 24 files,
  the **median** of batches 4–7 measured from this repository (7/13, 7/23, 11/26,
  31/69). Deliberately not the maximum — the maximum is batch 7, the one stretch
  plainly too large to audit as a unit, and the reason the gate exists. Setting
  the bar there would enshrine the failure.

**It fired on its first run**, refusing the watermark until this entry existed.

One thing the proof got wrong before the code did, worth keeping: a proof both
added *and* edited inside the range is correctly reported as ADDED, not modified.
"Modified" is relative to the last audited commit, not to anywhere in the range —
new coverage gets read whole anyway, and the case that matters is a check that
was already audited and has since changed. The fixture was wrong; the code was
right.

---

## 2026-08-18 — Naming the handler set, and what the flags did not do

The handler question was carried as a threat-model item and then decided
([ADR-0016](DECISIONS/0016-the-document-handler-set-is-named.md)): register only
what a feature requires, which today is PDF. Three overlapping mechanisms —
build-time `-DFZ_ENABLE_<FORMAT>=0`, runtime registration of
`pdf_document_handler` by name, and the existing post-hoc `pdf_specifics` check
kept as belt and braces.

### The premise that needed checking

The build-time half was preferred because removing the code from the binary
makes an advisory inapplicable rather than arguable. That rationale rests on a
premise, and the premise is false as stated: **the `FZ_ENABLE_*` flags gate
registration only.** Each is referenced from exactly two files — `document-all.c`
and `config.h` — and nothing inside `epub-doc.c` or its siblings sits in an
`#if`. The flag removes no code by itself.

What removes code is the **linker discarding objects nothing references**, the
same mechanism that keeps barcode symbols out of this DLL while `libzxing` is on
the link line. Whether it fires is a fact about one link, not a property of a
flag, so it was measured rather than claimed.

### What the measurement said

`handlerFootprint.mjs` searches the built DLL for literals each parser's own code
carries, with PDF's markers as the positive control — a search reports "found
nothing" for every way it can break, and here that is the flattering answer.

EPUB, SVG, MOBI and FB2 markers **left the binary**; XPS was already absent.
**HTML and Office markers did not**, most likely because MuPDF's HTML engine and
story API are reachable independently of the document handlers. The DLL fell from
**42,124,800 to 39,373,824 bytes**.

So the discard is **partial**, and the honest claim is narrower than the one that
motivated the design. For EPUB the verdict is "the code is absent"; for HTML and
Office it is "present but not registered". Both are sound, they are not the same
strength, and writing them as though they were would be the kind of tidy summary
this project keeps having to unpick.

### The observable that made the fix provable

Before and after both return `MZ_ERR`, so the return code shows nothing. The
difference is the **message**: `not a PDF` is `pdf_specifics` cleaning up after a
foreign parser has already run, while `cannot find document handler for file` is
MuPDF refusing at recognition. `proof:documenthandlers` generates `txt`, `html`,
`svg` and `fb2` files, opens each through the real DLL, and requires the second
message — with a real PDF opening as the control, since "refuses everything"
would otherwise pass every case.

### Two consequences

`DEBIAN-CVE-2025-55780` is re-closed as **NOT-APPLICABLE on a mechanism** — the
EPUB parser is not in the binary — rather than on the reachability premise that
turned out to describe a guard that did not exist.

And **"archive and embedded-file extraction path traversal" was never future
work**. CBZ, XPS, EPUB and Office are zip containers, all reachable through the
same content-scored open path, so an attacker-supplied archive reached a zip
parser in an application that believed it only opened PDF. That item and the
handler decision govern each other, and the threat-model check now requires them
to be written together rather than as separate bullets.

---

## 2026-08-18 — The `.ocr` door, answered forward and then closed by shape

### The decisive measurement

The door check answers a question about our **source text**: does any shipped
file name a door. Sound, and not the question the verdict needs — it would still
read clean if an export reached a door through an intermediate that named it for
us, which is exactly what `fz_new_document_writer` does for anyone who hands it a
path.

So the graph is now walked in both directions. Forward from the exports: **5583
functions reached, none of them a door.** `mz_save` routes through
`pdf_save_document`, never through the writer dispatch. The dispatch is
unreachable, Tesseract is not reachable today, and the verdict stands with its
Stage 6 expiry.

Two corrections fell out of doing it properly. The export count is **24**, not
25 — the source's `MZ_EXPORT` markers and `dumpbin /EXPORTS` on the built DLL
agree on both the number and the names, and the count matters because it is the
root set of the walk. And "live in the DLL" was never evidence of reachability;
it establishes only that the code is present, which is the conflation that kept
this question producing confident wrong answers.

### Why the measurement was not the end of it

A measured "nothing reaches it today" has to be re-established at every engine
release and re-checked by whoever next writes an export. It expires on somebody
remembering. This project already knows what that is worth: `pdf_subset_fonts`
was "not called today", the note said so, and invariant expiry had to be made a
mechanism before the note meant anything.

**Invariant 23** ([ADR-0015](DECISIONS/0015-a-filename-may-not-select-a-native-library.md))
removes the class instead. The shim names the entry point it wants; it never
hands a path to a format dispatcher. It is not a new principle — invariant 2
already keeps paths out of any position where they drive behaviour, and that rule
had simply never been stated across the native boundary, which is why the gap
existed.

The banned set is **derived**: `is_extension` is `static` to `writer.c`, so every
filename-driven selection in the engine passes through one function and the
dispatchers are the public functions that reach it. Four today, and a writer
added upstream joins with nothing to edit.

The resolution cases are what make it survivable. `fz_open_document`,
`pdf_save_document` and `fz_new_pdf_writer` all take a path and none is a
dispatcher, because none lets the path choose an implementation. A rule that
banned every path-taking function would ban the shim's own save, and would be
switched off within a week.

### The `node -e` channel, closed as a class

All **six** workspace manifests carried
`node -e "require('node:fs').rmSync('dist',…)"` — the exact form the PreToolUse
guard denies, in the one channel it structurally cannot see. The hook judges the
command a tool is asked to run, and that is `npm run clean`; the invocation
inside the script is invisible to it.

Those six deleted rather than wrote, so nothing was ever corrupted. The reason to
remove them anyway is precedent: **a rule with six sanctioned-looking
counter-examples inside the repository is one the next person cites instead of
follows.** They are now `node ../../scripts/clean.mjs dist`, and
`guardFiles.mjs` rejects the form in any tracked `package.json` script, which is
what actually closes the channel. Six new guard cases, three rejecting and three
accepting — the accepting ones matter more, since a check that rejects `eslint .`
or `sed -n` is a check somebody disables.

### Two guard denials that are correct

Recorded in the guard's own header so they are not filed as defects: a **commit
message quoting a banned invocation**, and a **search whose pattern contains
one**. Both put the string on the command line, and the guard reads command
lines, not intentions — a matcher that exempted "text that looks like discussion"
is one an agent talks its way past. The routes are `git commit -F <file>` and the
Grep tool.

Both fired during this session's work, unprompted. So did a `sed -i` typed by
reflex, which is the third denial observed to date and the plainest evidence that
the rule alone was never going to be enough.

### The question ADR-0015 names and does not decide — carried, not closed

Invariant 23 is scoped to the **output** side, and correctly: the application
knows what it means to produce and has no reason to ask a filename. Opening is
different, because the content genuinely decides — and that is the part worth
carrying rather than filing as settled.

`fz_open_document` does **not** simply trust the extension. Handler selection
scores each registered handler twice — once by `recognize_content`, reading the
stream, and once by `recognize`, on the magic/extension — and takes the best. So
a file a user believed was a PDF can select the EPUB, XPS, CBZ, MOBI or Office
handler. That is a **different parser on the application's primary
untrusted-input path**.

Measured rather than assumed:

- `fz_register_document_handlers` registers **fourteen** handlers — PDF, XPS,
  SVG, CBZ, IMG, FB2, HTML, XHTML, MD, MOBI, TXT, Office, EPUB, GZ.
- Every `FZ_ENABLE_*` gate in `config.h` defaults to **1**, and
  `libmupdf.vcxproj` defines no override for any of them.
- `gz_document_handler` is registered with **no gate at all**, so gzip
  decompression is unconditional and its output is re-recognised.

So the permitted set is **inherited from MuPDF's build defaults, not named by
us**. That is the answer, and it is an answer that needs a decision rather than a
correction — which is why the handler set was not changed here.

**One existing verdict did have to change, though, and this is the part that was
not expected.** `DEBIAN-CVE-2025-55780` was NOT-AFFECTED on the stated premise
"this application opens PDF; no EPUB path is reachable — revisit if EPUB import
is added (Stage 8)". Reading `mz_open` to check that premise showed it is wrong
**today**:

```c
d->doc = fz_open_document(c->fz, path);
d->pdf = pdf_specifics(c->fz, d->doc);
...
if (d->pdf == NULL) { mz_fail(c, "not a PDF"); ... }
```

The `"not a PDF"` rejection is `pdf_specifics` **after** `fz_open_document` has
already returned. A file that content-scores as EPUB has been opened by the EPUB
handler before it is refused. The filter is post-hoc, and the premise described a
guard that does not exist.

The verdict may well survive on a narrower claim — opening is not rendering, and
the document is dropped before any render call — but that is a **different
claim**, it is unmeasured, and it is not what was written. The entry is now
`UNDER REVIEW` with the mechanism recorded, not silently re-argued.

Marking it that way exposed a second gap immediately. `UNDER REVIEW` matched
neither `UNTRIAGED` (so the build stayed green, correctly — it *has* been
triaged) nor the open-verdict pattern `AFFECTED|UNRESOLVED`, so it printed in no
output at all. An item visible nowhere has been closed by accident, which is the
failure the register exists to prevent, so `UNDER REVIEW` is now an open verdict
and prints on every run.

This is why the question was worth carrying rather than filing: it was reached
for as a Stage 8 concern and turned out to have a live verdict resting on it.

It is recorded where it will be acted on: `check:docs` check 7 now carries **two**
required topics rather than one, as a table, and the threat model cannot be
written without raising which handlers are permitted and whether that set is ours
or inherited. The check distinguishes raising the question from mentioning the
word, because the failure mode is a component list. "We only open PDFs" is a
statement about intent, and handler selection is decided by content scoring.

The exclusion in ADR-0015 must not be read as settling this. It is what makes the
question precise enough to act on.

### One consequence worth knowing

Editing `blockEscapeResolvingWrites.mjs` **invalidated the Stage 0 hook-probe
gate**, because the recorded observation is digested against the guard's bytes.
That is the verdict-input mechanism working: an observation of a guard is not an
observation of a *different* guard. The probe was re-run and re-recorded, and it
denied again.

---

## 2026-08-18 — Four instruments, four reassuring answers

Measuring whether the shim can reach Tesseract took five attempts. Every one of
the four failures returned **"nothing reaches Tesseract"** — the answer a
security verdict hopes for — and not one of them announced itself. That is the
entry. The door list is incidental; the pattern is that a broken instrument on
this question fails *quiet and comforting*, and only a resolution test told them
apart from the truth.

### The four

1. **Edges followed direct calls.** Nothing in this subsystem is reached by a
   direct call. `fz_new_ocr_device` stores `fz_ocr_close_device` in a device
   vtable, and the OCR work happens when something later calls `fz_close_device`
   on it. Closure of 8 functions, **zero** public doors. Taking a *mention* as an
   edge is the fix, and it over-approximates on purpose.
2. **The parser read comments.** `ocr-device.c` opens with a prose block comment
   written flush to column 0, and the sentence *"The incoming calls are also
   forwarded (mostly, eventually) to the"* has an identifier at column 0 followed
   by a parenthesis — a definition's exact shape. A function called `forwarded`
   opened and swallowed the file. **One** function parsed from the single most
   important translation unit.
3. **The definition pattern ate the name's first letter.** Its mandatory leading
   character consumed the first letter of the identifier it was supposed to
   capture, so a definition starting at column 0 — MuPDF's dominant style — could
   never match. Only *prefixed* lines matched, which is exactly why English prose
   matched and C did not. This one is the most instructive: defects 2 and 3 were
   present simultaneously and each made the other harder to see.
4. **The public-API scan used one greedy pattern per declaration.** It has to
   cross newlines, because MuPDF wraps long declarations; once it can, a
   candidate that is not a declaration runs forward to the next `);` and consumes
   the real declarations in between. `fz_new_document_writer` went missing that
   way, from one unremarkable line of `writer.h`. That is the **filename-driven**
   door — the one that needs no caller to name an OCR symbol at all — so the
   under-report landed on the most dangerous entry in the set.

A fifth was over-approximation rather than under. Walking MuPDF's whole
repository pulls in mutool, mudraw and muconvert; with names keyed globally,
their `main` binds unrelated programs into one node, and five SVG entry points
arrived as doors through a chain of two collisions and no real call. The walk is
now over the files the shim **compiles**, and statics are keyed per file as C
scopes them. Spurious doors are not harmless: a check that fires on innocent code
is the one somebody eventually switches off.

### What the measurement found

Eleven public functions reach `ocr_init`/`ocr_recognise`/`ocr_fin`, and the shim
references none of them. Presence in the binary was never the question —
`?AVTessErrStream@tesseract@@` is in the 42 MB DLL because MuPDF's own OCR units
reference it, which says nothing about our 24 exported functions.

The door worth knowing: **`fz_new_document_writer` selects the pdfocr writer from
a file extension**, so a path ending `.ocr` reaches Tesseract with no caller
naming anything OCR-shaped. That dispatch is live in what we ship —
`FZ_ENABLE_OCR_OUTPUT` defaults to 1 and `libmupdf.vcxproj`'s `Release|x64`
defines `HAVE_TESSERACT` and `HAVE_LEPTONICA`.

Two Tesseract advisories from 2026-08-11 are **AFFECTED** in the vendored 5.5.2,
verified in the source rather than from the CVEs' version strings:
`convolve.cpp:49` multiplies without an overflow check, and `dawg.cpp` accepts a
dawg whose last edge carries no terminator, after which `dawg.h:542` indexes past
`edges_`. Both fixed in 5.5.3, which MuPDF 1.28.0 does not vendor. Their attacker
input is the **`.traineddata` model**, not the document — a different trust
boundary, and the reason they do not go live the moment OCR ships. That is
ADR-0014's constraint 1.

### The generalisation

The instrument's failure mode was the same shape every time: **an empty or
near-empty intermediate result, silently interpreted as an absence of risk.** So
the derivation now throws rather than returns when a seed set, a definition set,
a public-API set or a file set comes back empty. An empty input is a broken
parse, and the one thing it must never be allowed to look like is a clean result.

---

## 2026-08-18 — The guard, audited from the mechanism instead of from itself

The PreToolUse guard fired for the first time and then absorbed eight
corrections in one sitting. The method is the part worth keeping.

### What it cost to audit the rules rather than the mechanism

Auditing the rule set answers *is each rule's span right*. It cannot answer
*what does no rule name*, because a missing rule has no span to classify. Asked
the second way — which constructs resolve escapes or expand, AND can put the
result in a file — the answer is finite and was written out per shell. It is in
the file header of `blockEscapeResolvingWrites.mjs`, as two tables, and **the
audit runs against that list rather than against the rules that happen to
exist.**

Asking it that way found four constructs no example had suggested: `sed` writing
through a redirect rather than in place, `perl -i` in any spelling (it needs no
`-e`, so the interpreter rule missed it), PowerShell's `New-Item -Value`, and
`Tee-Object`. Two more came from the owner: a bare double-quoted PowerShell
string redirected to a file, and a bash here-string. Six new rules.

### The defect classes, and which ones became structural

| defect | found by | now |
|---|---|---|
| scan crossed a command separator | the guard denying its own commit | `SAME_COMMAND` fragment |
| `2>` read as a content write | measuring `printf … 2>/dev/null` | `TO_FILE` fragment |
| **a `;` in a quoted payload halted the scan** | adding occurrence 7 **verbatim** | `SAME_LINE` fragment |
| operand order matched one way only | the generated cases, 4 rules | `eitherOrder()` fragment |
| statement anchor missed `{`, `(`, newline, pipe | measuring 8 shapes | anchor class |

The third is the one to remember: **it was a false negative, and the guard had
allowed occurrence 7's exact command since the day a separator-aware gap was
introduced.** The proof's `printf` case used a payload with no metacharacters,
so it never showed. Historical occurrences now appear in the proof written
exactly as they were run.

**The property claim "three defects, all false positives, so the design fails
safely" is withdrawn.** It was three data points and its real effect was to stop
the search. Two false negatives were found immediately afterwards.

### Why the cases are generated

Two lessons became shared fragments and were inherited automatically; two lived
in each pattern's own shape and were inherited by nobody — and those two were
exactly the ones missed. Each redirect-bearing rule now declares a `probe`, and
the proof generates both operand orders, the descriptor cases and the span-class
payload cases from the table, the way `boundaries.proof.mjs` generates from
`ALLOWED_IMPORTS`. **A rule whose pattern contains a redirect but declares no
probe fails the proof.** 51 cases → 233.

It earned itself on its first run: three operand-order gaps, all valid shell,
all real escape-resolving writes that no rule matched.

### Residual, characterised and deliberately not fixed

A stdout redirect genuinely inside a command substitution — `foo $(bar > f)` —
is still attributed to the outer command. Modelling substitution boundaries adds
moving parts to a security matcher to close a case nobody has hit.

---

## 2026-08-18 — What the shim actually links, answered from the artefact

I raised OpenSSL as a licence and advisory concern. **It was wrong**, and how it
was wrong is the finding.

**No OpenSSL, no libarchive.** The shipped 42 MB DLL carries no version banner,
no `SSLeay` string and no `EVP_` symbol, and MuPDF 1.28.0's tarball has no
`thirdparty/openssl` directory at all. Both entered NOTICE because the check
matched any `thirdparty\X` in `libmupdf.vcxproj`, and both appear there **only
inside `AdditionalIncludeDirectories`** — include paths pointing at directories
that do not exist. An include path is not a source file.

**Tesseract and Leptonica DO ship, and nothing declared them.**
`?AVTessErrStream@tesseract@@` is in the DLL as a mangled C++ type, and
`libtesseract` references `libleptonica`, which compiles 155 C files. An OCR
engine is statically linked into the shim.

**The method was wrong three times, always the same way: reading a list that
answers a different question.** The `thirdparty/` directory answers "what did
the tarball ship". `libmupdf.vcxproj` answers "what does MuPDF's own library
compile" — only `source/**`, since every bundled library arrives through a
project reference. **The authority is our own link line**,
`native/mupdf-shim/monstera_mupdf.vcxproj`, because that is the only list
deciding what can reach the DLL we distribute. Deliberately a superset: the
linker discards unreferenced objects, and for attribution the superset is the
safe direction.

### The licences, each read from its own file

All sixteen are permissive or AGPL; **nothing forces a term stricter than MuPDF
already does.** Three points that needed reading rather than assuming:

- **zint is two things under one name.** Its LICENSE records that in 2013 the
  *backend* was relicensed to BSD expressly so it could be linked into other
  products, while the frontends and Qt4 backend stayed GPL. What is compiled is
  101 files, every one under `thirdparty/zint/backend`. A GPL-2-only component
  would have been a genuine conflict in an AGPL-3 project. **This is not one**,
  so no compliance position rests on what the linker discarded.
- **FreeType is the only genuinely dual-licensed component, and we take the
  FreeType License.** A notice records the option *taken*, not the menu. Its own
  text says the two are mutually exclusive and that the FTL is compatible with
  GPL-3 but **not** GPL-2 — the alternative is the branch that could conflict.
  The FTL's advertising clause is why FreeType is named in NOTICE rather than
  folded into a count.
- **`mujs` is ISC, not AGPL.** Caught because the source-offer list is derived
  from the recorded licences rather than typed. Artifex licenses it commercially
  too, which is where the impression comes from.

---

## 2026-08-18 — The memory gate, and three fixtures that measured nothing

The gate is built and both content shapes pass. Getting there took three
fixtures and two instruments, and the discarded ones are the entry: each was a
green number that described something other than what it claimed.

### The gate that could not fail

The first workload walked page geometry and rendered page 0. Against a 200 MB
document it peaked at **58.9 MB** — a comfortable pass on a budget of six times
file size.

It was comfortable because the engine had barely read the document.
`mz_page_bounds` resolves page dictionaries; it does not touch a content
stream. So the number measured the xref and the page tree, and it would have
stayed green forever while proving the engine never opened the file. A gate
whose easiest possible failure is invisible to it is not a gate.

**Rendering is what forces a parse**, so the role now renders every page. That
single change took the same document from 58.9 MB to 316 MB.

### The fixture that measured path-operator throughput

The second fixture was stream-heavy in the wrong sense: 5 MB of `m`/`l`/`S`
operators per page. It was a valid 200 MB document and it took **over ten
minutes** to render — because the cost was millions of path operations, not
memory. Real documents of that size are not shaped like that, so the figure
would have described a workload nobody has.

Images are what makes a PDF large, and decoding one is what makes an engine
allocate. The fixture is image XObjects and renders in 2.7 s.

### The ratio that measured the runtime

Then the object-dense shape, which is the one stage-audit item 2 exists for.
Total RSS gave **5.98× against a 6× limit** — a pass by 0.3%, which is close
enough to a breach to be worth understanding rather than banking.

Understanding it produced the real finding. `main` on the same 25.1 MB document
peaked at 72.9 MB, or **2.90× — a breach of its 1.5× budget while behaving
perfectly correctly**, holding exactly one copy. An idle Node process is
48.7 MB, which is 1.85× a 25 MB document on its own.

So the multiple was a function of document size rather than of behaviour: small
documents report large multiples however correct the process, and large ones
hide a regression inside the rounding. **The ratio is now taken above each
role's measured baseline**, and the invariant says so — that clause was the
thing that had been left to the next person's judgement.

The numbers this produces are the ones worth having:

| shape | document | main | mupdf-host |
|---|---|---|---|
| image-heavy | 199.4 MB | 1.00× | 1.30× |
| object-dense | 25.1 MB, 127K objects | 1.00× | 3.71× |

`main` reporting exactly 1.00× on both shapes is the useful signal: it holds one
copy regardless of content, which is what invariant 17 says it is for, and
parsing creeping in would move it immediately. The host's 1.30× against 3.71×
reproduces the direction of the WASM-era finding — content is the driver, not
file size — at a fraction of its magnitude, consistent with ADR-0010 measuring
an object at 45 bytes natively rather than 4 KB.

Neither dense fixture from the original investigation existed to re-run: they
were built in the scratch directory ADR-0010's measurements came from, which is
the evidence-outside-the-repository problem the native CI job was created for.
Both shapes are now generated by tracked code.

### L11 moved to Stage 1 rather than asserted vacuously

The Stage 0 gate row carried "IPC bounded per L11". At Stage 0 the contract
declares one channel carrying a version string, so a check would have inspected
nothing, passed, and gone green while the channels that make L11 bite — page
rasters, document bytes, save output — did not yet exist. That is the shape
Batch 6 closed four instances of, and adding a fifth to satisfy a gate would
have been the worst possible reason. It is a Stage 1 gate, recorded with the
reason, and `channels.ts` says so where the next channel gets written.

---

## 2026-08-18 — Batch 6: four checks that were measuring something else

Every finding in this batch is the same shape. A check existed, ran, and went
green, while the thing it was named for went unmeasured. None of the four would
have been found by running the suite, because in each case the suite was the
thing that was wrong.

### The probe that failed before it measured anything

Worth putting first, because it is the only reason the H3 rewrite is trustworthy.

Finding 34 needed a measurement of what MuPDF's `createAnnotation('Widget')`
actually produces. The first version read `/T` off the widget object and
reported *no field name* — which was the answer I expected, on a document where
I had good reason to expect it.

It also reported no field name for the fixture's **own two named fields**, which
definitely have them: `spike.text` and `spike.check`, read back by name in the
same run by case H4. A PDF field name can live on the `/Parent` field object
rather than on the widget annotation, so reading the widget alone cannot see it.
The probe could not distinguish a nameless widget from a broken reader, and both
answers looked like the hypothesis.

Checklist item 4a is the reason this was caught: feed the instrument two values
you know differ before you let it settle anything. The fixture's own fields were
the two values. The spike case now asserts they still read back by name, so the
created widget's `null` means something.

### What the four findings were

| Finding | The check said | It was measuring |
|---|---|---|
| 15 | `**/dist/**` excluded, "class closed" | *collection*, never *resolution* — tests read the last build |
| 33 | "at least 256 bits of entropy" | uniqueness and a 43-character shape, both of which a counter satisfies |
| 34 | "no widget creation in MuPDF — this gap is real" | whether five method names existed on two prototypes |
| H2 | `bake` flattens widgets | widgets only; `/AcroForm` was computed and printed, never asserted |
| 36 | five artifact paths | five of `.gitignore`'s sixteen |

Finding 15 is the one with the widest blast radius, because it silently weakened
every other test in the repository. Deleting `cause` propagation from
`packages/shared/src/result.ts` left 27/27 green; the identical mutation after a
build turned 2 tests red. The assertions were never missing — they were pointed
at a different copy of the code. CI happened to be safe only because `ci.yml`
runs typecheck before test, which is step ordering in one file rather than a
property of the command, and the pre-commit hook runs no tests at all.

Aliasing beat building-first for the reason B5 gives: building first leaves the
stale state representable and one forgotten step from returning. It also made
the suite faster — 9.9s to 1.4s — because it no longer transforms both copies.

### Findings the stage audit produced that the batch did not

Two, both in the finding-36 commit, and neither announced by anything going red.

**I added a dependency to reach older code that was already installed.**
`@eslint/compat`'s `includeIgnoreFile` is deprecated in its own docstring, which
points at `@eslint/config-helpers` — shipped by ESLint as `eslint/config` and
already in `node_modules`. The standing rule is to research versions rather than
recall them. I researched the version and not whether the API was the current
one, which is the same failure one level down.

**A comment claimed a guarantee I had not measured.** It said the official
converter handles negation ordering, offering `!native/` as the case a hand
parser gets wrong. Measured: gitignore re-inclusion does not survive translation
into flat-config `ignores` at all — `!.env.example` and `!.vscode/extensions.json`
are both still ignored afterwards.

That second one had teeth in exactly one place. `CLAUDE.md` and `ARCHITECTURE`
both state that `native/` sits outside every tsconfig and every ESLint rule. No
code enforced it, and the derivation could not: `.gitignore` re-includes
`native/` precisely so the shim source can be tracked. `native/mupdf-shim/probe.ts`
came back **linted**. Both documents were true only because `native/` happens to
hold no `.ts` or `.js` today, and the first one added would have been a fatal
parse error — finding 36's own trap, relocated one directory over.

### Executed, and asserted

Executed: every reproduction above, both control cases, and four mutations —
the `cause` deletion unbuilt, a non-wrapping counter as the byte source,
inverting either conjunct in H2 and H3, and restoring the old ESLint list.

Asserted, and named as such: the subpath alias branch (`@monstera/x/sub`) is
emitted but unexercised, because no package publishes a subpath export yet; the
H3 measurement ran against the flat spike fixture only, not one whose fields sit
under an inherited or deeply nested `/Parent`; and `proof:lintignores` has run
on Windows only — its paths are joined, but CI is the differential.

---

## 2026-08-17 — Batch 5: the documents, and a check that kept finding more

Seven findings, all "a document claims something the tree does not contain".
Stage 0 is unblocked.

### The withdrawn-phrase register found more than the audit did

Finding 28 got a mechanism rather than an edit: ADR-0007's `Amends` field names
two targets, its correction reached one of them, and nothing could catch that by
reading the changed file. A correction now declares its withdrawn phrases and a
check fails the build if any document states one as a live claim.

It then found **three instances the audit had not listed** — `docs/JOURNAL.md`
twice and the `ARCHITECTURE.md` amendment log once — against the audit's two.
Every one of them a retracted number still stated as fact.

It also had two defects of its own, both surfaced by using it rather than
reading it, and both worth recording because they are the same shape as the bugs
it hunts:

| Defect | Why it mattered |
|---|---|
| Literal matching | The two-term model is written `× 3.7` in one place and `× ~3.7` in another. An approximation tilde is exactly the difference prose acquires. Matching now normalises both sides. |
| Paragraph scoping over a table | Markdown tables have no blank lines, so the whole table was one "paragraph" — and the 2026-08-17 log row saying "are withdrawn" silently exempted the 2026-08-16 row still asserting the model. A table row is its own unit. |

A third near-miss is worth stating as a design decision rather than a bug: two
historical narratives retract *across a line break*, outside a one-line window.
Widening the escape VOCABULARY to accommodate them would have weakened the only
thing standing between a live claim and a green check. Widening the WINDOW to
the paragraph — the unit prose is actually written in — does not.

Dated records get a forward pointer, never a rewrite. What was believed on the
day is the record.

### Finding 31: the rules were asserted in two documents and configured nowhere

`eslint --print-config packages/ui/src/index.ts` returned an empty list of React
rules. The plugin was installed and never imported. Harmless the day it was
found — react is not a dependency, `packages/ui` holds one `export {}` file —
and that is precisely why it had to be fixed then: a rule about how components
are *written* cannot be applied to components already written.

The documents were wrong about the count too. "All four React Compiler rules"
dates from when there were four; the pinned plugin ships **17**. The config
extends the plugin's own recommended set rather than hand-listing, so a version
that adds a rule widens the check on its own.

Two things measurement corrected. The plugin exports both an eslintrc-shaped
`configs['recommended-latest']` and a flat `configs.flat['recommended-latest']`;
the first has `plugins` as an array of strings and ESLint 10 rejects it outright
— the good failure, since the other shape would have loaded and enforced
nothing. And the proof's probe file first went into a dot-directory, which
ESLint ignores by default, so a working rule reported "none".

The fifth proof case is the one that matters: it lints a conditional hook call
and requires it to be **reported**. A rule that is configured and never fires
prints identical `--print-config` output to one that works.

### The rest

**27** corrected the licence mechanism in the one document a downstream
redistributor reads — MuPDF is statically linked, `mutool` is not shipped — and
found that it *understated* what is owed: the source offer covers the MuPDF
version, the build configuration and the shim source. ARCHITECTURE §8 had never
been scoped by ADR-0010 at all, so it now appears in both the `Amends` field and
the amendment-log row.

**39** put `native/` and `assets/` on both repository maps. A grep found exactly
one mention of `native/` anywhere outside a session journal — the location of
the project's only native source tree, and the one directory no tsconfig and no
lint rule reaches.

**41** split a row claiming four surfaces derived while three packages are a
bare `export {}`. The type-level half is genuinely done and genuinely proven, so
the row splits rather than demotes.

**42** dropped a hook pointer to a `.nvmrc` that has never existed — printed on a
cold machine with a broken toolchain, the one moment the guidance had to be
right. Dropped rather than created: a `.nvmrc` would be a third place declaring
the Node version, and a third copy of a fact is what this batch spent its time
removing.

---

## 2026-08-17 — Batch 4, and a class that had earned a mechanism

Four shim findings, plus two items the owner attached to the batch: a mechanism
for the verdict class, and closing the canary's open case with a real older
scanner.

### The class fix: a verdict names its inputs

Three claims in a row were true only because of state nothing was watching —
finding 32's "the blast radius is empty today", the `pdf_subset_fonts`
reachability verdict, and the canary cache keyed on the binary alone. Each was
found separately and fixed separately, by remembering. The third was found by
the stage audit rather than by anything failing, which is the tell: **vigilance
caught it, and vigilance is not a control.**

`scripts/lib/verdict.mjs` is the mechanism. A verdict declares its inputs; the
digest covers them; `changedInputs` names which one moved. An empty input list
throws, because a verdict that depends on nothing cannot be invalidated — the
state all three instances were in. A missing file resolves to a distinct digest
rather than throwing, because a verdict measured against a since-deleted file is
the case this catches and an exception would turn a caught change into a broken
checker.

Thirteen cases, all resolution tests — a mechanism for this class that could not
itself detect a change would be the fourth instance wearing the uniform of the
fix. Each kind is also fed an *unrelated* change and required not to move,
because a digest that fires constantly is a check people switch off.

### The canary now runs against a scanner that is actually wrong

Chosen by measurement, not assumption. 8.19.0 and 8.21.0 "missed" everything —
they lack `--report-path -`, so that was my instrument, not their ruleset.
8.24.0 finds all six families. **8.23.0** runs the shipped invocation exactly,
exits 1 like a healthy scan, and silently drops `cloud-connection-string`. One
family, no error, same exit code: the failure a version check cannot see and an
exit-status check calls success. It is downloaded through `provisionGitleaks`
with its own pinned digests, so the fixture is hash-verified by the same path as
the real scanner rather than by a second, weaker one.

### Finding 10: the cheap path was a second, wrong implementation

`mz_page_geometry` is the viewer's scroll-layout source under L21. MediaBox went
through `pdf_dict_get_inheritable`; three lines later /Rotate went through
`pdf_dict_get_int`, which sees only the leaf's own key. /Rotate is inheritable.
/CropBox was never read at all.

It now calls `pdf_page_obj_transform_box` and applies the transform, which is
literally what `pdf_bound_page` does — so the cheap path is the same arithmetic
on the same two values as the expensive one, not an approximation of it. That is
what lets the proof assert they agree *exactly*.

Mutation-tested by restoring the old reads. The proof goes red with the audit's
own numbers — nested pages 3–5 report `600x800 rot=0` against bounds `800x600`,
cropped pages report `600x800` against `300x400` and `500x200` — and **the flat
fixture still passes**, which is exactly how this survived being "executed once".

### Finding 25: the comment was a claim, and it was false

With the 1.28.0 source back, all three of the audit's "unverified, stated as
such" suspicions are confirmed: `pdf_clear_xref` walks every entry of every
subsection of every section while the loop walked one resolved entry per object
number from `xref_base`; `pdf_get_xref_entry_no_null` can solidify the xref, so
a *counting* function could rewrite what it measured; and that accessor throws
rather than returning NULL, making the NULL branch dead.

The cheap branch was to delete the sentence. That leaves the property
unverified, so the claim became an equation instead:
`cached_after == cached_before − droppable`, taken by censusing twice around the
purge. A classification that drifts from upstream now stops balancing.

**The fixture took two attempts, and the first was wrong in a useful way.** I
built the differential by saving incrementally *to disk* and measured 25 cached
objects — identical to the flat original. A shadowed entry has no cached object
until something loads it, so a second on-disk section changes nothing. The
difference needs an **in-memory** edit, which opens a fresh incremental section
while the originals stay cached in the older one. That fixture reports 26
against 25 from identical bytes.

Worth stating because it nearly slipped: the equation alone cannot prove the
population is right — a walk that undercounts *consistently* still balances — so
the bound is asserted separately.

### Findings 24 and 37

`grep -c fz_var` returned 0. Exactly three locals qualify and the rest genuinely
do not, so the rule is now in the file header rather than left to be re-derived.
Of finding 37's five items, two were already closed by the instrument rebuild;
the three that survived were an MZ_ERR path that left the *previous* failure's
message in the buffer, a shrink that reported success for a no-op after casting
−1 to unsigned, and an `fz_try` around `fz_drop_document` that MuPDF's own
header settles — "Do not call anything in the fz_always() section that can
throw", and MuPDF calls `fz_drop_*` from `fz_always` throughout.

The rebuilt shim reproduces ADR-0010 exactly: 155,548,924 bytes allocated and
freed, 1,547 blocks each way, imbalance 0.

---

## 2026-08-17 — Batch 3: what the guards were actually guarding

Five audit findings, five commits, and a stage audit that found a sixth defect
nothing had failed on. Every mechanism below was measured against the pinned
gitleaks 8.30.1 in throwaway repositories under the OS temp directory — never in
this tree, because a credential-shaped string here is one `git add -A` from a
permanent public commit whether or not it is synthetic.

### The suppression channels: there were four, and one has no flag

The finding said three. Measurement found four, and the shape of the fourth is
what mattered:

| Channel | Effect | What closes it |
|---|---|---|
| inline `gitleaks:allow` comment | exit 1 → 0 | `--ignore-gitleaks-allow` |
| `.gitleaksignore` fingerprints | exit 1 → 0 | **nothing** |
| `GITLEAKS_CONFIG`, `GITLEAKS_CONFIG_TOML`, untracked `.gitleaks.toml` | exit 1 → 0 each | `--config`, measured to outrank all three |
| `--baseline-path` | exit 1 → 0 | never passed; a baseline file present is not picked up implicitly |

`--gitleaks-ignore-path` looked like the answer for the second row and is not:
it **adds** a location rather than replacing one, so a repository with its own
`.gitleaksignore` still exits 0 with `-i` pointed at an empty directory. The
file is also read from the scan target's root as well as the working directory,
and — the part that settles it — **it works while untracked and gitignored**, so
no check on staged or tracked content can ever see it. A purely local file, in
nobody's diff, silently disarms the hook for whoever has it.

With no flag available, the only honest closure is to refuse: the scan does not
run while a `.gitleaksignore` exists. That is not a workaround standing in for a
missing check. It is the fail-closed direction for a scan that has been told
what to overlook, and the alternative is a green check over the credential it
was told to ignore.

### `[extend]` is load-bearing, and its absence still exits 1

A `.gitleaks.toml` without `[extend] useDefault = true` **replaces the entire
default ruleset**. Measured on a corpus holding a Slack token and a PEM key:

```
no config                     slack-bot-token, private-key
one custom rule, no [extend]  the custom rule ONLY
one custom rule + useDefault  all three
```

The middle row still exits 1 and still prints a finding. It looks exactly like a
working scanner while every built-in rule has been switched off. This is why the
canary asserts specific rule IDs and not a non-zero exit — an exit code cannot
tell those two rows apart, and neither can a human reading CI output.

### The canary, and the value it caught first

The check being replaced ran `gitleaks version` and treated exit 0 as evidence.
That establishes that a process starts. It says nothing about the ruleset, which
is the entire product, and is precisely what differs between the pin and
whatever a package manager put on PATH.

Six shapes across five families this project actually holds — signing key, CI
token, cloud object store, cloud connection string, both AI providers — each
asserted by the rule ID **measured** from 8.30.1. No complete shape is stored:
each is assembled at runtime from a prefix and a deterministic SHA-256 body.

That discipline immediately corrected a canary rather than the scanner. An AWS
body containing `0` never matched at any filename, even with the rule
force-enabled — because a real access key ID is base32 and `0` is not in that
alphabet. Bisecting one character at a time found it. Asserting that value
unchecked would have produced a permanently red canary, blamed on the binary.

**The default ruleset catches no AI provider key at all** — zero findings for
both Anthropic and OpenAI shapes under every built-in rule, `generic-api-key`
included. Stage 9 registers AI providers. Three rules were added now, because
the gap is in the scanner today and a key pasted into a scratch file is
permanent the moment it is pushed.

### Latency, because a slow check is a skipped check

| | before | after |
|---|---|---|
| pre-commit hook, warm | 2603 ms | **2053 ms** |
| canary contribution | — | 106 ms (cached) |

The canary costs one scan per *scanner*, not per commit: the verdict is keyed on
the binary's SHA-256. Deleting the now-redundant `gitleaks version` spawn from
resolution — the exit-status check finding 04 is about — more than paid for it.
Verification is strictly stronger and the most frequent action in the project
got faster.

### What the stage audit found

**The cache key was incomplete.** Keyed on the binary alone, it ignored the
configuration — so removing `[extend] useDefault = true` would have kept reusing
an "ok" recorded before the ruleset was switched off, on every commit, until the
binary itself changed. CI would have caught it (the proof forces a re-measure);
the hook would not, and the hook runs before the mistake is permanent. Same
shape as finding 32 and the `pdf_subset_fonts` verdict: a claim resting on the
current state of something else with nothing that fires when it changes. The
configuration's bytes are now part of the key.

**A proof pair was vacuous, and its own control said so.** Finding 17's first
attempt used the staged scope and passed identically with and without the fix,
because `git diff --cached` reports the whole index from anywhere. Only
`git ls-files` defaults its pathspec to the working directory — so the exposed
scope was `--tree`, the CI mirror, the one check that inspects everything
already committed. In this repository: **3 tracked paths listed from
`packages/ui`, 100 from the root.** A guard examining 3% of the tree and
printing a clean bill is worse than no guard, because someone is relying on it.

**A parameter was decorative.** `divergenceNotice` took `pinnedVersion` and
decided from a precomputed boolean, so two different versions produced the same
answer. The resolution test caught it — feed an instrument two values that must
differ and confirm it says so, before trusting it.

Every fix was mutation-tested. Removing the root resolution turns the tree case
red with the guard accepting a tracked Windows executable. Reverting the publish
decision to the flag turns the repair case red, and prints
`gitleaks 8.30.1 ready at …` over a file that cannot run. Removing
`--ignore-gitleaks-allow` turns four cases red including the canary.

### Not verified, and worth naming

The canary has only run against the pinned build. Catching a scanner that is
*not* pinned is its entire reason to exist, and that path is exercised only by
passing a version string the result cannot match. `commandPath`'s PATH-lookup
branch is likewise unexercised, since every current caller resolves an absolute
path.

---

## 2026-08-17 — A full audit, and what "harmless today" turned out to be worth

A multi-agent audit of the whole repository found **43 defects behind an
all-green board** — lint clean, typecheck clean, 27 tests passing. 67 candidates
were raised, 5 refuted, and two checks were proven unable to fail. The full
report is published as an artifact; this records what it changed and what is
owed.

### Severity re-rated: reachability is not a severity argument

Several findings were rated low or medium because the code they affect does not
exist yet. One of them cost a build within a day of being written.

**Finding 32** — `proof:provision` deleted the whole `.tools` root rather than
the gitleaks subtree it owns — was rated **low**, on the reasoning that `.tools`
held only gitleaks so the blast radius was empty. It stopped being empty the
moment a second provisioned artefact existed. Running that proof while MuPDF was
downloading deleted a 69 MB in-flight archive, and the failure surfaced as an
unrelated `ENOENT` on rename **inside the other provisioner** — an error naming
neither the proof nor the cause.

The mechanism is general: *an empty blast radius is filled by ordinary progress,
and the finding is not re-examined when it fills.* So every severity that rested
on reachability rather than on a test is re-rated on the same principle — the
question is not "is this reachable today" but "what makes it reachable, and is
that thing on the plan":

| Finding | Was | Now | What fills the radius |
|---|---|---|---|
| 32 `.tools` root deleted | low | **high** | already happened; fixed in b615779 |
| 12 guards CI on ubuntu only | medium | **high** | already true; Windows is the target platform |
| 09 / 21 runtime bans by subpath | high / medium | **high** | installing electron or react — Stage 0 exit |
| 36 ESLint ignores vs `.gitignore` | low | **medium** | the first Electron build |
| 31 React lint rules asserted, absent | medium | **medium**, but do it now | the first `.tsx`; B9 says these cannot be retrofitted |
| 22 kernel declares WASM mupdf | medium | **medium** | unchanged; it is a manifest lie today, not later |
| 23 allocator counters | medium | **medium** | a second `mz_init`, which the utility process will do |
| 24 missing `fz_var` | medium | **medium** | any MuPDF throw; error paths are not hypothetical |
| 18 corrupt binary wedges provisioning | medium | **low** | genuinely external — AV quarantine, shared checkout |
| 42 `.nvmrc` referenced, absent | low | **low** | unchanged, but it fires on a cold machine |

Two ratings went *down*, which matters: this is a re-rating, not an inflation.

### Deferred, with the stage each is owed to

Each carries a case that fires when it becomes reachable, so none can be
forgotten the way `guardStagedFiles.mjs` was — wrong on the day it was written
and carried in two documents for the project's whole life.

- **`import-x/no-cycle` does not fire** (finding 08, second half). The missing
  resolver was one cause and is fixed — `no-unresolved` and `no-self-import` both
  work now, verified. Something else keeps `no-cycle` inert; `maxDepth` default,
  `Infinity` and `10` all behave identically. `boundaries.proof.mjs` asserts the
  BROKEN behaviour, so the day it starts working the proof goes red and whoever
  sees it inverts the case. **Owed: Stage 1**, or sooner if a cycle bites.
- **The ADR-0010 leak claim cannot be re-measured as written.** "0 live blocks
  and 0 live bytes after the context is dropped" came from the global counters;
  with correct per-context accounting the question is not representable, because
  the accounting lives inside the context being dropped. Monotonic
  allocated/freed totals, per context and globally, are the design that keeps it
  — **owed with the next instrument commit**, not deferred to a stage.
- **`mz_page_geometry`, `mz_store_size` and the allocator counters were measured
  once against a DLL that no longer exists** (findings 10, 11, 23). Two are now
  rebuilt and validated; the geometry one is not. **Owed: Batch 4.**
- **Eight historical `docs/JOURNAL.md` blobs carry the resolved escape
  sequences** and cannot be removed — B10 forbids the rewrite and git retains
  them by hash regardless. Listed by SHA in `KNOWN_HISTORICAL_BLOBS`, exempt in
  the history scope only, and the count is printed on every run. The sanctioned
  repair is `45eb4fb`.

### The pattern the audit named

Two shapes account for most of the 43. Guards built against the easy shape and
never re-tested against the hard one: a control character at byte 16 but not at
byte 26,635; a bare specifier but not a relative path into `dist`; a flat repo
but not a type change; an exact filename but not a suffix. And fixes that closed
one instance and left the class open: the extractor fixed on Windows only,
`.probe/` ignored for one proof and not its sibling.

Both ship green, which is why the class fixes went in first — generating the
boundary cases from `ALLOWED_IMPORTS` turned 11 hand-written cases into 148 and
immediately caught 40 route failures that no hand-written list had covered.

---

## 2026-08-17 — Handle lifetime, settled before DocumentService was written

"Released on close" also means *only* on close, and releasing pages as you
scroll was already proven not to help. So a session grows as the user visits
pages and never shrinks. `DocumentService` owns handle lifetime, so this had to
be decided before it existed rather than discovered afterwards.

**Scrolling is linear, not accelerating.** Visiting pages in viewport batches of
ten, every batch adds exactly 25.2 MB — a constant 2.52 MB per page, matching
the full-walk figure of 370 MB over 141 pages. The fixture is deliberately
pathological (900 annotations per page); the point is the *shape*, and the shape
is a straight line.

**Close and reopen is the only lever, and it works.**

| | 141-page fixture | 2260-page fixture |
|---|---|---|
| live before close | 317 MB | 532 MB |
| after close | 0.5 MB | 0.5 MB |
| after reopen — the floor | **5.9 MB** | **86 MB** |
| close | 668 ms | 760 ms |
| reopen | 28 ms | 304 ms |
| first page afterwards | 121 ms | 1654 ms |

Memory returns to the open-cost floor. The user-visible cost is not the reopen
itself but re-reading the page they are looking at, which on a 2 million object
document is 1.65 s — enough to matter, so this is not something to do at an
arbitrary moment.

**What a reopen loses, measured rather than assumed.** An unsaved rotation is
**gone** after close and reopen, and comes back only by replaying the command.
Nothing else on the handle is authoritative.

So the rule, now in §2 and invariant 22: **an engine handle is a cache, never
the truth.** It can be dropped and rebuilt between commands because canonical
bytes and the command log live in main. The condition that places on every
command: no mutation may exist only on the handle — a command that cannot be
replayed cannot be issued.

**No memory limit or recycling schedule was added.** The host containment budget
already decides when to recycle, and the same reopen-and-replay path already
serves the kill-and-restart response and failed-save recovery. One route,
reached three ways; a second number would have been a second policy for one
concern.

---

## 2026-08-17 — The memory limit was an engine choice, not a constraint

**The whole of the previous day's memory work was answering the wrong question.**
Two ADRs were written designing policy around MuPDF's 2 GB ceiling — an
admission gate, a two-term cost model, size bands — and nobody asked whether the
ceiling had to exist. It did not. It is a property of the **WASM build**, which
cannot read from disk and so copies whole documents into a capped sandbox.

Native MuPDF, same version 1.28.0, bound through a thin C shim and koffi:

| | WASM | native FFI |
|---|---|---|
| open a 405 MB document | 1293 MB | **1 MB live** |
| open 464 MB / 2.04M objects | — | **144 MB** |
| save that file | **FAILED** (`realloc`, 2 GB cap) | **304 MB, 4.5 s** incremental |
| mutation on a held handle | — | **0.004–0.024 ms** |
| spawn `mutool` per operation | — | 443–3745 ms |

Recorded as [ADR-0010](DECISIONS/0010-native-mupdf-through-an-ffi-shim.md).
ADR-0007's model, gate and ceiling are withdrawn; ADR-0001's stated AGPL
mechanism is corrected while its conclusion stands.

**Three things had to be executed rather than reasoned about.** A resident
`mutool` process is impossible — its stdout is block-buffered over a pipe and
MuJS has no flush, so a request/response protocol deadlocks; proved with a
minimal case where nothing arrives until the process exits. The prebuilt archive
ships three statically linked executables and no library, so the shared library
is built from source. And `fz_try`/`fz_catch` is `setjmp`/`longjmp`, so every
pair stays inside one exported shim function — a `longjmp` through koffi's
frames is undefined behaviour. Containment verified by forcing a failure and
watching the process survive with an error code.

**The object-graph memory question, closed.** MuPDF holds a page's parsed object
graph for the document's lifetime — 370 MB across 7.1 million allocations for
127,000 annotations. Ruled out by measurement, not argument: not the resource
store (0 bytes at every checkpoint), not the glyph cache or store items (the
full documented purge surface, three passes, freed nothing after the first
48 MB), not `fz_document.open` (holding 141 pages then releasing them empties
the list and reclaims 8 MB of 378; in release mode the list never grows and
memory still reaches the same 370 MB), not a leak (0 live blocks after context
drop), and not Windows withholding freed memory (working set returns to
baseline, and tracked private commit within 5% throughout). It is a cache: a
second pass allocates nothing, purging is counterproductive, close reclaims
everything, and no engine change avoids it.

**And the number that made it look alarming measures a workload the app never
runs.** Scroll layout reads geometry from the page dictionary: 10 MB against
370 MB on the dense fixture, 152 MB against 4.07 GB on the 2,260-page one.

**Two instrument bugs, both of which produced confidently wrong numbers.** A
`setInterval` peak sampler cannot fire while a synchronous FFI loop holds the
event loop, so a walk that costs 526 MB reported 63 MB — reproducibly, on every
run. And a spike case whose verdict was a literal `false` could never go red.
Peaks are now marked explicitly inside the loop, and live bytes come from an
allocator hook installed through `fz_new_context` rather than from RSS.

---

## 2026-08-16 — The Stage 0 memory gate, measured before it was built on

**The gate as written fails, and it is not a main-process problem.**

Part G's "peak RSS < 1.5× file size" was measured against `mupdf@1.28.0` before
`DocumentService` was written, because it constrains the engine seam and
discovering it afterwards is the failure this project exists to prevent.

On a 160 MB document, one rotation, full save: peak **5.11× file size**, of
which 4.64× scales with the document. The mechanism, read out of `mupdf.js` and
confirmed by the numbers: `openDocument(path)` does `readFileSync` and then
copies into the WASM heap, so two whole copies exist at once (2.99×); the heap
copy stays resident because object loading is lazy and reads from it (1.74×
floor); any save builds a **complete second image** in the heap (4.11×); and
`asUint8Array()` returns `HEAPU8.subarray(...)`, a view, so the copy-out K.1
mandates adds another 1×.

**Incremental save does not rescue it.** It works — 201 bytes appended for one
rotation, reopens correctly, `countVersions()` 1 → 2 — and RSS still rose
444 MB during the call. The on-disk delta is small; the in-memory
materialisation is not. Worth having for signatures, useless as a memory remedy.

**And then the unit itself turned out to be wrong.** The ratio was not
monotonic — 3.70× at 200 MB, 4.31× at 400 MB, 3.21× at 657 MB — so two fixtures
of the same size and opposite content profile were measured before any budget
was written as a multiple of file size. A 405 MB **image-heavy** document (53
objects) peaks at 3.71×. A 28 MB **object-dense** document (127K objects) peaks
at **20.9×**. A 464 MB object-dense document **fails outright**, inside
`loadPage` during the page walk, never reaching the save — where a 657 MB
stream-heavy document succeeds.

Content is the driver; file size is the wrong denominator. The model that fits
every fixture is `(stream bytes × ~3.7) + (object count × ~4 KB)`, and
`countObjects()` costs nothing (RSS identical either side of the call), so
admission can read both terms before loading a page. **Both the model and the
admission gate built on it were withdrawn the next day** — the 4 KB term was
WASM materialising objects eagerly, and the same document opens natively at 45
bytes per object. Left standing as what was believed on the day; the entry below
records the retraction.

The non-monotonicity has a separate and duller cause: RSS is the allocator's
high-water mark, not live bytes. Once the heap grows to absorb the open spike a
later save reuses that space — in the image-heavy run, RSS after the save
(1099 MB) sits *below* RSS after the open (1202 MB).

This is also why the recovery path matters more than any threshold. The
hypothetical raised against the first draft — "a 450 MB object-dense document
that passes the size gate, the user works for an hour, the save fails" — turns
out to be measured fact at 464 MB.

**The hard ceiling is a fact, not a policy — and it is profile-specific.** `mupdf-wasm.wasm` declares
`maximum=2048MB` in its memory section. Escalating trials, each in a fresh
process: **~657 MB opens, edits and saves; ~679 MB fails** with
`realloc (551620174 bytes) failed`. It fails at **save**, not at open — opening
alone still succeeded at 700 MB. So a document can open and be read long after
it has become too large to write back, which is why the ceiling has to be
stated up front rather than enforced at the moment a user tries to save.

Recorded as [ADR-0007](DECISIONS/0007-memory-budgets-and-the-document-size-ceiling.md).
Budgets are now **per process** and each is argued from what the process is
for, because a budget derived only from the measurement it constrains can never
fail — main ≤ 1.5× as a design constraint, the MuPDF host ≤ 6× as a containment
limit whose breach means kill-and-restart, the renderer ≤ 2.5× — that last
figure **withdrawn the next day** by ADR-0007's own correction, because it had
no derivation; invariant 17 now makes the renderer budget provisional and
two-term.

> The sentence above is left standing rather than edited, because what was
> believed on the day is the record. Only the forward pointer is added — and it
> was added because the withdrawn-phrase check flagged this line, not because
> anyone re-read the entry. The audit itself listed only the FEATURES.md row.

**A second rule fell out of the same measurement.** Save mode is decided by the
*purpose* of the save, never by a default: never incremental for removal
(redaction, sanitize, flatten, encryption change, metadata scrub, password
removal), because an incremental save appends and leaves earlier revisions
readable by walking the xref chain — a redaction saved that way is recoverable,
which is how real organisations have leaked documents. Always incremental where
a signature must survive, because a full rewrite changes the byte ranges it
covers. Full rewrite otherwise, for now.
[ADR-0008](DECISIONS/0008-save-mode-is-determined-by-purpose.md), invariant 19.

**And an invariant turned out to be assumed rather than measured.** L5 says a
save never rewrites annotations the app did not author, "byte-identical". The
spike only proves the foreign annotation *survives* a save, which is strictly
weaker. A full rewrite re-serialises every object, so if MuPDF normalises
encoding or compression on round trip, L5 is already violated by the mode we
default to. That check is cheap, it can invert the save-mode decision, and it
runs first.

---

## 2026-08-16 — Stage 0 opens

**First actions (Part G), in order.**

1. Committed `BUILD-PROMPT.md` and `DESIGN-DRAFT.html`. Both are plain text
   carrying no secret, binary or fixture, so nothing in them was a thing the
   not-yet-existing guards could have caught.
2. Committed the pre-commit guards, their proofs, and the CI mirror. The
   ordering is the point: the guards exist before there is anything they could
   fail to catch.

**Decisions taken with the owner.**

- Repository is public with GitHub secret-scanning push protection enabled,
  confirmed before the first push. Retained-by-hash permanence is exactly why
  it cannot be enabled retroactively.
- The supplied `logo.png` is the official logo, used as-is; the earlier
  circular-mark-plus-wordmark treatment is withdrawn. Recorded as
  [ADR-0002](DECISIONS/0002-brand-mark-treatment.md) because it amends design
  law, and B4 does not exempt the design system.

**Mechanisms found, not patched around.**

- *Line-ending churn.* The founding-document commit emitted
  `LF will be replaced by CRLF`. Root cause: no normalisation policy was
  declared, so each clone's `core.autocrlf` decided independently what landed in
  a blob and identical source churned between checkouts. Fixed with
  `.gitattributes` (`* text=auto eol=lf`), with hooks and shell scripts pinned
  to LF because Git for Windows' `sh` reads a trailing CR as part of the command
  word and dies with `bad interpreter`.
- *Hook root resolution.* `preCommit.mjs` initially derived the repository root
  from its own file location. A git worktree keeps its checkout outside the main
  clone, so that path would have pointed the scan at the wrong tree — reporting
  success for a tree nobody committed to. Now asked of
  `git rev-parse --show-toplevel`.
- *No pinned gitleaks build for every platform.* `BUILDS` covers five
  platforms; linux-armv7 and the 32-bit targets have published releases but no
  pin, leaving a contributor there with no route to a working hook at all.
  Closed with a `MONSTERA_GITLEAKS` override that is still verified by spawning
  it — it selects a binary, it does not excuse one from working.

**Verification, not assumption.**

- Every gitleaks archive digest was taken from the release checksums file **and
  independently recomputed locally** before being pinned. A summarising model
  transcribing 64-character hex is a silent-corruption risk not worth taking.
- `gitleaks protect` no longer exists in 8.30; the staged-scan invocation is
  `gitleaks git --staged`. Checked against `--help` rather than recalled.
- `actions/checkout` and `actions/setup-node` were both at versions **two and
  one majors newer** than assumed. Both are now pinned by commit SHA, not by
  tag: a tag is mutable and its target runs with the workflow's token, which is
  the same class of risk as an unpinned binary download.
- The guard proofs were run against three deliberate mutations of the guard
  (size limit raised, magic-byte detection disabled, allowlist widened) and each
  turned them red. A proof that cannot fail proves nothing.
- **Every dependency version was fetched live, and the assumptions lost badly.**
  Of the versions that would have been written from memory, `actions/checkout`
  was two majors stale, `actions/setup-node` one, ESLint was at 10 rather than
  9, TypeScript at 7 rather than 5, and Vite at 8 with Rolldown. None of that is
  recoverable by recall; all of it is one registry fetch away.
- **Two "latest of everything" conflicts, found before any code depended on
  them.** `typescript-eslint@8.67.0` — published six days ago, so plainly
  current — peers `typescript >=4.8.4 <6.1.0`, which excludes TypeScript 7's
  native rewrite, and adopting 7 would mean no type-aware linting at all, which
  is the only thing that actually enforces B7's `any`-is-an-error rule. And
  `electron-vite@5` stable peers `vite ^5||^6||^7` while its Vite 8 support has
  sat in a beta since April. Both put to the owner with the tradeoff stated;
  both decided by them, recorded as
  [ADR-0004](DECISIONS/0004-toolchain-versions.md).
- **Package renames produce confidently wrong conclusions.**
  `@base-ui-components/react` is frozen at `1.0.0-rc.0` and carries an npm
  `deprecated` field reading "Package was renamed to @base-ui/react". The live
  package is at **1.7.0**, eight stable minors past 1.0. Querying the old name
  yields "Base UI is still in RC", which this project believed for about ten
  minutes. Recorded in [ADR-0005](DECISIONS/0005-ui-foundation-libraries.md)
  alongside the finding that Radix ships **no combobox and no autocomplete**,
  which is what actually decided the primitive library.
- **The AGPL obligation is wider than the npm licence fields say.** A licence
  audit across every direct dependency found no GPL-2.0-only conflict and no
  misdeclared licence, but it did find that `electron`'s "MIT" covers only
  Electron's own source: the shipped binary aggregates Chromium, Node.js and
  **FFmpeg (LGPL-2.1-or-later)**. All compatible, but `LICENSE` and
  `LICENSES.chromium.html` must ship and corresponding-source duties extend to
  them. Also recorded: only `electron` and `electron-updater` are actually
  conveyed to users, so the generated NOTICE must reflect the
  distributed-versus-build-time split rather than listing the whole tree. And a
  full transitive scan is still owed — beneath `electron-builder`
  (`app-builder-bin`, `7zip-bin`, NSIS stubs) is where a GPL-2.0-only package
  would realistically hide.
- **"Latest" is not always the highest version.** `electron-builder`'s `latest`
  tag points at 26.15.3 while 26.15.7 sits on a `v26` tag, four patches ahead
  and deliberately unpromoted. Two sources disagreed about which was current and
  a direct dist-tag read settled it. The pin follows `latest`, because a release
  the maintainers declined to promote is one they declined to recommend.
- **The writer-of-record matrix looks wrong in two rows, and its pdf-lib
  dependency is five years cold.** MuPDF 1.28.0 declares `rearrangePages` and
  `bake(bakeAnnots, bakeWidgets)` — page reorder and form flattening, both of
  which the founding matrix assigned to pdf-lib on the stated grounds that MuPDF
  lacks them. pdf-lib's last release was 2021-11-06. **The matrix is not amended
  on this evidence**, because §3.1 requires each row to be *executed* against a
  real document and a type declaration proves only that an API is declared.
  Written up as hypotheses in [`ENGINE-SPIKE.md`](ENGINE-SPIKE.md) for the
  Stage 0 gate to test, which is precisely the job that gate exists to do.
- **CI was red on all three pushes, and only checking said so.** The badge had
  not been looked at; the assumption was that green locally meant green in CI.
  Root cause: `preCommit.proof.mjs`'s pass-path case needs a working scanner —
  the gate is *designed* to block without one — and the workflow ran the proofs
  before anything provisioned gitleaks. Reproduced locally by parking `.tools`.
  Fixed at the class rather than the instance: every entry point now provisions
  what it needs, so the steps are order-independent. A step order that must be
  remembered is one that will eventually be got wrong.
- **A second, unrelated defect surfaced during that investigation.** Timestamps
  showed `.tools` being rebuilt mid-test, leaving a stray archive that the
  success path deletes. `provisionGitleaks` cleared the destination and
  extracted into it, so two concurrent provisioners — CI steps, a hook racing a
  proof, two terminals — could have one delete the directory the other was
  extracting into. What survives is a half-populated tree that `fileExists`
  accepts. Now it builds in a per-process staging directory and publishes by
  atomic rename. This matters well beyond gitleaks: the same primitive
  provisions `pdfium.dll`, `mutool` and Ghostscript, where a half-written native
  library is a crash with no useful stack rather than a clean error. Its proof
  races three provisioners from a cold cache and checks the published binary
  *runs*, not merely that it exists; under a shared-staging mutation two of the
  three racers fail, so the proof is not vacuous.
- **The engine spike overturned two rows of the writer-of-record matrix, and
  found a defect no amount of reading would have surfaced.** Run before
  `DocumentService` rather than after, because that is where the matrix becomes
  load-bearing — `rotatePages` has to route to a writer of record, and building
  first would have shaped the kernel around claims that turned out false.

  Two of the founding matrix's three stated justifications were wrong: MuPDF
  *does* have a page-reorder primitive, and it *can* flatten form fields. But
  the finding that mattered was behavioural. **`rearrangePages` drops
  `/AcroForm`** — even when passed the identity permutation, so merely calling
  it destroys a form. The widget annotations survive on their pages, which is
  worse than losing them: the fields still render while the field tree is
  orphaned, and the document silently stops being a valid AcroForm. A plain save
  preserves it, which isolates the cause to the primitive.

  The remedy was already written down. Invariant L6 says page reordering
  rewrites the page tree *in place*. Doing exactly that through MuPDF's own
  `PDFObject` API preserves all four catalog entries. **The founding record
  predicted the failure class; only its stated reason was wrong.**

  pdf-lib is removed from the repository entirely — it held four matrix rows and
  has been unmaintained since 2021-11-06. MuPDF now covers two of them, and
  `@cantoo/pdf-lib` covers the rest. Fewer writers is a simplification, not just
  a substitution.

  The spike is kept and runs in CI as a regression gate rather than being thrown
  away: each case records the verdict the matrix depends on, so an engine
  upgrade that changes any of them turns the build red instead of quietly
  invalidating the architecture.

- **A doc-editing script silently corrupted a committed file.** A Python
  heredoc used a non-raw string containing a Windows path; `\a` and `\b`
  resolved to BEL and BACKSPACE, so `C:\a\b.pdf` was committed as two control
  characters. It renders as `C:.pdf` — the characters appear to *vanish* rather
  than look wrong, which is why it survived review and two further edits.

  The instance was repaired, but the class is what matters: any escaping bug in
  any tool can write invisible characters into a text file, and a public
  repository keeps them forever. The pre-commit guard now rejects C0 control
  characters in text files, excluding tab, LF and CR. Proven with a control
  case, since a guard that also rejected tabs would reject most of the
  repository.

- **The stage audit found a data-loss risk on its first run.** Written into
  `CLAUDE.md` and applied immediately to `CapabilityRegistry`. The question that
  caught it was item 2 — *was this verified against the easy shape only?* The
  easy shape is a well-formed path string; the hard shape is the same file named
  three different ways.

  `C:\a\b.pdf`, `C:/a/b.pdf` and `c:\A\B.PDF` are one file on Windows and mint
  three handles, because idempotency is keyed on the string. Harmless in the
  registry — every handle resolves to a path that reaches the file — and a
  data-loss bug one layer up: if `DocumentService` decides "already open?" by
  handle or raw path, one file becomes two documents with two command logs, and
  the second save silently discards the first's edits.

  Canonicalisation was deliberately **not** added to the registry. It is
  fallible (per-volume case folding, symlinks, UNC, 8.3 names) and needs I/O
  that a not-yet-existing Save As target cannot supply, so putting it inside a
  security primitive would make that primitive's correctness depend on a
  normaliser's. The behaviour is pinned by a test that explains why, and
  identity becomes `DocumentService`'s job via `fs.realpath`.

- **A defect that changed with the terminal.** Provisioning gitleaks worked from
  PowerShell and failed from Git Bash, from identical code. Windows has two
  programs called `tar` and they are not interchangeable: **bsdtar** in System32
  reads zip and tolerates `C:\…` arguments; **GNU tar** from Git for Windows
  reads neither — it parses a colon as a remote `host:path` and cannot open a
  zip at all. `spawnSync('tar')` picks whichever PATH offers first, so which
  implementation ran depended on the shell that launched the process.

  This is the worst shape of bug for an open-source project: CI never saw it
  (the guards job runs on Linux, where paths carry no colon and the assets are
  tar.gz), so it was waiting specifically for a contributor on Windows using
  Git Bash. Fixed by naming the binary explicitly rather than letting PATH
  choose, with a legible error if bsdtar is absent. GNU tar's `--force-local`
  was rejected: it fixes GNU tar and breaks bsdtar, which does not accept the
  flag.

- **The gitleaks platform map covered five of ten published platforms.** The
  `MONSTERA_GITLEAKS` override had been introduced to give contributors on the
  other five a route — which is an override standing in for a missing pin, a
  workaround with a config flag on it. All ten are now pinned, each digest taken
  from the release checksums **and** independently recomputed. `linux-arm`
  additionally resolves armv6 versus armv7 from the ABI Node was compiled
  against, since `process.arch` reports only `arm` and an armv7 binary does not
  run on armv6 hardware. The override remains, narrowed to its real purpose: a
  platform the release does not publish at all.

- **Re-verifying the spike's own conclusion found it half-wrong.** The owner
  pushed back on how confidently the pdf-lib removal had been asserted, and the
  push-back was correct. Separating what had been *executed* from what had been
  *asserted* left three claims in the "asserted" column, and one of them was
  load-bearing.

  The in-place page reorder had been proven against a **flat** page tree only,
  and written up as "rewrite the `/Kids` array, touching nothing else". On a
  **nested** tree that is wrong twice over: it permutes subtrees rather than
  pages (a six-page document in two branches came back `4 5 6 1 2 3`), and it
  drops attributes leaves inherit from intermediate `/Pages` nodes — a landscape
  page silently becomes portrait while the page order still looks right.

  The correct algorithm pushes inheritable attributes down before flattening.
  Both tree shapes are now in the spike, the wrong approach recorded as REFUTED
  so nobody re-derives it.

  The other two: content composition in `@cantoo/pdf-lib` had never been
  executed at all — only the package name had been swapped — and its
  "maintained" status rested on a single publish date. Both now verified (new
  documents, watermarks, image embedding, each read back by MuPDF; 116 releases
  with ten in the last six months).

  The lesson generalises past this instance: **an approach verified against the
  easy shape is not verified.** The flat page tree, the single platform's
  lockfile, the already-provisioned scanner — three times in one day the same
  mistake, which is why the guards for each are now mechanical.

- **A lockfile that resolves on one platform is not a lockfile that resolves.**
  CI failed at `npm ci` on Windows *and* Linux while the identical command
  succeeded locally, and a fresh clone of the pushed repository reproduced the
  false pass rather than the failure. Three hypotheses died before the real one
  — an out-of-sync lockfile, our own `prepare` lifecycle script, and the
  PowerShell-versus-bash shell difference — each costing a push to disprove.

  Mechanism: sharp ships one prebuilt package per platform as optional
  dependencies, and two of them (`@img/sharp-wasm32`,
  `@img/sharp-freebsd-wasm32`) depend on `@emnapi/*`. npm recorded the platform
  packages but omitted those transitive dependencies, having resolved the tree
  on win32-x64 where the wasm32 packages are never installed. `npm ci`
  validates the lockfile as a whole rather than only the parts the current
  platform needs, so it rejected the tree everywhere. Fixed by deleting
  `node_modules` and `package-lock.json` and resolving from scratch; the
  `@emnapi` packages are now top-level entries.

  Two things follow. **`npm ci` in CI is the only thing that tells the truth
  about a lockfile** — local `npm install`, and even a fresh clone, will
  happily agree with a broken one. And this recurs with any dependency shipping
  per-platform binaries, which `pdfium` and `mutool` both will.

  **Correction, two hours later: "fixed by regenerating" was wrong.** Adding
  `zod` to one workspace dropped the same entries again. The defect is not a
  one-off stale lockfile; npm re-prunes on *every* incremental install, so a
  clean regenerate repairs it and the next `npm install <pkg>` breaks it. What
  was recorded above as a fix was a repair of a symptom.

  The actual fix is mechanical, per B10's rule that safety nets are mechanisms
  and not disciplines: the pre-commit hook now runs `npm ci --dry-run
  --ignore-scripts` whenever a commit stages a manifest or the lockfile, and
  blocks on failure. Six seconds, only on commits that can cause it, and it
  uses npm's own validation rather than a reimplementation — writing our own
  lockfile walker would mean owning a second opinion about what "in sync"
  means, whose failure mode is a guard that passes broken lockfiles and is
  trusted anyway. Proven against the exact lockfile from the commit that broke
  CI.

- **CI failures were undiagnosable from outside the repository.** GitHub serves
  Actions logs only to authenticated callers, so publicly available run data
  stopped at "the Install step failed". The Install step now tees its output
  and re-emits the error as a workflow annotation, which *is* public. That is
  what ended the guessing — the annotation named the two missing packages
  outright. Kept permanently: a contributor who cannot see why a check failed
  cannot fix it, and this project wants drive-by contributors.
- The design draft's token seed was audited against M2's contrast law **before**
  being encoded, and failed it in 13 places. Root cause was not the values: the
  token file declared colours but not which foreground may sit on which surface,
  so the specified check was over-broad in one direction (failing
  `--muted` on `--accent-soft`, a pairing that never renders) and unable to
  express the other (a decorative hairline and an input's outline are the same
  token at 1.13:1, and only one of them owes WCAG 1.4.11 its 3:1). Resolved by
  [ADR-0003](DECISIONS/0003-token-role-typing-and-declared-pairings.md) before
  any token code exists. Finding it later would have meant thirteen violations
  spread across a hundred components, and the cheap escape would have been the
  blanket exemption M2 bans by name.
