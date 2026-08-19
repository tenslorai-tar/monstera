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

> **BEFORE ANY OF IT — the lockfile guard, 2026-08-19.** The lockfile itself is
> repaired (`686d1a7`) and CI can install again, but the guard for that class
> answers with whichever npm is installed and this machine's cannot see the
> defect (finding F-3). Adding a dependency is precisely the incremental install
> that produced occurrences 2 and 3, so the Electron unit runs straight at it.
> Fix the guard, watch CI go green, then start Electron. The shape is a decision
> the owner should weigh, not one to inherit — see the correction section below.
>
> **Where the list stands, 2026-08-19.** Items 1 and 2 are built **kernel-side
> and unwired** — `DocumentService`, the stateless `CommandBus`, the log on the
> record, `rotatePages` with its inverse, and §9's failure type. The immediate
> unit is the **handler and composition point**, under `apps/desktop/src` and
> importing no Electron (ADR-0009, 2026-08-19).
>
> **Then Electron, in three commits rather than one:** add the dependency · close
> the witness gap, since `in: null` stops being accepted the moment Electron is a
> dependency (`FEATURES.md`, the reachability-witness row) · then the containment
> assertion against a running host (invariant 25's row). That split follows from
> B8 and is written here only so it is not collapsed into one commit by whoever
> reaches it — adding the dependency is a working, provable unit on its own, and
> the other two are separately provable against it.
>
> **CORRECTION, 2026-08-19 — "a working, provable unit on its own" is wrong, and
> it was written without testing it.** Measured before starting: adding
> `"electron"` to `package.json` and running nothing else turns
> `check:advisories` **red**, naming both symbols, the condition and the
> remedy — the T-1 expiry firing exactly as designed, and it fires on the
> *manifest*, before any install. So a commit that adds the dependency and stops
> is a red commit, and this project does not commit red.
>
> Worse for the split than it first looks: a witness scope is a glob over
> **tracked** files (`git grep`), and `node_modules/electron` is not tracked. So
> the symbols cannot be witnessed by the dependency merely existing — they can
> only be witnessed by shipped code that *names* them, which is the host, which
> is commit 3's work. The three-commit split therefore needs re-deciding rather
> than following: either the witness entries change shape to something a tracked
> tree can satisfy, or the dependency and its first use land together.
>
> Recorded here rather than discovered mid-commit. The probe was one edit and one
> command, and it cost less than the first attempt at a split that cannot hold.
>
> ### RESOLVED, 2026-08-20 — two units, and the middle one stops being a gap
>
> **Commit 1 = the dependency AND the derivation, together.** The two Electron
> symbols move from `in: null` to **derived from Electron's own API surface**, in
> the same commit that makes deriving possible. It is green standing alone and it
> **strengthens** the check — those two symbols stop being hand-typed — rather
> than relaxing one to unblock a commit. Then commit 2 is the host, commit 3 the
> containment assertion against a running one.
>
> The register already prescribed this in its own words: *"the day Electron lands
> … the symbol list stops being hand-picked because it can then be DERIVED from
> Electron's own API surface, the way the OCR doors are derived from the engine
> source."* `node_modules/electron` is provisioned in exactly the sense
> `.tools/mupdf` is — untracked, absent where nothing installed it, and reported
> as unverifiable there.
>
> **Rejected: pointing `witness.in` at an ADR or a `FEATURES.md` row.** A string
> someone typed sitting beside another string someone typed. It proves nothing
> about Electron's API and it is the shape of a check edited until it goes green.
>
> **Rejected: the dependency landing with its first use.** That makes the first
> unit "dependency + host + containment" — three separately provable things in
> one commit (B8) — and leaves the null-witness mechanism exactly where it is.
>
> #### Measured before building, not reasoned about
>
> **1. The seam: registration, not B4 — stated explicitly rather than implied by
> the diff.** `unwitnessedSymbols` takes one derivation, `{ verified, checked,
> claim: 'ocr' }`. A second deriver keys that by claim. The register already
> models derivation as a first-class state — a third bucket beside witnessed and
> unverifiable, with its own count and its own mandatory-where-possible flag — so
> nothing new is being expressed and no seam is being bent. What changes is
> **arity**, which is the same move `WriterRegistry` and the command spec table
> already make.
>
> Two things that are **not** pure arity, called out rather than hidden inside
> "generalising":
>
> - `derived.includes(symbol)` is today a **flat** list checked against every
>   claim's symbols, so a symbol derived for one claim would count as verified
>   under another. Harmless with one deriver and a real cross-claim collision
>   with two. Keying by claim **narrows** it, which is a behaviour change in the
>   tightening direction.
> - `ocrDoorDrift` conflates two jobs: deriving symbols (feeds `verified`) and
>   **completeness** — declared-but-not-derived and derived-but-not-declared both
>   fail. The second must **not** generalise: every Electron API name is
>   "derived but not declared", and thousands of them. Electron gets the first
>   half only, and the register's existing sentence stands unchanged — *"it
>   checks spelling, not completeness"*.
>
> It would be B4 if the second deriver needed a different **kind** of evidence,
> or if `--require-derivation` needed per-claim policy. Neither: both read a
> provisioned untracked tree and answer *"does the source actually contain the
> symbol as declared"*.
>
> **2. `electron.d.ts` survives `--ignore-scripts`, and the reason is stronger
> than expected.** Measured from the published artifact rather than on a runner,
> and stated as such: `electron@43.4.1`'s tarball is 195 KB, lists
> `electron.d.ts` in its `files`, and **has no `scripts` block at all** — the
> binary download is a `bin` entry (`install-electron`), not a lifecycle script.
> So `--ignore-scripts` cannot affect whether the type surface is present; there
> is nothing for it to skip. The file is 1.1 MB and declares `utilityProcess` and
> `MessageChannelMain`.
>
> That is the artifact answering the question more directly than one runner
> could, and it is **not** a runner measurement — recorded that way rather than
> claimed as one.
>
> **And it changes commit 3, which the question did not anticipate.** No
> postinstall means `npm ci --ignore-scripts` leaves **no Electron binary at
> all**. The containment assertion needs a *running* host, so that job must
> install the binary deliberately rather than inheriting it from the install
> step. Named now so it is a step someone writes, not a surprise at the end.
>
> #### The `@types/node` collision: NEST, and the premise of the alternative is wrong
>
> **Chosen: let npm nest Electron's copy** — and it is not "whatever npm happens
> to do". Measured in a clean export with the runners' npm:
>
> | location | version |
> |---|---|
> | `node_modules/@types/node` | 22.20.1 — ours, the direct devDependency |
> | `node_modules/electron/node_modules/@types/node` | 24.13.3 — nested |
> | `node_modules/png-to-ico/node_modules/@types/node` | 25.9.5 — **already there** |
>
> Three things this establishes rather than assumes. The placement is
> **deterministic**: we declare `@types/node` directly, so npm gives our version
> the root slot and nests conflicting transitive ones. The arrangement **already
> exists** — `png-to-ico` has been nesting a 25.x all along, so "three
> `@types/node` in one tree" is the current working state, not a risk Electron
> introduces. And nothing hoists it into the global type surface: `tsc --build`
> and `tsc -p tsconfig.scripts.json` both exit 0 **with Electron imported and
> `utilityProcess` / `MessageChannelMain` used**, and that probe carries its own
> control — naming an export `electron.d.ts` does not have fails `TS2305`, so the
> module genuinely resolved instead of degrading to `any`.
>
> **The alternative's premise does not hold, and that matters more than the
> choice.** The 22-types / 24-runtime gap is not a mismatch to close: `@types/node`
> should describe the **minimum supported** runtime, which `engines.node:
> ">=22.19.0"` declares. The types and `engines` agree today. Bumping the types to
> `^24` would make them **disagree** — `scripts/` could then use a Node 24-only
> API while the manifest promises 22.19.0 works.
>
> **There is a real defect nearby and it is a different one.** `engines` claims
> `>=22.19.0` and **nothing tests it**: every CI job pins 24.19.0. That is an
> untested support claim, the shape this project treats as a finding everywhere
> else. Closing it means either testing on 22 or narrowing the claim to what is
> exercised — a decision about who can build this project, not a types question,
> and deliberately not folded into commit 1.
>
> #### The Electron binary is a second supply chain, and its verification is switchable
>
> `install.js` fetches from GitHub releases through `@electron/get`, not the
> registry — so commit 3's host cannot arrive by installing dependencies, and
> dropping `--ignore-scripts` would not help either, because there is no lifecycle
> script to run.
>
> **Measured, and it decides the design:** `install.js:45` reads
>
> ```
> checksums: process.env.electron_use_remote_checksums ||
>   process.env.npm_config_electron_use_remote_checksums ? <remote> : require('./checksums.json')
> ```
>
> — the shipped pin is the default and **an environment variable switches
> verification to a remote source**. Trusting the installer's own check would mean
> trusting a pin that an env var can replace, which is the escape hatch this
> project closes everywhere else.
>
> So commit 3 uses the primitive already built and used twice (`gitleaks.mjs`'s
> per-platform `sha256` table, `mupdf.mjs`'s `SOURCE_SHA256`): **fetch and verify
> against a hash we record**, not through `install.js`. The chain is recorded
> rather than trusted at each link — package version → its `checksums.json` →
> our pin, so bumping Electron is a diff someone reads:
>
> ```
> electron-v43.4.1-win32-x64.zip
>   c2ef9a5f65472c34d14bd3e67b7d14e66b0c01f124aba45263d6a4232160e13a
> ```
>
> That is commit 3's **design**, not a step in its YAML.

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

## 2026-08-19 — Stage audit: `f144768..81b9b2b`

**Audited through 81b9b2b.** 9 commits, 29 files, **2 proofs added, 9 modified**,
3 new instruments. The first range in this project's history audited against a
**running board** — every finding below either came from a CI run that executed,
or was found by the checklist against one.

### The range's own shape: three defects, one mechanism

G-1, G-2 and X-3 are the same failure wearing three faces: **the developer
machine has something the runner does not.**

- **G-1** — `HEAD` did not typecheck, on either platform, and the file was mine.
  A capture group is `string | undefined`; the case that failed to compile was
  the *control*. I had run `proof:toolchain`, `lint` and `test` before committing
  and not `typecheck` — and a `.mjs` file executes regardless of `tsc`, so "the
  proof passes" and "the repository typechecks" are two different questions.
- **G-2** — `NOTICE` was under-declaring **`mupdf@1.28.0`, AGPL-3.0-or-later**, a
  bundled *production* package. Not the cause it looked like: `crypto-js` is
  dev-only and never appeared there. The old lockfile marked `mupdf` `"dev":
  true` while `packages/kernel` declares it under `dependencies`. The generator
  was right the whole time; its input was wrong — the same pruned lockfile as
  F-2, with a **compliance** consequence rather than a build one.
- **X-3** — `proof:documenthandlers` found its control PDF in a **gitignored**
  directory another step happens to write. Present here, absent on a runner,
  where the proof correctly refused to be evidence. Measured: that step's
  conclusion is `skipped` on every CI run back to `d61d995` and `failure` the
  first time it executed. The proof now **builds** its control — item 4b says put
  the control in the instrument, and a control that exists only after some other
  step ran is not in the instrument.

Last range's T-1 breakage was the same shape (a derivation verified where the
engine source was provisioned). That is four, and it is now the most reliable
source of red builds here.

### X-1 — the blind spot recurred one directory over

Last range widened the audit report's proof classifier to see `*.test.ts`. Its
**instrument** column was still scoped to `scripts/` — and this range landed
`packages/kernel/src/filesystemProbe.ts`, an instrument in the plainest sense,
whose wrong answer silently disables the assertions that depend on it. The column
that exists to say *"resolution-test this"* did not mention it, and neither did I
until the checklist asked.

Fixing a classifier's **pattern** and leaving its **root** is half a fix, and
both halves report "found nothing" identically. Widened to new non-test source
under `scripts/`, `packages/*/src/` and `apps/*/src/`, with a case for the probe
and a **control that a new test is *not* listed there** — without it the widening
is satisfied by listing every added file, which makes the column the file list it
sits beside. Its first act after the fix was to name the probe.

### X-2 — and the instrument the column had missed was in fact wrong

Writing that probe's first test found it. `foldsCase` guarded against a fixture
whose name carries no case by comparing **the whole path**, and a temp directory
almost always has lower-case letters in it — so the guard passed for any fixture
and the probe was reporting whether the *directory's* name folds. A different
question with the same answer on most filesystems and the wrong one on a
case-sensitive volume holding a case-insensitive mount. Now the basename.

Found by writing the guard's first test, which is the whole argument for item 4a:
**the probe had been in use, and used correctly, while measuring the wrong
string.**

### X-4 — a proof that failed for something that was not its subject

`proof:hookprobe` asserted that `check:docs` **exits 0** either side of the
failure it induces, which couples a proof about the tool-use guard gate to every
other consistency check here. It duly went red on both platforms because the
stage-audit gate was over budget on an unrelated range, reporting the hook gate
as broken when it was fine.

It now asserts on the gate's **own message**. Absence is meaningful only because
its sibling asserts presence in the same run: if the checker printed nothing at
all, the induced-failure case fails. Mutation-tested — making the message
unseeable reddens that control alone and leaves both absence cases green.

Worth recording because it decided the shape: `documentConsistency.mjs` prints
its `ok` lines only when **every** check passes, so a positive control on this
gate's own line is unavailable while anything else is red.

### The checklist

**1. Root cause or workaround?** All root-cause. The one repair that can
regenerate is `NOTICE`, and `notice:check` guards it in CI — which now runs. The
lockfile guard itself is still blind (F-3) and still owed; nothing here papered
over it.

**2. The hard shape.** Named above and it is the range's theme. Also still
unverified: union dispatch at a second command kind, held by a compile-time
trigger.

**3. Would CI have caught it?** **G-1 and G-2 it did catch** — the first time
that sentence has been true here, and the reason both are in this record at all.
X-1 and X-2 it would not: no check reads the audit report's own classifier, and
the probe's guard had no test.

**4. Non-vacuous.** Mutations run this range: the toolchain pin at a bare major
**and** at a one-patch difference (`24.19.0` → `24.19.1` reddens both workflow
cases — the resolution test proper, which the coarse mutation alone would not
have established); `replacementVerdict` in both directions; the contract-drift
predicate in both; the workflow invocation pair; the hook-probe message. Each
reddened its own case and no other.

**4a. Resolution.** Three new instruments. `toolchain.mjs` resolution-tested at
the smallest difference that changes a decision. `contractDrift.mjs` has its
fires/quiet pair and a fail-closed control. `filesystemProbe.ts` had **none**
until this audit, and giving it two found X-2.

**4b.** X-1.

**5. Executed, or asserted?** Everything executed, including the CI runs — read
through the REST API rather than predicted. That is the correction from the
previous range applied rather than repeated.

**6. Architecture before the feature.** Yes: the `dev:ino` correction
(`0b2e9fe`) landed before the fix (`7ef7ef9`), in its own commit.

**7. Documents.** `CLAUDE.md` item 4b gains X-1's generalisation — a classifier's
root is as much a scope as its pattern. `FEATURES.md`'s `DocumentService` row
carries the write-target correction. ADR-0009 carries the `dev:ino` section.

### The buckets, with a new one

- **CI-caught:** G-1, G-2. **A category that did not exist in the previous three
  ranges**, because the board was not running. Both were found within an hour of
  the board coming back.
- **Instrument-caught, during the work:** X-3's proof refusing to be evidence
  without its control — the proof was right and the workflow was wrong, which is
  the good failure.
- **Mutation-caught:** none. All confirmed existing checks.
- **Audit-caught:** X-1, X-2, X-4.

Three audit-caught against the previous range's two. **Worse, and the reason is
worth more than the count:** two of the three are the same instrument I widened
one range earlier, and the third is a proof I wrote three ranges ago. The pattern
across four ranges is now unambiguous — *the checks are where the defects are* —
and the thing that finally started catching them at the right time is a CI board
that runs.

---

## 2026-08-19 — Stage audit: `d61d995..f144768`

**Audited through f144768.** 12 commits, 27 files. The column figures are given
twice below, because **the instrument's answer changed during the audit** and
that is this range's main finding.

As reported when the audit opened: *0 proofs added, 3 proofs modified, 0 new
scripts.* As reported after W-1 was fixed: **1 added, 5 modified** — including
`boundary.test.ts` at +312/−77 with nine deletions the range diff hides.

### W-1 — the report that scopes every audit could not see a vitest test

`isProof` in `scripts/lib/auditWatermark.mjs` matched `*.proof.mjs` and
`proofs/` and nothing else. Every `*.test.ts` in the workspace was therefore
invisible to **both** columns — and that is where most of this project's
controls live: §9's path assertions, the composition point's ordering control,
every mutation-tested pair in the packages.

Measured on this range rather than reasoned about: 254 lines of new test
carrying the range's strongest control reported as **"proofs ADDED: none"**, and
a test file whose controls had changed meaning at +312/−77 listed in no column
at all.

That is audit item 4b in the instrument that *administers* item 4b. Its output
is "found nothing", and an auditor cannot tell that from "there was nothing to
find" — while the MODIFIED column is the one this report's own comment calls the
reason it exists in this shape.

**A file-naming convention is not a check.** The fix widens the classifier and
adds three cases, and the third is the one that makes the other two mean
anything: an ordinary source file must land in **neither** column. Without it,
"counts tests" and "counts every changed file" pass identically and the column
becomes the file list it sits next to. Both mutation directions run: narrowing
the pattern back reddens the two W-1 cases alone; widening it to accept
everything reddens the control and the new-scripts case alone.

Its first act after the fix was to surface nine hidden deletions in
`boundary.test.ts` — U-2's mechanism paying out on the first range it could see
tests. Read: they are the pre-§9 boundary cases that asserted `error.message`
and `error.cause`, removed by `4a9ac84` because those fields no longer exist,
plus my own fixture rewrites. Nothing was lost quietly.

### W-2 — the contract proof holds its fixtures as STRINGS, and it drifted twice

`scripts/proofs/contract.proof.mjs` compiles handler-map and client-stub source
held in template literals. That is what a compile-fail proof *is* — it asserts
the shapes TypeScript must reject, which no compiling file can express — and it
is also why `npm run typecheck` cannot see inside it. So the contract's types
have **two** implementations and only one is in the fast loop.

It drifted twice, in this one range:

1. `4a9ac84` changed `Handlers` to return a `Result` and left four cases stale.
   The proof was **red on `main` for three pushes** while `typecheck` and `test`
   were green — and they were right to be, because `boundary.test.ts`'s own
   fixture map was rewritten in the same commit. Only the copy inside the
   strings was orphaned.
2. Adding the `document.execute` channel left three more stale — about an hour
   after the first was found and written up, by the person who had just written
   it up.

Twice is a class, and the second occurrence is the argument: *"run the proof
when you touch the contract"* is a rule that has to be recalled at the moment a
command is composed, which this project has already measured the worth of seven
times over in `CLAUDE.md`'s standing rules.

**So it is a mechanism now.** The pre-commit gate runs `proof:contract` when —
and only when — the commit stages a contract, shared or kernel **source**. Not
documents, not tests: tests are read by `typecheck` like any other file and
cannot change what the proof compiles against. It costs about **50 seconds** on
those commits and nothing on any other. It adds no coverage, since CI already
runs the proof on everything; what it changes is *where the failure lands* — a
blocked commit instead of a red `main` nobody reads. Four cases, including a
control that it stays quiet for documents and tests, and a fail-closed control
executed rather than asserted: pointed at a directory git will not answer for,
the predicate must return **true**. `root` is injectable for exactly that
reason, the same argument `IdentityReader` carries.

Also fixed while here: `packages/contract/src/channels.test.ts` implements the
**real** channel map for the first time. Every other map in the tree is a
fixture, so nothing had ever asked whether the shipping contract can be
satisfied at all.

**If the 50 seconds is not worth it, remove the gate rather than weakening it** —
a conditional check that got quietly narrowed until it stopped firing would be
worse than none, because the record would still say the class was closed.

### W-3 — the reachability walk cannot see an untracked file

Found by running it: the first handler named `DocumentService` under
`apps/desktop/src` and `check:advisories` stayed **green**. The cause is not a
bug — `scripts/lib/verdict.mjs` resolves an absent-symbol input with `git grep`,
which reads tracked files only, deliberately, so that build artefacts and
vendored trees do not fire every verdict constantly.

The consequence had not been written down: **a newly written source file is
invisible to every reachability verdict until it is staged.** An author writing
exactly the unit a trigger is armed for sees green for the whole time they are
writing it. Recorded in the register's own control entry, which is where someone
meets it.

The trigger then fired correctly the moment the files were staged, named both,
and its successor verdict — `renderer-facing-errors-carry-no-text` — now rests on
the failure *type* rather than on the absence of a handler.

**Checked explicitly, because a replaced verdict is where a loosening hides:**
the old trigger would also have fired for a *second* handler reaching the kernel.
Nothing is lost by dropping that, because the obligation it prompted is now met
by a type that every handler inherits rather than by a per-handler review.

### W-4 — a comment in a scanned file is scanned text, again

My test named the diagnostic function in prose and expired the verdict the file
exists to evidence. `mupdfWriter.ts` learned this about the format dispatcher.
The instrument is right and stays as it is: it cannot tell a comment from a call,
and giving a text search a parser is how it acquires a second way to be wrong.

### The checklist, item by item

**1. Root cause or workaround?** No workarounds. Two narrowings and no
widenings: `Failure` lost a field it could not honestly carry, and the
boundary's declared-code list lost `internal`. The one replacement — the
advisory verdict — is examined above rather than assumed benign. The one thing
that could regenerate is W-2's drift, which is why it got a mechanism rather
than a note.

**2. The hard shape.** Named and **not** verified: union dispatch with a second
command kind. The code carries a compile-time trigger that fails the day
`CommandKind` widens, rather than a dispatch design invented from one data
point. Also unverified, and unverifiable today: the handler under a real
transport. `structuredClone` deep-equal on everything the new channel puts on
the wire is what stands in for it.

**3. Would CI have caught it?** W-2, yes — and did, for three pushes, with
nobody reading it; that gap is now closed at the commit. W-1, **no**: CI runs
`proof:auditscope`, and that proof shared the classifier's blind spot exactly.
A proof written from the same assumption as the thing it checks is not
independent evidence.

> **The first sentence of that answer is WRONG. See the correction below** — CI
> could not have caught W-2, because CI had not executed a proof since
> 2026-08-17.

**4. Non-vacuous.** Eleven mutations run, each reddening its own case and no
other: three on the failure-shape union, one on the named error, one on the
lane's serialisation, one on the §9 fixture's path, two on `isProof` in opposite
directions, two on the drift gate, and the contract proof's own cross-product
check. The §9 mutation is the one worth naming: taking the path **out of the
fixture** reddens the control alone while the "no path crosses" case stays
green, which is the whole reason that control exists.

**4a. Resolution.** One new instrument, `scripts/hooks/contractDrift.mjs`, and
it was given its pair before it gated anything: fires on a contract source,
quiet for a document and a test.

**4b.** W-1, above.

**5. Executed, or asserted?** Everything above was run. **Asserted, and it is
the one thing in this entry that was not executed:** that CI actually went red
on `main` for those three pushes. `gh` is not installed on this machine. What
was executed is that `proof:contract` fails at `4a9ac84` and that
`.github/workflows/ci.yml:141` names it.

**6. Architecture before the feature.** Yes, both times, and in separate
commits: the composition point's location (`d30ab77`) and the incident-id
decision (`01d4e96`) each landed before the code they govern. The one question
this range *declined* to answer — who owns engine session lifetime — is deferred
behind an existing trigger rather than answered inside a composition point,
which would have been the retrofit B4 exists to prevent.

**7. Documents.** `CLAUDE.md` item 4b gains the audit-scope report as its fifth
blind instrument, with the general form stated: a classifier deciding what an
instrument looks at needs a control for what it must **exclude**.
`docs/FEATURES.md` gains the composition-point row and records the trigger
firing. The register carries the successor verdict and W-3.

### The three buckets

- **Instrument-caught, during the work:** W-3 and W-4 (the advisory register),
  W-2's first occurrence (running the proof), the irregular-whitespace zero-width
  space and the phantom `{ code: never }` union member (lint), and **two escape-
  guard denials** — a `python -c` and a `node -e`, both reflexive one-liners,
  neither a probe.
- **Mutation-caught:** none. All eleven confirmed existing checks rather than
  finding new defects.
- **Audit-caught — shipped, then corrected:** W-1, and W-2's second occurrence.

Two, against the previous range's two. **Flat, not improving** — and two ranges
is still not a trend. What the two audit-caught items have in common is worth
more than the count: both are instruments that could not see part of their own
subject, which is now three ranges running.

### Correction, 2026-08-19 — CI had not run a proof in two days, and this entry assumed it had

Three findings from the Actions API, which this session could not reach. They
are measured except where marked.

**F-1. Item 3 above is wrong about W-2.** It says CI *"did"* catch the contract
proof's drift, *"for three pushes, with nobody reading it"*. It did not. The last
successful `ci.yml` run is **4579645, 2026-08-17** — 138 commits back. Every run
since fails at the **Install** step, all three jobs, both platforms, with

```
npm error code EUSAGE
Missing: @emnapi/runtime@1.11.3 from lock file
Missing: @emnapi/core@1.11.3 from lock file
```

So no CI job has executed a proof since the day before yesterday, and
`674c453`'s commit message carries the same mistake: it reads as though a working
CI had gone red unread. What actually happened is that nothing ran. **The
correct answer to "would CI have caught it" for the whole range is *no*, for
every finding in it** — which also removes the mitigation that entry leaned on,
and is why the pre-commit contract gate is not merely a convenience.

The mistake is worth naming for its shape: I read `ci.yml:141` and concluded
what CI *would* do. That is a declaration, and the project's own rule is that a
declaration is not behaviour. Reading a workflow file is not reading a run.

**F-2. The lockfile was occurrence 3 of the regenerating class.**
`@img/sharp-wasm32` declares `@emnapi/runtime ^1.11.1` and
`@napi-rs/wasm-runtime` declares `@emnapi/core`, and the lock carried **no
top-level entry for either** — only a nested 1.10.0 pair under
`@unrs/resolver-binding-wasm32-wasi`. The documented repair, in its own commit:
`686d1a7`.

**F-3. And the guard built for that class cannot see it from this machine.**
This is the finding, not the lockfile. Measured, same clean `git archive` export
with no `node_modules`, same lockfile:

| npm | `npm ci --dry-run --ignore-scripts` |
|---|---|
| 11.6.2 (Node 24.12.0, this machine) | **exit 0**, printing *"added 217 packages"* |
| 11.17.0 (Node 24.19.0, what the runners resolved) | **exit 1**, the annotation verbatim |

`lockfileIntegrity.mjs`'s header says the check is *"npm's own validation rather
than a reimplementation of it"*. That premise does not hold: this npm answers a
different question — it resolves an ideal tree and reports what it *would*
install, which is indistinguishable from validating one.

`e259d17` pins the runner's Node exactly, which closes the half where CI's npm
could move without a commit. **It does not fix the guard**, and regenerating the
lockfile without fixing it is the repair-that-regenerates shape the guard exists
to prevent: the instance closes and the instrument stays exactly as blind.

**OWED, as its own unit and before anything builds on it:** the guard must stop
depending on whichever npm is installed. The shape is not chosen here — the
candidates are a provisioned npm pinned the way `gitleaks` is, or a refusal when
the local npm is older than `NPM_VERSION`, and the second blocks every
dependency-touching commit on a machine that has not been updated, which is a
cost the owner should weigh rather than inherit.

**F-4. Guards was red independently, and it was NOT the live OSV query.**
Reproduced rather than inferred, in a worktree with no `.tools/`: the OSV query
**succeeded** (`74 advisories … all triaged`) and the failure came four lines
later, from the T-1 witness rule reading *"the derivation could not run"* as
*"the derivation found nothing"*. Fixed in `02f21d8`, with the distinction now
carried in both directions.

The live-query exposure is real and is **not** what broke this: a required gate
that depends on an unauthenticated third-party POST goes red for reasons that
have nothing to do with the code. Recorded as a separate item; the fix is not
obvious, since the query is also what makes the register honest, and skipping it
on a network error is the *"could not check"* reading *"nothing to report"*
failure this whole check exists to refuse. It already refuses correctly.

**What the two days cost, and it is the point.** Every push in this range was
made against a green local board and a CI that had not run. Two of this range's
four findings were about instruments that could not see their subject; this makes
a third, one layer out — **the board itself**. A red CI nobody reads is the same
failure as a green check that verifies nothing, and it lasted 138 commits.

**One more count for the record:** the escape-resolving-write hook denied **three**
calls during this range's work — a `python -c`, a `node -e` and a `sed -i` — all
three reflexive one-liners in the middle of ordinary work, none a probe. That is
the mechanism doing the job the written rule failed at seven times.

---

## 2026-08-19 — Stage audit: `77d4c2c..d61d995`

**Audited through d61d995.** 10 commits, 20 files, 0 proofs added, **3 proofs
modified**, 0 new scripts.

**Past the gate, not on it.** `check:docs` was already red at 10 against a
threshold of 9 when this started. Recorded because "on the line" and "over it"
are different states and only one of them is a rule being kept.

Read in the order the range demanded: `auditScope.proof.mjs` **first and
slowly**, because it is the proof of the instrument that defines the range being
audited, and it changed inside the range it scopes. Not circular — but everything
else here is bounded by it, so a defect there mis-scopes every other finding.

### Finding V-1 — the append-only control has never tested anything

`proofChurn` is built from **modified** proofs only. The control's fixture,
`fresh.proof.mjs`, is **added** inside the range — so it lands in `proofsAdded`,
never appears in `proofChurn`, and `appended` is `undefined` on every run. The
guard reads:

```js
appended === undefined || appended.net.removed === appended.perCommit.removed
```

so **"not found" passes**. Measured, not inferred: replacing `===` with `!==`
fails the case immediately, printing `net -? vs per-commit -?` — the `?` being
the entry that was never there.

Three things make this worth more than its size.

**It is audit item 4b's corollary applied to a test rather than to an
instrument.** *An empty intermediate result is a broken parse, not a clean
input* — written about seed sets and symbol tables, and it holds identically for
a fixture lookup. A control that cannot find its own subject must throw, never
pass.

**It is the vacuous shape inside the control written to prevent a vacuous
shape**, one commit old. The case exists so the RESOLUTION case above it cannot
be satisfied by a report that *always* claims a difference. It has been
protecting nothing since it was written.

**The mutation missed it, and the reason is instructive.** The mutation run when
this landed pointed `perCommit` at the range diff, which makes net equal
per-commit for *everything* — a state the vacuous branch also passes. A mutation
that moves both sides of a comparison cannot separate a control from its own
emptiness. The one that would have caught it is the opposite: make the figures
always differ, and watch this case stay green.

**Would CI have caught it?** No. `proof:auditscope` runs in `guards.yml` and
passes, because the vacuous branch is the thing being run.

**Not mis-scoping this audit.** The instrument itself is sound — the range report
printed `net +118 −8 / per-commit +120 −10` for `contract.proof.mjs` with *2
deletion(s) DO NOT APPEAR*, which is U-2's fix working on its first real range.
What is unguarded is a future regression to always-differ.

### Finding V-2 — the report a human reads has no test at all

`proof:auditscope` imports `auditScope` from `scripts/lib/auditWatermark.mjs`. It
never runs `scripts/audit/scope.mjs`. So the **data** is tested and the
**rendering** is not: delete `proofChurnSection`'s hidden-deletions line entirely
and every case still passes.

That line is the whole of U-2's value — the figures without it are two numbers an
auditor has to subtract in their head. The same class as V-1 one level out: the
part that changes behaviour is the part being read, and it is the part nothing
asserts.

**Both closed in the commit after this one.** V-1's control now uses a proof that
existed **at** the watermark, so it reaches the modified column at all, and its
guard is `!==` rather than `===` — not-found fails. V-2 is closed by spawning
`scope.mjs` against the fixture repository and matching the rendered line, with a
control that the warning stays **absent** for a file with nothing hidden, since a
report that warns on everything is one nobody reads by the third range.

**And the mutation V-1's analysis called for was run**: making the two figures
always differ. It reddens both the resolution case and the append-only control —
which the original mutation could not do, because moving both sides of the
comparison together is a state the vacuous branch also passed. Deleting the
rendered line reddens the V-2 case and nothing else.

### The modified-proof column, read

`auditScope.proof.mjs` **+45 −0** and `guardFiles.proof.mjs` **+61 −0**: purely
additive, no case altered, no expectation flipped.

`contract.proof.mjs` **+118 −8 net, +120 −10 per commit**. The two hidden
deletions are the `VersionWriter` → `CommandWriter` rename inside a control
fixture — a rename, not a loosening. Read and classified, which is the record the
column exists to produce; U-2's line is what made them visible at all.

`guardFiles.mjs` is again a **widening** (the Trojan Source codepoints), and the
evidence a widening needs is the opposite of a loosening's: `guard:tree` over
every tracked file passes, and the non-ASCII prose control passes, so nothing
legitimate is now rejected.

### The rest of the checklist

**1 — root cause or workaround?** No loosened check, no escape hatch. Two fixes
are root-cause in the strong sense: U-1 made the guard **decode** rather than
widening a byte range it structurally could not express, and U-2 printed the
figure the column was missing rather than telling auditors to run `git log -p`
themselves.

**Corrections inside the range:** three, all before push — the vacuous
cross-document log control (caught by mutation), the cross-product refusing a
confusable `because` pair, and two guards deleted for being unreachable
(`isKind`, and a runtime `replay` check that lint proved always-false, replaced
by a compile-time trigger). V-1 is the fourth and it is **not** in that group: it
shipped, and this audit found it.

**2 — easy shape only?** Hard shape throughout: a **misspelt** symbol, a
checkpoint that must hold the **pre-command** document, a **truncated** type
dump, a page whose prior rotation is **absent** rather than present. The one
place the hard shape was not tried is V-1 — the control was never run against a
proof that actually appears in the column it reports on.

**3 — would CI have caught it?** V-1 and V-2: **no**, and structurally — CI runs
the proof whose control is vacuous, and runs nothing that exercises the report.
Everything else in the range is covered.

**4 — proofs non-vacuous?** Mutated throughout, and one mutation found a defect
in a **test** rather than in the code for the second range running: making every
document share one log left all 126 tests green, because the cross-document
control read a context *stub*. It now asserts against the service, and reddens.

**4a — resolution.** The churn reporting got its resolution test in the same
commit as the instrument, which is the second range in a row that has happened.
The resolution case is sound; its **control** is V-1.

**4b — search-shaped instruments.** None added. V-1 is a 4b-shaped failure in a
test, which is the generalisation worth carrying: the corollary is about *empty
results being treated as answers*, and a fixture lookup is one.

**5 — executed or asserted?** Executed: every mutation; V-1 measured by flipping
its own condition; the error-boundary leak measured on the real filesystem
(`EPERM: operation not permitted, stat 'C:\pagefile.sys'`, with the path in the
stack too); `.path` confirmed **not** copied by `toStructuredError`; the claim
that the kernel builds `{ cause: error }` chains checked and found **false** —
all four sites are in `boundary.ts`, `result.ts` and `schemas.ts`.

**6 — architecture before feature?** Clean, and deliberately so for the second
range running. Two ADR decisions, each in its own commit, each **before** the
code: the composition point with the log's home, and §9 as a type rather than a
sanitiser — the second landing before any handler exists at all, which is the
whole reason it is cheap.

**7 — documents match code?** `check:docs` passes its eight checks once the
watermark advances. A marker was corrected in this range rather than found stale
later: `rotatePages` read **done** while this file's own legend requires a UI
dispatch test, and now reads `kernel done, unwired`.

---

## 2026-08-19 — Checkpoint retention is not blocked, it is already shipped and unsized

Recorded from the review seat's third point, and the correction runs in the
direction that strengthens it rather than against it.

**The claim reviewed:** checkpoint restore needs byte images per terminal entry;
that is the same ADR-0007 memory question as `DocumentService` holding canonical
bytes; one sizing decision wearing two hats, and building retention before sizing
it means retrofitting under a log that already exists.

**Agreed, and `ARCHITECTURE` §4 already says so** — *"Memory is one document plus
a few checkpoints"* is a single budget statement covering both, with the rejected
alternative named as *"full-byte snapshots rationed by a memory budget"*, whose
worst case is several resident copies of a large file. The law treats them as one
budget. They are not one *mechanism*: the canonical image is one per open
document and unconditional, while checkpoints are many and need a cap plus an
eviction rule, and evicting a checkpoint costs undo depth. But the eviction rule
cannot be chosen without knowing what share of the budget the canonical image
takes, which is what makes it one decision.

**The correction: this is not a future unit that restore unblocks.** It is
already built. `CommandBus.execute` mints a checkpoint from `writer.serialise`
and stores it on the entry; `CommandLog` has **no cap of any kind**; entries are
dropped only when a new command truncates the redo tail. So the log already
retains an unbounded number of full document images, one per terminal entry, and
§4's budget sentence is enforced by nothing.

Three things follow from the difference between *blocked* and *shipped*:

- It is a **defect, not a design gap**, and belongs in the next audit range under
  item 1 rather than on an owed list.
- It is not reachable today — no IPC boundary, no renderer, and terminal entries
  need a malformed document — which is why it is not urgent, and is exactly the
  reasoning `verdict.mjs` records as finding 32's lesson: *"the blast radius is
  empty today"* is not a verdict, because ordinary progress fills it.
- The sizing unit is therefore **closing a live gap**, not unblocking a future
  one, and its proof needs a control that the cap actually evicts rather than
  only that a limit is configured.

**What it does not change:** the order. The two small units already agreed come
first, and the retention sizing is one unit covering both hats, before any of the
IPC work that would give this a caller.

---

## 2026-08-19 — Stage audit: `b315e2c..77d4c2c`

**Audited through 77d4c2c.** 7 commits, 18 files, 0 proofs added, **2 proofs
modified**, 0 new instruments in `scripts/`.

Run at 7 of 9 rather than on the gate. C is §3's real assertion — undo restoring
a leaf to *inheriting* — and it is not a thing to build under a gate about to
trip.

### Finding U-1 — the file guard's scope is narrower than its stated purpose

`findControlCharacter` scans **C0 plus `0x7f`**, byte-wise. It does not cover the
Trojan Source class (CVE-2021-42574): bidirectional overrides `U+202A`–`U+202E`,
`U+2066`–`U+2069`, `U+061C`, and the invisibles `U+200B`–`U+200D`, `U+2060`,
`U+FEFF`, `U+00AD`. It **cannot** cover them in its present form — it reads raw
bytes, and every one of those is a multi-byte UTF-8 sequence.

**Verified independently rather than accepted**: 186 tracked files, 183 read as
text (the three skipped are the icon set, whose bytes decode into watched
codepoints by coincidence — scanning them would bury a real finding in noise).
**Zero hits**, with a positive control confirming the search can locate a watched
codepoint at all, because a scan reports "found nothing" for every way it can be
broken and here that is the answer everyone wants.

So this is a **gap, not a defect** — and the reason it is worth closing now is
specific to this repository rather than general. The premise is that the world
reads this code, under AGPL, with outside contributions eventually arriving.
**Review integrity is exactly the property those characters attack**: source that
renders one way to a reviewer and compiles another. And the guard's own stated
purpose is protecting text from characters *invisible to a reader* — it is that
purpose, one codepoint range short.

The same shape as the NUL finding, and that is the point of recording it as a
class rather than an item: **a check whose scope is narrower than its purpose,
where nothing about it looks wrong.** Nothing in the output, the tests or the
diff says "this only covers one byte range" — the count of cases passing is the
same either way.

`docs/security/THREAT-MODEL.md` covers supply chain as *a malicious upstream
release* and does not cover source that reads differently than it compiles. The
codepoint set lands with a threat-model line, so the scan has a stated reason
rather than being a list somebody extended.

**CI would not have caught it.** `guard:tree` runs in `guards.yml` and is
structurally blind to the whole class.

### Finding U-2 — the modified-proofs column reports NET change, so intra-range churn is invisible

The column exists because *a loosened check looks like a corrected one*, and it
tells the auditor to read each diff. It reports the **range** diff.

Measured on this range. `scripts/proofs/contract.proof.mjs` reports **+191, −0**
at range level. Per commit it is **+72, −0** in `6c8d28f` and **+133, −14** in
`77d4c2c`. A line added in one commit and rewritten in a later one nets to an
insertion, so the fourteen deletions — including one `because` matcher being
re-anchored — do not appear at all.

Here it is benign: the fourteen are eight import rewrites, four comment lines,
one import, and the `because` change, which was a **tightening** forced by the
cross-product check. Read them and that is visible. But nothing made an auditor
read them, and the column reported zero.

**"Benign here" is not the reason to fix it, and recording it that way would get
it deprioritised by whoever reads this next.** The reason is that U-2 is the
range-scoped audit's own founding argument turned on its own instrument.

This project audits ranges rather than trees because *an end state that looks
clean hides defects that arrived and were corrected inside the range* — measured
in the range before this one, where four of eight substantive commits corrected
something an earlier commit had introduced. A column reporting the **net range
diff** is a tree-wide sweep at smaller scale: the same shape, the same blindness,
one level down. The instrument built to stop an auditor trusting a clean end
state presents a clean end state of its own.

So the hazard is not hypothetical in kind, only in instance: a proof loosened in
one commit and re-tightened in another inside the same range shows **zero
deletions**, while the loosened state was committed and pushed in between.

**The blind spot's exact limit, stated so nobody overclaims it:** it needs an
*exact revert* within the range. A loosening replaced by a *different* tightening
still shows in the net diff, because the lines differ. That is narrow — and it is
narrow in precisely the way "the end state is clean" is narrow, which is the case
this project already decided was worth an instrument.

Cheap fix, not taken here: have `audit:scope` report per-commit churn for files
in the proofs column alongside the range total. Left **open**, with the fix
named, because changing that instrument needs its own resolution test and this
range's owed work is C.

**CLOSED after C.** The column now prints both figures and, when they differ,
says how many deletions the range diff hides and names the command that shows
them. Two cases, and the second is what keeps it useful: a rewrite inside the
range must make the figures **differ** by one hidden deletion, and an
append-only change must make them **agree** — a report that always claims a
difference is a warning nobody reads by the third range. Checked against the
real case as well as the synthetic one: on `b315e2c..77d4c2c`,
`contract.proof.mjs` is `net −0` and `per-commit −14`, so the instrument would
have printed the line on the range that produced the finding.

### The first quantitative evidence the mechanisms are paying, and it is one data point

Worth stating on its own rather than leaving inside item 1, and worth stating
with its limit attached.

- **Previous range:** four of eight substantive commits corrected something an
  earlier commit in the same range had introduced. Found by an audit reading the
  diff afterwards.
- **This range:** three corrections happened **inside** the commits that caused
  them, before anything was pushed — the elision's truncated-dump gap, the
  confusable `because` pair, and a vacuous test. All three were caught by
  instruments firing during the work.

That is the difference between *finding* defects and *not shipping* them, and it
is the trend that decides whether this scaffolding was worth building.

**One range is not a trend.** Measure it again next range before anyone calls it
one — and record the comparison whichever way it goes, because a measurement kept
only when it flatters the mechanism is not a measurement.

### The rest of the checklist

**1 — root cause or workaround?** No loosened check, no escape hatch, no
special-cased input. Two fixes are root-cause in the strong sense: T-1 was closed
by **derivation and witnessing** rather than by checking the current spellings,
and T-2 by comparing the exact quantity rather than tightening the proxy.

The corrective work in this range has a **different shape from the last one**,
and the difference is the interesting part. Last range, four of eight substantive
commits corrected something an earlier commit had introduced. This range, three
corrections happened **inside** the commits that caused them, before anything was
pushed: the elision's truncated-dump gap, the confusable `because` pair, and a
vacuous test. All three were caught by instruments firing during the work rather
than by an audit reading the diff afterwards. That is the same defects arriving
earlier, which is what the instruments are for.

**2 — easy shape only?** Hard shape throughout. A **misspelt** symbol rather than
a correct one (T-1). A checkpoint that must hold the **pre-command** document
rather than merely exist. A **truncated** type dump rather than a nested one. A
malformed `/Rotate` as a **real** constructor for the terminal branch rather than
a fixture invented to reach it.

**3 — would CI have caught it?** U-1: **no**, and structurally so. U-2: no — it
is a property of the audit instrument, which CI does not run as a judgement.
Everything else in the range is covered: `proof:contract`, `proof:advisories`,
`vitest`, `typecheck` and `guard:tree` all run in CI.

**4 — proofs non-vacuous?** Mutated throughout, and the separations matter more
than the count. On the register: three, each reddening only its own half — the
enforcement gate, verify-nothing, and one-combined-number, the last being T-1's
own mechanism. On `rotatePages`: four, plus two on the writer binding failing in
**opposite** directions. On the log and bus: five, including checkpoint-after-
apply, which reddens with `expected '90' to be '/Landscape'` — a sentence an
existence check cannot produce.

**One mutation found a defect in a test rather than in the code.** Moving
`record` before `apply` changed nothing, because the case named *a failing apply
records nothing* never reached `apply`: capture validates the same page indices
and threw first. The test asserted something it could not observe. Renamed to
what it tests, its reachable neighbour added, and the case one command cannot
construct recorded as uncovered **at the call site** rather than assumed away.

**4a — resolution.** Two instruments gained resolution treatment, and one of them
got it **before it measured anything** for the first time in this project: the
witness rule's resolution case — one symbol moving from witnessed to unverifiable
must move both counts by one — was written in the same commit as the rule. The
other is `elideTypeDumps`, whose truncation pass now ends in a **refusal** if any
brace survives, rather than degrading quietly.

**4b — search-shaped instruments.** One added and it is the range's main work:
the witness rule is a `git grep` per symbol, so it carries a control asserting a
**non-zero verified count** on every run. Without it a rule that verified nothing
would pass all seven enforcement cases. The U-1 scan above carried its own
positive control for the same reason.

**5 — executed or asserted?** Executed: every mutation; the full bidi and
invisible-codepoint scan over 183 text files with its control; MuPDF's rotation
behaviour on four questions before a line was written; the snap port compared
**engine-to-engine** over 23 raw values. Asserted and labelled: that `apply`
throwing where `capture` succeeded behaves correctly — not constructible with one
command, recorded at the call site.

**6 — architecture before feature?** Clean, and for the first time in this
project it ran forwards **deliberately** rather than being caught. Two ADR
decisions, each in its own commit, each **before** the code that would have
decided it by accident: who captures prior state (`cb96db8`, before the handler),
and whether a declared-invertible command may produce a terminal entry
(`5684c08`, before the log). Both are recorded as **silences filled**, not as
clarifications of something already written — the ADR was not wrong, it was
quiet, and saying which is part of the record.

**7 — documents match code?** `check:docs` passes its eight checks. Every commit
updated its `FEATURES.md` row, including two rows moved from `—` to `done` and
one to `partly done` with what it still owes stated.

### The escape guard fired twice more

`sed -i` from the review seat — **while writing a finding about text corruption**
— and `node -e` from the build seat, reached for as a throwaway prefix on a `sed`
while auditing the file that records these fires.

Fifth and sixth recorded unprompted denials; second from the review seat. Neither
adds anything about the mechanism. What both add is the same observation from
opposite chairs: the rule was maximally primed in each case — one seat was
literally composing text about invisible characters corrupting files — and it was
still not in reach at the moment the command was formed.

---

## 2026-08-19 — S-1's harness paid in a different currency

Worth separating from the two earlier payments, because the source is different
and that is the whole point of recording it.

Making `apply` a required field on `CommandSpec` meant every existing spec
fixture in `contract.proof.mjs` began failing for **a reason it did not claim**:
*"Property 'apply' is missing"*, rather than the axis defect or the routing
defect each case exists to demonstrate. Seven cases would have gone on printing
green while testing nothing they advertised.

The harness refused to certify any of them, and said which case and why.

**The two earlier payments were proofs catching proofs.** S-1 itself was found by
auditing a proof; the confusable-reason pair was found by the resolution test
added to that proof. Both were the instrument turning on its own kind. This one
is a **feature** breaking a proof's meaning while leaving its verdict intact —
the direction that arrives during ordinary work, from someone who is not thinking
about the proof at all, and the direction nobody is auditing at the time.

A verdict-only harness cannot tell the two apart, because in both cases the case
still rejects. That is the argument for matching the reason, restated by
something that happened rather than by reasoning about what could.

---

## 2026-08-19 — T-1 closed: a symbol is derived, witnessed, or printed as unverifiable

**Finding T-1 is closed. Finding T-2's real significance is a recurrence, named
here rather than left as a new event.**

### What was wrong, in one sentence

A reachability verdict's **path glob** had a positive control and its **symbol**
had none, so a misspelt symbol produced "no references" on every run forever —
which is the verdict's passing answer — while the summary line reported it as
checked.

### Three states, and the third is the one that had to be got right

- **derived** — the OCR doors, computed from the engine source and compared. The
  coverage is now taken from **what the derivation actually confirmed** rather
  than from the declaration that it exists: rename the register entry the drift
  check reads and the confirmed set empties, which surfaces those eleven symbols
  as unverifiable instead of leaving a stale exemption behind. A declared
  `derived: true` would have been the escape hatch wearing the fix's clothes.
- **witnessed** — found on every run in a declared scope. Two constraints, and
  each closes a way the witness could confirm nothing. The scope must be
  **disjoint from the paths the verdict scans**, or the witness is satisfied by
  the very reference whose appearance expires the verdict. And it may never
  resolve to the **register itself**: a misspelling is present there too, so the
  search finds its own typo and reports success. That second one is a proof case
  because it is the mistake a careful author makes.
- **unverifiable** — nothing here can witness it. Printed every run and counted
  **apart**, never folded in.

### Two numbers, never one — and the proof case is T-1's own mechanism

`18 symbol(s) checked` was true of a register with two symbols misspelt. One
number covering both states is not a summary of this rule; it is the exact shape
of its failure, and it is why T-1 survived a whole range unseen.

So the resolution case (item 4a) asserts that moving **one** symbol from
witnessed to unverifiable moves both counts by one. Mutating the line to print
`verified + unverifiable` as a single figure reddens that case **and nothing
else** — the non-zero-verified control stays green. The instrument's resolution
test fails on precisely the defect the instrument was built for, which is as
close as this gets to a demonstration rather than an argument.

This is `target-absent` versus `sole-writer` again, in a third place. "Could not
look" and "looked and found nothing" must not share an output.

### `in: null` is a derived state, not a declaration

The objection to permitting it was that an exemption an author writes is a
workaround with a config flag on it. That objection is answered by mechanism
rather than argued with: **a null is accepted only while a condition the
register resolves itself still holds.** For the two Electron host symbols the
condition is *electron is named in no `package.json`* — one file read, resolved
through the same `absent` input every other verdict uses.

An author therefore cannot assert their way past this. They can only state a
fact, and the fact is checked on every run. A symbol with no checkable condition
gets no null: two proof cases, one for a bare null and one for a condition that
has stopped holding.

The expiry needs no second mechanism, and it carries **three consequences on one
day**. When Electron becomes a dependency: the condition fails and the null stops
being accepted; a witness becomes possible; and the symbol list can stop being
hand-picked, because it can then be **derived** from Electron's own API surface
the way the OCR doors are derived from the engine source.

That last one is the completeness hazard, which witnessing does not touch and
nothing available today does. `utilityProcess` and `MessageChannelMain` are two
hand-picked names for "Electron spawns a document-parsing process", and a
correctly spelt list can still be short. The mechanism that fixes it is the one
already working elsewhere, attached to the same trigger — so the next reader
inherits the plan rather than the problem.

### Mutations, and what each one separated

Three, and the separations are the point rather than the count:

- neutralise the enforcement gate → **the seven enforcement cases red, the
  control and resolution cases green**;
- make the rule verify nothing (`0 verified, 18 unverifiable`) → **only the
  control and resolution cases red**, every enforcement case still green;
- print one combined number → **only the resolution case red**.

Neither half carries the other. A rule that verified nothing would have passed
all seven enforcement cases, which is why the non-zero-verified control is not
optional — it is item 4b applied to the fix for a 4b finding.

### T-2 is a RECURRENCE, and that is worse than a new finding

The retention test compared **length** while byte equality sat unused and equal.
Beside it, the round-trip test stayed green on a document mutated to differ by
one byte at the same length — pdf-lib reloaded it and counted two pages.

**Two instruments blind at once, each concealing the other.** This project has
had that exact pair before: the OCR reachability walk failed four times running,
and *two of the four were live simultaneously, each concealing the other*. The
shape is not "an instrument was weak". It is that a weak instrument sitting next
to a second weak one produces a **consistent** reassuring answer, and consistency
is what reads as confirmation.

Recording it as a recurrence rather than as a new event is the difference between
a lesson and a list. The general form: when an instrument is found to be blind,
the next question is not "what else does it miss" but **"what else was agreeing
with it"**.

---

## 2026-08-19 — Stage audit: `8f097e3..b315e2c`

**Audited through b315e2c.** 9 commits, 12 files, 0 proofs added, **2 proofs
modified**, 0 new instruments.

Run at 9 against a threshold of 9 — on the gate rather than past it. The next
unit is `rotatePages` with a working `apply`, the first end-to-end command, and
building a substantial unit under a gate about to go red is how a range gets
audited in a hurry.

### The modified proofs, classified — and one of them is a WIDENING

The column exists because *a loosened check looks like a corrected one*. Neither
of these is loosened, and they are not loosened in two different ways, which is
worth separating rather than reporting as one clean answer.

`scripts/hooks/guardFiles.proof.mjs`: **+22, −0.** One case added, nothing
altered. `scripts/proofs/contract.proof.mjs`: **+491, −11**, and the eleven
deletions are structural — a widened `Case` typedef, a `spawnSync` gaining
`--pretty false`, and a verdict branch replaced by a stricter one. **No
expectation flipped, no case removed, no assertion dropped.** Read line by line,
because "no loosening found" is worth nothing unless somebody looked.

The guard itself is the interesting one. `byte < 0x09 && byte > 0x00` became
`byte < 0x09` — the check now catches **more**, not less. A widening has the
opposite risk profile from a loosening and needs the opposite evidence: not "does
it still catch what it claimed", but **"does it now reject something legitimate"**.
Two measurements say no. `guard:tree` passes over every tracked file, and the
adjacent accept case — a long clean text file past the sniff window — still
passes. A NUL in a file `looksBinary` classifies as text has no legitimate
reading, so the widened set is exactly the set that should have been rejected all
along.

Recorded as *read and classified as a widening* rather than as *no loosening
found*. Those are different records and only one of them says a human decided.

### Finding T-1 — a verdict's GLOB has a positive control; its SYMBOL has none

The advisory register is now this project's main expiry mechanism: five
reachability verdicts over eighteen symbols, two of them guarding obligations
that do not exist yet. Every one is a claim that something will fire **later**,
and a trigger that never fires is the perfect silent failure — it reports the
reassuring answer forever.

So the register was audited as an instrument, per item 4b. It is search-shaped
in the purest way: `git grep` for a symbol, and *not found* is both the healthy
answer and the answer every broken configuration gives.

`brokenReachabilityControls` already closes half of this, and closes it well. One
control per distinct path glob, derived from the verdicts rather than listed, so
a new verdict naming a new glob demands a control instead of inheriting one.
Breaking a glob was confirmed red — and produced **two** independent failures,
the control not finding its symbol and the glob becoming uncontrolled.

**The other half is open. The symbol itself has no control.** Measured, not
reasoned: `utilityProcess` and `MessageChannelMain` misspelt to `utilityProcesss`
and `MessageChanellMain`, `check:advisories` exits **0**, and the summary line
still reads *18 symbol(s) checked* — because the count counts declarations, not
findings. Invariant 25's containment verdict is then green forever, and nothing
anywhere would say otherwise.

This is the file's own stated failure mode, in the file that states it. Its
doc comment names *"a symbol misspelt in the register"* as one of the ways the
walk breaks; the control it built catches the glob and not the symbol.

**The OCR door set is exempt, and the exemption is the shape of the fix.** Its
eleven symbols are *derived* from the compiled engine source by
`scripts/security/ocrDoors.mjs` and cross-checked every run — misspelling one was
confirmed red in both directions at once (*reaches OCR, not declared* and
*declared, reaches nothing*). Derivation is why. The other seven symbols are
hand-written with nothing checking them.

Those seven were all made to fire by execution during this audit, so the register
is **correct today**: `DocumentService` and `readFileIdentity` from
`apps/*/src/**`, `utilityProcess` and `MessageChannelMain` and `pdf_subset_fonts`
from `packages/*/src/**`, `Uint8Array` from the single-file glob, and `ByteImage`
in the commit that added it. The twelfth, `fz_new_document_writer`, fired for
real, unprompted, on a comment in `mupdfWriter.ts`.

What is missing is not the state — it is the mechanism that keeps the state true.
A symbol correct today has no more standing than a claim true today, which is
what this register exists to stop.

**Second hazard, same family, recorded with it: a correctly spelt list may be
incomplete.** `utilityProcess` and `MessageChannelMain` are two names for
"Electron spawns a document-parsing process", hand-picked. OCR's completeness is
derived; this one is asserted. The fix shape below addresses spelling, not
completeness, and saying so is part of the finding.

**The fix has one judgement call and it is the owner's**, because the obvious
mechanism has an escape hatch in it. Requiring each symbol to be **witnessed** —
found somewhere outside the globs the verdict scans, checked every run — works
for five of the seven: `DocumentService`, `readFileIdentity`, `ByteImage` and
`Uint8Array` all live in `packages/kernel/src/**`, and `pdf_subset_fonts` in the
provisioned engine source the OCR walk already reads. It does **not** work for
`utilityProcess` and `MessageChannelMain`: Electron is not a dependency, so those
two have no witness anywhere in the repository. A `witness: null` escape would be
a workaround with a config flag on it unless the gap is *printed on every run*
rather than merely permitted — which is the difference worth deciding before
building, not after.

### Finding T-2 — the retention test compares a proxy where the quantity is free

`mupdfWriter.test.ts`'s *does not retain the image it was opened from* zeroes the
source buffer between two serialises and asserts `again.length ===
written.length`. Length is not content. The test has some resolution through the
throw path — a session reading a zeroed buffer would most likely fail rather than
return a same-length document — but the assertion itself cannot tell a corrupted
serialisation from a clean one at equal length.

Measured rather than argued: adding `expect(Array.from(again)).toStrictEqual(
Array.from(written))` **passes**. The exact quantity was available, equal, and
unused. That is the `0.01 MB` harness in miniature — an instrument reporting a
rounder number than the one it had.

Small, and open, and reverted rather than folded into this commit.

### The rest of the checklist

**1 — root cause or workaround?** No loosened check, no escape hatch, no
special-cased input. The guard fix is the one to name: NUL was *delegated* to
`looksBinary`, which reads 8000 bytes, so the repair was to stop delegating
rather than to widen the sniff window — the class, not the byte.

The honest headline for this range is a different one. **Four of the eight
substantive commits correct something an earlier commit in the same range
introduced or left incomplete**: `9fce274` corrects `1f5d0f9`'s scope, `15d9a40`
corrects `9fce274`'s depth and replaces its hardcoded pairs with the full
cross-product, `8650a35` gives `8c6bd2d`'s sweep the control it shipped without,
and `b315e2c` corrects a comment `83607ca` had just written. None is a
workaround. All four are the pattern this scoping exists to see: defects arriving
inside the work done an hour earlier to close the previous defect. A tree-wide
sweep would have found the end state clean and reported nothing.

**2 — easy shape only?** Hard shape tested throughout: a NUL **past** the sniff
window rather than inside it, a rejection for the **wrong** reason rather than a
rejection, a **nested** type dump rather than a flat one, confusable reason pairs
found by n² rather than by hand, and a byte-image adapter with **no adapter
behind it** proven by a type-level fixture carrying no assertion. The one place
the hard shape had not been tried is T-1: every symbol had been tested spelt
correctly, none spelt wrongly.

**3 — would CI have caught it?** For T-1, **no** — `check:advisories` runs in
`guards.yml` and passes the misspelling. For the range's own two defects, also
no, and that is the point of both fixes: `guardFiles.mjs --tree` runs in CI and
passed a file carrying a literal NUL at byte 19204, and `proof:contract` runs in
CI and printed green for a case rejecting for a reason it did not claim. Both
gaps are now closed; T-1's is not.

**4 — proofs non-vacuous?** **Six mutations**, each confirmed red against the
case named for it. Two are worth more than the count. Reverting the guard
widening reddens the new NUL case *and leaves the twelve neighbouring cases
green* — the mutation separates. And flipping the seam's `Apply` conditional from
`'byte-image'` to `'live-session'` reddens two seam cases, one of which **still
rejected** and failed only because the reason no longer matched. Under the
pre-`S-1` harness that case would have printed green. S-1's fix is therefore
load-bearing rather than tidy, demonstrated instead of argued.

**4a — resolution.** No new measuring instruments, so this would ordinarily be
checked-and-empty. It is not. An **existing** instrument gained the resolution
test it had been missing: `resolutionTest` in `contract.proof.mjs`, which
cross-assigns every reject case's expected reason against every other reject
case's actual diagnostic. It found a real defect on its first run — a confusable
pair outside the two that had been hardcoded. Recorded as *added late and
immediately productive* rather than as absent. T-2 is the one resolution failure
found: an assertion coarser than the data it holds.

**4b — search-shaped instruments.** None added. The register was audited as one
instead, which is where T-1 came from. The delegation sweep from `8c6bd2d` is not
a script — it was a hand-run grep with its scope and its limitation recorded in
this file, and it gained its positive control in `8650a35` rather than shipping
without one.

**5 — executed or asserted?** Executed: every mutation above; all seven
hand-written verdict symbols driven to expiry by naming them in a shipped file
and then reverted; the misspelt-symbol measurement that produced T-1; the
byte-equality measurement that produced T-2; `guard:tree` over the whole
repository; 92 tests, 21 contract cases, 26 guard cases, 17 advisory-register
cases, 8 document checks. Asserted and labelled: that `utilityProcess` and
`MessageChannelMain` are the *complete* set of entry points invariant 25 cares
about — hand-picked, unlike OCR's derived door set, and recorded inside T-1.
Corrected on execution: a suspected eighth finding. `FEATURES.md`'s §6 row claims
*"ten compile-fail cases, three of them controls"* and the group holds only two
`allow` cases, which read as an off-by-one carried forward. It is not: the third
control is a **reject** case, labelled as the control for `diagnose`'s atomic
branch. The row is right and the count was checked rather than assumed.

**6 — architecture before feature?** Clean. Nothing in this range amended
`ARCHITECTURE.md` or an ADR, and nothing needed to. The seam was built to §8 **as
written** after an over-reading of it was corrected from the review seat before
any code existed — §8 asks for both shapes in the type, not for a second adapter
and not for byte retention. `b315e2c` corrects a *comment* that claimed more than
the code did; a comment asserting a guarantee is read as one, but correcting it
is not an amendment because the ADR was never wrong. The obligation it left
behind became a trigger and a `FEATURES.md` row, which is this project's standing
answer to an owed-list line.

**7 — documents match code?** `check:docs` passes its eight checks. Every commit
updated its `FEATURES.md` row in the same commit, including the byte-retention
row that exists to say what is **not** built. ADR-0009 §8 needs no dated
correction: the ADR describes the design, the design is unchanged, and what moved
was one comment's claim about how far the code had got.

### The escape guard fired again, during this audit

A `node -e` denied — reached for as a throwaway prefix while composing a `sed`,
with no thought behind it at all. Fourth recorded unprompted fire after
2026-08-18T06:45Z, the `node -p`, and the review seat's `echo`; third from the
build seat.

Nothing new about the mechanism. What it adds is one more instance of the only
claim that matters here: the command was composed *while auditing the very file
that records these fires*, which is about as high as context-priming gets, and
the rule still was not in reach at the moment of composition. Limit 2's asymmetry
governs it — a denial is self-certifying.

---

## 2026-08-19 — Stage audit: `d9f01b0..8f097e3`

**Audited through 8f097e3.** 8 commits, 14 files, 0 proofs added, **1 proof
modified**, 0 new instruments.

Run at 8 against a threshold of 9, deliberately early: the engine seam plus its
first command would have tripped the gate mid-build, and a seam is precisely the
thing this project forbids discovering partway through.

### The modified proof, read line by line

`scripts/proofs/contract.proof.mjs`: **165 insertions, 0 deletions.** No existing
case altered, no expectation flipped, none removed. Purely additive, which is
the benign half of that column — recorded because "no loosening found" is only
worth anything if somebody looked.

### Finding S-1 — the compile-fail harness accepts ANY error as a rejection

Reading the diff produced the finding, which is the argument for the column.

A `reject` case passes when `tsc` exits non-zero. **It does not check why.** So a
case can pass while failing for a reason unrelated to what it claims: a typo in
the probe, a renamed export, a second error masking the absent first one. The
harness already guards the catastrophic version of this with paired `allow`
controls — a broken import fails those — but not the subtle version, where the
code *is* rejected and the stated reason is not the operative one.

That gap has been live since the file was written and no case has yet been wrong.
It matters now because six of the nine new cases turn on **which property**
mismatches, and two of them differ from each other only in that.

Checked by hand, running each probe and reading the compiler's own words:

| case | tsc says |
|---|---|
| omits the reproducibility axis | `missing the following properties: reproducible, replay` |
| non-reproducible claiming intent replay | `Types of property 'replay' are incompatible` |
| non-invertible claiming inverse undo | `Types of property 'undo' are incompatible` |

Each rejects for the reason it claims. **By hand is not a mechanism**, and the
next case added will not get this treatment — so the finding is not "these three
are wrong", it is that nothing would have told me if they were.

Also observed while checking: with **both** axes mismatched at once, tsc reports
only `undo`. A single case asserting a combined failure would therefore say
nothing about the second axis, which is why the two are separate cases.

**Closed by** letting a case declare the reason it expects, matched against the
compiler output — before the seam commit, because the seam's own fixture goes
into this same harness.

### Finding S-2 — "the seam expresses both writer shapes" is a claim with no control

Recorded before it is relied on rather than after. §8 requires the engine seam to
express **whole-byte-image writers as well as live-session operations**, because
three of the four writers of record consume and produce whole byte images and a
seam modelled only on live sessions breaks at Stage 4.

The build ahead implements **one** adapter — the live-session one, which is what
`rotatePages` needs. The byte-image variant will exist in the type with nothing
behind it, and **an unimplemented variant nobody constructs is exactly the
vacuous check this session has been full of.** The control is a type-level
fixture that constructs a byte-image adapter satisfying the seam, living in the
proof and never registered: if it cannot be written, the type does not express
the shape, and that is found now rather than at Stage 4.

There is precedent for a deliberately empty seam — ADR-0018 keeps
`WebUpdateProvider` registered with nothing behind it and forbids deleting it as
dead code. The difference is that an empty registration is visible on
inspection and a type's expressiveness is not, which is why this one needs a
fixture and that one does not.

### The rest of the checklist

**1 — root cause or workaround?** No loosened check, no escape hatch, no
special-cased input in the range. Two are worth naming as root-cause rather than
symptom: R-2 **deleted** the case fold rather than replacing it with a different
fold, and `close` was **split into two halves** rather than given an exception —
§2's synchronous removal and §7's serialised teardown are properties of
different halves, so neither had to bend. `close` becoming `async` is not a
loosening: the body still reaches the index removal without yielding.

**2 — easy shape only?** The hard shape was tested in every case, and in three it
was the case that found the defect: two copies matching on name/size/mtime for
identity, a **nested** page tree for inheritance (ADR-0006's own correction), the
Turkish collator and the eszett expansion for path comparison, and
undo-redo-back-to-identical-content for `dirty`.

**3 — would CI have caught it?** Yes for everything in this range: `vitest`,
`proof:contract` and `typecheck` all run in CI. The two findings above are
*about* CI's blind spots rather than instances of them — S-1 is a check CI runs
that cannot see its own reason, S-2 is a claim CI has nothing to check.

**4 — proofs non-vacuous?** **15 mutations**, each confirmed red against the case
named for it: 2 on the path comparison, 5 on the lane, 2 on the stamp and
reentry, 2 on the close guard, 3 on the counter, 1 on the spec table. Two of
them are worth more than the rest because the failure is not an assertion:
removing either reentry guard makes its proof **hang to the 5-second timeout**
rather than fail, which is the guard's justification demonstrated instead of
argued.

**4a — resolution.** No measuring instruments added. The compile-fail cases are
the equivalent shape, and S-1 is exactly a resolution failure: the harness cannot
distinguish two rejections that differ only in which property is wrong.

**4b — search-shaped instruments.** None added this range.

**5 — executed or asserted?** Executed: the eszett pair against the real
filesystem (two inodes, one directory), Turkish collation across four locales,
every mutation, and each new reject case's compiler reason. Asserted and labelled
as such: S-2. Corrected on execution: one control comment in the counter claimed
to guard against a per-entry `isDirty` snapshot and does not — the mutation
showed it actually guards `savedVersion` being re-seeded per entry, and the
comment now says so.

**6 — architecture before feature?** Clean, and worth stating why the judgement
went this way: ADR-0009 gained three **dated clarifications** in this range
rather than B4 amendments. Each resolves or corrects something the ADR already
specified — §2 against §7 on close, how §7's version echo is realised, and a
defect in what §5's neighbouring comment claimed. None introduces a constraint
the ADR did not have. A new constraint would have been an amendment in its own
commit.

**7 — documents match code?** `check:docs` passes its eight checks; every commit
in the range updated its `FEATURES.md` row in the same commit, including the one
that records `apply` as deliberately absent.

---

## 2026-08-19 — Stage audit: `caa59d0..d9f01b0`

**Audited through d9f01b0.** 11 commits, 23 files, 1 proof added, **0 proofs
modified**, 1 new instrument.

Over the threshold at 11 against 9, and the gate caught it: `check:docs` went
red the moment `d9f01b0` pushed HEAD past a batch. The audit ran before the next
feature commit rather than after it, which is the only arrangement in which the
gate does anything.

**Proofs modified: none. Checked, and the column is empty.** That is the
load-bearing column — a fix that quietly loosens a check looks identical to one
that corrects it, and only the diff separates them. Recording "nobody needed to
read one" is a different fact from omitting the column, so it is written here
rather than left out. The one file that did change and could have hidden a
loosening, `scripts/lib/auditWatermark.mjs`, gained **documentation only**: the
structural-tail paragraph. No threshold moved, no logic changed.

### Finding R-1 — `pathIdentity.mjs`'s floor is a COUNT, not an IDENTITY

**Item 4b. Executed, not reasoned about.** This is the highest-consequence
finding in the range: this instrument produced ADR-0009's measured path-form
table, the merge-only identity rule rests on that table, and `DocumentService`
and the write-target check rest on the rule.

It already carries a control — `usable.length < 2` prints `MEASURED NOTHING` and
exits 1 — added after its very first run reported `UNIFIES` having resolved
nothing. **That control is a count, and a count is satisfied by the two easiest
forms.**

Measured, by running a copy with the redirector host changed to an unreachable
name so every UNC form errors exactly as it would on a machine with admin shares
disabled:

```
2 form(s) resolved.
  realpath.native: 1 distinct
  dev:ino:         1 distinct

UNIFIES. Every form folds to one identity.        exit 0
```

It compared `C:\…` against `\\?\C:\…` — two local forms that were never going to
disagree — never reached the redirector at all, and printed the reassuring
answer with a clean exit. `\\localhost\C$` is an **admin share**, which is
disabled or elevation-gated on a great many Windows machines, so this is the
ordinary configuration and not a contrived one.

The consequence is precise: ADR-0009's correction tells a future reader what
would invalidate its rows and invites them to re-measure. On such a machine that
re-measurement returns **the opposite of the recorded finding**, silently, and
the whole identity rule rests on the row it contradicts.

The recorded table itself stands — it was measured on this machine, where
`\\localhost\C$` does resolve, and re-running the tracked script today still
reports `realpath.native: 2 distinct, dev:ino: 1 distinct`, which is that row.

**Fix:** the floor must span the boundary the instrument exists to measure — at
least one **local** form and at least one **redirector** form resolved, not two
forms of any kind.

### Finding R-2 — `pathsEqual` depends on the process locale, in an identity primitive

**Item 2, the hard shape.** `documentIdentity.ts` compares canonical paths with
`localeCompare(a, b, undefined, { sensitivity: 'accent' })`. Measured:

| locale | `FILE.pdf` vs `file.pdf` | `resume` vs `résumé` |
|---|---|---|
| default (en-US here) | EQUAL | differ |
| `tr-TR` | **differ** | differ |
| `lt-LT` | EQUAL | differ |

Under a Turkish locale the *plain* case pair stops matching, because `FILE` and
`file` contain `I`/`i` and Turkish collation pairs those with different letters.
NTFS does not work that way: its case folding comes from the volume's uppercase
table and carries no locale tailoring.

The failure direction is the dangerous one. Row 1 of the merge rule failing to
merge means **two `DocId`s for one file**, which is two command logs and a save
that discards the other's edits — the exact loss the module exists to prevent.

**Latent today, and the reason it is latent is the reason it will not stay
that way.** Both sides currently come from `readFileIdentity`, so both strings
are byte-identical and any locale returns 0. The function's own comment names
the case that makes it live: *"a caller may hold a value from a different
source, and NTFS is case-insensitive"* — which is the justification for doing a
case-insensitive compare at all. The intended future use is precisely what
breaks it.

**Fix:** `toUpperCase()`, which is locale-**in**dependent (unlike
`toLocaleUpperCase`) and matches the uppercase-table approach. Measured: it
returns EQUAL for both case pairs and `differ` for the accent pair, in every
locale.

### Findings R-3 to R-7 — five fix-induced defects, all already closed

Every one arrived **inside code written to close the previous step**. Third
range in a row where that is the dominant shape, and the case for scoping the
audit to a range rather than to the tree makes itself again: a tree-wide sweep
finds these by luck, a range-scoped one reads the diff that made them.

| # | Defect | Shape |
|---|---|---|
| R-3 | Replacement detection routed through `isSameDocument`, so **every replaced file reported `sole-writer`** | wrong question — the two take the same pair of identities and ask opposite things; path equality is sufficient evidence for one and carries none for the other |
| R-4 | The concurrent-open control passed with the index lane **removed** | vacuous proof — it ran against the real filesystem and the two `realpath`+`stat` pairs happened to land far enough apart |
| R-5 | The 4b control's message named two causes and there are **three** — `close` bypasses the lane by design and can land mid-check | a correct guard with a message that sends the next reader hunting a race that never happened |
| R-6 | The advisory-register proof asserted only that a corrupt register **fails**, and passed identically with the fix reverted | vacuous proof — second in two days |
| R-7 | `reviewed` was the one load-bearing key still guarded **by accident** | two-thirds of a class fix |

R-3, R-4 and R-5 were caught by proofs and review before they shipped anywhere.
R-6 and R-7 were caught by mutation testing during the same session that
introduced them. All five are closed, with controls that go red on the
mutation.

### Finding R-8 — a defect from the REVIEW seat, recorded because the record is one-sided otherwise

The reason given for fixing `readBaseline`'s bare `catch` was that a trailing
comma **converted a corrupt register into a clean pass**. It did not. Restoring
the `catch` and feeding the checker a register with one stray comma turned it
red on `74 advisory/advisories have no recorded verdict` — an unreadable
register also yields an empty `reviewed` map, so every advisory read as
untriaged.

The claim was **one condition worse than the truth**. The clean pass needs the
advisory feed at zero as well, which is reachable but is a compound state, not
the simple one described.

What caught it was refusing to write down a claim that had not been reproduced.
The check cost twenty seconds. Had it gone in as stated, the journal would carry
a defect worse than the one that existed, in the document whose only value is
that it is accurate.

**This is the first finding in this record that originates from the review seat
rather than the build seat**, and it is written down for that reason. A record
in which only the builder is ever corrected is not a record of what happened; it
is a record of who was watching whom. An overstatement from the reviewing side
is also harder to catch later, because it arrives with authority on it.

### The rest of the checklist

**1 — root cause or workaround?** Every fix in the range names a mechanism. Two
are worth stating as root-cause rather than symptom: the `.ocr` handler set is
removed at **registration** rather than filtered at open, and `readBaseline`
now **throws by name per key** rather than growing an `if` per instance.
`--baseline <path>` was examined as a possible escape hatch and is not one: it
selects *which* register is read, never *whether* a check runs, and — since
`d9f01b0` — pointing it at a nonexistent file throws by construction, so it
cannot become a route to a quiet pass.

**3 — would CI have caught it?** R-3 to R-7, yes: all are covered by tests or
proofs that now run in CI, including `proof:advisories`. **R-1 and R-2, no.**
`pathIdentity.mjs` is a spike, run by hand, and nothing in CI executes it — which
is exactly why 4b insists the control lives *in the instrument* rather than only
in a proof. `pathsEqual`'s locale dependence is invisible to a suite running
under `en-US`.

**4 — proofs non-vacuous?** Nine mutations across the range, each confirmed red
against the case named for it: six on `DocumentService` (index lane, close
ordering, the 4b control, contested, dedup, over-merge) and three on the
advisory register (parse swallow, control failures ignored, `reviewed`
unguarded). Two of the nine found a vacuous control instead — R-4 and R-6.

**4a — resolution.** `pathIdentity` **passes**: fed the local and UNC forms of
one file, it reports `realpath.native: 2 distinct` against `dev:ino: 1 distinct`,
which is precisely the distinction ADR-0009's row claims and precisely what a
collapsed comparison would hide.

**5 — executed or asserted?** Re-verified rather than carried forward: the
environment ADR-0009 pins its rows to is still the environment
(`node 24.12.0 / libuv 1.51.0 / win32 x64 10.0.26200`). Still asserted and
labelled as such: the mapped-network-drive row, which no machine here can
produce. Withdrawn on measurement: R-8.

**6 — architecture before feature?** Clean. `ab6c153` (invariants 24 and 25) and
`8acdc95` (Store-only distribution) are both B4 amendments in their own commits,
both landing *before* the code they constrain. `DocumentService` was built on an
ADR-0009 amended first, not retrofitted under it.

**7 — documents match code?** `check:docs` passes its eight checks. The
`DocumentService` and CommandBus rows in `FEATURES.md` state what is not built
as explicitly as what is, and the sequencing constraint on the lane is on the
row rather than in anyone's memory.

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

### Then the class, because two of three keys is not a fix

`reachability` and `reachabilityControl` got a guard each, written one at a
time in response to one instance each. `reviewed` did not: it was defaulted
from a spread, arrived `undefined` from a truncated file, and killed the
untriaged filter with a `TypeError` instead of naming the register.

**And `reviewed` is the key whose accidental guard corrected the premise for
this whole fix.** The one key still protected by coincidence was the one that
produced the coincidence. Its failure is loud — but only while the feed returns
entries, which is the same condition that made the previous accidental control
conditional. Truncated register plus an empty feed is the identical compound
clean pass, reached through the third key instead of the first.

So the keys are a table rather than four `if` blocks, each naming what an
absent or an empty one means. The asymmetry is deliberate and asserted:
`watch` may legitimately be empty — zero hand-curated upstream items is a real
state — but its **key** must be present, because that is what separates it from
a file that lost the section. Claiming "every key must be non-empty" would have
been stricter than the evidence supports.

Two things the tooling found that the proof did not:

- **`typeof null === 'object'`**, so `"reviewed": null` passed the obvious
  shape check and died later on a `TypeError` — the exact failure the table
  exists to replace with a named error. Found by `tsc`, not by a test, and now
  a case of its own.
- a dynamic `delete` in the proof, which lint rejected; the truncation fixtures
  are built by filtering keys instead.

17 cases. Removing `reviewed` from the table turns exactly the two cases named
for it red, and they fail on the **reason** — the check still goes red, just
not for a reason connected to what it guards, which is the distinction the
whole entry is about.

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

### Third fire, and the first from the review seat

The guard denied an `echo` with ANSI-C quoting — **in the reviewing session, not
the building one**. Third recorded unprompted fire after 2026-08-18T06:45Z and
the `node -p` above.

What is new is not the count. It is that nothing until now had shown the hook
covers **both seats**. Every prior observation came from the session writing
code, which left "does it protect the reviewer too" as an assumption nobody had
tested — and the reviewing seat runs verification commands constantly, which is
exactly where an `echo` or a `printf` gets reached for.

Two fires in the build seat and one in the review seat is still a pattern rather
than a law, and limit 2's asymmetry governs each of them.

### The delegation shape, swept — and empty

The NUL defect had a searchable shape: **a check reasoning "that other check
already handles this case", where the other check's scope is narrower than what
was handed to it.** The guard's comment was correct about its reasoning and
wrong only about scope, and nothing about it looked wrong — which is what makes
the shape worth sweeping for rather than waiting to trip over again.

Swept **every `.mjs` and `.ts` in the repository** — not only the guard and
security directories — for the phrasing (*already handled*, *keys on*, *covered
by*, *delegated to*) and for the underlying mechanism (`subarray`,
`slice(0, …)`, window and limit constants used by one check and relied on by
another).

**The search's positive control, which is what makes the empty result worth
anything.** Run against the **pre-fix** `guardFiles.mjs`, the patterns
`already handled` and `keys on` hit lines 298 and 452 — the defect itself. So
the sweep demonstrably finds the thing it was built for, and the proof is one
`git show 612d896~1` away and permanent. A sweep reporting nothing is worth
exactly as much as its evidence that it can report something (audit item 4b).

**Nothing found.** Recorded as checked-and-empty, which is a different record
from not looking. The near-misses and why each is sound:

- `executableSignature(head)` also reads only the sniff window — correct, and
  not the same shape: a magic-byte signature is a property of the file's start
  by definition, so the window is the whole question rather than a sample of it.
- `ocrDoors.mjs` says its empty-set floors "catch only the ones that empty an
  INPUT". That is the pattern done **right**: it names the limitation and then
  adds the control that covers the remainder, instead of handing the case to
  something narrower.
- `lockfileIntegrity.mjs`'s `.slice(0, 12)` truncates displayed error lines, not
  a check's scope.
- `generateNotice.mjs` scopes licences deliberately; `secretScan.mjs` **refuses**
  to delegate rather than delegating; `blockEscapeResolvingWrites.proof.mjs`
  enforces that every property has a case.

**What "checked and empty" does NOT mean here, stated so it is not read as
stronger than it is.** This sweep matches **comments**. It finds *documented*
delegations only. A check that silently assumes another covers a case, with
nothing written down, is invisible to it — and the next one may well be exactly
that, since this one was documented by luck rather than by policy.

**The instrument for the undocumented kind already exists, and it is not a
better sweep.** It is a proof case sitting on each check's **scope boundary**:
the past-8000-byte case and its NUL twin are precisely that, and they would have
caught this with no comment to grep. Boundary cases are the general mechanism;
the sweep is the cheap one-off. Recorded together so nobody repeats the sweep
later and believes it covers more than it does.

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
