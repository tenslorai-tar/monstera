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
> **CLOSED, 2026-08-20, with a check rather than a narrowing.** `ci.yml` gains a
> `floor` job at 22.19.0 running the JS-only half — install, typecheck, lint,
> tests; no native build, because the shim is a Windows toolchain matter and not
> what the floor claim is about. Narrowing `engines` to 24 would have shut out a
> contributor on Node 22 for no measured reason; the honest close is to test the
> claim, not to shrink it until it is trivially true. `NODE_FLOOR` in
> `toolchain.mjs` is the one declaration, and `proof:toolchain` fails if it
> disagrees with `engines.node`, if it equals the pinned runner version (a floor
> row testing nothing new), or if **no job runs the floor at all** — the last
> being what stops deleting the row from leaving every other case green.
>
> #### THE THIRD RUNTIME — recorded with a firing condition, not acted on
>
> There are three Node versions here, not two, and the third arrives with
> Electron:
>
> | surface | runtime | floor |
> |---|---|---|
> | `scripts/` and build tooling | the contributor's Node | `>=22.19.0`, now tested |
> | `packages/kernel`, `apps/desktop` | **Electron's bundled Node 24.18.1** | one known version |
>
> One `@types/node@22.20.1` types both. For `scripts/` that is correct — types at
> the supported floor. **For shipped code it is not a floor at all**: it
> under-types a runtime pinned exactly, so a Node 24 API available at runtime is
> a compile error, and the types describe a version the application never runs
> on.
>
> **Not restructured now, deliberately.** Per-workspace `@types/node` with no
> data point behind it is a premature abstraction, and today nothing in either
> package wants an API the floor types lack — measured, since both typecheck
> halves are green with Electron imported.
>
> **The firing condition, stated so it is recognised when it happens:** the day a
> file under `packages/kernel/src` or `apps/desktop/src` wants an API newer than
> the floor types. The answer then is a per-workspace `@types/node` matching
> Electron's bundled Node, **not** raising the root one, which would re-break
> `scripts/`.
>
> It is **not** a register entry, and that is a judgement rather than an
> oversight: `engine-advisories.json`'s triggers are text searches over shipped
> paths, and *"wants an API newer than the floor types"* is not a string. The
> trigger is `tsc` itself — the condition announces itself as a compile error on
> a Node global or method — so what this record owes is that whoever meets that
> error finds the cause here instead of reaching for a cast.
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

## 2026-08-28 — Stage audit: `c8fa4d0..2091b91` — the fence around the DOM has a hole the shape of its own roots, and a document went stale a range ago

**Audited through `2091b91`.** Pasted from `npm run audit:scope`:

```
Unaudited range: c8fa4d0..HEAD
  commits: 5 (one batch is 9)
  files:   22 (one batch is 24)

  proofs ADDED — new coverage (4):
    packages/shared/src/colour.test.ts
    packages/ui/src/documentStores.test.ts
    packages/ui/src/renderVehicle.test.tsx
    scripts/proofs/domEnvironment.proof.mjs
  proofs MODIFIED (1):
    scripts/proofs/electronImports.proof.mjs   net +14 -0
  proofs REMOVED: none
  source FILES ADDED (4):
    packages/shared/src/colour.ts
    packages/testing/src/domCleanup.ts
    packages/ui/src/documentStores.ts
    scripts/lib/domEnvironment.mjs
  source FILES CHANGED (3):
    packages/shared/src/index.ts    net  +1 -0
    packages/ui/src/index.ts        net  +7 -0
    scripts/lib/tokenContrast.mjs   net +64 -61
  source FILES REMOVED: none
```

The range is `onColor`, the per-document stores, ADR-0029, and the
component-test vehicle. **The audit was not owed at this point** — 5 commits, 22
files, both inside the batch — and is run here because the next commit crosses
the gate and the pre-commit hook blocked it, which is the mechanism working.

### EEEE-1 — `check:domenvironment` cannot see the thing it forbids, and I wrote it this morning

The check exists because installing `happy-dom` created a capability that
`CLAUDE.md`'s rule — *a test that must fake `DOMMatrix` or a window bridge is
evidence the boundary is wrong* — had never needed a mechanism for. It requires
the `node` environment outside `packages/ui`. It has a positive control, it
refuses on an empty walk, its proof executes both refusal branches, and mutating
its rule to a deny-list reddens 4 of 10 cases.

**And it is blind to a DOM in `scripts/`.** Measured, by writing a probe file
and **deleting it immediately** — it is not in the tree and was never committed,
which is why the paths below resolve to nothing:

```
scripts/auditprobe.test.mjs  (written, run, deleted — no longer exists)
  first line naming happy-dom as its environment

  npx vitest run scripts/auditprobe.test.mjs   →  Test Files 1 passed
    (since deleted)                                (typeof document === 'object')
  node scripts/lib/domEnvironment.mjs          →  "no test outside packages/ui
                                                   names one", 118 files, exit 0
```

Two axes, and both were narrow from the first line I typed:

| axis | what I wrote | what governs |
|---|---|---|
| root | `['packages', 'apps']` | `vitest.config.mjs` sets **no `include`**, so vitest collects from the whole repository |
| pattern | `.ts` and `.tsx` | vitest's default is `?(c\|m)[jt]s?(x)` — `.mjs`, `.cjs`, `.js`, `.jsx`, `.mts` all collect |

These are W-1's *pattern* and X-1's *root*, the two axes of this classifier the
audit-scope report has already been fixed on, in a new instrument, one range
later. The remedy is not to widen the two lists — that is the same guess again —
it is that **the governed set is the set of files vitest collects**, so the
extent must come from vitest's own rule rather than from a second opinion about
where tests live (B3a).

**The anchor was present and on the wrong axis.** The check refuses when
`filesScanned === 0`, which catches a walk that broke. It cannot catch a walk
that succeeded over the wrong set, because 118 files is a confident number
either way. Checklist 4c asks which direction the danger runs; here it runs
toward a *smaller* set, and a count derived from the walk agrees with any
smaller set it produces.

Not fixed in this commit, which is docs-only by rule. Fixed in the next.

### EEEE-2 — `docs/UI-GUIDE.md` says React is not installed, and it has been since the previous range

Found by running item 7's NNN-4 compensation — *a range that states a
cross-document relationship must sweep every other statement of that
relationship* — for the first time since it was written. This range states one:
`onColor`'s home is `packages/shared`, and `d81b3fd`'s whole subject is that the
WCAG formula has one writer. Sweeping `computed at the point of use` and
`storing a derived color` across the documents surfaced `docs/UI-GUIDE.md`,
which no check reads and which nobody had opened.

Three stale claims, all in the *"Strings, dialogs, icons"* and accessibility
sections:

1. *"Owed: the primitive. `packages/ui/src/` holds `bridge.ts`, `index.ts` and
   `tokens.css`, and no component at all."* — false as of the next commit.
2. *"Neither axe-core nor Playwright is installed, and React is not installed
   either."* — **React was installed in `3e25b74`, inside the PREVIOUS range**,
   and that audit's item 7 did not reach it. axe and Playwright are still
   absent, so this is a compound claim with one clause dead and one alive, which
   the checklist names as the shape no reader flags: the half you check is the
   half that is still true.
3. *"None of the four rules below has a mechanism yet."* — the dialog rule
   acquires one with the primitive.

This is NNN-4's own point demonstrated rather than restated: **a document is
falsified by a commit that never touches it**, so no range-scoped sweep of
changed files can reach it. What reached it was a sweep keyed on the *subject*
the range asserts.

### EEEE-3 — I wrote a false claim while writing up the true one

The `docs/FEATURES.md` row for the design substrate, edited in the next commit,
listed *"Still owed: `docs/UI-GUIDE.md`"*. **The file exists — 192 lines,
committed at `8288aac`.** The claim was false at the moment it was written, so
no sweep for staleness could ever have found it (AAAA-8), and it was caught two
minutes later by the sweep run for EEEE-2 against a different question.

The tell AAAA-8 gives is *a claim that names one axis where the evidence varies
on two*. This one is simpler and worse: I listed what a row owed from the row's
own text without opening the file, and `check:docs` cannot help because a
document existing is not a link. Corrected before that commit lands.

### 1. Root cause or workaround?

Four corrections in the range. Three are root-cause; **one I am classifying as a
workaround and flagging rather than defending.**

- **`useOnColor` holding state → writing to the element.** Root cause.
  `react-hooks/set-state-in-effect` rejected the first version and was pointing
  at a defect rather than a shape it disliked: that version's dependencies were
  the token *names*, which do not change when the theme does, so it solved once
  at mount and then held a stale colour — the stored derived colour ADR-0003
  forbids, arriving by the back door inside the hook written to prevent it. The
  rewrite holds no state and a `MutationObserver` on `data-theme` makes the
  answer follow the theme; disabling the observer reddens that case.
- **`fireEvent.change` for the input.** Root cause, and the diagnosis is the
  finding: React tracks an input's value through its own property descriptor, so
  assigning `.value` and dispatching `input` is invisible to it. **It read as a
  broken component for one run and was a broken harness.**
- **The docblock described rather than spelled in `domCleanup.ts`.** Root cause,
  and the same move `borderTokens.mjs` already makes: a scan cannot tell a prose
  mention from a directive, so the marker is not written out in prose.
- **`useOnColor` reading tokens at the document element rather than at the
  target.** *Prompted by a harness limitation, and weaker than the alternative.*
  happy-dom does not inherit custom properties to a child — measured — so
  reading at the element cannot be tested there at all. Reading at the root is
  correct **as long as every theme is applied to `<html>`**, which is how
  `tokens.css` is written today; reading at the element would be correct in that
  case *and* under a subtree theme. So I chose the narrower rule after the
  broader one turned out to be untestable, which is the shape Rule 0 warns
  about, and the honest classification is a workaround with a stated trigger
  rather than a fix. The trigger is written into the module: *the first time a
  theme attribute is set on anything other than the document element.* **Owner's
  to overrule.**

### 2. Verified against the easy shape only?

The vehicle was verified here and then on **both CI legs** — board GREEN at
`2091b91`, `CI=success, Guards=success` — so the ambient-environment axis is
covered by two machines rather than one.

The hard shape I did test, because it is the one that separates: the Button's
contrast fixture uses the **real** `--text` and `--accent`, which measure about
1.8:1 and therefore *fail* the 4.5 a label needs. A fixture whose text already
cleared its fill is satisfied by a component that ignores `onColor` entirely —
defect and correct behaviour produce the same colour.

The hard shape I did **not** test is EEEE-1: I verified `check:domenvironment`
against the tree it was written for and never asked what a test file outside
that tree looks like to it.

### 2a. Has a change to HOW something is proven moved the coverage?

Yes, once, and the commit stated it. `check:tokencontrast` implemented the WCAG
formula; it now imports it from `packages/shared/dist`, so **a check that needed
no build now needs one.** That is 2a's exact shape — a provisioning condition an
assertion did not have.

It differs from the electron-symbols case in the direction that matters: a
missing or stale build **throws** rather than reporting *unverifiable*, so it
fails closed. Verified independently rather than taken from the commit message:
`check:tokencontrast` runs at `ci.yml:197`, in the `build` job, which runs
`npm run build` at line 144. It appears in no other job.

### 3. Would CI have caught it?

**EEEE-1: no, and it never will as written** — the check is registered
(`ci.yml`, two steps, both green at `2091b91`) and reports success over the
wrong set, which is the failure that looks exactly like coverage.

**EEEE-2 and EEEE-3: no.** `docs/UI-GUIDE.md` is read by no check. `check:docs`
verifies that links resolve and that FEATURES rows are well-formed; neither can
see a sentence that has become false, and EEEE-3 was never true.

Answered from a run, not from the workflow file: the board at `2091b91` is
`Guards=success, CI=success`, so every check discussed here executed.

**And the other way round — a defect this machine cannot see?** One branch keyed
on provisioning entered the range: `tokenContrast.mjs`'s build-freshness guard.
Its throwing side executes wherever `dist` is absent, which is a fresh clone —
not here, where `npm run typecheck` has run all day. It is exercised by
`proof:tokencontrast`, which is registered on the same job.

### 4. Non-vacuous proofs

Mutations run, and what each said:

| mutation | result |
|---|---|
| `domEnvironment` rule → deny-list of happy-dom/jsdom | 4 of 10 cases red, including both fail-closed ones |
| `setupFiles` removed from `vitest.config.mjs` | exactly 1 of 5 vehicle cases red, `expected 1 to be +0` |
| `onColor` minimum 4.5 → 1 | both Button colour cases red, nothing else |
| `MutationObserver` callback emptied | the theme-change case red |
| `aria-label` → `data-label` on `IconButton` | 8 cases red across two files |
| `modal` → `modal={false}` on `Dialog` | **exactly one** case red |

**The last one is the finding.** The focus-guard case survives it: Base UI
installs guards for a non-modal popup too. So that case is evidence the dialog
is a real Base UI popup — which is what goes red if someone re-derives one from
a `div`, the failure Rule 0 names — and it is **not** evidence that focus is
trapped. Written into the test file beside the case, because a reader counting
cases that mention focus would otherwise count its coverage at three when it is
one.

### 4a. Instrument resolution tests

The vehicle is itself an instrument, and it was resolution-tested before
anything was built on it: focus on element A versus element B must read as two
different values, and a key event must reach the focused element. Both would
pass vacuously in a DOM where `focus()` does nothing and `activeElement` is
always `body` — the primitives' entire keyboard story rests on those two, and
four cases in `Dialog.test.tsx` would have asserted into a void.

Two harness properties measured rather than assumed, both by writing a probe and
deleting it: happy-dom **does not** inherit custom properties to a child, and it
injects **no** `<style>` element for a Base UI dialog with or without
`CSPProvider`.

### 4b. Searches with positive controls

`domEnvironment.mjs` carries a control fixture — a kernel path naming a DOM —
run on every invocation, and refuses to report when it goes unfound. That
control is sound and **it is not what EEEE-1 needed**: it proves the *matcher*
can see, and the blindness is in the *walk*. A positive control on the pattern
does not test the roots, and both produce "found nothing" in the same voice.

The CSP claim about Base UI is a search and is recorded as one: grepped against
`@base-ui/react@1.7.0` in `node_modules` on 2026-08-28, `styleDisableScrollbar`
has exactly two `getElement` call sites, `ScrollAreaRoot.js` and
`SelectPopup.js`, both gated on `!disableStyleElements`. It found five hits
including two non-matches, so it was not blind — but it has no standing control
and is a claim about one version's shipped JavaScript, not a proof.

### 4c. Does this check derive its extent from the set it governs?

Three rosters entered the range.

- **`domEnvironment.mjs`'s file walk — the defect above.** Its extent is derived
  from two hard-coded roots and two extensions, and its anchor (`filesScanned >
  0`) sits on a different axis from the danger, which runs toward a *smaller*
  set. 118 files reads as thorough whichever 118 they are.
- **`createRoster(failures, { cases: 10 })`** in the new proof — a literal, so a
  case silently dropped is a hard failure. Correct direction.
- **`ICON_SIZES`** in `iconSize.ts` — typed as a four-tuple rather than
  `IconSize[]`, so a fifth use added to the union without being added to the
  roster is a compile error. This one is used as a roster by a test that asserts
  all four sizes produce distinct classes, and without the tuple that test would
  agree with any shrink.

### 5. Executed, or asserted?

**Executed:** every mutation in item 4 · the two happy-dom probes · the blind-spot
demonstration in EEEE-1 · the board read at `2091b91` · `npm test` at 586 cases ·
`typecheck`, `lint`, and the sweep-invisible seven (`notice:check`,
`brand:check`, `guard:staged`, `guard:tree`, `perf:gate`, `electron:surface`,
`shim:reach`, `ocr:doors`) · `check:tokencontrast`'s job placement, read out of
`ci.yml` by line number · `docs/UI-GUIDE.md`'s existence and line count.

**Asserted, and owed:** that `disableStyleElements` is the right answer for
`Select` and `ScrollArea` under `style-src 'self'` — happy-dom enforces no CSP,
so **no test written here can separate the guarded case from the unguarded one**,
and writing one would be the vacuous fixture item 4 forbids. The observation is
owed to the Playwright pass against a real Chromium. That a primary button's
computed colour is *legible on screen* — the tests prove a ratio, and §10.7's
visual pass is what proves a rendering. That an icon is 16 px — no stylesheet is
loaded in a component test, and asserting it would mean building the second
copy of §10.4's table that `iconSize.ts` exists to refuse.

### 6. Did architecture change before the feature, or underneath it?

No amendment was needed and none was made. The primitives register into §10.4
and ADR-0005 as they stand; the test vehicle is a toolchain addition, which
ADR-0004 is the writer of record for, and it was taken by the owner's ruling and
appended there in the same commit as the install.

**Two amendments remain owed to one §9.17 clause and neither knows about the
other** — ADR-0028's ready replacement text for *"main runs the language runtime
and nothing else"* (`docs/ARCHITECTURE.md:746`), and ADR-0025's `mupdf-host`
baseline once the readings settle. Whichever lands first must name the other as
pending in the amendment log. Unchanged by this range and repeated here so it
does not fall off.

### 7. Do the documents still match the code?

EEEE-2 and EEEE-3 are this item's findings and both are above.

Everything else checked: `docs/DECISIONS/README.md` now records ADR-0004 as
corrected — `check:docs` caught that omission itself, which is the widened
correction-form pattern from XXXX-2 doing the job it was widened for.
`docs/FEATURES.md`'s design-substrate row is edited rather than annotated,
because a FEATURES row is a live specification and a correction underneath it
leaves the false body holding the contract position.

**ADR-0004 carries a correction, not an edit:** its *"lucide-react is ISC, not
MIT"* consequence was read off the registry's licence field, and the package's
own `LICENSE` is 43 lines carrying **two** grants — ISC, plus 110 Feather icons
under MIT, copyright Cole Bemis. `x`, the only icon Stage 0 ships, is on that
list. Nothing about compatibility changes; the manifest's obligation does. The
generator was already right, because it copies the file rather than the field —
which is the same reason Part J insists NOTICE be generated at all.

---

## 2026-08-28 — Stage audit: `36a988b..c8fa4d0` — two red boards, one family: half of a two-part check, read as covering both

**Audited through `c8fa4d0`.** Pasted from `npm run audit:scope`:

```
Unaudited range: 36a988b..HEAD
  commits: 9 (one batch is 9)
  files:   23 (one batch is 24)
  proofs ADDED — new coverage: none
  proofs MODIFIED (5):  engineHostConnection.test.ts  net +124 -28
                        engineReaderChannel.test.ts   net  +55 -0
                        hostWriteQueue.test.ts        net  +32 -0
                        electronImports.proof.mjs     net  +17 -0
                        peakRss.proof.mjs             net  +93 -2 (1 deletion hidden)
  proofs REMOVED: none
  source FILES ADDED: none
  source FILES CHANGED (9):  engineHostConnection.ts   net +146 -5
                             engineReaderChannel.ts    net  +51 -1
                             hostWriteQueue.ts         net  +84 -8
                             readerProtocol.ts         net  +31 -1
                             readerWorker.ts           net  +12 -0
                             checkLocal.mjs            net  +15 -5
                             documentConsistency.mjs   net  +83 -6
                             peakRss.mjs               net  +37 -0
                             roleMupdfHost.mjs         net +624 -117
  source FILES REMOVED: none
```

The range is YYYY-1 in three parts, the `mupdf-host` role driving the real host,
YYYY-2, XXXX-2, ADR-0005's library set, and ZZZZ-1.

**Nothing was added and nothing removed — every proof in the range is a
MODIFIED one**, which the report calls its load-bearing column, and all five
diffs were read.

### The two reds, and why they are one finding

`a269621` failed CI on ubuntu; `3e25b74` failed CI on the shim job. Different
checks, different platforms, same shape: **I ran one half of a two-part
verification and read its green as covering both halves.**

| | I ran | the half I did not | what it cost |
|---|---|---|---|
| YYYY-2 | the two new `reportPeakOf` cases, on Windows | what they do where `peakWorkingSetOf` throws | red on ubuntu |
| ZZZZ-1 | `proof:licences` — *can* a notice be generated | `notice:check` — does the COMMITTED notice match the tree | red on the shim job |

Neither needed new information. `peakWorkingSetOf`'s Windows-only rule is in its
own header, which I had read that hour; `notice:check` is a script in the same
`package.json` I derive the sweep from. **Both were answerable before the push
from material already in front of me**, which is what makes them one finding
rather than two coincidences.

### ZZZZ-1 — the pre-push sweep cannot see `notice:check`, and the reason is its name

`checkLocal.mjs` derives its set from `package.json` by NAME: every script
starting `check:` or `proof:`. `notice:check` starts with `notice:`. It is a
real verification step — pass/fail, wired into CI, runnable locally, and the one
that reddened `3e25b74` — and the sweep is blind to it because of what it is
called. So are `brand:check`, `guard:staged`, `guard:tree`, `perf:gate`,
`electron:surface`, `shim:reach` and `ocr:doors`.

`checkLocal.mjs` documents two limits already, and this is a **third of a
different kind**: those two are about *reach* — a provisioning-keyed branch, a
CI-only proof — and this one is about the **classifier**. The classifier is a
naming convention, which is the shape this repository has already named once:
*a file-naming convention is not a check* (W-1), there about which FILES count
as proofs, here about which SCRIPTS count as checks.

**Its failure is silent in the way that matters.** A script outside the pattern
produces no error, no warning and no absence anyone can see; the sweep reports a
smaller number and calls it 29 of 29. That is item 4b's reassuring answer
arriving in a *roster* rather than in a search.

**The remedy is a decision and is recorded rather than taken.** Renaming into
the pattern makes the name the classifier, so an unswept check cannot exist
without being visibly misnamed (B5), at the cost of a sweep of every workflow
reference. A roster beside the derivation is the other shape, and 4c says its
danger runs toward shrinkage, so it would need an anchor. Both are larger than
the board fix they were found by, and neither belonged in the commit that
unreddened `main`.

### 1. Root cause or workaround?

Nine commits. **One repair is a genuine loosening and is named rather than
absorbed**, and two more have the shape of something banned.

- **`WriteRefusal` gained a non-terminal member.** `hostWriteQueue.ts`'s header
  said *"every refusal is terminal, and that is the shape rather than a
  policy"*. That is now false and the paragraph was corrected in the same
  commit. What makes it a root-cause fix rather than a special case is that the
  header's own argument — a frame the peer never sees desynchronises the stream
  — **needs a stream**, and `ERROR_PIPE_LISTENING` says there is not one yet:
  the instance is in its listening state, nothing has been written, no offsets
  exist to be wrong. Nor can it arrive mid-stream, since an instance returns to
  listening only through `DisconnectNamedPipe`, which nothing calls.
- **The factory's signature changed from `Result` to `Promise<Result>`.** Not a
  B4, and checked rather than assumed: ADR-0023's three *synchronous* mentions
  are about cloning reader bytes and about `work` over a live handle, and
  `engineSessions.ts:381`'s is about `onEnded`, which is unchanged. Nothing
  required the factory to be synchronous.
- **`documentConsistency.mjs`'s pattern was widened**, which is a loosening in
  form and a strengthening in fact: it now matches four correction heading forms
  where it matched one, and nine ADRs that were reported clean are now reported
  correctly.

**Nothing in this range could regenerate.** The closest candidate is `NOTICE`,
which is generated rather than hand-maintained, and its check is what caught the
staleness — the mechanism worked; what failed was that I did not run it.

### 2. Verified against the easy shape only?

**Yes, twice, and both are the range's two reds.** YYYY-2 is the platform axis
(Windows measured, Linux not) and ZZZZ-1 is the two-part-check axis. Recorded
above rather than repeated here.

A third that did **not** fail, because it was taken to the hard shape
deliberately: `roleMupdfHost --host` was run against a real contained host on
this machine and then **registered in CI**, because the pipe, the reader thread,
the `connected` message and the factory's wait had unit tests over injected
surfaces and had never run against a real process off one developer machine.
That is the gap YYYY-1 itself came out of.

**A shape still untested, stated:** every contained-host reading remains from a
checkout under a user profile. A checkout on a second volume, or under a
directory whose inherited ACL differs, is a configuration the grant set has
never met.

### 2a. Has a change to HOW something is proven moved the coverage?

**Yes, and one of the two is a reduction that had to be compensated in CI.**

`reportPeakOf`'s two cases are now gated to `win32`. On its own that is a
reduction to zero in CI, because `proof:peakrss` ran on the ubuntu job **and
nowhere else** — the cases would have run on my machine and no other. That is
ZZ-1's shape exactly: a branch keyed on the platform, where the side that never
executes is a specification nobody reads. The proof is now registered on the
Windows job as well, so the two runs cover disjoint halves and each names the
half it skipped.

The strengthening: `engineHostConnection.test.ts` gained three cases the file
could not previously express, and its harness now models the peer arriving at
`resume` — which is where reality puts it, since a suspended process has not run
a line and cannot have opened a pipe.

### 3. Would CI have caught it?

**It did, twice, which is the honest answer and not a good one.** Both defects
were caught by CI rather than before it, and both were answerable locally.

Computed rather than assumed for the rest: `proof:checklocal` and
`proof:affectedproofs` are unconditional steps on Guards, `proof:containergrants`
and now `proof:peakrss` and `roleMupdfHost --no-document` on the Windows CI job,
`proof:peakrss` also on ubuntu.

**And the other direction — a defect this machine cannot see:** the whole
containment path. `containedStart.mjs`, `containerGrants.proof.mjs` and
`roleMupdfHost --host` need `icacls`, a provisioned runtime and a built shim, so
the Linux job cannot run any of them. A grant-set or connection regression is
visible on exactly one of the two boards, which is why the connection acceptance
test was registered on the Windows job rather than left local.

### 4. Non-vacuous proofs

**Six mutations, each reddening only its own cases.**

| mutation | result |
|---|---|
| delete the `ERROR_PIPE_LISTENING` branch | the 536 case reddens; the 232 case stays green |
| treat every errno as non-terminal | the 232 case reddens; the 536 case stays green |
| hand out a client without waiting for the peer | the `connect` case and the fast-fail case redden |
| remove `onConnected`'s latch | the pre-registration case hangs, then times out |
| accept `connected` after an ending | the dead-peer case reddens |
| `reportPeakOf` returns 1 instead of refusing | the refusal case reddens; its control stays green |

Two are worth naming as *pairs* rather than as mutations: the errno branch is a
**classifier**, so one direction proves nothing — a build that treated every
refusal as non-terminal passes the first mutation and fails the second. And the
existing 232 case gained the assertion it never had, that the queue is actually
**shut**; without it that case would have survived the very mutation it exists
to catch.

**The load-bearing case in the whole range is not a mutation but an assertion:**
the `connect` failure case asserts `onEnded` was **not** called. The stage alone
would pass for a build that reported the failure twice — as a refusal and as a
death — and reporting it twice is precisely the defect, since `engineSessions`
counts a death and two deaths poison the document.

### 4a. Instrument resolution tests

`hostFixedCost.mjs` passed its own before reporting — bare 37.8 MB against a
deliberately +8 MB cell at 45.9 MB, recovered 8.1 MB — and its figures priced
ADR-0028's rejected alternative.

No instrument was added. `roleMupdfHost.mjs` changed heavily (+624/−117) and its
two host cells are **paired by construction**: `--no-document` and `--host` run
the same harness so their difference is the document, which is the only way
§9.17's above-baseline subtraction is meaningful. Readings 86.0/86.1/86.0 against
88.1/87.7/87.7.

### 4b. Searches with positive controls

`documentConsistency.mjs`'s correction rule **gained one**, and it is the range's
best example of why: *no ADR is corrected* is that rule's passing answer and it
had been the wrong answer for weeks. Anchored on ADR-0023, which carries
twenty-two body-level corrections in the form the old pattern could not see.

**The control does more than detect blindness — it redirects the diagnosis.**
Mutated by restoring the old pattern, it produces ten problems and the control's
is *first*; without it the other nine read as *these rows are wrong* and send a
reader to the index, which is the opposite of where the defect is.

`check:emittedtemplates` and `sweep:prose` both located their controls on every
run in this range.

### 4c. Does this check derive its extent from the set it governs?

**ZZZZ-1 is this item**, and it is the first instance in this repository where
the derived thing is a set of *scripts to run* rather than a set of files to
scan. `checkLocal.mjs` derives from `package.json` by name prefix; the failure
to fear makes that set **smaller**, and there is no anchor — nothing
independently claims how many verification scripts exist, so seven can sit
outside the sweep with no number disagreeing.

Compare the rosters that do have anchors: `SCANNING_PROOFS` against a literal
`SCANNING_PROOF_COUNT` read by both its callers, and `grantSet`'s derived half
against the host-entry and workspace-group cases.

### 5. Executed, or asserted?

**Executed:** six mutations · both platform paths of `peakRss.proof.mjs`, the
Linux one by forcing the branch · the real contained host, connected and driven,
ten times · `notice:generate` and `notice:check` · `npm ls @babel/core
--omit=dev`, which showed exactly one path · the production-tree counts with and
without Lingui, 118/43 and 19/1 · every version in ADR-0005's set queried from
the registry · `proof:licences` with Lingui removed, 24 cases.

**Asserted, and therefore not findings:** that `roleMupdfHost --no-document`
behaves on a runner as it does here — it is registered and the board is green,
but I cannot read the job log from this seat, so the figure it prints is
unverified by me · that the Zag machines work, since nothing imports them yet ·
that renaming the non-conforming scripts would not break a workflow reference I
have not enumerated.

### 6. Did architecture change before the feature, or underneath it?

**Before.** ADR-0028 was written and the wiring was not. The factory's signature
change is inside an existing seam and its premise was checked against ADR-0023
rather than assumed.

**The near-miss is YYYY-1 itself, and it is worth keeping.** The design that
would have shipped — a client handed out before its peer exists — was not caught
by any test, because every unit test injects surfaces and the race is between a
real process and a real pipe. It was caught by **writing the first caller**, and
the first caller only existed because the role was made to drive the real host.
An instrument found an architecture defect that the architecture's own tests
could not.

### 7. Do the documents still match the code?

`hostWriteQueue.ts`'s header was corrected in the commit that falsified it,
which is XXXX-1's lesson applied in advance rather than found by the next audit.
`checkLocal.mjs`'s stale refusal paragraph and ADR-0028's *"the next commit"*
claim were both corrected in `e4f1499`.

**NNN-4's cross-document sweep fires on this range and was run.** ADR-0005's
library set is a cross-document relationship — the ADR states versions, the
manifests state versions — and they now disagree in one place: the ADR records
the Zag machines at **1.43.0** and the tree carries **1.43.3**. Recorded in the
installing commit rather than edited into the ADR, because an ADR is a record of
what was decided and researched at the time; the manifest is the live statement.

**What this range did NOT sweep, stated:** ADR-0005's supply-chain argument
against Ark UI — *66 packages* — is now falsified by its own chosen i18n
library, which contributes 75. That is recorded in `3e25b74`'s message and is
owed a correction on ADR-0005 once the owner rules on Lingui. It is named here
so the debt is visible rather than resting in a commit message.

---

## 2026-08-28 — Stage audit: `acb2cbb..36a988b` — a header still describes the refusal its own file deleted, and nine corrected ADRs are indexed as uncorrected

**Audited through `36a988b`.** Pasted from `npm run audit:scope`:

```
Unaudited range: acb2cbb..HEAD
  commits: 9 (one batch is 9)
  files:   16 (one batch is 24)
  proofs ADDED — new coverage: none
  proofs MODIFIED (2):       checkLocal.proof.mjs      net +89 -96
                             containerGrants.proof.mjs net +47 -6
  proofs REMOVED: none
  source FILES ADDED: none
  source FILES CHANGED (4):  checkLocal.mjs      net +81 -58  (16 deletions hidden)
                             affectedProofs.mjs  net +37 -7
                             scanningProofs.mjs  net +49 -10
                             containerGrants.mjs net +59 -6
  source FILES REMOVED (1):  sweepScope.mjs
```

The range is WWWW-1 to WWWW-4, the grant set reshaped to directories, the WWW-2
sweep refusal lifted, and ADR-0028.

**`sweepScope.mjs` is the removed instrument, and its removal is the range's
subject rather than a side effect.** Read against its destination by name:
`multiProofSweepRefusal` was its only export, `checkLocal.mjs` its only importer,
and five `checkLocal.proof.mjs` cases went with it — which is why that file is
the only net-negative proof in the range (+89 −96). Nothing was carried away
unnoticed: the four cases that replace them assert the inverted property in both
directions.

**Three findings, all found by reading rather than by anything going red.** Two
are in files this range did not change; the third is in a document this range
added, and is falsified by the commit recording this audit.

### XXXX-1 — `checkLocal.mjs`'s module header still asserts the refusal that `0f7f7de` deleted

Lines 56–60, in the paragraph a reader treats as *what this module is*:

> So this tool is useful over `check:*` and is not a sweep of everything — and
> as of finding WWW-2 that is enforced rather than said: a run selecting more
> than one `proof:*` script in THIS repository is refused before it starts, with
> no flag to turn it off. The measurement and the boundary are on the refusal
> itself, below `filtered`.

There is no refusal, no boundary below `filtered`, and `sweepScope.mjs` does not
exist. The two sections that explain the lift are at lines 279 and 327 — **220
lines below the sentence that contradicts them** — which is item 7's predicted
shape exactly: the author adds a new section saying what changed and leaves the
original paragraph standing, and the stale half keeps the position a reader takes
as the contract.

Three things make it worth a finding rather than a tidy-up.

**It is a compound claim and the surviving clause vouches for the dead one.** The
same sentence continues *"what separates a runnable script from `proof:cff` is
measured cost, not job membership"*, which is still exactly true. Nothing about
reading the paragraph feels wrong, because the part a reader checks is the part
that still holds.

**The ragged line break is the visible residue of a partial edit** — *"below
`filtered`. What"* mid-line, where a clause was removed and the sentence around
it was not re-read. That is a tell available in the diff.

**And no sweep could have reached it.** `sweep:prose` found its positive control
and reported **0 matches in 42 documents** for both *"is refused before it
starts"* and *"selecting more than one proof"*, so no `.md` file carries the
claim. Its root is documents; a stale claim in a **source comment** is outside
what it can see. That is the third occurrence of this shape in a source comment
— `publish`'s destination sentence, the quarantine directory nothing cleaned up,
and now this — against zero occurrences the document sweep has caught. The sweep
is aimed at the corpus where the shape does not happen.

Not fixed in this commit: an audit-recording commit is docs-only and alone, and
this is a source comment. It is the first commit after.

### XXXX-2 — the ADR index rule sees three correction forms as one, and misses nine

`documentConsistency.mjs`'s second rule exists so that *"the index must not
assert a status the file contradicts"*, and decides whether an ADR is corrected
with:

```js
/^>\s*##\s*Correction\s*[—–-]\s*\d{4}-\d{2}-\d{2}/m
```

That matches a **blockquoted banner at the top of the file** — the form used by
ADR-0001, ADR-0007 and ADR-0010, all three of which have index rows saying so.
Ten ADRs carry body-level `## Correction, DATE — …` blocks instead; nine of them
are invisible to the rule and every one of their index rows reads *Accepted*,
with nothing recorded:

```
0006 · 0009 · 0019 · 0020 · 0022 · 0023 · 0024 · 0025 · 0027
```

**This range is where it bites.** Corrections were appended to ADR-0025, ADR-0027
and ADR-0023 in these nine commits, and no index row moved for any of them
because nothing asked.

**The rule has already been fixed once for the same class of blindness, and the
fix stopped at the instance.** Its own comment records it: *"The first version of
this check omitted the EM dash, which is the one the ADRs actually use — so it
found no corrections at all and reported that half as passing."* The dash was
widened; the `>` was not. Half a fix, and the surviving half reports *found
nothing* in exactly the voice of a clean corpus — W-1's pattern axis, in the
check that was written after W-1.

**What is NOT yet decided is which way to repair it**, and that is deliberate.
Either the two heading forms mean different things — a banner retracts the
headline, a body block refines a detail — in which case the distinction belongs
in `docs/DECISIONS/README.md` where an author chooses between them, or they do
not, in which case the pattern widens and nine rows need updating. Today an
author picks the form by accident, and a `>` and a comma decide whether the
index-consistency requirement applies. Recorded rather than guessed at.

### XXXX-3 — a claim I wrote in this range is falsified by the commit recording this audit

ADR-0028's Status line says:

> Per B4 the amendment to `docs/ARCHITECTURE.md` is the next commit and the
> wiring the one after it, so the law states the superseded clause for **exactly
> one commit**.

This audit is the next commit and it is not the amendment, so the count is
wrong the moment this lands. It is a **compound claim** and the surviving half
is the load-bearing one — B4's ordering is being followed, the gap is
deliberate, the amendment does precede the wiring — which is exactly what makes
the dead clause hard to see. The same shape as XXXX-1, committed by me, in the
same hour I wrote the finding about it.

Two things it demonstrates that XXXX-1 does not.

**It was false the day it was written, in the sense AAAA-8 names**: nothing
changed to falsify it, because *"the next commit"* asserted a fact about the
future that no reading of the repository could have supported. B4 requires the
amendment to precede the **feature**; it says nothing about what may sit between
it and the ADR. I wrote the stricter claim because it read better.

**And no sweep will ever find it**, for the same reason: a range-scoped audit
hunts statements that *became* false, and this one never had evidence. It was
caught because the next unit of work happened to be the counterexample.

Corrected in the commit after this one, alongside XXXX-1: *"the amendment
precedes the wiring"*, which is what B4 actually requires and what I could
support.

### 1. Root cause or workaround?

Nine commits, no workaround, and two repairs are worth separating from their
symptoms because both have the *shape* of something banned.

- **The sweep refusal was removed rather than narrowed.** WWW-2's guard rested
  on a premise — that a multi-proof sweep dies under the job object — and the
  investigation it prescribed was run twice: **81 of 81 both times, no errno**.
  Removing a guard is the strongest form of loosening there is, so what makes it
  legal is that the mechanism it guarded against was measured not to exist, and
  the file keeps the diagnostic (`spawnOutcome`, the run-log copy instruction)
  that would report it if it ever does.
- **The injected non-start went 40,000 → 200,000 characters, which is *bump the
  number until it passes* unless the mechanism is named.** It is: Windows caps
  the whole command line at **32,767 characters** and Linux caps a **single
  argument** at `MAX_ARG_STRLEN`, **131,072 bytes**. 40,000 clears the first and
  not the second, so the case passed here and reddened Guards. The assertion
  widened with it, `/ENAMETOOLONG/` → `/ENAMETOOLONG|E2BIG/`, and a widened
  pattern is a loosening in form; what makes this one not a loosening is that
  the alternation is **closed** — those are the two errnos the class produces —
  and the absence of *either* still fails, so a spawn that carried no cause at
  all is still red.

**One check was loosened outright and it is named rather than absorbed.**
`containerGrants.proof.mjs` dropped `set.length === 4` for `set.length > 0`. In
isolation that is this checklist's own warning about a loosened check. What
replaces it is two property cases — the package holding `hostEntry.js` must be
in the set, and both workspace groups must appear — and the reason is at the call
site: a literal count is the right anchor over a **hand-kept** list and becomes a
number people edit to make a red thing green once the list is **derived**. That
is 4c's direction question, asked in the commit that made the change. Mutation
evidence in item 4.

**Nothing in this range could regenerate.** The grant set is derived from the
filesystem, so a workspace package added tomorrow arrives granted rather than
reproducing the exact omission SSSS-1 measured.

### 2. Verified against the easy shape only?

**The range's own answer is that the easy shape was the LOCAL one, and CI held
the hard one** — the reverse of this item's usual direction, and worth recording
because it is the first time that has happened here. The 40,000-character
fixture was verified on Windows, where it is correct, and the platform where it
is wrong is the one this machine cannot run.

The grant reshaping was taken to the hard shape deliberately: **two machines**,
this one and `windows-latest`, with the contained cell reaching its own code on
both. A single-machine containment reading could not have established it, since
the container's refusal of process creation is already known to be
build-dependent.

The **package-root versus `dist`** substitution was measured rather than argued.
I wrote the reasoning first, then made the substitution with everything else held
fixed, and the contained cell died at `module-resolution` — one step *earlier*
than the failure it was meant to fix.

**A shape still untested, stated:** every contained-start reading so far is from
a checkout **under a user profile**. A checkout on a second volume, or under a
directory whose inherited ACL differs, is a configuration the grant set has never
met, and the failure mode there is the one this thread has already paid for
twice — a well-formed set that is incomplete.

### 2a. Has a change to HOW something is proven moved the coverage?

Yes, twice, and they point in opposite directions.

**A reduction:** `containerGrants.proof.mjs`'s count case became two property
cases (item 1). A count is total — it fails on any change in size. The
replacements are specific: they catch the omission that actually happened and a
group disappearing entirely, and they are **silent on a partial shrink** — drop
`packages/shared` from the derived half and every case here still passes.

That is stated in the commit and compensated by mechanism rather than by care:
`containedStart.mjs` now runs on every push, and a host that cannot read a
package it imports does not start. The pairing is the point — *"the one thing
that cannot agree with a roster gone quiet is a host actually starting"* — and it
is why the proof's own comment says it asks whether the set is well **formed**
and cannot ask whether it is **complete**.

**A strengthening:** `checkLocal.proof.mjs`'s five refusal cases became four
inversion cases plus an errno class assertion, and `affectedProofs.mjs` now reads
`rosterMiscount()` rather than the bare array — so the anchor protects the second
caller too, which was VVVV-1's whole finding.

### 3. Would CI have caught it?

**Computed, not assumed.** All three proofs the range's changed files reach are
**unconditional steps**:

| proof | workflow | platform |
|---|---|---|
| `containerGrants.proof.mjs` | `ci.yml:743` | Windows |
| `checkLocal.proof.mjs` | `guards.yml:367` | Linux |
| `affectedProofs.proof.mjs` | `guards.yml:469` | Linux |

And the range contains a **run** that answers the question directly rather than a
reading of the workflow file: Guards went red at `0f7f7de` on the 40,000-character
case, which is CI catching a defect this machine structurally could not see.

**Neither of this audit's two findings is visible to CI, and for different
reasons.** XXXX-1 is a stale claim in a source comment, and nothing in this
repository reads source comments for claims that stopped being true —
`sweep:prose` reads `.md` only. XXXX-2 is a blind spot **inside a check that
passes**: `check:docs` is green on all nine commits and is the thing that cannot
see it, which is the worst version of this item's answer, since the green tick is
what a reader takes as coverage.

**And the other direction — is there a defect THIS MACHINE cannot see?** The
containment work has two worlds and the richer one is here: `containedStart.mjs`
and `containerGrants.proof.mjs` need `icacls`, a provisioned runtime and a built
shim, so the Linux Guards job cannot run either. A grant-set regression is
therefore visible on exactly one of the two boards, which is why the acceptance
test was registered on the Windows job rather than left as a local instrument.

### 4. Non-vacuous proofs

**Three mutations, each reddening only its own cases**, run today against a clean
tree and reverted with `git checkout --`.

| mutation | result |
|---|---|
| `workspacePackages` drops the `apps` group — a **partial** shrink | `proof:containergrants` exit 1, exactly one case red: *"and every workspace package, since the entry imports across them"*. The host-entry case correctly stayed green, so the two cases separate |
| `selectsNoProof` forced `false` in `checkLocal.mjs` | `proof:checklocal` exit 1, exactly one case red: *"a check-only selection also RUNS the scanning roster rather than printing it"*. The opposite-direction case — a deliberate single-proof run is not widened — stayed green |
| `SCANNING_PROOF_COUNT` 9 → 8 | two independent reds: `npm run local` exits **78** before running anything, and `proof:affectedproofs` exits 1. Both callers now read the anchor, which is WWWW-3's fix executed rather than asserted |

The first is the load-bearing one: it was chosen to be the mutation the *bug*
would not produce. Dropping the whole derived half would also fail `set.length >
0`'s neighbours and prove less; dropping one group leaves a well-formed set of
nine paths and is the shape the four-path set actually had.

**Mutations aimed at branches no fixture reaches:** none run this range, and the
candidates are named rather than left implied — `workspacePackages`' `catch`
(an absent `packages/` or `apps/` group, unreachable in a checkout of this
repository) and `readAcl`'s `null` return (an unelevated *Access is denied*,
which this machine does not produce for these paths). Both are the JJJ-1 shape:
branches encoding a true fact about a state no test can construct here.

### 4a. Instrument resolution tests

`hostFixedCost.mjs` was run today at `--runs 3` and **passed its own resolution
test before reporting**: bare runtime 37.8 MB against a deliberately +8 MB cell
at 45.9 MB, recovered 8.1 MB. Its figures are what priced ADR-0028's rejected
alternative 3.

No instrument was added in this range, so there is nothing owing a first
resolution test. `containerGrants.mjs` changed and is not a measuring
instrument — it reports a DACL read back from `icacls`, and its control is the
read-back itself.

### 4b. Searches with positive controls

Three searches ran in this range's service and all three carried controls that
fired:

- `sweep:prose`, twice, for XXXX-1's phrases — **0 matches in 42 documents,
  control found**. The zero means something because the deliberately
  line-wrapped control phrase was located in the same run.
- `check:emittedtemplates` at commit time — *"12 emitted-source template(s) carry
  no backtick"* **and** *"the scan located its positive control, so that result
  means something"*.
- `proof:affectedproofs`, whose `CONTROL_EDGE` requires a known-present import
  edge before the walk's silence counts.

**And the reassuring answer outside a search, which is where this item keeps
arriving:** `npm run local -- --only check:` reported **29 of 29** on its first
run today — and its own disclosure said every index-reading check had inspected
the *previous* content, because the three documents were unstaged. A 29/29 that
means nothing looks identical to one that means everything. It was re-run
staged, where the run adds the line *"the index matches the working tree, so
index-reading checks saw your edits"*. That disclosure passes the printed-
compensation test: it names the two files, so it could not have been printed
before the change.

### 4c. Does this check derive its extent from the set it governs?

**XXXX-2 is this item.** `documentConsistency.mjs`'s correction rule derives
which ADRs are *corrected* from a **heading form**, and the failure to fear makes
that set **smaller** — an ADR whose corrections use the other spelling drops out
silently. There is no anchor: nothing independently claims how many ADRs carry
corrections, so nine can vanish from the rule's view without any number
disagreeing.

The two rosters this range touched are the other direction and both have anchors:

- `SCANNING_PROOFS` against `SCANNING_PROOF_COUNT`, a literal that is
  deliberately **not** `SCANNING_PROOFS.length` — and both of its callers now
  read it, which was VVVV-1.
- `grantSet`'s derived half against the host-entry and workspace-group cases,
  which is a **weaker** anchor than a count and is covered by `containedStart`
  as recorded in 2a.

### 5. Executed, or asserted?

**Executed:** the two-machine contained start · the package-root substitution ·
the 81/81 sweep investigation, twice · `hostFixedCost --runs 3` including its
resolution test · the three mutations above · the elision of
`engineReaderChannel.ts`'s type-only import, read from `apps/desktop/dist/` ·
the two `sweep:prose` searches · `npm run local` twice, once staged.

**Asserted, and therefore not findings:** that a partial shrink of the grant set
is caught by `containedStart` — the mechanism is registered and green, but no
run has been made with a package deliberately dropped · that ADR-0028's amended
clause is enforceable once a scan for what `main` binds exists — no such scan is
written · that the marginal cost of `win32HostSurface.js` on `composition.js` is
~1.0 MB, which came from an **untracked** probe and is why ADR-0028 is built on
the 2.7 MB absolute instead.

### 6. Did architecture change before the feature, or underneath it?

**Before, and this range is the clearest instance of it so far.** The wiring was
surveyed and not built; the survey found that §9.17 assigns the FFI binding to
`mupdf-host` by name while ADR-0022 requires it in `main`; ADR-0028 is that
conflict recorded and decided, with the amendment and the wiring as the two
commits after.

**And the near-miss is the part worth keeping.** ADR-0023's note of 2026-08-27
resolved the same question as *"a note rather than a B4"* by reaching for a
dynamic import — a placement that reads as compliance while the clause it was
avoiding stays false. That is Rule 0's shape, one step from being built on, and
it was caught by the reviewing seat rather than by me. The note now carries a
dated correction saying so.

### 7. Do the documents still match the code?

**XXXX-1 says no**, in the file whose headline change this range is — and
**XXXX-3 says no about a document I wrote in this range**, which is the same
compound-claim shape arriving inside the audit that named it.

Everything else checked and clean: `docs/FEATURES.md` states no claim about the
deferral, so nothing there was falsified by ADR-0028 · the ADR-0023 correction
uses the body-level form its twenty-one siblings use, so the index row is
consistent with the file as the rule reads it (and inconsistent with it as a
human reads it, which is XXXX-2) · `docs/DECISIONS/README.md` gained ADR-0028's
row in the same commit as the file.

**NNN-4's cross-document sweep fires on this range and was run.** ADR-0028
states a relationship between §9.17 and ADR-0022, so every other statement of
that relationship was swept: `sweep:prose` for *"main runs the language runtime
and nothing else"* found **two** — ADR-0023's note, which the same commit
corrects, and `docs/JOURNAL.md`, which is a record and takes an appended
correction rather than an edit. `docs/ARCHITECTURE.md:739` is the source and is
the subject of the amendment commit that follows.

**A claim written in this range that was checked against its own evidence at the
time of writing (AAAA-8):** ADR-0028's *"at most 2.7 MB"* names the surface's
absolute cost over bare rather than its marginal, precisely because the marginal
came from an instrument that no longer exists. The bound is stated as a bound.

---

## 2026-08-27 — Stage audit: `e48b265..acb2cbb` — a caller reached past the anchor it depends on, and a census miscounted by 22%

**Audited through `acb2cbb`.** Pasted from `npm run audit:scope`:

```
Unaudited range: e48b265..HEAD
  commits: 9 (one batch is 9)
  files:   22 (one batch is 24)
  proofs ADDED (1):     borderTokens.proof.mjs
  proofs MODIFIED (6):  remoteLifecycle.test.ts +30 -1
                        blockEscapeResolvingWrites.proof.mjs +120 -11
                        preCommit.proof.mjs +39 -4 · annotate.proof.mjs +62 -3
                        checkLocal.proof.mjs +80 -5 · electronImports.proof.mjs +14 -0
  proofs REMOVED: none
  source FILES ADDED (2):   borderTokens.mjs · baselineSpread.mjs
  source FILES CHANGED (5): checkLocal.mjs +7 -4 · preCommit.mjs +1 -9
                            sweepScope.mjs +19 -5 · budgetGate.mjs +13 -2
                            barrelCost.mjs +3 -0
  source FILES REMOVED: none
```

Queue items 1–5 and the UUUU findings: the hung `vitest` tree, two temp-directory
leaks, `docs/UI-GUIDE.md`, `main`'s spread, the border scan, and Track C's
precondition.

**`preCommit.mjs` is the only net-negative file (`+1 -9`) and the deletion is
TTTT-1's** — the stale comment block asserting the opposite of what the gate
does. Read against its destination: nothing was carried away with it, the WW-4
sentence above it survives, and the correct paragraph below it is untouched.

### 1. Root cause or workaround?

Nine commits, no workaround. Three repairs are worth separating from their
symptoms:

- the temp leaks are fixed **at the two call sites**, not by a sweeper that
  deletes `monstera-*` on start — which would have been the classic
  regenerating repair;
- `ask`'s crashed-hook branch narrows to *silence at a non-zero exit* rather
  than throwing on all silence, because silence at exit 0 is the protocol's
  allow. The first repair was the wide one and every ALLOWS case went red;
- the border rule inverts the burden instead of inferring interactivity, which
  is the analysis ADR-0003 rejected as having silence for a failure mode.

**No check was loosened.** The one candidate is `baselineFor` becoming exported
and gaining an options parameter; the gate's call is unchanged and passing `{}`
is identical to passing nothing.

### 2. Verified against the easy shape only?

The hard shape for the leak fixes is *a run that fails*, and the `preCommit`
cleanup is placed before the verdict for exactly that reason — `process.exit`
below it would skip anything written after.

The hard shape for `ask` was the one that broke it: the ordinary allow. Testing
only crashed hooks would have shipped a repair that reddens 245 cases.

**A shape still untested, stated:** `baselineSpread.mjs` has been run at
`--runs 15` on one machine in one session. Its own finding is that between
sessions matters more than within one, so its untested shape is the one it
proved important.

### 2a. Has a change to HOW something is proven moved the coverage?

Yes, once, and it is a gain. `checkLocal.proof.mjs`'s non-start cases were
previously a claim about a classifier called directly, with the harness's own
branch recorded as unreachable from a fixture. It is reachable — a command line
past 32767 characters — so the assertion moved from *the function classifies
this correctly* to *the harness reports and stops*. Strictly more coverage, on
the same runners.

### 3. Would CI have caught it?

**Answered from runs.** `798e2ee`, `fa2138c`, `07fcd78` and `8288aac` were each
green on both jobs, and `acb2cbb` was green before this audit began. Nothing in
this range reddened `main` — which is the first range this session that did not,
and the difference is that every push waited for the board.

**What CI could NOT have caught is the whole subject of two commits.** The temp
leaks are invisible to every assertion in both files — 10 tests and 32 hook
cases pass identically with the fix reverted, and the observable is a directory
count. Nothing in CI counts directories, and a runner is discarded after each
job, so this class can only be seen on a machine that persists. That is stated
rather than closed: the fix is proven by a before/after delta measured by hand,
and by the mutation that makes the delta non-zero.

**Is there a defect this machine cannot see?** `borderTokens.mjs` examines zero
declarations here and everywhere, so its scan half is unexercised on every
runner until the first component stylesheet lands. It prints `NOTHING TO SCAN`
rather than reporting clean, and the proof carries the whole claim.

### 4. Are the proofs non-vacuous?

Six mutations, each reddening the case written for it:

| mutation | result |
|---|---|
| `remoteLifecycle.test.ts`: roots unregistered | red — 284 → +12 per run |
| `preCommit.proof.mjs`: dirs unregistered | red — +3 and +2 per run |
| `ask`: silence at non-zero read as allow | red, one case |
| `spawnOutcome`: a spawn error classified `ran` | red, three cases; control stays green |
| `checkLocal`: the non-start `break` → `continue` | red, the stop case alone |
| `borderTokens`: (two defects found by the proof itself) | see below |

**The two leak mutations pass every assertion in their files**, which is the
point: 10 tests and 32 hook cases are green either way. The observable is the
directory count, and that is a measurement rather than a case.

### 4a. Has every instrument passed a resolution test?

| instrument | resolution test | result |
|---|---|---|
| `baselineSpread.mjs` | `main` against `main-service`, known to differ | 49.1 vs 52.1 MB — separated, and it refuses below 0.5 MB |
| `borderTokens.mjs` | the control fixture's violation against its four near-misses | exactly one, and the right line |
| the catch census (scratchpad) | four classification fixtures plus three that must NOT match | held after two corrections |

### 4b. Does every search carry a positive control?

`borderTokens.mjs` ships `CONTROL_FIXTURE` and its proof asserts the count, the
line, and the near-misses — the load-bearing one being that `--border-control`
must not match `--border` as a substring, since a check that fires on correct
code is deleted within a day.

**And the control caught the instrument twice on its first two runs**: the
property pattern was anchored at line start and examined **zero** declarations
in its own fixture, and the marker accepted an empty reason because a CSS
comment's terminator satisfies `\S+`.

### 4c. Does this check derive its extent from the set it governs?

**VVVV-1, and it is this audit's finding.** `checkLocal.mjs` now appends the
scanning roster to a check-only selection — and it read `SCANNING_PROOFS`
directly, reaching past `SCANNING_PROOF_COUNT`. That anchor exists because the
failure to fear makes the roster **smaller**: a list deriving its own count
agrees with any deletion. So removing an entry together with its count would
have left the sweep running eight of nine, with `affectedProofs.mjs` — which
also reads the raw array — agreeing that all of them ran.

Fixed in the commit that follows this audit: the count is checked before the
roster is used, and the sweep refuses when the two disagree. Staleness stays
handled by `derived.includes`, which is what lets a fixture repository declaring
none of them run normally rather than refuse.

**The shape to carry:** an anchor protects only the callers that read it. This
one had a guarded accessor, `scanningProofRoster`, and the new consumer imported
the constant beside it instead — B3a's *a helper sitting beside a bare inline
expression is the same trap one step on*.

### 5. Executed, or asserted?

**Executed:** three baseline sweeps of 15 readings; two `perf:gate` runs;
before/after directory counts for three temp prefixes and their mutations; the
five spawn shapes in the non-start measurement; every proof named above.

**Asserted and NOT executed:** that the ~5.8 MB between-session baseline shift
was caused by the hung `vitest` tree. All three roles moved by the same amount
across the kill, which is why it is recorded as a machine property with a size
and no mechanism.

### 6. Did architecture change before the feature, or underneath it?

Neither. ADR-0003 gains a dated note that its named mechanism was unavailable,
which is a record of what was built rather than a change to what was decided.

### 7. Do the documents still match the code?

`docs/UI-GUIDE.md` is new and marks its own four unbuilt mechanisms.
ADR-0025 and ADR-0003 gain dated corrections. FEATURES rows 288 and 328 are
edited true, and 328's title changes because its subject did.

**The NNN-4 sweep fired on the roster claim** — this range states that the
scanning roster is what an import walk cannot name, which is a cross-document
relationship — and it is what surfaced VVVV-1's second half: `affectedProofs.mjs`
states the same thing and reads the same raw array.

### VVVV-2. The census miscounted by 22%, in the file that documents the defect

The swallowed-error census matched `catch { return; }` inside a **comment** —
in `documentConsistency.mjs`, the file whose comment documents exactly that
defect — and inside a **string** in an emitted-source fixture. 194 catch blocks
became 151 once comments and strings were masked.

Then its width metric counted the sentinel in
`try { call(); return false; } catch { return true; }`, reporting eleven sound
sites as defects — `electron.mjs`'s `stat`, `lockfileIntegrity.mjs`'s
`JSON.parse`, six must-throw proof cases. Excluding a trailing `return` took the
candidates from 40 to 13.

**Both corrections are the finding rather than footnotes.** An instrument built
to find one class of reassuring answer produced two of its own, and the second —
a metric that is *nearly* right — is the more dangerous, because its output
looked like a list of real defects rather than like noise.

### VVVV-3. A delimiter in prose closed a comment, which is the seventh class in a new costume

Writing `*/` inside a JSDoc block in `borderTokens.mjs` ended the comment early
and node refused the file. That is the emitted-template class — prose and code
sharing a delimiter — arriving in an ordinary comment rather than in a
`String.raw`, where `check:emittedtemplates` does not look.

It cost nothing, because running the file is what found it. Recorded because the
scan's scope is `String.raw` regions by design (VV-1 measured that widening it
to every template produces 36 unusable reports), so this variant has no
mechanism and will recur.

### Correction, 2026-08-27 (WWWW-4) — the temp census reached the right conclusion on evidence that could not support it

`798e2ee` concluded that most of the 1,229 `monstera-*` directories in `%TEMP%`
were not this repository's, on the grounds that **`git log -S --all` finds no
commit that ever contained `monstera-print`, `monstera-stamp` or
`monstera-nested`.**

That grep is blind to the likeliest candidate. This project writes uncommitted
scratchpad probes constantly and by design — four this week alone — and one of
those being the source would leave no commit trace at all. The conclusion was
right; the reason given for it was not evidence for it.

**What settles it is the creation dates, which were never read.** Measured
2026-08-27 against `c767e66`, this repository's first commit at
**2026-08-15 16:03**:

| | |
|---|---|
| oldest directory | `monstera-proof-fo5uyo`, **2026-06-09 04:11** |
| created before the repository existed | **713 of 732** |
| created since | **19** |

The oldest predates the first commit by **more than two months**, and 713 cannot
be this repository's output whatever code once wrote them. Thirty prefixes
appear in that pre-repository set, including `native` and `proof`, which the
census had *attributed* — so a prefix matching a live call site does not
establish that these instances came from it.

**The 19 within the repository's life are all ours, and none is a missing
cleanup:** `host-surface`, `cff`, `advisory`, `audit`, `adr`. Every one of those
call sites removes its directory, and `hostSurfaceProbe.mjs` documents why its
own removal fails about one run in three — `TerminateProcess` is asynchronous,
so the kernel releases the child's handles after the call returns. They cluster
on 08-23 to 08-25, the days runs were being killed at bounds during the WWW-2
investigation, which is WWW-1's recorded behaviour: a killed script never runs
its `finally`.

**So the corrected finding is narrower and stronger.** The two leaks fixed in
`798e2ee` were the only sites in this repository creating a temp directory and
never removing it; the rest of our leftovers are killed-run debris with a known
mechanism; and the bulk of the population predates the repository. The claim
*"about 700 came from code that has never existed here"* is now a reading rather
than an inference — and it is 713, dated.

---

## 2026-08-27 — Stage audit: `9bbfbbb..e48b265` — a swapped gate left its old comment standing, and I pushed twice onto a red board

**Audited through `e48b265`.** Pasted from `npm run audit:scope`:

```
Unaudited range: 9bbfbbb..HEAD
  commits: 9 (one batch is 9)
  files:   22 (one batch is 24)
  proofs ADDED (2):     containerGrants.proof.mjs · typeOnlyExports.proof.mjs
  proofs MODIFIED (4):  auditScope.proof.mjs +65 -0 · documentRuleScope.proof.mjs +1 -0
                        kernelLoad.proof.mjs +5 -1 · peakRss.proof.mjs +50 -0
  proofs REMOVED: none
  source FILES ADDED (3):   typeOnlyExports.mjs · containerGrants.mjs · containedStart.mjs
  source FILES CHANGED (6): annotate.mjs +31 -3 · documentConsistency.mjs +120 -2
                            preCommit.mjs +27 -58 · auditWatermark.mjs +75 -0
                            peakRss.mjs +24 -3 · barrelCost.mjs +117 -7
  source FILES REMOVED: none
```

RRRR-1's checklist roster and RRRR-4's row-length rule, the runner's host floor,
QQQQ-1's gate swap, ADR-0027's grant built and then measured, and SSSS-2's
runtime correction to `R`.

**`preCommit.mjs` is the only net-negative file (`+27 -58`) and it is a swap, not
a removal**: `emittedSideEffects.mjs` left the pre-commit set and
`typeOnlyExports.mjs` took its place, with the emit scan retained as CI's
completeness control. Reading the deletions against the destination by name is
what found TTTT-1. The other three modified proofs are additive; the one
deletion in `kernelLoad.proof.mjs` is a figure being corrected by SSSS-2.

### 1. Root cause or workaround?

Nine commits, no workaround. Three are worth naming as root-cause work rather
than repair: QQQQ-1 replaced a gate that could be *blind* with one that reads the
index and cannot be, rather than softening the blind branch; SSSS-2 gave
`measurePeak` a `runtime` parameter rather than re-labelling the figure; and
`containedStart.mjs` revokes before it grants rather than reading the machine as
it found it.

**One repair could regenerate and does not:** the ACLs `containedStart.mjs`
changes are restored in a `finally` and read back with `inspect()`, and the run
prints the state it leaves. A probe that left the machine revoked would break the
next contained run for a reason nothing recorded.

**No check was loosened.** `annotate.mjs --always` widens what CI emits and is
the one change in the range that could be read as one; it is gated on
`status === 0`, and TTTT-2 is the case that now says so.

### 2. Verified against the easy shape only?

The hard shape for `containedStart.mjs` is *the grant is present already*, which
is this machine's state and the one under which a positive reading means nothing.
It is the shape the instrument is built around rather than one it was tested
against afterwards.

The hard shape for `R` was *a second runtime*, and it was not tested until this
range: every prior figure came from whichever interpreter started the harness.

**A shape still untested, stated rather than closed:** `barrelCost.mjs --runs`
was exercised at 1 and 5. Nothing has run it where a sweep FAILS mid-series, and
the loop has no handling for that — `measurePeak` throws and the whole run dies,
which is the correct behaviour and is not asserted anywhere.

### 2a. Has a change to HOW something is proven moved the coverage?

Yes, once, and it is a **gain with a stated edge**. QQQQ-1 moved the pre-commit
half of ADR-0026's class from an emit read to an index read. The emit read had
two worlds — a machine with `dist` and one without — and the poorer world was
reported as *blind* and let through. The index read has no such branch, so the
pre-commit gate now blocks in every checkout.

What it no longer sees is the emit itself: a `dist` carrying a violation whose
source has since been corrected is invisible to the index read. That is CI's
`check:emittedsideeffects`, unconditional on both legs, which is why it stayed.

### 3. Would CI have caught it?

**Answered from runs, and the answer is that CI caught what this machine did
not.** `c248756` and `e48b265` were both red on CI and green on Guards, on the
step *Prove nothing can trigger the unpinned Electron download*
(`scripts/proofs/electronImports.proof.mjs`), both platforms:
`api.github.com/repos/tenslorai-tar/monstera/actions/runs/33076084119/jobs`.
`containedStart.mjs` imports the built surface through a `file://` URL and was
not listed in `ACCOUNTED_COMPUTED`.

`npm run local -- --only check:` passed 19 of 19 both times. It names that proof
in its scan-reach list; TTTT-3 is why that did not stop me.

**Is there a defect this machine cannot see?** One branch keyed on presence
arrived in this range: `containedStart.mjs` refuses on any platform that is not
`win32` (exit 69) and on a missing build (exit 70). Neither side is exercised by
CI, because the file is research and no workflow runs it. That is stated, not
closed — it is the class the checklist warns about, in a file whose whole subject
is a Windows kernel behaviour.

### 4. Are the proofs non-vacuous?

Four mutations run in this range, three of which reddened the case written for
them. The fourth is TTTT-2 and did not.

| mutation | result |
|---|---|
| `peakRss.mjs`: `options.runtime ?? process.execPath` → `process.execPath` | red, naming the ignored option |
| `annotate.mjs`: drop the `status === 0` guard | **green** — see TTTT-2 |
| the same, against the corrected case | red, naming the notice on a failing run |
| `containedStart.mjs`: the coarse outcome bucket | see TTTT-4 — the instrument's own verdict |

**A branch nothing reaches, kept:** `containedStart.mjs`'s `create-failed`
outcome. Neither cell produced it — `CreateProcessW` succeeded in both, which is
itself the finding that corrected ADR-0027's predicted mechanism. It is kept
because the state is real and a token that cannot execute the image is what the
ADR describes; deleting it would remove the name for the outcome the ADR predicts.

### 4a. Has every instrument passed a resolution test?

| instrument | resolution test | result |
|---|---|---|
| `containedStart.mjs` | the two contained cells: one ACE on four paths, present or absent | `runtime-init` vs `module-resolution` — separated |
| `barrelCost.mjs --runtime` | the same six cells under two interpreters | `R` 7.5–8.0 vs 10.3–13.0 — separated |
| `containerGrants.mjs` | `apply()` grant/revoke read back through `icacls` | separated, and it decides from the read rather than the exit code |

**`barrelCost.mjs`'s anchor held under both runtimes** — `mupdfWriter.js` at
+39.3 MB and +41.4 MB over bare against its own 4 MB floor — so neither runtime
was blind to the subject it exists to measure.

### 4b. Does every search carry a positive control?

`containedStart.mjs`'s is the **uncontained cell**, and it is load-bearing rather
than decorative: node reports `Cannot find module` for a file it cannot READ as
readily as for one that is absent, so without a cell that reaches the entry the
`granted` row would have been indistinguishable from a stale build path. It
refuses terminally rather than reporting a verdict when that cell does not run.

`containerGrants.mjs`'s `namesApplicationPackages` matches the SID **and** the
display name, because `icacls` renders a known SID by name and an unknown one
numerically — a search for either alone finds nothing on half the machines.

**The NNN-4 sweep fired and found two.** SSSS-2 states a cross-document
relationship — which runtime a figure was read under — so every other statement
of `9.6 MB` was swept: `docs/FEATURES.md`'s `mupdf-host` row used it as a
host-relevant candidate, and `kernelLoad.proof.mjs`'s diagnostic quoted it as the
after figure. Both corrected. Two more mentions were left alone because they
already name their runtime.

### 4c. Does this check derive its extent from the set it governs?

Three rosters in the range, all literals, all in the direction 4c asks for —
the feared failure makes each set SMALLER, so a derived count would agree with
the omission:

- `AUDIT_ITEMS` (11 items) in `auditWatermark.mjs`, with a case asserting the
  length and two members rather than recomputing them;
- `EXPECTED_RULES` in `documentRuleScope.proof.mjs`, which gained the row-length
  rule as a literal line;
- `annotate.proof.mjs`'s `cases: 8`, raised by hand with the three new cases.

**One derived set was added and it runs the other way:** `containerGrants.mjs`'s
`grantSet()` derives its four paths from the resolvers that own them, so a moved
artefact moves the grant with it. The failure to fear there is a path that is
present and ungranted, and `apply()` refuses an absent path rather than skipping
it (*ABSENT IS NOT DONE*), which is the anchor.

### 5. Executed, or asserted?

**Executed:** the three contained-start cells and their ACL transitions; ten
`barrelCost` sweeps across two runtimes; the four mutations in item 4;
`electronImports.proof.mjs` before and after the listing; `perf:gate` on both
fixtures; `annotate.proof.mjs` at 8 cases.

**Asserted and NOT executed, listed as unfinished:** that ADR-0027's grant set
extended to the application's built output would let a contained host start. That
is the obvious next move and it is a prediction — the same kind of prediction
this range just falsified once. It is not written anywhere as a fact.

### 6. Did architecture change before the feature, or underneath it?

Neither, and one decision is now **reopened rather than amended**. ADR-0027
rejected *an uncontained host in development* on the reading that development
containment costs four grants on artefacts provisioning already installs. The
measurement says it costs more. A correction is appended to the ADR recording
that the rejection rested on a premise this range falsified; the choice between
widening the grant set and taking the rejected option is the owner's, and no
feature was built on either reading in the meantime.

### 7. Do the documents still match the code?

Three corrections, all appended or edited in the same commits: ADR-0027's
correction of 2026-08-27, ADR-0025's `R` correction, and `docs/FEATURES.md` rows
287, 289 and 291.

**TTTT-1 is this item, found in the changed function's own comment.**

**A claim written in this range and checked while writing it** (AAAA-8's tell):
the `INSUFFICIENT` verdict names one axis — the grant — where the evidence could
also be explained by the entry script simply not being where the probe looked.
That is what the uncontained control rules out, and it was added because the
question was asked before the claim was written rather than after.

### TTTT-1. The swapped gate kept its old comment, in capitals, above the correction

`preCommit.mjs` now scans the **index** for type-only re-exports. Eight lines
above the new comment saying so, the old one still read:

> IT READS THE BUILD ON DISK, WHICH THE INDEX IS NOT, and that is the one thing
> this caller has to say out loud. The emit is the only place the two spellings
> differ, so there is nothing in the index to read.

Every clause false, and the second directly contradicted by the paragraph below
it. The block also still promised *the staged TypeScript files are named below*,
for a `stagedTypeScript()` helper the same commit deleted. Two headers for one
gate, both opening *ADR-0026's class, the half no lint rule covers*.

**This is item 7's documented shape and the checklist predicts it exactly:** the
author adds a section saying what changed, and leaves the original standing in
the position a reader treats as the contract. What is new is that here the stale
half was not half-true — it was wholly false and still survived review, because
it sat *above* a correction rather than inside one, and the reader who agrees
with the new paragraph never scrolls back.

**Found by the audit, not by a check, and no check can see it:** both paragraphs
parse, both describe a real mechanism, and one of them was true a commit ago.
The compensation is the one already mandated — read the diff of the changed
function's own comment — and it worked here only because `preCommit.mjs` was the
range's only net-negative file, which is what sent me to its diff first.

### TTTT-2. My case for `--always` passed its own mutation

`annotate.mjs --always` shipped in this range with **no case at all**;
`annotate.proof.mjs` was not in the modified-proofs column because nobody touched
it. Adding cases was the obvious repair. The interesting part is the case I wrote
first.

The hazard `--always` introduces is that a flag reporting on success is one
statement from reporting success, so the case asserted: a failing run under
`--always` still emits `::error` and still exits 3. Dropping the `status === 0`
guard left both of those exactly as they were, and the case passed.

**The end state was the wrong observable, again.** The decision `--always` makes
on a failing run is *not to emit a notice*, and the absence of that notice is the
only thing the correct path produces. Asserting it reddens the mutation
immediately.

Three of these in two days now, all inside the commit that fixed the previous
one. The checklist entry naming the pattern was written this week and I still
reached for the end state first, which is the measure of how weak *knowing the
rule* is against a case that looks right.

### TTTT-3. I pushed twice onto a red board, past a compensation that named the proof

`checkLocal` ends every run that touched a scanning proof with a list:

> Static-import reach only. These proofs SCAN the tree, so any change reaches
> them and no import walk can say so — run them too: `proof:electronimports` …

It named the exact proof that then went red on CI, twice. I ran the three the
import walk derived and skipped the five it printed, then pushed `c248756`
without waiting for the board and wrote `e48b265` on top of it.

**Both halves are mine, and one of them is a mechanism's.** By this project's own
test — *could this have been printed before you made your change?* — that list is
a **disclaimer**: it is the same five proofs on every run, computed from nothing
about the change. The derived list beside it, which names proofs by import reach,
is a mechanism and I obeyed it.

**Raised, not resolved.** The obvious fix is to stop printing the list and run
the five, which cost 0.2s, 1.0s, 3.5s, 18s and about 12s here — under a minute
against a sweep that already takes three. That converts a note into a mechanism
and is a change to the harness every push depends on, so it is proposed rather
than taken in an audit-recording commit.

### TTTT-4. The instrument reported its own blindness as a finding

`containedStart.mjs`'s first two-cell run printed *the grant changed nothing
observable* while its own logs showed one cell dying in Chromium's ICU
initialisation (`icu_util.cc:232`) and the other in node's module loader.

Both had landed in one `no-program` bucket, and the verdict compared buckets. The
distinction existed in the evidence and not in the classifier, so **an absent
distinction read exactly like an empty one** — the same sentence this repository
has recorded for a missing audit-scope column, and here it was a coarse enum
rather than a missing column.

Cells carry a `stage` derived from which layer wrote the diagnostic, and the
verdict compares outcome and stage. The repair is what made `INSUFFICIENT` a
readable verdict rather than an unreadable one.

---

## 2026-08-27 — Stage audit: `71b299d..9bbfbbb` — I made a guard non-blocking, and a parser read its own documentation

**Audited through `9bbfbbb`.** Pasted from `npm run audit:scope`:

```
Unaudited range: 71b299d..HEAD
  commits: 9 (one batch is 9)
  files:   19 (one batch is 24)
  proofs ADDED (2):     emittedSideEffects.proof.mjs · tokenContrast.proof.mjs
  proofs MODIFIED (2):  engineSessions.test.ts +175 -0 · lintRules.proof.mjs +111 -2
  proofs REMOVED: none
  source FILES ADDED (5):   tokens.css · emittedSideEffects.mjs · tokenContrast.mjs
                            hostFixedCost.mjs · hostFixedCostChild.mjs
  source FILES CHANGED (3): engineSessions.ts +168 -0 · preCommit.mjs +81 -0
                            peakRss.mjs +53 -0
  source FILES REMOVED: none
```

PPPP-1's quantity fix, ADR-0025's `base 98 MB` derivation, ADR-0023's open-time
correction and its build, PPPP-2, and the UI substrate's first unit. Both
modified proofs are additive (`+175 -0`, `+111 -2`); the two deletions in
`lintRules.proof.mjs` are its header sentence being widened from *React rules* to
*the lint rules this project's documents claim are enforced*, which is the file
gaining a second family rather than a check being loosened.

### QQQQ-1. I turned a guard from blocking to reporting, and the half it leaves can be silently inert

Item 1 names a loosened check as the shape to distrust: *widening a type,
disabling a rule, raising a limit, or exempting a role means the check was right
and the code was wrong.* `check:emittedsideeffects` was registered fail-closed in
the pre-commit set, blocked every case in `proof:guards` — whose fixture
repository has no `dist` and legitimately never will — and I made *blind* a
report rather than a block.

**The reasoning holds and the consequence was understated in the commit that
made it.** On a machine where nobody runs `tsc`, the pre-commit half prints one
line and passes, every time, and by the third reading that line is furniture —
the exact disclaimer test this project applies to printed compensations. So the
FEATURES row's *two mechanisms* is really **one gate and one best-effort local
copy**, and the pre-commit half's contribution is bounded by whether the
committer happens to have built.

**What reopens it, and why the alternative was rejected too fast.** The emit is
the only place the two spellings differ *in general* — but the export spelling in
particular is syntactically decidable in **source**: an export declaration whose
every specifier carries `type`. An index-reading pre-commit scan is therefore
possible, and I rejected it in one line as a B3a second opinion about the lint
rule's question. That rejection is worth re-examining, because B3a's objection is
to a *partial reimplementation of an authority*, and here there is no authority
to reimplement — no lint rule covers this spelling at all. **Raised, not
resolved:** it trades one mechanism that can be inert for one that always runs
and can only produce false negatives.

### QQQQ-2. The token check's first run reported five failures about a token called `<category>`

`tokens.css`'s header documents the role grammar, and the illustration began with
the real `@role` marker, so the parser read the documentation as a declaration.

**This is the emitted-template class in a new file type**: a region where prose
and machine-read content share a syntax, so an example of the syntax *is* the
syntax. That family has cost this repository seven occurrences in `String.raw`
regions, and the scan covering those cannot see this one — different file,
different marker.

**No scan is proposed, and the reason is 4c rather than difficulty.** *A comment
that looks like data* is undecidable in general, and a check for this one marker
would cover the instance already found while the class stayed open — reading as
watched. What generalises is the proof case: every parsed role name must be a
valid custom-property name, so the illustration cannot return as a silent
sixteenth role. The remedy is a **validating parser**, not a rule about how to
write comments.

### QQQQ-3. The 9c retry has a tail no fixture reaches, and it is kept deliberately

Item 4's *mutate the branches no fixture reached*. `onDocumentOpened`'s loop ends
with a report reached only if `POISON_AT` attempts run out without `poisoned()`
agreeing — and since both the loop bound and the counter read the same constant,
**no code in this repository can reach it**. That is JJJ-1's first kind: kept,
because the fact it encodes is true and deleting it would leave the state this
function exists to prevent — open and sessionless — arriving in silence the day
those two stop agreeing. It is not a missing case, and no case is written for it.

The branch that *is* reachable and load-bearing is the loop bound itself, which
exists only because a mutation showed the semantic exit could spin for ever; that
one has three cases.

### Executed, and asserted

**Executed.** Three mutations on `onDocumentOpened`, each reddening its own
cases · a mutation on `eslint.config.js` reddening `proof:lintrules`' two new
cases while `check:lint` stayed green · a planted `export {} from` in
`packages/kernel/dist/index.js`, named by the scan and blocking the hook · the
pre-ADR-0003 border value reddening `check:tokencontrast` at **1.16:1**, the
figure that ADR records · two probe runs of fifteen paired readings with the
counter cross-check passing · 521 vitest cases · 18 of 18 local checks against
the index · board **GREEN at `3051956`**.

**Asserted.** That `scripts/research/hostFixedCost.mjs` is adequately covered by
its own resolution test with no proof in CI. It refuses to report unless it first
recovers a known 8 MB difference, which is the instrument-side control — but
nothing runs it on another machine, and a probe that spawns processes and reads
working sets is exactly the kind whose behaviour is machine-dependent. Stated
because *no proof* and *no proof needed* read identically in the columns above.

### Correction, 2026-08-27 — the checklist was missing from this entry and the two before it (finding RRRR-1)

Appended rather than woven in, because an entry is a record. This entry, and the
two before it, carried findings and no item headings; the last entry that had
them is `f75005d..cc1e54e`. The cause was a length instruction of mine whose
wording put the checklist inside a sentence about trimming, so it read as a
budget. **It is not prose and no length instruction reaches it.**
`unansweredAuditItems` now turns `check:docs` red when the newest entry omits an
item, against a literal roster — the failure to fear makes the set smaller
(4c), so a roster derived from the entries would agree with any omission. It
fired on this entry, which is how these answers came to be written.

#### 1. Root cause, or workaround?

**One loosening, and it is QQQQ-1 above.** `check:emittedsideeffects` went from
blocking to reporting on *blind* in the pre-commit set. The other two are root
fixes: PPPP-1 moved the quantity to the module that owns it rather than
correcting the reading (B3a), and `onDocumentOpened`'s loop bound made a runaway
unrepresentable rather than caught (B5).

#### 2. Verified against the easy shape only?

**No, and each hard shape was a different axis.** The token check was run against
ADR-0003's *rejected* value, not only the shipped one. The emit scan was run
against a violation planted in a real `dist`, not only its fixtures. The host
probe was run against **two runtimes**, which is what found PPPP-1's second axis.

**What was NOT reached:** the emit scan's no-build world, outside
`proof:guards`' fixture. See item 3's inverse.

#### 2a. Has a change to HOW something is proven moved the coverage?

**Yes, and it was understated in the commit that made it.** Turning *blind* from
a block into a report is coverage moving, not a wording change: the pre-commit
half now contributes nothing on a machine where nobody builds. Recorded as
QQQQ-1 and unresolved.

#### 3. Would CI have caught it?

**From a run.** Board **GREEN at `9bbfbbb`**, `CI=success`. `ci.yml`'s build job
carries `proof:emittedsideeffects`, `check:emittedsideeffects`,
`proof:tokencontrast` and `check:tokencontrast` as unconditional steps, and that
run executed them.

**And the inverse, which is the half this range most needed.** Yes — there is a
defect this machine cannot see. `check:emittedsideeffects`'s pre-commit caller
branches on whether a build exists, and on a developed-in machine `dist` always
exists, so the report-and-continue branch runs **only** inside `proof:guards`'
fixture repository. That is the two-worlds shape exactly: a branch keyed on the
presence of something never executes where the thing is always present, and the
richer world is the one that hides it.

#### 4. Are the proofs non-vacuous?

Three mutations on `onDocumentOpened`, each reddening its own cases — and the
first **hung** rather than failing, which is what exposed the unbounded loop. One
on `eslint.config.js`, reddening `proof:lintrules`' two new cases while
`check:lint` stayed green. One planting `export {} from` in
`packages/kernel/dist/index.js`. One reverting `--border-control` to the
pre-ADR-0003 value, reddening `check:tokencontrast` at **1.16:1**.

#### 4a. Has every instrument passed a resolution test?

`hostFixedCost.mjs` recovers a known **8 MB** difference and cross-checks the
parent's `PeakWorkingSet64` against the child's `maxRSS` before reporting, and
refuses on either. `tokenContrast.mjs` reproduces **3.04:1** and **1.16:1**,
two figures ADR-0003 recorded from its own solve.

#### 4b. Is the instrument a search? Then its positive control.

`emittedSideEffects.mjs` carries a fixture with two violations and three
near-misses and refuses when it cannot find them. `tokenContrast.mjs` requires
its control's bad pair to fail **and** its good pair to pass. Both controls run
inside the scan, not only in the proof.

#### 4c. Does this check derive its extent from the set it governs?

The token check's roles **are** derived from the file, and the failure to fear —
a missing declaration — makes the set smaller. That is why its completeness check
runs in both directions, with the value-without-a-role case as the anchor.
`AUDIT_ITEMS` is a literal for the same reason, decided in this correction's own
commit.

#### 5. Executed, or asserted?

Answered above, unchanged: one asserted line, about the host probe's coverage.

#### 6. Did architecture change before the feature, or underneath it?

**Before, and it is checkable in the log.** `9978312` appends ADR-0023's
open-time correction; `35054f2` builds it. Separate commits, in that order.
Nothing in this range was retrofitted under a feature already built.

#### 7. Do the documents still match the code?

Rows updated for the export half's closure and the token substrate; ADR-0025 and
ADR-0023 took appended corrections rather than edits.

**And one document claim in the REPORT was false** — finding RRRR-4. The stretch
report said *"row 291 is 1470 words and I did not rewrite it"*. It is row **292**,
it **was** rewritten, and it went from 1470 to **1756** words, up 19%, in a
commit whose stated intent was compression. Nothing was lost and the added
content is substantive; the finding is that an operation meant to shrink a row
grew it, and the report stated the opposite.

---

## 2026-08-27 — Stage audit: `4eb94a7..71b299d` — a document claims a lint rule is enforced, and nothing checks that it is, which is audit finding 31 in a new rule

**Audited through `71b299d`.** Pasted from `npm run audit:scope`:

```
Unaudited range: 4eb94a7..HEAD
  commits: 7 (one batch is 9)
  files:   24 (one batch is 24)
  proofs ADDED: none
  proofs MODIFIED (8):  engineHostConnection.test.ts +8 -8 · engineSessions.test.ts +2 -2
                        documentCommands.test.ts · registerHandlers.test.ts
                        channels.test.ts · hostBody.test.ts
                        remoteEngine.test.ts · remoteLifecycle.test.ts   (all +1 -1)
  proofs REMOVED: none
  source FILES ADDED: none
  source FILES CHANGED (12): composition.ts +3 -3 · contractHandlers.ts +2 -2
                             documentCommands.ts +2 -2 · commandHandlers.ts +1 -1 · …
  source FILES REMOVED: none
```

The range is ruling LLLL-2's lint unit in four parts, the rule enabled last and
alone, the row's expiry fired for one half, and one appended correction. **Every
one of the eight modified proofs is an import statement**; each diff read, and
no assertion or case moved. Board **GREEN at `71b299d`** — CI success, Guards
success — so item 3 is answered from a run for this range's own commits rather
than owed forward.

### OOOO-1. `docs/FEATURES.md` says the rule is an error, and `check:lint` being green does not establish that

The row now states: *"the import half is CLOSED as of `c39e255` —
`@typescript-eslint/no-import-type-side-effects` is an error over
`**/*.{ts,tsx}`"*. **Nothing checks it.** Delete that line from
`eslint.config.js` and `check:lint` stays green, because the tree no longer holds
a single violation for the rule to miss — the class was fixed first, which is the
ruling's shape and is also what removes the evidence. The two canaries that
proved the rule fires were a manual act, in one session, and were deleted by
design.

**This repository has already paid for this exact defect and built the mechanism
for it.** `lintRules.proof.mjs`'s own header: *"CLAUDE.md and CONTRIBUTING.md both
stated the React Compiler lint rules were errors. `eslint --print-config …`
returned an empty list of React rules: the plugin was installed and never
imported by `eslint.config.js`."* That was audit finding 31. Its three cases are
exactly the shape this needs — configured at error, scoped to the intended files,
and **firing**, because *"a configured-but-inert rule prints the same
`--print-config` output as a working one"*.

So this is not a new mechanism to design; it is a registration into one that
exists, and writing a second rule-registration check beside it would be the B3a
shape. **Owed, and fixed in the next range** — recorded here rather than folded
in, because an audit commit is docs-only and alone.

**The transferable form is narrower than *claims need checks*.** It is that
**fixing a class removes the evidence that the guard against it works**. Before
the fix, a broken rule and a working one gave different answers, because there
were 70 violations to report. After, they give the same answer. The window in
which the guard is verifiable closes at the moment the guard is adopted — so the
proof has to be written in that window, or built from a fixture that does not
depend on it.

### OOOO-2. The export half's only protection is a comment, and this project's own record says that is not a mechanism

Part 4 fixed the one `export { type … } from` and added a comment at the site
naming the mechanism. That comment is *correct* and it is *not a defence*.
CLAUDE.md's own count: the escape-resolving-write rule was broken seven times,
five of them while the file said the rule was the only defence; the
emitted-template rule seven, the third in a file whose own header carried the
rule against it and the fourth by the author who had just written the check. The
sentence there is **KNOWING THE RULE IS NOT A DEFENCE**, and it has three domains
behind it.

So the export half is now in precisely the state the import half was in before
`c39e255`: a rule in prose, an author expected to recall it, and no mechanism.
**Expect a recurrence rather than hoping against one** — the emitted-template
count is the precedent for saying so out loud, where predicting the sixth
occurrence cost nothing and was right within a commit. The row carries what is
owed: a scan over the emit with its own positive control, `check:emittedtemplates`'
shape, because no lint rule in the pinned plugin covers the spelling.

### OOOO-3. A rewrite that erased a load that mattered would not reliably have reddened CI, and what carried that risk is not in CI either

Item 3's inverse, asked of the range's own subject. `proof:kernelload` covers one
consequence — a native binding becoming reachable — and 514 vitest cases cover
what they exercise. Nothing covers the general case: *a module with module-scope
work stopped being loaded*. Four of the seventy statements were the only
load-point their target had in some tree, and one of those took
`@monstera/nodemode` to **zero**.

What actually carried that risk was the reachability count run by hand once per
part, and it exists now only in three commit messages. **Naming it because the
next such rewrite will not have it**, and because the alternative — turning it
into a check — is a 4c judgement rather than an omission: *is every module that
lost a load-point still loaded* is decidable, but *did that matter* is not, and
a check that answered only the first half over a class that is two-thirds
undecidable would read as watched. The honest artefact is the recorded method,
which is what these three commit messages are.

### Executed, and asserted

**Executed.** Four emit measurements either side of a full rebuild (69 → 41 → 23
→ 0 import, 1 → 0 export) · a runtime-JavaScript diff per part, `.d.ts` and maps
excluded · a prefix-agnostic reachability count per part, after NNNN-4 corrected
the pattern · two canaries reported by the rule from the shipped config and then
deleted · 514 vitest cases at each part · 16 of 16 local checks against the index
at each part · `proof:kernelload` with its control · the board.

**Asserted.** That no removed load-point changed module initialisation order in a
way that matters — unchanged from the previous entry, still reasoning rather than
measurement, and still the line to distrust.

---

## 2026-08-27 — Stage audit: `cc1e54e..4eb94a7` — the control a ruling handed me cannot fail, and the two instruments that differed by one were never disagreeing

**Audited through `4eb94a7`.** Pasted from `npm run audit:scope`:

```
Unaudited range: cc1e54e..HEAD
  commits: 8 (one batch is 9)
  files:   19 (one batch is 24)
  proofs ADDED: none
  proofs MODIFIED (4):  commandBus.test.ts +3 -3 · documentService.test.ts +2 -2
                        mupdfWriter.test.ts +1 -1 · rotatePages.test.ts +2 -2
  proofs REMOVED: none
  source FILES ADDED: none
  source FILES CHANGED (9): commandSpecs.ts +10 -10 · commandDeclarations.ts +6 -2
                            commandBus.ts +4 -4 · engineSeam.ts +3 -3
                            rotatePages.ts +3 -3 · commandLog.ts +2 -2
                            documentIdentity.ts · documentService.ts · mupdfWriter.ts
  source FILES REMOVED: none
```

The range: the previous audit recorded, LLLL-1's dropped paragraph restored,
ADR-0027 written and stopped at, Track D's baseline finding, the runner-baseline
expiry, MMMM-1's plugin reading, and the first part of the emitted-import
rewrite. **The four modified proofs are import statements only** — read each
diff; not one assertion or case moved, which is what a loosened check would look
different from.

### NNNN-1. The emit-diff control I was handed cannot fail, and reachability is the half that separates

Ruling LLLL-2 states the control for each part of the lint rewrite exactly:
*"dist must differ from its pre-commit state only by removed `import {}` /
`export {}` lines, and the running count must fall by the number of statements
that part rewrote."* Both halves held for part 1 — 28 statements rewritten, 69
→ 41 in the emit, and a runtime-JavaScript diff of 28 removed `import {} from`
lines plus one `export {};`.

**And that control cannot distinguish a safe removal from a harmful one.**
`no-import-type-side-effects` fires only where **every** specifier in the
statement is inline-type, so its fix always deletes a whole statement and never
rewrites one. A removal that erased a load something actually needed is
therefore *also* a removed `import {} from` line, and *also* moves the count by
one. **The output the control checks for is what both outcomes produce** — item
4b's reassuring answer, arriving inside a comparison a ruling had specified.

What actually separates them is whether each removed target still has a live
load-point through a value edge. Measured across every dist tree after part 1,
and every one of the seven targets does:

| target | remaining references |
|---|---|
| `@monstera/shared` | 29 |
| `@monstera/contract` | 27 |
| `commandLog.js` | 3 |
| `documentIdentity.js` | 3 |
| `capabilityRegistry.js` | 3 |
| `documentService.js` | 2 |
| `engineSeam.js` | 1 |

Corroborated from the other side: none of the five kernel modules above has an
observable module-scope effect — no registration, no I/O, no shared mutable
state. `engineSeam.js` and `commandLog.js` and `capabilityRegistry.js` have zero
module-scope initialisers, `documentIdentity.js` one (`promisify`) and
`documentService.js` three (all function values). **That scan was blind on its
first run and was caught by its own control**: `@monstera/contract` builds its
schemas at module scope and must show work, and the first pattern reported zero
for it because the declarations begin with `export`. The figures above are from
the corrected pattern, whose control reports non-zero for contract.

**`engineSeam.js`'s single remaining reference is the barrel's `export {} from`,
which part 4 removes**, so that module will then be loaded by nothing at all.
That is ADR-0026's intended end state and it is written down here because a
module with zero load-points looks exactly like a broken build to whoever checks
this next.

**The transferable form:** when a ruling — or anyone — hands you a control, ask
what the *defect* would print for the same input. A control specified as *"the
diff contains only X"* is worthless where the bug also produces only X, and that
is not visible from inside the sentence, which is why it survived being written
by the seat that has the direction rule and read by the seat that wrote it down.

> **Correction, 2026-08-27 — two figures in the table above are undercounts, and
> the instrument that produced them was blind in exactly the way this finding is
> about (finding NNNN-4).** The counts came from `grep -rho "from '\./$t'"`,
> anchored on a **same-directory** specifier. A module referenced from a
> subdirectory is written `'../engineSeam.js'` and that pattern cannot match it.
> Measured against the same post-part-1 snapshot with a prefix-agnostic pattern:
> `engineSeam.js` is **7**, not 1, and `commandLog.js` is **4**, not 3. The other
> three kernel rows are unchanged, and the two package rows used exact
> specifiers (`'@monstera/contract'`, `'@monstera/shared'`) so 27 and 29 stand.
>
> **The conclusion is unaffected and is strengthened**, because the error
> understates: every target retained live load-points, and two retained more of
> them than recorded. That is the least interesting part of this.
>
> **What matters is that the reassuring answer here was not "found nothing".** It
> was *"at least one reference for every target"*, and a partially blind pattern
> satisfies that just as well as a working one — it returned `1` for
> `engineSeam.js`, a plausible number, not a `0` that would have been
> investigated on sight. NNNN-1 above is a finding about a control that cannot
> fail, and its own supporting instrument was one, written in the same hour by
> the author writing the finding. The module-scope scan in the paragraph beside
> it **did** get a positive control and **was** caught by it; the reference count
> got none, and the difference between the two was not a decision — it was that
> one of them returned zero and looked wrong.
>
> So the rule that transfers is narrower than *searches need controls*, which was
> already on the page and did not fire: **a count needs a control whenever
> "more than zero" is the answer you are hoping for**, because an undercount and
> a correct count are then the same shape. Item 4b's tell is *found nothing*;
> this is the same defect wearing *found some*.
>
> The sentence above beginning *"`engineSeam.js`'s single remaining reference"*
> was false when written and is true as of part 2, which removed the six
> `../engineSeam.js` references from `packages/kernel/src/host/`. Left standing
> with this note rather than edited, per the record rule.

### NNNN-2. Two instruments differing by one, and the difference was the finding

The OWED row recorded ESLint-over-source at **69** and grep-over-dist at **70**,
called the gap unchased, and chose the dist figure *"being read from the artefact
rather than from the text that produces it"*. The reasoning for the choice was
sound and the gap needed no chasing beyond MMMM-1: 69 is everything
`no-import-type-side-effects` can see, because it visits `ImportDeclaration`
only, and 70 is that plus the single `export {} from`. **The instruments were
never disagreeing — they were counting two populations, and the difference
between them is the uncovered half.**

Corrected in `4eb94a7`. The shape worth keeping: a discrepancy of **one** between
two instruments reads as rounding, and the sentence it attracts is one that picks
a figure to trust rather than one that asks what the difference is made of. A gap
of forty would have been investigated on sight.

### NNNN-3. LLLL-1's repair can regenerate, and no check is proposed for it — deliberately

Item 1's test: *a repair that could regenerate is a symptom fix.* Restoring
B3's dropped paragraph is exactly that — the next move of that comment can drop
it again, and `65f9c16`'s message records the *method* that catches it
(*"checked by name, not by eye"*) without recording that the method is a person
remembering.

**No check is proposed, and the reason is 4c rather than difficulty.** A comment
move is not decidable by a scan: the same words at a new address and words that
vanished are the same input to anything that does not model moves. A grep pinning
this one paragraph would cover the instance already found while the class —
every comment paragraph that must survive a relocation — stays undecidable, which
is a check that **reads as watched and is not**. The compensation that exists is
the audit-scope report's net-negative figure on a moved-from file, which is
printed, computed per run, and names the file.

### Executed, and asserted

**Executed.** The plugin source read at 8.67.0 plus an ESLint probe with a
positive control · the emit counts either side of a full rebuild · the
reachability of all seven targets · the module-scope scan with its control
repaired · 514 vitest cases · 16 of 16 local checks against the **index**, after
the harness reported that the first run had read the previous content ·
`proof:kernelload` with its control (`mupdfWriter.js` reachable from `engine.js`)
still passing, which a rewrite that erased the edge the walk rides on would have
reddened.

**Asserted.** That no removed load-point changed module *initialisation order* in
a way that matters. The reason it is safe is that ES modules initialise once in
dependency order and every target still loads through a value edge — but no cycle
analysis was run, so this is reasoning and not a measurement, and it is the one
line in this entry to distrust.

**Item 3, and not from the workflow file.** `proof:kernelload`, `check:types`,
`check:lint` and the vitest suite are unconditional steps, and entry
`f75005d..cc1e54e` established that from a run rather than from `ci.yml`. What
this range's own commits have not yet had is a board reading — they are audited
before the push, so the answer is owed on the next green rather than claimed
here.

---

## 2026-08-27 — Stage audit: `f75005d..cc1e54e` — a move dropped B3's own rationale, in the commit whose author was watching for exactly that

**Audited through `cc1e54e`.** Pasted from `npm run audit:scope`:

```
Unaudited range: f75005d..HEAD
  commits: 3 (one batch is 9)
  files:   19 (one batch is 24)
  proofs ADDED — new coverage (1):
    packages/kernel/src/host/hostSessions.test.ts
  proofs MODIFIED — read each diff (4):
    documentCommands.test.ts +4 -3 · engineSessions.test.ts +6 -1
    contract.proof.mjs +10 -10 · kernelLoad.proof.mjs +54 -10
  proofs REMOVED: none
  source FILES ADDED (2):
    packages/kernel/src/commandDeclarations.ts · engine.ts
  source FILES CHANGED (8):
    documentCommands.ts +7 -3 · commandBus.ts +16 -7
    commandSpecs.ts +27 -64 · engineHandlers.ts +1 -1 · hostBody.ts +1 -1
    hostSessions.ts +1 -1 · remoteEngine.ts +1 -1 · kernel/index.ts
  source FILES REMOVED: none
```

The range: ADR-0026 built and measured, JJJJ-1's cases, and KKKK-1/2/3's three
record corrections.

### LLLL-1. The declaration move dropped B3's rationale, and the author was watching for that exact class at the time

`commandSpecs.ts` is **+27 −64**, and net figures are how a move hides what it
loses. Three doc comments moved to `commandDeclarations.ts`. Two arrived whole.
One did not:

> One writer per concern. Two writers is how a codebase acquires sidecar hacks,
> and for a document it is how one engine's idea of the page tree overwrites
> another's.

That is **B3's own reason for existing**, attached to `WriterOfRecord` — the type
the whole writer-of-record matrix is built on. What survived was the mechanical
half (*derived from the seam, so a writer without an adapter is a compile error*)
and what left was the half that says why anybody should care.

**The sharp part is not the loss, it is who lost it.** In the same move the same
author noticed this exact class on a different comment — `Reproducibility`'s
richer text, naming signing, OCR, AI and random object identifiers — and
deliberately carried the original over rather than keeping the thinner
replacement, with a commit line saying so. **Attention to one instance of a
class is not coverage of the class**, and being alert to it in the same hour, in
the same file, in the same operation, did not generalise.

**Why no check is proposed.** A moved comment is not decidable: the same words
at a new address and words that were dropped look identical to any scan that
does not know what a move is. What is checkable is the tell, and it is the one
this report already prints — a **net** figure on a file that moved code. Item 4b
covers it in the abstract; this is the instance that says the abstraction has a
concrete trigger: *read the deletions of any file whose diff is net-negative
after a move, against the file the code moved to.*

**Not fixed here** — an audit-recording commit is docs-only and alone.

### LLLL-2. A 33-file mechanical change cannot land as one commit, and auditing first does not help

Computed rather than discovered by hitting it. `BATCH = { commits: 9, files: 24 }`,
and `auditWatermark.mjs` builds the pre-commit figure as
`files = committed.files ∪ staged`, failing when the union exceeds 24. So for a
commit staging 33 files the union is 33 **whatever the range holds** — a fresh
watermark makes `committed.files` empty and changes nothing.

That matters because the obvious remedy is wrong in a specific way: *audit first*
clears the **range**, not the commit, and the commit is what exceeds the budget.

**This is not filed as a defect in the gate.** The threshold is the median of
batches 4–7 and exists so the checklist stays applicable to a diff somebody
reads, which is a good reason. It is filed because the consequence is not
obvious from the gate's own message: a **whole-class, auto-fixable, mechanically
uniform** change — the shape whose entire value is that the diff is legible in
one piece — is exactly the shape the budget refuses, and splitting it is what
makes it less legible rather than more.

The disposition is the owner's, and it is named here rather than resolved by
whichever agent next meets it: split with an audit between, raise the budget for
a mechanically-uniform diff, or accept that such changes land in parts.

### 1. Root cause, or workaround?

| the fix | the mechanism |
|---|---|
| ADR-0026's edges | the spec table bundled *what a command is* with *how it is performed*, so every routing consumer got an engine. Split by layer, one declaration in two of them |
| KKKK-3's tautology | `>= 0` cannot be false and `importsOf` returns `[]` for that file on every run — the clause asserted nothing and the **title** asserted something untrue |
| KKKK-2's title | a live specification whose leading words said `OPEN` and whose body said closed |

**None is a workaround, and one is worth naming as a near-miss.** ADR-0026's
declaration split, taken alone, would have been a workaround wearing a fix's
clothes: it is the tidy change, it reads as the fix, and it moved **nothing** —
the first re-measurement was identical. What made it a fix was reading the emit.

### 2. Verified against the easy shape only?

**No, and the hard shape is where the whole change was.** The easy shape is the
source, which cannot distinguish `import type { X }` from `import { type X }`.
Every conclusion in this range comes from `dist/*.js`.

### 3. Would CI have caught it?

**Yes, from a run.** `proof:kernelload` and `proof:contract` are unconditional
steps in `ci.yml`, and the board is GREEN at `34348d4` with both workflows
successful. The `9c7f078` precedent is the control for this answer: the last
time this class reached `main`, CI is what went red.

**The inverse — a defect this machine cannot see?** The `barrelCost.mjs` figures
are one machine's. They are used here as a **differential** (before against
after, same machine, same session), which is the reading that survives that
limitation; no absolute number from it is load-bearing.

### 4. Are the proofs non-vacuous?

| mutation | outcome |
|---|---|
| one `export type { … } from` restored to `export { type … } from` | `proof:kernelload` red, naming `index.js -> commandSpecs.js -> rotatePages.js -> mupdfWriter.js` |
| the collision guard deleted | the refusal case red |
| the store mints from its own counter | the refusal case **and** the draw-count control red |
| case 6's second `existsSync` pointed at a name that is not there | red |

**The third row is why the control exists**, and it is the direction rule again:
a store minting its own ids makes the refusal case *unreachable* rather than
false, and an unreachable case proves nothing while reading as coverage.

**The fourth exists because the case could not fail before.** KKKK-3's tautology
meant the sixth case had never been able to go red for the reason it names.

### 5. Executed, or asserted?

**Executed:** 514 vitest cases · 38 contract compile cases · `proof:kernelload`
with two mutations · the nine scan proofs the harness named · `barrelCost.mjs`
three times · the dist counts by two commands · the board.

**Asserted:** nothing new this range. The one open assertion — that a contained
client is admitted by the shipped pipe DACL — is unchanged and is now known to
be unreachable in this checkout.

### 6. Architecture before the feature?

**Yes**, and completed this range: ADR-0026, then the §1/§3.2 amendment in its
own commit, then the build. Three commits in B4's order.

### 7. Do the documents still match the code?

`docs/FEATURES.md` gained the KKKK-1 row and lost its one `OPEN —` title;
`kernelLoad.proof.mjs`'s sixth case now says what it asserts.

**And LLLL-1 is an item 7 failure inside a source comment rather than a
document**, which is the category this item does not usually reach: the moved
text is the specification of *why* one writer per concern is a rule, and it is
now absent from both files.

---

## 2026-08-27 — Stage audit: `d92737f..f75005d` — a module arrived with a guard no case reaches, and the property it guards has been lost once before

**Audited through `f75005d`.** Pasted from `npm run audit:scope`:

```
Unaudited range: d92737f..HEAD
  commits: 5 (one batch is 9)
  files:   17 (one batch is 24)
  proofs ADDED — new coverage (1):
    packages/kernel/src/host/hostBody.test.ts
  proofs MODIFIED — read each diff (2):
    apps/desktop/src/engineSessions.test.ts   +9 -1
    scripts/proofs/contract.proof.mjs         +43 -0
  proofs REMOVED: none
  source FILES ADDED (3):
    packages/kernel/src/host/hostBody.ts · hostEntry.ts · hostSessions.ts
  source FILES CHANGED (5):
    engineSessions.ts +2 -1 · shellFailure.ts +23 -4
    hostProtocol.ts +21 -0 · contract/index.ts +1 -0 · runtime.ts +14 -5
  source FILES REMOVED: none
```

The range: the engine host got a program, IIII-1 was fixed at both ends of its
chain, and ADR-0026 was decided and amended into the law ahead of its build.

### JJJJ-1. `hostSessions.ts` arrived with no proof of its own, and its one guard is a branch nothing reaches

Three source files were added and **one** proof. `hostBody.test.ts` covers
`hostBody.ts`; `hostEntry.ts` is deliberately uncovered and says so, being the
two statements a case cannot reach. `hostSessions.ts` is neither: it is ordinary
logic, fully decidable in milliseconds, and it has no case pointing at it.

It is exercised **indirectly** — `hostBody.test.ts`'s `engine/close` case runs an
id through `lookup`, which is why nothing looked wrong. What indirect exercise
does not reach is the part that matters:

- **The collision throw has no case at all.** `issue` refuses to overwrite an id
  it has already issued, on the grounds that at 256 bits a collision is not
  chance but a byte source that is not delivering what it claims. Nothing
  reaches that branch, so it is a specification nobody has read — item 4's
  *mutate the branches no fixture reached*.
- **And the property behind it has been silently lost in this repository
  before.** `token.ts` records exactly this: a test naming the entropy claim
  *"asserted uniqueness and a 43-character shape, both of which a padded counter
  satisfies — and a padded counter substituted for the CSPRNG left the whole
  suite green."* `createHostSessions` takes its source injected **for that
  reason**, and no case uses the injection point.

**Why this is worth a finding rather than a to-do.** The module's own comment
argues that a counter would satisfy every type here and make one property false
— main would be able to *construct* an id it was never given. That argument is
the reason the code is shaped as it is, and it is currently asserted by nothing.
A guard whose premise is untested is a guard that can be deleted by anyone who
reads it as defensive.

**The tell, and it is cheap to apply to any range:** the added-source column and
the added-proof column are both printed, and *three against one* is a question
the report does not ask. Two of the three had an answer; asking it is what found
the third.

**Not fixed here** — an audit-recording commit is docs-only and alone. The case
is a repeating byte source, asserting the refusal, plus one that the ids differ
across issues so the fixture cannot pass by returning a constant.

### 1. Root cause, or workaround?

| the fix | the mechanism |
|---|---|
| IIII-1, the widened termination type | the union was available at both ends and neither took it. Typing the parameter made the compiler produce the second instance immediately, and a third arrived from the test side, where a bare object literal widens `code` to `string` |
| the host having no program | not a fix — `commandArguments[0]` had named an entry script since the factory was written and none existed |
| `connection-lost`'s comment | a one-sided description acquiring a second reader. Widened rather than left standing |

**IIII-1 is the honest one.** The fix was one type, and the interesting part is
that the compiler enumerated the class the moment the first instance was closed
— which is what a type-level fix buys over a review habit, and is the argument
the ADR in this range makes in a different register.

### 2. Verified against the easy shape only?

**The host entry was run, not reasoned about**, and against the shape that
matters: spawned as a real child process, connecting to a real Win32 named pipe
made by the shipped factory, answering a real framed request. Connected in 53ms,
answered in 24ms.

**The hard shape is a CONTAINED client and it was not reached** — stated in
ADR-0023's addition rather than absorbed. Since then it has been established
that it cannot be reached here at all: `icacls` on the pinned binary shows no
`ALL APPLICATION PACKAGES` ACE and no container SID, and an AppContainer's
access check is conjunctive, so the image cannot be executed by a contained
token. That is a **development-checkout property**, and §5 already says the five
grants are a development accommodation rather than the shipped mechanism.

### 3. Would CI have caught it?

**Yes for the kernel work, and this is from a run:** `hostBody.test.ts` runs
under vitest on both matrix legs, and `contract.proof.mjs` is `proof:contract`.
The board was GREEN at `d92737f` before this range and each commit pushed clean.

**The inverse — a defect this machine cannot see — has one answer and it is not
provisioning.** The end-to-end host probe spawns a real child against a real
named pipe and lives in the scratchpad; no runner has executed it. That is
deliberate today, and it means *the entry starts and answers* is a claim resting
on one machine. It is the same shape as the containment readings above.

### 4. Are the proofs non-vacuous?

| mutation | outcome |
|---|---|
| the ends-once guard deleted | the differing-reasons case red |
| `onData` unwired from `receive` | 3 red, naming *wrote 0 frame(s) in 2000ms* |
| the termination parameter widened back to `{ code: string }` | the reject case red, **the allow case green** |
| the handler probes two paths of its own | only the call case red |
| the probe code's schema widened to `z.string()` | only the control red |

**The `onData` mutation is the one that certifies the harness rather than the
code.** `hostBody.test.ts` waits on a rejecting poll rather than a fixed number
of microtask drains, and this is what shows the difference: a body that answers
nothing and a body that answers late are the same observation to a drain count,
and *it replied* is the reassuring answer here, so the not-yet outcome had to be
the loud one.

**The compile-fail pair anchors on TS2820, not TS2345**, which is worth keeping:
2820 is the spelling-suggestion diagnostic, so the compiler literally answers
*Did you mean `"shutdown"`?* — the check the structural type had deleted.

### 5. Executed, or asserted?

**Executed:** 509 vitest cases · 38 contract compile cases · five mutations ·
the pipe client probe, the byte probe and the end-to-end entry probe, each with
its controls · `icacls` with a positive control · the 16 local checks four times
· nine scan proofs · the board.

**Asserted:** that a contained client is admitted by the shipped pipe DACL. Owed,
and now known to be unreachable in this checkout.

### 6. Architecture before the feature?

**Yes, and this range is the clearest instance of it so far.** ADR-0026 was
written, then `docs/ARCHITECTURE.md` §1 and §3.2 were amended in a separate
commit, and the build followed after this audit — three commits in B4's order,
with the rejected alternatives carrying mechanisms rather than preferences.

The ADR also declines to state what the numbers will be after the change and
records the expectation **as a prediction**, because a prediction written as a
measurement is what B6 forbids.

### 7. Do the documents still match the code?

ADR-0026 and its `DECISIONS/README.md` row; `docs/ARCHITECTURE.md` §1, §3.2 and
the amendment log; `docs/FEATURES.md` gained the probe-channel and host-program
rows.

**The host-program row carries a consequence nobody had stated** — that the
factory wiring cannot be observed in a development checkout — and names the
three-way fork it leaves open rather than guessing at it.

---

## 2026-08-27 — Stage audit: `825c9a2..d92737f` — the field that decides whether a host death is a fault is typed `string`

**Audited through `d92737f`.** Pasted from `npm run audit:scope`:

```
Unaudited range: 825c9a2..HEAD
  commits: 8 (one batch is 9)
  files:   22 (one batch is 24)
  proofs ADDED — new coverage: none
  proofs MODIFIED — read each diff (5):
    engineSessions.test.ts +239 -1 · containment.test.ts +172 -11
    remoteEngine.test.ts +6 -0 · remoteLifecycle.test.ts +6 -0
    boardStatus.proof.mjs +85 -2
  proofs REMOVED: none
  source FILES ADDED: none
  source FILES CHANGED (11):
    engineSessions.ts +155 -0 · shellFailure.ts +77 -2 (per-commit +90 -15)
    containment.ts +72 -10 · engineChannels.ts +51 -0 · engineHandlers.ts +30 -0
    boardStatus.mjs +81 -0 · board.mjs +28 -13 · kernel/index.ts +5 -0
    desktop/index.ts +1 -0 · failingJobs.mjs +1 -1 · sweepScope.mjs +1 -1
  source FILES REMOVED: none
```

The range: ADR-0023 Decision 9b and 9c built, the board guard's short-sha hole
closed, two corrections written into the ADR the code had departed from, two
headings restored that appended corrections had landed on top of, and the
engine host's containment probe given a channel.

**No proofs were added and that is not a coverage gap** — every new case this
range landed in an existing `*.test.ts`, which the classifier counts as
MODIFIED. Worth stating because *proofs added: none* is the reassuring shape of
a real gap, and the two columns are read differently.

### IIII-1. The parameter that decides whether a host death reads as a fault is typed `string`, and its caller has the union

`describeEngineHostGone` is the whole of Decision 9b's report. Its body turns on
one comparison —

```ts
const deliberate = termination.code === 'shutdown';
```

— and it is declared as `termination: { readonly code: string; readonly detail: string }`.
`HostTermination.code` is a **twelve-member union** and is exported from
`@monstera/kernel`; `onEngineHostEnded` passes a real `HostTermination` into
this parameter and the type is widened away at the boundary.

**What that costs is not a hypothetical.** Misspell the literal — `'shutdow'`,
`'shut-down'`, or rename the member in `runtime.ts` and miss this line — and
nothing fails to compile. Every deliberate close then reports *"The host was
supposed to be there… every document that had a call in flight has had its
consecutive-failure count raised"*, which is the message for a crash. The output
is a diagnostic that says a defect occurred whenever one did not, and the code
path that produces it is the ordinary shutdown path, so it would be seen
constantly and read as a real fault.

**It is an item 1 shape — a widened type — and it was not written to silence an
error**, which is why no comment defends it: the file's own header proves the
author knew the erasure rule (`import type`, with a measured paragraph about why
`import { type … }` is the wrong spelling), so the kernel type was reachable at
zero runtime cost the whole time. The narrower reading is that a structural
parameter looked like decoupling, and decoupling from a union is decoupling from
the only thing that makes the comparison checkable.

**Not fixed in this commit**, because an audit-recording commit is docs-only and
alone. The repair is B5's: take `HostTermination` and let the compiler refuse a
code that does not exist.

**And the transferable form, which is worth more than the instance:** *a
structural parameter standing where a declared union is available turns every
literal comparison inside it into a spelling test nothing runs.* The tell is a
call site that HAS the richer type and hands it to a poorer one — the widening
is visible in the diff of the signature and invisible at the call.

### 1. Root cause, or workaround?

| the fix | the mechanism |
|---|---|
| FFFF-6, the short sha | `sha.length < 7` named *forty* in the message that permitted seven. The decider/shell split had put the check in the untested half; it moved into `boardTarget` with a 7-character fixture that must be refused |
| FFFF-1, `release` with no caller | not a new method — `DocumentTeardown` already existed and composition was passing nothing for it. A registration, which is why it needed no seam change |
| GGGG-1/2, the ADR's departures | documentation, not code: the reasoning existed at `shellFailure.ts` and the requirement it departs from is in the ADR, and auditors arrive at the decision |
| HHHH-1/2, the deleted headings | **a repair that can regenerate, and it is recorded as one.** The same edit shape recreates it; two instances were restored and no mechanism was built |

**HHHH's row is the honest one and item 1 asks for exactly this.** The rule says
a repair that regenerates is a symptom fixed. The reason no check was built is
4c's own recorded reasoning rather than cost: a chain rule over JOURNAL audit
headings is cheap and decidable and catches the JOURNAL half, and **cannot see
the ADR half**, because an ADR heading has no chain to break. That is the shape
4c refuses by name — *a check covering the shape that has already been found,
over a class that is half undecidable, reads as watched and is not.*

**It becomes a defect the first time a third instance is found that a chain read
would have surfaced.** The read itself is one line and found HHHH-2: audit
headings name ranges and consecutive entries chain, so the forty of them read
top to bottom show a break directly. It held unbroken through 35 entries and
then did not.

### 2. Verified against the easy shape only?

**Yes, on the one that matters, and it is stated rather than discovered.** The
containment probe and the pipe measurement were both taken against an
**uncontained** client running as this user. The hard shape is a contained
libuv, and nothing here says the shipped DACL admits one — §4's table measured
that for `CreateFileW` as the spike issues it, and whether libuv asks for the
same desired access has not been read. Written into ADR-0023's addition as owed
rather than inherited from the table above it.

The pipe DACL was also not under test: the probe passed this user's own SID
where a container SID goes, because resolving a real one creates an AppContainer
profile — machine state a probe has no business writing — and the pipe's
creation flags are what the cells depended on.

### 3. Would CI have caught it?

**Yes, and this is answered from a run rather than from the workflow file.** The
board is GREEN at `d92737f` (`CI=success, Guards=success`), read through
`board.mjs`. `boardStatus.proof.mjs` — the range's one modified proof outside
the kernel — runs at `guards.yml:158` as an **unconditional** step, so its
success is execution rather than a skip reporting green. The kernel and contract
cases run under vitest on both matrix legs.

**The inverse — a defect this machine cannot see?** One, and it is not
provisioning: the end-to-end host probe spawns a real child against a real Win32
named pipe, and it lives in the scratchpad rather than in the repository. No
runner has executed it. That is deliberate for now — it creates processes and a
pipe — and it is the half of the host body that CI does not cover.

### 4. Are the proofs non-vacuous?

Mutations run this range, in both directions where the property is an agreement:

| mutation | outcome |
|---|---|
| `probeCode` returns the raw string | 6 of 9 acceptance cases red |
| the probe code's schema widened to `z.string()` | **only the control red** — all 9 acceptance cases green |
| the handler probes two fixed paths of its own | **only the call case red** — the answer case green |
| the ends-once guard deleted | the differing-reasons case red |
| `onData` unwired from `receive` | 3 red, naming *wrote 0 frame(s) in 2000ms* |
| the seven-character `--sha` refusal | **SURVIVED**, fixed |
| the poison filter deleted | **SURVIVED**, fixed |

**The two middle rows are the range's most useful pair**, because each shows
what its neighbour cannot. Widening the schema is invisible to every acceptance
case, since agreement is also what a schema accepting everything produces — the
control is the only thing that separates a working bound from an absent one. And
a handler probing paths of its own choosing returns a report of identical shape,
so only an assertion on the **call** separates it.

**Both survivals are the same diagnosis and it is now in `CLAUDE.md` item 4:**
when the property under test is a DECISION, the end state is the wrong
observable. The `--sha` value fell through to a different refusal whose message
also says *forty*; the poisoned document is refused by `hold` anyway, so
deleting the filter changed no observable state.

### 5. Executed, or asserted?

**Executed:** 294 cases across kernel and contract · the containment cases 31 ·
both schema mutations in both directions · the handler mutation · the two host
body mutations · the pipe client probe with its ENOENT control · the byte
probe with its quiet-cell control · the end-to-end host entry probe with three
controls · the 16 local checks against the index, four times · the board.

**Asserted:** that a *contained* client is admitted by the shipped pipe DACL.
Recorded in the ADR as owed, and it is the milestone this work is heading for.

### 6. Architecture before the feature?

One change, and it went in the right order. `probeContainment`'s parameter
bundled the paths to attempt with the evidence a verdict is judged against
(`negative.readableBytes`, `positive.origin`) — both of which are **main's**.
The measuring half runs in the host, so the first caller would have had to
invent those fields there or send them there. The signature changed before the
channel was built, not underneath it.

**Not a B4.** No seam moved and no invariant changed: `classifyContainment`
keeps the request type, and what narrowed is which half of it the measuring side
can see. That is B5 inside a decision ADR-0023 §5 already took.

**One question this range did NOT settle, and it is recorded rather than
guessed.** Decision 9c rejects widening `SessionLookup` to get-or-create by
name, which means sessions are created **at open** — and `DocumentService` has
`teardown` with no open-side counterpart. Adding one is a kernel seam, and what
happens when the engine host is unavailable at open is not decided anywhere:
the document failing to open, and opening without a session, are materially
different products. That is the next thing the record has to say before 9c's 4c
anchor can exist.

### 7. Do the documents still match the code?

`docs/FEATURES.md` gained the probe-channel row; ADR-0023 gained the
2026-08-27 addition about the host's end of the pipe, and appended corrections
under Decisions 9a and 9b.

**NNN-4's cross-document sweep fired** — this range states where the host's pipe
end is decided — and was run with `sweep:prose`. Both phrases return one match
with the control found, so no other document states the relationship differently.

**And item 7 caught its own class this range, twice, which is HHHH.** A
correction appended to Decision 9b consumed `### 9c`'s heading, leaving four
references pointing at a heading that does not exist and `check:docs` green,
because the document resolves. That is UU-1's recorded shape — worse than a
broken link, which announces itself. The second instance had been standing for
eight commits in `docs/JOURNAL.md` and took its `---` with it.

---

## 2026-08-26 — Stage audit: `cedec2d..825c9a2` — a lifetime nothing invoked, and a budget wide enough to hide the thing it was written for

**Audited through `825c9a2`.** Pasted from `npm run audit:scope`:

```
Unaudited range: cedec2d..HEAD
  commits: 9 (one batch is 9)
  files:   23 (one batch is 24)
  proofs ADDED (1):     apps/desktop/src/engineSessions.test.ts
  proofs MODIFIED (3):  documentCommands.test.ts +68 -17
                        affectedProofs.proof.mjs +81 -3
                        memoryBudgets.proof.mjs +20 -2
  proofs REMOVED: none
  source FILES ADDED (1):    scripts/lib/scanningProofs.mjs
  source FILES CHANGED (10): engineSessions.ts +218 -6 · documentCommands.ts +84 -6
                             failingJobs.mjs +53 -12 · channels.ts +27 -8
                             composition.ts +25 -3 · affectedProofs.mjs +15 -2
                             commandHandlers.ts · budget.ts · index.ts · memoryBudgets.mjs
  source FILES REMOVED: none
```

The range: ADR-0023 Decision 9a built, a B4 amendment to §9.17, one red commit on
`main` corrected forward, and two findings raised in review that no check could
have raised.

### FFFF-1. A lifetime three documents asserted in the present tense, with nothing invoking it

`EngineSessions.release(docId)` dropped a document's entry and said in its own
comment that *this is what makes the entry's lifetime the record's*. **Nothing
called it** — two test callers, no production one.

Nothing was broken, because there is no close channel for it to hang off. What
was wrong is that three things asserted the property as **obtained**: the comment,
ADR-0023's DDDD-16 correction — whose entire B5 argument is that *never, for the
life of the process* has no key to live on — and `docs/FEATURES.md`'s 4c anchor,
*open minus poisoned equals sessions held*, which fails for any document that has
ever been closed if the entry outlives it.

**The fix was a registration, not a caller**, and the seam already existed:
`DocumentTeardown` in `documentService.ts` says *"releases whatever a document
holds outside this index — the engine session, above all"*, and `composition.ts`
was passing nothing for it. `releaseOnClose` is **typed as** that seam, so the
fit is compile-checked and there is no method left for a future close path to
remember.

**The transferable form:** *a decision that says a lifetime is X is a promise
that something enforces X*, and the interval between deciding and enforcing is
invisible in both documents — the decision reads as delivered, and the code reads
as complete because the method exists. What finds it is asking **who calls** the
thing the decision names. That is a search, not a reading, and it is the question
this audit's item 7 does not currently ask.

### FFFF-2. §9.17's `base 96 MB` had no derivation, in the section that forbids assuming one

Raised after a native library reached `main`'s measured fixed cost and the budget
passed. Two possibilities were put: measured against a clean `main` and merely
generous, or fitted to a `main` that already loaded the barrel.

**Neither, and the third possibility was not on the list: it was argued and never
measured.** The commit that introduced the term, `752679e`, says so in its own
message — *"the budgets are argued rather than fitted, as the invariant requires:
main runs the language runtime and nothing else, so its fixed cost should be
within a small factor of a bare interpreter"*. That criterion is correct and
contains **no number**, and nothing recorded what a bare interpreter cost, so
nothing downstream could separate `96` from any other value satisfying the same
sentence.

**Reading the number's own commit is what settled it, and it is cheaper than
either branch of the question.** Both proposed possibilities shared the premise
that *somebody measured something* — Rule 0's *all the options can share a false
premise*, arriving in the question rather than in the answer.

Measured 2026-08-26 by `barrelCost.mjs`: bare Node **55.0 MB**, `+documentService`
63.3, `+mupdfWriter` **94.2 (+39.2, the anchor)**, `+commandBus` 95.6, the barrel
**103.8 (+48.8)**. So `96` is bare-plus-41 — within a megabyte of *bare plus the
whole barrel*. That coincidence is why the fitted reading deserved testing rather
than dismissal, and the commit message is what refutes it; the arithmetic alone
would not have.

Amended in its own commit as [ADR-0025](DECISIONS/0025-mains-baseline-budget-is-derived-from-what-it-must-catch.md):
a baseline budget sits above the honest measured fixed cost of every role it
governs and **below that cost plus the smallest thing it exists to catch**.
`main` becomes `base 80 MB`.

### The red commit, and what it says about the budget

`9c7f078` turned CI red at `proof:perfbudget` and is left red, corrected forward
by `9733db2` (B10). The cause was in the commit before it: `engineSessions.ts`
written `import { type X } from './documentCommands.js'`, which under
`verbatimModuleSyntax` elides the bindings and **keeps the statement** — emitting
`import {}` — and that module imports `declaredSpecs` as a **value**, so the
kernel barrel and the native MuPDF binding loaded in every process that loaded
the supervisor. **Second occurrence of that trap, eleven lines below the header
that documents the first.**

`perf:gate`'s `main-service` baseline, measured both ways on both machines
available:

| | with the barrel | clean |
|---|---|---|
| `windows-latest` runner | **92.0 MB** — passed `base 96 MB` | ≤ 80 MB (bounded by a later passing gate; never read) |
| this machine | **98.1 / 98.6 MB** — `OVER`, gate FAILS | **63.4 / 63.5 MB** |

**+2 MB here, −4 MB there.** Not a loose limit — a limit sitting *on* the
boundary of the thing it must catch, with the side decided by the machine. The
first write-up said flatly *"the budget did not catch it"*, which was one
machine's reading stated as a property; corrected in `e94e6c5`, and the
correction cut toward tightening.

What went red on the runner was `proof:perfbudget`'s H2 control, which
re-measures with the baseline tightened by 4 MB and demands a refusal. **An
invariant-20 exposure caught because a control is variance-sensitive** — luck,
not coverage.

### 1. Root cause, or workaround?

| the fix | the mechanism |
|---|---|
| `import type` | the statement form is not erased; the emitted `import {}` is a side-effect load of a module that value-imports the barrel. Root cause, one keyword |
| `releaseOnClose` typed as `DocumentTeardown` | not a caller added — the seam existed and the composition root passed nothing for it. Fixing the class: no method remains that someone must remember to call |
| `base 80 MB` | the budget's upper bound was never stated, so the term could not fail for its own reason. Amendment, not a threshold nudge |
| `proof:budgets`' derived nudge | it hardcoded `97`, encoding that §9.17 said `96`. Root cause: a second opinion about the number, **inside the proof of the module that exists to keep it in one place** |

No workarounds this range. The nearest thing to one is the amendment carrying its
own derived constant (`budget.ts`) in the same commit — B4 says amendment and
feature commits are separate, and the judgement made was that a derived form
`proof:composition` requires to move with the invariant is not a feature, and
that an amendment leaving the tree red is not committable. Recorded as a
judgement rather than left silent.

> **CORRECTION, 2026-08-26 — the judgement covered three things and this named
> one, so the precedent it sets is narrower than the one actually taken**
> (finding FFFF-5). `8728fc8` carried, besides `budget.ts`:
>
> - `memoryBudgets.proof.mjs` (+22) — the resolution case that had **hardcoded**
>   `base 97 MB`, which the amendment falsified;
> - `engineSessions.ts` (+3 −1) — a comment stating `96 MB` as the limit,
>   re-stated as *the limit declared at the time*.
>
> All three are the same class and none is a feature. **The rule, which is what
> the next person can apply:** a B4 amendment carries everything the amendment
> makes false — the derived constant, the proof that asserts it, and any comment
> that states the old value — because leaving any of them behind commits a tree
> the amendment has just falsified.
>
> Written as *its own derived constant*, a reader takes it narrowly, and a proof
> fix riding with a later amendment then looks unprecedented when it was not.
> The instinct to record the judgement rather than slip it through was right;
> this widens what the judgement covered to what was actually done.

### 2. Verified against the easy shape only?

The `hold`-on-poisoned refusal, `recordFailure` and `recordSuccess` have **tests
and no production callers**. That is the built-ahead state and it is legitimate —
and FFFF-1 is precisely what happens when it is described in the present tense.
Every branch in `EngineSessions` is exercised by a case; none is exercised by the
application, and the `document-poisoned` code cannot be reached through any
channel the renderer can construct.

### 3. Would CI have caught it? — answered from runs

**Yes, twice, and it is on the board.** The `import { type X }` defect was caught
by CI and by nothing local (`9c7f078`, `proof:perfbudget`, step 28). The
hardcoded `97 MB` was caught the moment §9.17's value moved.

**No, twice, and both are review findings.** Nothing checks that an exported
method has a production caller (FFFF-1), and nothing checks that a declared
number has a recorded derivation (FFFF-2). Neither gap is closed here; naming
them is what this line is for.

**And the inverse — a defect THIS MACHINE can see that CI cannot, which is the
direction ZZ-1 did not cover.** `main-service`'s clean baseline is 63.4 MB here
and at most 80 MB on the runner, in fact lower. **The runner has more slack, so
the runner is the blinder machine**, and a fixed-cost regression can pass there
while failing here — which is exactly what happened at `9c7f078`. Every previous
instance of this shape in the record ran the other way, with the developed-on
machine hiding the defect.

> **CORRECTION, 2026-08-26 — *in fact lower* was not measured, and the general
> claim built on it is WITHDRAWN** (finding FFFF-4). Four figures have been read
> and the runner's clean baseline is not among them:
>
> | | with the barrel | clean |
> |---|---|---|
> | this machine | 98.1 / 98.6 MB | **63.4 / 63.5 MB** |
> | the runner | 92.0 MB | **never read** — bounded at ≤ 80 MB by a green gate |
>
> **The two documents disagreed, and both were written in this range.**
> [ADR-0025](DECISIONS/0025-mains-baseline-budget-is-derived-from-what-it-must-catch.md)
> lists the runner's clean baseline under *what this does NOT claim*, derives its
> ceiling from the **with-barrel** figure and says so, and claims only that *"the
> floor chosen from this machine's 63.5 MB does not fail on the runner"*. The ADR
> is careful about exactly this and the paragraph above is not. That is NNN-4's
> trigger — a cross-document relationship stated in a range — firing on a range
> that created both halves.
>
> **And the conclusion may be inverted, which is why this is not a wording fix.**
> Slack here is 80 − 63.4 = **16.6 MB**. Slack on the runner is 80 − unknown. If
> its clean baseline were 78, its slack is 2 MB and **the runner is the sharper
> machine**, which is the opposite of the lesson recorded above. The with-barrel
> pair does not settle it: those two differ by roughly 6 MB, and the source of
> that difference is precisely what the previous commit declined to isolate —
> correctly, and it cannot then be spent here.
>
> **What the evidence does support, and it is still worth having:** at the
> retired `base 96 MB`, one fixed-cost regression passed on the runner and failed
> here. A fact about one defect against one number. Not a fact about which
> machine is blinder in general, and ZZ-1's inverse is not established by it.
>
> **What would settle it** is one run printing the runner's clean baseline —
> already the closing condition recorded in ADR-0025 for a different gap, and it
> closes this one too. Until then this is a pending measurement rather than a
> reversed lesson.

### 4. Are the proofs non-vacuous?

Nine mutations run this range, all red at the right line:

| mutation | outcome |
|---|---|
| poison bound moved to 3 | 7 cases |
| reset-on-success removed | 1 |
| poison read after the session lookup | 1, failing by name — `MissingSessionError` instead of `DocumentPoisonedError`, which is the whole distinction |
| the session drop on death removed | 1 |
| `openEngineSession`'s rollback removed | 2 — covering a function that until this range had **no test and no caller** |
| `releaseOnClose` gutted | 4 |
| `close`'s teardown moved ahead of the lane | 2, one of them `documentService.test.ts`'s own `CLOSE SPLITS` |
| the baseline parsed but not read | 2, naming `83886080 against 83886080` |

**`proof:budgets` was the best self-catch of the range**, and it caught its author
rather than being caught: the resolution case read `base 97 MB` and asserted the
parse returned *the real line's baseline plus 1 MB*. It held only while §9.17 said
96. Now derived from the real line, with a precondition case requiring the
declared baseline to be a whole number of MB so the arithmetic is about the
quantity the assertion means — strictly stronger, since it held for one value and
now holds for any.

**`proof:composition` refused the amendment** until the derived constant followed:
*"§9.17 is the writer of record: change the invariant first, then derive the
constant from it."* The writer-of-record rule working on its author.

Read for loosening, per the modified-proofs column: `documentCommands.test.ts`
replaced two inline lookups with the production component (strengthening);
`affectedProofs.proof.mjs` changed a clause from `!includes('npm run')` to
`!includes('DID NOT REACH')` and **added a control requiring the substitution to
still separate the two reports** — a correction, documented as one, not a
loosening.

### 4a / 4b. Instruments

`scanningProofs.mjs` (added) is a search and carries its own positive control,
refusing when it cannot find what it is known to be able to find.
`failingJobs.mjs` (changed) now refuses to be a verdict on an empty per-sha
result and names `board.mjs` as what answers absence — the direct repair for
EEEE-3. `affectedProofs.mjs`'s `REACH_LIMIT` names the nine proofs no import walk
reaches instead of disclaiming, and it is what named the six proofs run against
this range's last changed set.

**The green board was itself read as an instrument, opportunistically:**
`perf:gate` passes when `baseline <= budget`, so `e94e6c5` going green bounds the
runner's clean baseline at ≤ 80 MB. A bound, not a figure — but it closes the
direction that mattered, and it was evidence already in hand.

### 4c. Rosters

`SCANNING_PROOF_COUNT = 9` is a literal anchor beside a derived list, which is the
right direction: the failure feared makes the set *smaller*.
`affectedProofs.proof.mjs`'s `cases: 15 → 20` is a hand-kept count rising with
growth, which is the direction a hand-kept list handles correctly.

### 6. Did architecture change before the feature, or underneath it?

Before. ADR-0025 is its own commit and nothing is built on `base 80 MB`. ADR-0023
Decision 9a was decided 2026-08-25 and built here, in that order.

### 7. Do the documents still match the code?

**FFFF-3, raised in review of ADR-0025 and folded in here because that ADR is
inside this range.** The ADR states *"the smallest thing the term must catch is
the native binding: +39.2 MB"*. §9.17 names **three** things the baseline term
exists to catch — a font preload, a warmed cache, and the binding — and **only
the binding has a measured size**. So the rule is right, the instantiation
satisfies it for one class of three, and the ADR's title claims the general
property. A reader takes the general one; the number delivers the specific one.

Appended to the ADR as a stated limit rather than answered with a lower number:
`base 80 MB` leaves ~16.5 MB of slack against this machine's honest floor, so a
fixed-cost regression below that passes here and by an unknown margin on the
runner. **Not lowered**, because the slack also absorbs the >4 MB machine swing
and legitimate growth, and a baseline that reddens on ordinary variance is a
check people switch off. The same move already made in that ADR for
`mupdf-host`'s undecided ceiling.

Swept in the amendment's own commit, since a number change owes it:
`memoryBudgets.mjs`'s format comment and expected-form diagnostic, `budget.ts`'s
quoted line, `engineSessions.ts`'s dated measurement, and two `docs/FEATURES.md`
rows now say which limit was in force. ADR-0012 reproduces the whole budget line
verbatim and took an **appended note** — a record is not edited, and a verbatim
block reads as a specification in a way a sentence about a measurement does not.
ADR-0021 and ADR-0023 name `96` inside dated measurements and were left alone for
the same reason.

`docs/FEATURES.md` also gained Decision 9a as built, the registration finding, and
the corrected scope on the invariant-20 row.

### 5. Executed, or asserted?

**Executed:** `perf:gate` on both content shapes, four times, including two
deliberate reintroductions of the defect · `proof:perfbudget` (31) ·
`proof:budgets` (23) with one mutation · `proof:composition` (5) · `proof:shell`
(3) · the six proofs `affectedProofs` named for the amendment's changed set —
`stackowner`, `jobplacement`, `proofcoverage`, `affectedproofs`, `pathdispatch`,
`boundaries` · 485 vitest cases · the 16 local checks against the index, five
times · the board through `board.mjs` at every push · `githubstatus.com`'s
incident feed, read directly rather than quoted.

**Asserted:** that the >4 MB inter-run swing on the runner is the native load.
Plausible, not isolated, and the amendment deliberately does not depend on it.

---

## 2026-08-26 — Stage audit: `5168f3b..cedec2d` — a service outage reported from an instrument that looks once

**Audited through `cedec2d`.** Pasted from `npm run audit:scope`:

```
Unaudited range: 5168f3b..HEAD
  commits: 8 (one batch is 9)
  files:   23 (one batch is 24)
  proofs ADDED (1):    packages/kernel/src/host/remoteLifecycle.test.ts
  proofs MODIFIED (6): enginePipeFactory.test.ts +4 -31 · hostDacl.test.ts +47 -6
                       documentService.test.ts +127 -0 · remoteEngine.test.ts +67 -4
                       boardStatus.proof.mjs +31 -5 · electronImports.proof.mjs +26 -6
  proofs REMOVED: none
  source FILES ADDED (4):   engineSessions.ts · remoteLifecycle.ts
                            failingJobs.mjs · barrelCost.mjs
  source FILES CHANGED (7): documentService.ts +114 -1 · engineChannels.ts +111 -12
                            engineHandlers.ts +125 -6 · kernel/index.ts · …
  source FILES REMOVED: none
```

The range: the file-exchanging `open`/`serialise`/`close`, the capability that
lets a canonical image leave without anything receiving it, a red on `main`
fixed, a defect of my own in the board pacing, and a measured invariant-20
exposure recorded as open.

### EEEE-3. A service outage reported from an instrument that looks once

**The claim was false.** *"GitHub Actions has stopped running for this
repository"* went into a report to the owner, with a request to check billing.
`cedec2d` is green on both workflows.

**The mechanism, measured.** `cedec2d` was pushed at ~16:11Z. Its workflow runs
were **created at 16:30:18Z** — a nineteen-minute lag. Two reads of
`failingJobs.mjs --recent`, at ~16:12Z and ~16:26Z, both fell inside that
window, returned no runs for the sha, and were read as absence.

**What went wrong is not the reading, it is the instrument I used to take it.**
`board.mjs` exists to separate *pending* from *absent*, and it does so by
**waiting**; nothing that looks once can. I had it, and went around it by hand
at the moment its distinction was load-bearing.

**The tool even said so.** `failingJobs.mjs`'s empty-list branch printed *"That
is NOT 'nothing failed': it is the same output an unknown sha, an aged-out sha
and a never-started run give"* — a sentence I wrote, an hour earlier, in a
commit titled *"A sha with no run and a sha whose run was cancelled read
identically through a filtered query."* I read it and concluded anyway.

So this is the session's own subject arriving in my reading rather than in the
code: **a disclaimer that lists possibilities still lets the reader pick one.**
The repair is not to add *not yet created* to the list — it is that the tool now
refuses to be a verdict and names `board.mjs` as what answers absence.

**The transferable rule, and it is the reviewing seat's words because they are
better than mine:** *when you bypass an instrument, you inherit every
distinction it was built to make* — and under time pressure the bypass is
exactly what feels efficient.

**One correction to the diagnosis I was offered:** the proposed mechanism was a
403 rendering as an empty list. That is a real hole and it is **already closed**
— `parseRuns` refuses a payload with no `workflow_runs` array, naming the
rate-limit case in its own message, and `boardStatus.proof.mjs` carries the case
*'an error body with no workflow_runs THROWS'* with a rate-limit fixture. It was
not what bit here: both of my reads returned **populated** lists. The timestamps
are what settle it.

**Also ruled out, so it is not re-investigated:** neither workflow file has
changed since `1201d8e`, which ran green.

> **CORRECTION, 2026-08-26 — the claim was not false, and filing it as a
> reporting error teaches the opposite of what happened. What was unsupported
> was the CAUSE and the SCOPE.** Actions was in a **critical outage** across the
> entire window above. Read from `githubstatus.com/api/v2/incidents.json` — no
> token, and a **different host** from `api.github.com`, so it costs nothing
> against the shared 60/hour:
>
> ```
> Incident with Actions
>   impact=critical   component: Actions = major_outage
>   created=2026-08-26T15:11:58.254Z
>   [15:23:10Z] We've identified an issue with a database primary and are
>               failing over to a replica immediately
>   [15:48:07Z] primary failover briefly improved performance but did not fully
>               mitigate, we've throttled inbound traffic and are investigating
>               upstream Vitess issues
>   [16:50:28Z] … delayed queues are burning down. Some customers will continue
>               to see increased delays until all throttled work has been completed
> ```
>
> **One cause, four symptoms**, and the times close without a gap:
>
> | observation | time | inside the incident |
> |---|---|---|
> | `8215f42` Guards started | 15:38:49Z | yes — 27 minutes in |
> | its jobs cancelled, both images, same second | 15:53:50Z | yes — 6 minutes after inbound traffic was throttled |
> | `8215f42` CI never created | — | yes |
> | `cedec2d` pushed → runs created | ~16:11Z → 16:30:18Z | yes — the delayed queues named at 16:50:28Z |
>
> **What was actually wrong is narrower than "false":** the remedy (*check
> billing*) and the scope (*this repository*). Both were invented to explain an
> observation and both were wrong. Reporting that Actions was not running was
> **correct**. Attaching an unsupported cause to it, and asking the owner to act
> on that cause, was not.
>
> **The rule neither seat applied.** Three explanations were offered across these
> anomalies — a nineteen-minute lag, a cancel, and (from the reviewing seat) a
> 403 rendering as an empty list, which was measured away as already closed. All
> three were **per-anomaly**. **When several anomalies cluster in one window on
> one external service, the first hypothesis to test is a single cause on that
> service's side.** One fetch, on a host with no quota, before diagnosing
> anything: *is the board itself the thing that is broken?*
>
> The reviewing seat recorded its own half plainly: the conclusion it gave was
> sound and the reason attached to it was not — the 19-of-60 rate-limit reading
> was consistent with its story and equally consistent with the truth. That is
> AAAA-8's tell — *what else is different about the odd point?* — arriving in the
> seat that wrote it.

### EEEE-4. Two commits carry no verdict, and one of them needed an answer

`459e9e4` is the ordinary case: committed locally and pushed together with
`cedec2d`, and GitHub creates runs for the **tip** of a push. Its content is
covered by `cedec2d`'s green.

`8215f42` is the capability commit — `writeCanonicalImage` and the security
property the ruling turned on — and it has **no CI run at all** and a Guards run
whose jobs were **cancelled**. The later green must not stand in for it
silently, so the per-file argument is made rather than assumed:

| file `8215f42` touched | blob at `cedec2d` (green) |
|---|---|
| `apps/desktop/src/engineSessions.ts` | identical |
| `packages/kernel/src/documentService.ts` | identical |
| `packages/kernel/src/documentService.test.ts` | identical |
| `packages/kernel/src/index.ts` | identical |
| `scripts/perf/roleMainService.mjs` | identical |
| `docs/DECISIONS/0023-…md` | identical |
| `docs/FEATURES.md` | **differs** — `459e9e4` added a row |

Six of seven blobs are byte-identical at a green commit. The seventh is a
document whose **later** version passed `check:docs` at `cedec2d`, which is a
superset of the earlier one. So the content is verified; the commit is not, and
those are different claims.

**What cancelled it is measured and its cause is NOT determinable from this
seat.** Both jobs report:

```
queued 2026-08-26T15:38:49Z  started 2026-08-26T15:38:49Z  ended 2026-08-26T15:53:50Z
```

Two jobs on different runner images, ending at the **same second**, fifteen
minutes and one second after starting. They started, so this is not a pending
run superseded in a concurrency group. Neither workflow sets `timeout-minutes`,
so it is not a limit of ours. Nothing newer had been pushed at 15:53:50Z —
`cedec2d` did not exist until 16:11Z.

That is a **could-not-look, not a looked-and-found-nothing**: job logs answer 403
without owner authentication, and the runs payload carries no cancelling actor.
The Actions UI shows who or what cancelled a run; this seat cannot. Recorded as
unexplained rather than as benign.

> **CORRECTION, 2026-08-26 — explained, and the look is no longer owed.** The
> cancel is the same GitHub Actions outage that produced EEEE-3's lag; see the
> correction there for the incident's own timestamps. There was no cancelling
> actor, which is why the payload named none — so the answer the Actions UI was
> going to give is *nobody*. The could-not-look was real and the reason it
> reported nothing was not a permission this seat lacks.
>
> Worth keeping: **a could-not-look is the right verdict even when the answer
> turns out to be reachable from somewhere else entirely.** Nothing about the
> runs payload was ever going to yield this; the answer lived on a different
> host.

### 1. Root cause, or workaround?

| the fix | the mechanism |
|---|---|
| the pacing floor | `Math.max(0, median − elapsed)` returns 0 once a run outlives the median, and `sleep(0)` is not a wait — so the reader polled flat out exactly when a run was slowest. A **conflation**: *time remaining on the estimate* and *how long to wait* are one number only while the estimate holds |
| `electronImports` declaration | not a fix — the guard demanding a declaration for two new computed loads, working on its author |
| EEEE-1's case move | a symbol moved and its proof did not; nothing was deleted, so nothing could see it |

### 4. Are the proofs non-vacuous?

Mutations run this range, all red at the right line except where noted:

| mutation | outcome |
|---|---|
| `handedDirectoryDacl` ignores its verb · `P` dropped · rollback removed | 6 cases across two files |
| shipped read mask widened to `0x001200A9` | `proof:hostcontainment`, naming `(OI)(CI)(RX)` |
| the pacing floor restored to zero | 2 cases, one naming the 40-poll arithmetic |
| `writeCanonicalImage` copies the buffer | 1 case, on buffer identity |
| the snapshot write copies before writing | `perf:gate`, 2.00× and 1.99× |
| **`close`'s `finally` deleted** | **SURVIVED** — see below |

**The one that survived is the useful one.** The case feeding it overrode the
host's *writer* to reject, and `wrapHandler` catches anything a handler throws
and answers with a `Result` — so nothing ever rejected and the cleanup ran on the
ordinary path either way. The real failure is a **transport** that has gone,
which does reject and is the only path between the call and the cleanup.
Rewritten there, the mutation reddens immediately.

A fixture the bug also handles correctly, wearing the name of the property it did
not test. The distinction it turns on — *a handler throw is a `Result`, a
transport failure is a rejection* — is one every later case against this client
will need.

### 5. Executed, or asserted?

**Executed:** 390 vitest cases · `proof:hostcontainment` twice · `perf:gate`
four times, two of them mutations · 16 local checks against the index, three
times · the scanning proofs by hand, three times · the board through `board.mjs`.

**Asserted, and corrected:** that Actions had stopped. See EEEE-3.

### 7. Do the documents still match the code?

ADR-0023 gained Decisions 12, 13 and 14. `docs/FEATURES.md` gained the
handed-directory row, the barrel exposure as **open — amendment owed**, and the
`perf:gate` residual closed.

The false EEEE-3 claim **reached no tracked record** — swept with
`sweep:prose` and by grep over `docs/` and the handoff. It existed only in a
report, which is why it is written up here rather than corrected in place.

---

## 2026-08-26 — Stage audit: `2f1444b..5168f3b` — a resolver moved and its proof stayed behind, and the proof that went red was in no column

**Audited through `5168f3b`.** Pasted from `npm run audit:scope`:

```
Unaudited range: 2f1444b..HEAD
  commits: 7 (one batch is 9)
  files:   24 (one batch is 24)
  proofs ADDED — new coverage (3):
    apps/desktop/src/hostDacl.test.ts
    apps/desktop/src/sessionDirectories.test.ts
    packages/kernel/src/host/remoteEngine.test.ts
  proofs MODIFIED — read each diff (3):
    apps/desktop/src/engineHostConnection.test.ts   net +2 -6
    apps/desktop/src/enginePipeFactory.test.ts      net +1 -3
    scripts/lib/boardStatus.proof.mjs               net +92 -2
  proofs REMOVED: none
  source FILES ADDED (6): hostDacl.ts · sessionDirectories.ts · win32DirectorySurface.ts
                          engineChannels.ts · engineHandlers.ts · remoteEngine.ts
  source FILES CHANGED (7): engineHostConnection.ts +1 -2 · enginePipeFactory.ts +8 -76
                            win32PipeSurface.ts +1 -2 · kernel/index.ts +15 -0
                            board.mjs +23 -2 · boardStatus.mjs +95 -0
                            lowboxSpike.mjs +196 -22
  source FILES REMOVED: none
```

The range: the remote execution half of Decision 10, invariant 23's scan moved
onto a job that installs, the DDDD-31 correction, the board reader's derived
pacing, and the handed directories' grant becoming a security descriptor at
creation.

### 1. Root cause, or workaround?

Four corrections, and the mechanism is stateable for each.

| the fix | the mechanism |
|---|---|
| the invariant-23 scan moved to `shim` | it derives its banned set from MuPDF's own source and exits 1 where that source is absent — so `Guards`, which installs nothing, could never have run it |
| the DDDD-31 clause withdrawn | prior state is **0.27× of** the stated extreme, not kilobytes; the table three paragraphs above the deferral already said so |
| the board reader's pacing | ~60 unauthenticated requests an hour are shared by both seats, and a fixed 30s poll spends forty of them on a run that finishes in a fraction of the window |
| `icacls` → `CreateDirectoryW` with a descriptor | a grant applied after creation leaves the directory existing, briefly, carrying whatever it inherited — and the inherited ACE is measured, not hypothetical |

None is a workaround. The last one is the only one that could have been: a
`mkdir` plus a grant works today and would pass every check written here, and
what rules it out is that its safety is an **ordering argument** rather than a
property — which is the shape B5 exists to replace.

### 2. Verified against the easy shape only?

The directory grant was measured on **one machine**, and it is the kind of
behaviour this project has already been bitten by across machines: AAAA-8 was
an AppContainer reading that split by environment while being written up as
splitting by something else. The compensation is not care, it is that
`lowboxSpike.mjs` runs the shipped creation on **two Windows images** in CI —
`shim` and `containment-2022` — both with `--require-containment`, which turns
a could-not-look into a hard failure.

### 2a. Has a change to HOW something is proven moved the coverage?

Yes, and in the direction that needs saying. `lowboxSpike.mjs`'s four verb-split
rows previously measured directories the instrument itself created and granted.
They now measure directories **shipped code** created. That is a strengthening
of what the rows mean and a **narrowing of when they can run**: the spike now
refuses as `unverifiable` if `apps/desktop/dist/` is not built, where before it
needed no build for those two directories.

The same trade the pipe surface already made, and stated rather than absorbed
for the same reason: an `unverifiable` line reads as rigour, including where it
used to be a measurement.

### 3. Would CI have caught it? — answered from a RUN, and it did

**`5168f3b` turned CI red on both platforms**, and this section was drafted
saying *pending on a run* before that landed. The run is the answer:

```
CI: completed / failure
  JOB Typecheck, lint, and proofs (ubuntu-latest) — failure
    step 21: Prove nothing can trigger the unpinned Electron download — failure
  JOB Typecheck, lint, and proofs (windows-latest) — failure
    step 21: Prove nothing can trigger the unpinned Electron download — failure
Guards: completed / success
```

`electronImports.proof.mjs` keeps a **counted** allowlist of computed `file://`
loads. `lowboxSpike.mjs` declared four and now makes six, because the handed
pair followed the pipe and the process onto the shipped surface. The guard's own
diagnostic says why the count is there rather than a bare file key: *"a
file-keyed list with no count is standing amnesty."*

**The amnesty it refused would have been mine, and would have been correct on
the merits** — the two new loads are as legitimate as the four. A guard that
only stops illegitimate additions is one nobody can trust to have stopped
anything.

The inverse question — *is there a defect this machine cannot see* — was also
worth asking and its answer is now narrower than it looked. Every figure in
Decision 12's table was read here, and the DACL semantics are kernel behaviour
this project has already seen differ by Windows build. `proof:hostcontainment`
runs on **two** Windows images (`shim` and `containment-2022`), and both were
green in the same run that failed on the step above — so the measurement is no
longer one machine's, and the red is unrelated to it.

One thing worth recording about finding that step: `lowboxSpike.mjs` is invoked
by **path** in `ci.yml`, so a grep for its npm script name returns nothing. That
is the search whose reassuring answer is *no job runs this*.

### EEEE-2. The affected-proofs reporter cannot see a proof that SCANS, and says so in a sentence that is a disclaimer

The local sweep passed, 16 of 16, against the staged index. It named one
affected proof:

```
  !!  1 proof(s) read a file this tree changed and THIS RUN DID NOT REACH THEM
        npm run proof:hostcontainment
      This list is static-import reach only: a proof that spawns a script it
      never imports is not in it.
```

That is correct and it is not the whole set. `electronImports.proof.mjs` never
imports `lowboxSpike.mjs` — it **scans the tree** — so no static-import walk can
reach it, and the proof that actually went red appeared in no column.

**The class this misses is the worst one to miss.** A proof that scans the
repository is precisely the kind that guards a repo-wide invariant, and
repo-wide invariants are what adding a file or a call site trips. The
import-reaching proofs are the ones whose relevance is already obvious from the
diff.

**By this repository's own test, that closing sentence is a disclaimer rather
than a compensation.** CLAUDE.md asks: *could it have been printed before you
made your change?* It could — it is printed on every run, names nothing and asks
for nothing, and by the third reading it is furniture. That is the same property
that made `checkLocal.mjs`'s provisioning sentence fail to stop a red push, and
this is a second instance of it in the same file.

What would make it specific: the scanning proofs are enumerable — they are the
ones that walk the tree rather than import a module — and any changed file
reaches all of them. Naming them in the run's own output, as the import-reaching
ones already are, turns the sentence from *this list is incomplete* into *and
these three scan the tree, so your change reaches them too*.

**Open, with the fix named.** It is not closed in this range because the roster
it needs is a decision about how a scanning proof is identified, and that is
item 4c's question — the failure to fear here makes the set **smaller**, so it
must not be derived from something a missing proof also shrinks.

### 2b. The exit code that was read wrong, and the memory note that covers it

Reproducing the red locally, the first reading was `... | tail -30` followed by
`echo EXIT=$?` — which reports `tail`'s status. It printed `EXIT=0` beside output
that said *1 electron-import failure(s)*. Caught immediately because the text
disagreed with the number, which is luck rather than method; the second reading
redirected to a file and read the process's own code.

No new finding — this is exactly the standing note *read the real signal* — but
recorded because it happened while auditing, in the section about whether
instruments can be believed.

### 4. Are the proofs non-vacuous?

Four mutations run, all red at the right line:

| mutation | what went red |
|---|---|
| `handedDirectoryDacl` ignores its verb | 3 cases, in both new files |
| the `P` flag dropped | 2 cases |
| the rollback stops removing the snapshot | 1 case |
| the shipped read mask widened to `0x001200A9` | `proof:hostcontainment`, naming `(OI)(CI)(RX)` rather than `(R)` |

**The mutation direction was chosen, not defaulted.** The property under test is
*read and modify differ*, and agreement is also what a verb-blind builder
produces — so the case asserts the two strings differ **and** that swapping the
mask back makes them identical, which a builder that moved a flag between verbs
would fail.

`boardStatus.proof.mjs`'s +92 is six added cases carrying a resolution test and
three controls; nothing in it was loosened. Its roster went 15 → 21 as a
literal, which is item 4c's safe direction — the failure to fear is a case
added and the prose left behind, which makes the set bigger.

### 4a/4b. Instruments

`win32DirectorySurface.ts` is an adapter with no unit test, as
`win32PipeSurface.ts` is: it is exercised by `proof:hostcontainment` against a
real container, and a unit test of a koffi binding would assert that a mock was
called.

The spike's ACL reader is a **search**, and its positive control is unchanged
and now covers the new path too: every directory must be **found** naming the
container immediately after creation, or the run throws *THE SEARCH IS BLIND*.
Two assertions were added beside it, and both exist because presence alone is
not the property: the rendering must be **exactly** `(R)` or `(M)` — otherwise
these rows silently stop being continuous with the 2026-08-25 ones — and there
must be **no `(I)` ACE**, which is what `P` buys and what the `icacls` path
could not have given.

### EEEE-1. A resolver moved; its proof stayed in the file that no longer owns it

`hostPipeDacl` moved from `enginePipeFactory.ts` to `hostDacl.ts`. Its two
thorough cases — the both-ACEs-required literal and the four-bit mask
difference — stayed behind under a `describe('hostPipeDacl')` in a file that no
longer imports it, and the file that gained the function got a **thinner
duplicate** of the first one.

**Nothing was deleted and no coverage was lost, which is exactly why no check
could see it.** The tests passed. Lint passed. The audit-scope report named both
files. It is visible only by asking *where does this symbol's proof live now*,
which is a question a move makes and nobody asks.

Two things make it worth a letter rather than a tidy-up:

- **It is the memory note *proven in the wrong file*, arriving by a new route.**
  That note is about a helper getting the thorough proof while its call site
  gets none. Here the proof was thorough and in the right place, and the
  **subject moved out from under it**. A move is a rename plus a deletion, and
  the deletion side is the one with no signal.
- **It ended with two files asserting one expected value**, which is the second
  opinion B3a is about, at the assertion layer. Whichever file a reader opens is
  the one they trust.

**Fixed in the commit that follows this range**, not inside it: the audit gate
blocked every further commit until this entry landed, so the repair is in the
next range by the mechanism's own design. The cases move with the function, and
`enginePipeFactory.test.ts` keeps calling `hostPipeDacl` — because what it
proves is that the factory passes the resolver's output through unaltered, and
restating the literal there would be the second opinion again.

**The transferable question, for the next move:** *which file now holds the
cases for the symbol I just moved?* It is cheap, and it is not asked by the
diff, by the checks, or by the scope report — all three see a file changed and
a file added, which is what a correct move also looks like.

### 5. Executed, or asserted?

**Executed:** 173 vitest cases in `apps/desktop` · 28 containment cases through
the shipped factory, twice — once green, once against the mask mutation · four
mutations · 16 local checks against the **index** after staging · `koffi`
binding `CreateDirectoryW` · the three-directory ACL table, including the
`mkdirSync` control sibling · the shipped read mask rendering as `(R)` · the
full CI board for `5168f3b`, which is where the red came from · 18
electron-import cases after the declaration moved to six.

**Asserted:** that a session directory pair cannot outlive a main process that
dies without unwinding — it can, and the FEATURES row says so rather than the
code pretending otherwise.

**Previously asserted in this very entry, and corrected before it landed:** that
item 3 was *pending on a run*. It was drafted that way, the run answered while
the entry was being written, and the answer was red — which is why the section
above quotes the job output rather than a workflow file. Worth keeping visible:
the draft would have read as diligence, and *pending* is the answer that never
looks wrong.

### 6. Architecture before the feature?

No amendment owed, and this was checked rather than assumed. Decision 7 already
declares the handed pair; this range decides **how the grant is made**, which
is mechanism inside an existing decision. Recorded as Decision 12 in ADR-0023,
not as an ARCHITECTURE §-change: no seam moved and no invariant changed.

### 7. Do the documents still match the code?

ADR-0023 gained Decision 12. `docs/FEATURES.md` gained a row for the grant
mechanism carrying the unswept-root obligation with its trigger.

**One correction, and it is a count rather than a claim:** §5's *"the five
grants are a development accommodation"* is now three. The sentence was true
when written; two of the five were the shipped-behaviour ones and are no longer
granted at all. Appended as a dated correction under Decision 12 rather than
edited, because an ADR is a record.

The NNN-4 sweep fired — this range states where the grant mechanism lives —
and was run with `npm run sweep:prose` rather than by grep, for the reason the
fifth line-break miss established. `icacls` returns seven matches across 37
documents; the two in §5 and one in JOURNAL are records, and the FEATURES and
P1 mentions are about an install root this change does not touch.

---

## 2026-08-26 — Stage audit: `3c4f338..2f1444b` — two security scans that run on a developer machine and nowhere else

**Audited through `2f1444b`.** Pasted from `npm run audit:scope`:

```
Unaudited range: 3c4f338..HEAD

  commits: 8 (one batch is 9)
  files:   21 (one batch is 24)
  Within one batch. An audit is not yet owed.
  Fires at 10 commits (2 more) or 25 files (4 more).

  proofs ADDED — new coverage (2):
    scripts/proofs/mainNeverCancels.proof.mjs
    scripts/proofs/proseSweep.proof.mjs
  proofs MODIFIED — read each diff; a loosened check looks like a corrected one (4):
    apps/desktop/src/documentCommands.test.ts       net +10 -2
    packages/kernel/src/commandBus.test.ts          net +213 -17
    scripts/proofs/contract.proof.mjs               net +56 -1
    scripts/proofs/fetchVerified.proof.mjs          net +156 -5
  proofs REMOVED: none
  source FILES ADDED — instruments to resolution-test (items 4a, 4b) (3):
    packages/kernel/src/localEngine.ts
    scripts/lib/mainNeverCancels.mjs
    scripts/lib/proseSweep.mjs
  source FILES CHANGED (3):
    packages/kernel/src/commandBus.ts               net +41 -8
    packages/kernel/src/commandSpecs.ts             net +127 -5
    packages/kernel/src/index.ts                    net +5 -0
  source FILES REMOVED: none
```

**Audited under the FILE threshold, not the commit one** — the next commit would
have made 25 against a batch of 24, and the gate refused it. Board **GREEN at
`2f1444b`** (`Guards=success, CI=success`, exit 0).

### 1. Root cause, or workaround?

Root in every case, and one is worth naming because it looks like a preference.
**The concurrency setting was itself the defect**, not a symptom of one: a
cancelled run is no verdict at all, so grouping `main` with
`cancel-in-progress: true` destroyed the previous commit's verdict on every
rapid push. Changing it is a repair, and the fix is measured against its own
pre-fix control rather than assumed to take effect.

No loosened check. **One check was TIGHTENED and the harness is why:**
`contract.proof.mjs`'s byte-image reject matcher now anchors on a parameter
name, because the new `CommandExecution` case produced a diagnostic whose
operative line was word-for-word identical, and the proof's own resolution test
refused to certify either verdict while one matcher accepted the other's reason.

### 2. Verified against the easy shape only?

**No, and `mainNeverCancels` is where it would have been.** The easy shape is
`true` versus the expression. The cases that matter are the inverted expression
`== 'refs/heads/main'` — which *mentions* the branch and cancels on it and
nowhere else, so a matcher relaxed to a substring test would certify the exact
defect — and an expression the scan cannot read, which is **reported rather than
passed** because a check that cannot decide must not pass.

### 2a. Has a change to HOW something is proven moved the coverage? — and **DDDD-30**

**Yes, in two directions at once.** Sixteen `CommandBus` registrations moved from
`mupdfWriter` to `localMupdfWriter`, which widens what each case drives.

**DDDD-30. The checkpoint-failure control's INPUTS changed, and that is a cost
rather than an improvement.** It used to register a hand-built partial writer —
`open`, `close`, and a `serialise` that rejects — which is the most isolated
fixture available. Since Decision 10 a bare lifecycle no longer satisfies the
registry type, so it spreads `localMupdfWriter` and overrides `serialise`; its
capture is now the real one. That is the right call and the alternative is worse:
a stub carrying only a lifecycle would fail at the **capture**, before reaching
the checkpoint the case exists for, and would pass for the wrong reason. But it
means a change to `localMupdfWriter` changes this control's fixture, which is
recorded here rather than discovered later by whoever changes it.

### 3. Would CI have caught it? — **DDDD-29**, and it is the finding of this range

Answered from runs for the range's own work: both new proofs are unconditional
steps in `guards.yml`, and Guards reported `success` at `6d8f2d5` and `2f1444b`.

**Asked the other way — is there a defect this machine cannot see? — the answer
is yes, and it predates the range.** `scripts/checkLocal.mjs` derives its set
from every `check:*` and `proof:*` in `package.json`, so *every* check runs
before a push **on a developer machine**. CI runs the ones a workflow names. Two
do not appear in any workflow:

| script | what it enforces | where it runs |
|---|---|---|
| `scripts/security/pathDispatch.mjs` | **invariant 23** — no shipped file names a MuPDF entry point that selects an implementation from a filename | `checkLocal` only |
| `scripts/security/handlerFootprint.mjs` | which document-format parsers are actually present in the shipped DLL | `checkLocal` only |

**The first is the sharp one, and CI runs its PROOF.**
`scripts/proofs/pathDispatch.proof.mjs` is a step in `ci.yml`, so every push
proves the scan *can see* — and nothing ever points it at the repository. That is
the *instrument that gates nothing* shape inverted: the gate exists, is proven
sound, and is never fired.

It is also unregistered rather than unregisterable: run here during this audit,
it reads tracked source only — no `node_modules`, no MuPDF build — and exits 0
with *"no shipped file names a filename dispatcher"*. So it can run on Guards
today. `handlerFootprint.mjs` inspects the shipped DLL and may genuinely need the
`shim` job, which is a different answer to the same question and has to be
established rather than assumed.

Recorded rather than fixed, because an audit-recording commit is docs-only.

**The transferable form:** a check being *derived* into the local sweep makes it
feel covered. `checkLocal` deriving from `package.json` is exactly right and it
guarantees nothing about CI — and the fact that one of the two has a proof
running in CI is what makes the gap invisible, because the workflow file mentions
`pathDispatch` and a reader stops there.

### 4. Are the proofs non-vacuous?

Every control in the range was mutation-tested at the time. Two re-run during
this audit rather than recalled:

- `proseSweep`: `findInUnits` mutated to match the unit's **first line only** —
  five cases red and the CLI refuses with *"cannot see a phrase that wraps"*. So
  the positive control does carry the property, and the module is not certifying
  its own silence.
- `mainNeverCancels`: the column-0 anchor broken — the check **refuses** rather
  than passing, and three proof cases go red.

### 4c. Does each new scan derive its extent, and in which direction?

Both do, and both are anchored, which is the half 4c actually asks for.
`scanWorkflows` derives from `readdirSync` and a *deleted* workflow would agree
silently — anchored by `filesScanned >= 2` asserted in the proof.
`defaultDocuments` derives from `git ls-files` with the same shrink direction —
anchored by `filesScanned > 1` **and** by a positive control that requires a
named phrase to be found in `CLAUDE.md`.

**Stated limit on that anchor:** reword the sentence it quotes and the proof goes
red. That is the cost of a real-tree control and the alternative is worse, so the
failure detail tells the next reader to **re-anchor rather than delete** —
deleting it leaves only the empty-result case, which a sweep that opened no file
satisfies.

### 5. Executed, or asserted?

**Executed:** the concurrency differential, with the pre-fix cancellation in the
same payload; every mutation above; the prose sweep demonstrated against
`ARCHITECTURE.md`, where a `grep` finds one line and the sweep finds three; the
809,018-byte prior-state measurement; `pathDispatch.mjs` run by hand during this
audit.

**Asserted:** that Decision 10a's derived bound will be computed at the call
site — there is no call site yet.

### 6. Did architecture change *before* the feature?

**Yes, and for the first time in this project's record it was the whole commit.**
`2f1444b` amends `ARCHITECTURE.md` §5, updates `CLAUDE.md`'s map in the same
commit as the three-document table requires, and records ADR-0023 Decision 11 —
with the feature it exists for deliberately not in it.

### 7. Do the documents still match the code?

The §5 cross-document sweep was run with the new tool, and that is what found the
other three statements of the amended claim: `BUILD-PROMPT.md` C5 (immutable,
named in the amendment log as superseded), ADR-0022's citation (about the
*discipline*, which is unchanged), and the amendment's own log row.

### Correction, 2026-08-26 — DDDD-29 was right about the gap and wrong about the remedy, in the way its own section warns about

Three things above are corrected. The finding stands; two of its claims do not.

**1. "It reads tracked source only — no `node_modules`, no MuPDF build — and
exits 0, so it can run on Guards today" is FALSE.**
`scripts/security/pathDispatch.mjs` imports `mupdfSourcePath` and derives the
banned set from MuPDF's own `is_extension`, so with the source absent it exits
**1** — *"MuPDF source not provisioned — the dispatcher set was NOT derived and
nothing was checked."* That refusal is the scan being correct. It exited 0 during
the audit because **this machine has MuPDF provisioned**.

That is item 3's second half — *is there a defect THIS MACHINE cannot see?* — and
the answer was written into the same section that asks it. A branch keyed on
whether something is installed has a side that never executes where that thing is
always present, and the developed-in world is the one that hides it. The
correction is not "check harder": it is that **a claim about where a script can
run is a claim about a machine that does not have what this one has**, and
running it here cannot establish it.

**2. DDDD-29 overstated by LUMPING.** `handlerFootprint.mjs` is not a gate. Run
here it prints the shipped footprint — `epub`, `xps`, `svg`, `mobi` and `fb2`
absent, `pdf`, `html` and `office` present — and **exits 0 either way**. The only
thing that can fail is its positive control, the PDF markers. So its absence from
CI was a missing *measurement*, not a missing enforcement, and putting it in the
same row as invariant 23's scan made two different things look like one class.

**3. And the gap was sharper than the entry said.** The step that ran the proof
was named **"Enforce invariant 23 — no filename may select a native library"**.
It is not the filename a reader stops at; it is the word *Enforce* over a step
that proves a scan can see and never looks at a shipped file.

**Both now run in `ci.yml`'s `shim` job**, which provisions MuPDF and builds the
DLL — the same placement, and for the same stated reason, as the OCR-door step
four lines above them. The proof's step is renamed so *Enforce* belongs to the
check.

---

## 2026-08-26 — Stage audit: `4859f20..3c4f338` — a module's first proof covering the axis the incident was about, and two sentences of the law falsified by a commit that never touched them

**Audited through `3c4f338`.** Pasted from `npm run audit:scope`:

```
Unaudited range: 4859f20..HEAD

  commits: 9 (one batch is 9)
  files:   10 (one batch is 24)
  Within one batch. An audit is not yet owed.
  Fires at 10 commits (1 more) or 25 files (15 more).

  proofs ADDED — new coverage (1):
    scripts/proofs/fetchVerified.proof.mjs
  proofs MODIFIED — read each diff; a loosened check looks like a corrected one: none
  proofs REMOVED — coverage leaving; say why in the entry: none
  source FILES ADDED — instruments to resolution-test (items 4a, 4b): none
  source FILES CHANGED — an instrument whose behaviour moved (items 4a, 4b) (2):
    scripts/lib/fetchVerified.mjs
      net +127 -30   per-commit +127 -30
    scripts/research/lowboxSpike.mjs
      net +205 -12   per-commit +206 -13
  source FILES REMOVED — an instrument leaving; say why in the entry: none
```

**Audited at exactly one batch, and not by choice** — the pre-commit gate refused
the tenth commit and named this audit as what unblocks it. The tenth is the
Decision 10 build, so the range audited here is the decision work that precedes
it.

Board **GREEN at `3c4f338`** (`CI=success, Guards=success`, exit 0).

### 1. Root cause, or workaround?

- **The download retry** (`5cb259e`): a **legal workaround**, and the one shape
  Rule 0 permits — the root cause is a release host resetting one racer's TLS
  connection, which is outside this repository, and the commit names it. The
  test that matters is the direction: `retryTransient` wraps the *fetch*, and
  the **digest comparison sits outside it**, so a mismatch is answered once. A
  retry that enclosed the hash check would be downloading until the hash
  matches, which is the check that stands between a pinned asset and whatever a
  host served instead. `DownloadTooLarge` is re-thrown past the retry for the
  same reason: a ceiling breach is an answer, not a silence.
- **DDDD-22 / DDDD-23** (`cf3e178`): both root. The first added the fixture for
  the branch the design argues for; the second deleted a claim from a label
  nothing measured, rather than adding a measurement to justify the label.
- **DDDD-24** (`9e37ac2`): a documentation correction, and it *narrowed* a
  retraction rather than widening one — the standing clause was recovered, not
  re-argued.

No loosened check in the range. No proof modified, so the load-bearing column
is empty for the first time in five ranges.

### 2. Verified against the easy shape only?

**Not in this range, and DDDD-22 is why:** the previous range's proof covered a
failure *before* headers only, which is the easy shape, and the hard one — a
stream that dies mid-body — is the branch Decision 7's whole design argues for.
That fixture now exists and carries the no-contamination assertion.

### 3. Would CI have caught it? Answered from a run.

**Yes, and one of them it did.** `5cb259e`'s defect *was* a red board — CI is how
it was found, not something a check would have anticipated.

For the new proof: `proof:fetchverified` is registered in `guards.yml` as a step
with **no `if:`** in the *Secret scan and file policy* job, and that job reported
`success` on both legs at `9e37ac2`. A step without a condition cannot be skipped
in a job that succeeds, so it executed. **That is the reasoning, and it is not a
step line** — job logs need owner authentication, and the unauthenticated
`check-runs` payload carries job names only. Stated rather than glossed, because
"registered in the workflow" is what AAAA-29 warns is not an answer.

**Is there a defect this machine cannot see?** The provisioning branch here runs
on every runner, and `fetchVerified.proof.mjs` injects `fetchImpl`, so it makes
no network request and has no two worlds. `lowboxSpike.mjs` genuinely does — it
is Windows-and-shim only — and the range's own commit for that (`fd1235c`)
is the one that took its readings to three machines.

### 4. Are the proofs non-vacuous? — **DDDD-25**

**DDDD-25. `fetchVerified.mjs` got its first proof in this range, and the proof
covers the axis the incident was about. Four reachable branches of the same
module have no case anywhere in the repository.**

Ten cases, five of them controls, both directions of the retry rule — that half
is good, and the controls are the load-bearing ones (a mismatch, a ceiling
breach, a 404, a 403, a host outside the allowlist, each proven *not* retried).

What none of them reaches is `fetchChecked`'s **redirect** path, which predates
the range and had no proof before it either:

| branch | what it does | case |
|---|---|---|
| a hop whose `Location` fails the allowlist | `assertAllowed` throws | none |
| a redirect carrying no `Location` header | throws | none |
| a 200 with no body | throws | none |
| more than `MAX_REDIRECTS` hops | throws | none |

The first is the one that matters and it is not a tidiness point: the code
resolves `new URL(location, current)` **before** the host check, with a comment
saying the ordering exists so a relative hop cannot skip it. That is a
deliberate, security-relevant ordering with nothing holding it — NNN-2's shape
exactly, a branch reachable and load-bearing with no case at all. The existing
allowlist case covers the **initial** URL, which is the input a redirect defect
would sail past.

Recorded rather than fixed, because an audit-recording commit is docs-only.

**The general form is the transferable part, and it is not "write more cases":
a module's FIRST proof is written by whoever just had an incident, so its
coverage is shaped like the incident.** The retry axis is thorough because a
reset socket reddened `main`; the redirect axis is empty because nothing had
gone wrong there. A new proof arriving for an old module is the moment to ask
what the module does that the incident did not touch.

**Item 4c, and the range asked it of itself.** `lowboxSpike.mjs` derives
`CELL_COUNT` from a module-scope `CELLS` array and writes the 4c question out:
the failure to fear makes the set *bigger*, which a derived count tracks, and
the anchor against a *removed* cell is that every property row names the cells
it reads, so a missing cell turns rows `UNREADABLE` and the roster's declared
`cases: 28` — a literal — fails rather than shrinking. **That anchor is
asserted, not executed.** No run has removed a cell to confirm the roster fails
rather than agreeing. Stated as a limit rather than filed as a defect: the
mechanism is written down and the roster count is genuinely hand-kept, which is
the half 4c actually requires.

### 5. Executed, or asserted?

**Executed:** the verb-split rows on three machines (verdicts, not figures, and
the entry says so); the engine-open probe, mutated by pointing it at a missing
file; the ten download cases; `perf:gate`'s `main-service` figures, re-read on
this machine rather than carried from a document.

**Asserted:** the 4c anchor above. And Decision 10's claim that a host runs the
*same* `declaredSpecs` — true by construction of the module graph, and no host
runs anything yet.

### 6. Architecture before the feature?

Yes, and twice deliberately. Decision 10 was recorded in `3c4f338` and built in
the commit this audit unblocks. The **B4 question was checked rather than
assumed**: no `ARCHITECTURE.md` sentence becomes false under Decision 10, so it
is an ADR plus a seam change and not an amendment — an amendment commit editing
nothing asserts a change that did not happen.

### 7. Do the documents still match the code? — **DDDD-26**, and two already-false sentences

**Two sentences of the law were false before this range began** (`53298a0`).
`ARCHITECTURE.md` §3 said MuPDF runs "in the `mupdfHost` utility process" and
invariant 20 said "both engines live in utility processes" — which §2 of the
same document denies, having been amended by ADR-0022 on 2026-08-22. The
amendment log names the sections that were swept; §3 and L20 were not among
them.

**NNN-4's shape, and no range-scoped sweep could ever have reached them**: no
range has changed both the sentence and the decision that refutes it. They were
found by the sweep Decision 10's B4 question required — which is the
compensation NNN-4 names, firing on a range that states a cross-document
relationship.

Invariant 25's *"(a) and (b) are obtained on an Electron utility process"* was
deliberately **not** touched: it records what was measured, and it was.

**AND THE ORDINARY GREP MISSED ONE.** `grep -n "utility process"` over
`ARCHITECTURE.md` returns lines 160, 727, 793, 802, 812 and 821 — **not 249**,
where `utility` ends the line and `process` begins the next. The phrase is
there; no line contains it. It was found by reading the range, not by the
search, and a multiline match afterwards confirms both the miss and that the
remaining hits are correct. That is the **line-wrap axis for the fifth time** in
this repository, after `withdrawnPhrases.mjs`, a `grep -A3` window on a runs
payload, and an ad-hoc grep of `CLAUDE.md`. The lesson keeps being written down
and keeps recurring in tools nobody thinks of as searches — which is the
evidence that documentation is not the mechanism and a positive control is.

**DDDD-26. ADR-0023's Decision 10 states its blocker in the present tense, and
the blocker was removed one commit later.** The section reads *"`commandBus.ts`
calls `spec.capture(session, …)` and `spec.apply(session, …)` directly, in
main"*, which was true when written and is false now. The heading — *The
blocker, as a mechanism* — reads as historical to its author and as current to a
reader who lands on it, which is item 7's own warning about the paragraph a
reader treats as the contract. Corrected by an **appended, dated** note, because
an ADR is a record: the sentence is evidence of what was true when the decision
was taken and editing it destroys that.

---

## 2026-08-25 — Stage audit: `16dc4da..4859f20` — a stale count in the anchor's own explanation, and a board reading that cannot be taken later

**Audited through `4859f20`.** Pasted from `npm run audit:scope`:

```
Unaudited range: 16dc4da..HEAD

  commits: 9 (one batch is 9)
  files:   15 (one batch is 24)
  Within one batch. An audit is not yet owed.
  Fires at 10 commits (1 more) or 25 files (10 more).
```

**Audited at exactly one batch**, because the next commit is the Decision 7
instrument and it would be commit 10.

**2 proofs added**, 1 modified, 0 removed; **2 source files added**, 4 changed, 0
removed. The range built the **composition point** — the last link of the
transport — and then spent six commits on corrections to a decision written
inside it, four of them from the reviewing seat.

Board **GREEN at `4859f20`** (`Guards=success, CI=success`, exit 0).

### 1. Root cause, or workaround?

- **DDDD-14** (`ef9cf80`): root, and the repair is structural rather than a test
  accommodation. `engineAdvisories.mjs` calls `main()` at import so nothing can
  load it; instead of bolting an injection seam onto an entry point, OSV's
  protocol became a named module with callers (B3a).
- **DDDD-15** (`e7f3a94`): root — the type lacked a state, so two codes were
  added. Patching the fixture alone would have left the next caller choosing a
  violation for a host that committed none.
- **DDDD-20** (`4859f20`): root, and the repair **removes the copy** rather than
  correcting it. A corrected decomposition would have gone stale again in the
  same place, silently.

No loosened check. The one modified proof, `client.test.ts` at +38/−3, is a pure
strengthening: three fixture corrections and one added case.

### 2. Verified against the easy shape only?

**No, and the interesting case is a fixture that was wrong on its first try.**
The composition's load-bearing case proves that a client violation keeps its own
code, and it needs a **well-formed** response for an id nobody sent. The first
version sent a malformed one, which is refused *before* the correlation is looked
up — so it passed on `malformed-response` and proved a different thing than its
name claimed. Caught by the assertion, not by review.

### 2a. Has a change to HOW something is proven moved the coverage?

**Yes, and in the strengthening direction, but it does not replace what it looks
like it replaces.** DDDD-14 moved OSV's classification into a module with eight
cases driven by a fake `fetch`. Those cases prove the *decision*; they say
nothing about the live API, which is still exercised only when OSV misbehaves.
Coverage arrived beside the integration reading rather than in place of it.

### 3. Would CI have caught it?

DDDD-20, **no** — a stale comment beside a correct constant is invisible to every
check, and deliberately so: the roster enforces the number and has no opinion
about the prose. DDDD-15, **no**, for the reason recorded in the previous audit.

### 4. Are the proofs non-vacuous?

Mutations, all run: `hostFor` called twice reddens the once-only case **alone**;
mapping a dead peer to `shutdown` reddens three; reporting an ending for a host
that never started reddens the host-refusal case; dropping the explicit
`terminate` reddens three. In `client.test.ts`, substituting a fixed `frame`
inside `fail` reddens the new case and leaves the other fourteen green. In
`osvQuery.proof.mjs`, rethrowing the network error as itself reddens the
thrown-fetch case at `calls=1`, and retrying anything not ok reddens the 404 and
the 400 at `calls=3`.

**And a vacuity class was closed in the composition's own file:** every order
assertion went through `indexOf`, where `-1 < n` is true, so a run that skipped
the earlier step entirely would have passed all of them. They now assert presence
of both operands first — confirmed by deleting the `terminate` call, which
reddens three cases where the unguarded form went green.

**DDDD-20 — the roster anchor was enforced and correct; the paragraph explaining
it was stale by ten.** `createRoster(caseFailures, { cases: 23 })` carried a doc
comment opening *"THIRTEEN: three for the working-host control, nine property
rows, and the absence control"*. Nothing was broken: `passRoster.format()` throws
when recorded and declared disagree **in either direction**, so 23 was enforced
on every run — confirmed by running the spike (`23 containment cases passed`,
this machine, 2026-08-25, machine state fully reversed and the profile deleted).

The anchor did its job and the prose beside it did not, and that prose is the
only part a reader consults when deciding whether their change should raise the
number. It was found at exactly that moment — preparing to add Decision 7's
probes — and trusting it would have meant computing the new total from 13.

The repair is not a corrected decomposition. **Restating the number is what
failed**, and restating it accurately would fail again on the next case added, in
the same place. It is the rule `check:docs` already applies to §9.17: *do not
copy a number the reader can reach.* The usual B6 failure is a figure nobody
measured; this one was measured and then outlived by the code.

### 4a. Resolution test before it measured anything?

**The ACL measurement (`b465481`) had one and it is worth naming**, because a
reading taken without one is the shape this checklist exists for: the ACL was
read **before** the grant, **after** the directory grant, **after** the explicit
file grant, and **after** the revoke. Four readings, each differing from its
neighbour by exactly the act between them — so the instrument (here, `icacls`)
is demonstrably able to report the change it was used to detect.

### 5. Executed, or asserted?

**Executed:** 23 containment cases, twice · 13 composition cases and four
mutations · 15 client cases and one mutation · 8 `osvQuery` cases and two
mutations · four `icacls` readings · the local sweep at 15 of 15 on every commit
· the board at seven of the nine commits.

**Asserted:** that candidate 1's collisions are *exhaustive* — three were found
and there may be more. *(Correction, same day: this belongs in the asserted
column **permanently** rather than as a claim awaiting promotion. The three were
found by reading, and there is no procedure that would establish exhaustiveness —
so nothing is pending, and a later reader should not treat it as work in
progress.)* · that the ACL union generalises, which is ordinary Windows
behaviour but was **read once, on one SID (`ALL APPLICATION PACKAGES`), on one
machine, on one Windows build**. The conclusion it supports is a layout
constraint rather than a security claim, which is why one reading was enough to
act on and is recorded here as one reading rather than as a property.

### 6. Did architecture change *before* the feature, or underneath it?

Before. Decision 9 and its four corrections all precede the supervisor, which is
still unbuilt, and the ACL constraint precedes the instrument that will rest on
it. Nothing was retrofitted.

### 7. Do the documents still match the code?

DDDD-20 is one instance found and fixed. Cross-document sweeps were run for
Decision 9's claims and for *minted, never derived*; both clean.

**DDDD-21 — a board reading is only available at the time, and the lookup that
would take it later is retried for twenty minutes.** Two commits in this range,
`116732e` and `e7f3a94`, were pushed without their own board reading; a
descendant being green does not certify an ancestor, since a later commit can fix
what an earlier one broke.

Trying to close that gap retroactively is what produced the finding. `board.mjs`
fetches `actions/runs?per_page=8` — **the eight most recent runs**, with `poll=`
as a cache-buster rather than a page number. At two workflows per push that is a
**four-push window**, and nine commits have landed since. Those runs are gone.

`boardStatus.mjs` classifies this correctly and says so in its own words — *"This
is a BROKEN LOOKUP, not a verdict: a cache older than the push, a sha that does
not match the field, or **a page that does not reach far enough** all produce it"*
— returning `blind`. **It never reports a false green.** But `board.mjs` polls
`blind` forty times at thirty seconds, and for an aged-out sha that lookup cannot
succeed: every further push moves it further out of the window.

Two things follow. The **process** half is the transferable one: a board reading
is not deferrable, because the evidence ages out — which is a better reason than
*always read it*. The **tool** half is a real if small defect: `blind` covers one
cause that self-resolves (a cache older than the push) and one that never can (a
page that does not reach far enough), and they are separable — if the payload's
oldest run is newer than the sha's commit time, waiting is pointless. Recorded
rather than fixed, because it degrades a diagnostic and not a verdict.

---

## 2026-08-25 — Stage audit: `4f37b51..16dc4da` — a retry proven in the helper and unproven at the call site, and a fixture that hid a missing type state

**Audited through `16dc4da`.** Pasted from `npm run audit:scope`:

```
Unaudited range: 4f37b51..HEAD

  commits: 6 (one batch is 9)
  files:   19 (one batch is 24)
  Within one batch. An audit is not yet owed.
  Fires at 10 commits (4 more) or 25 files (6 more).
```

**Audited at 6, six files from the gate**, because the next unit — the
composition that creates a host, a pipe, a reader and a transport together — is
six files exactly, and a unit that lands *on* the gate leaves the audit owed
before anything else can be committed.

**3 proofs added**, 1 modified (a widened count), 0 removed; **4 source files
added**, 5 changed, 0 removed. The range finished main's half of the host
protocol, closed **CCCC-4** and the reviewing seat's three conditions, took
**ADR-0023 Decision 9**, and reddened `main` once on a third party.

Board **GREEN at `16dc4da`** — `Guards=success, CI=success`, read from
`npm run board`.

### 1. Root cause, or workaround?

- **CCCC-4** (`42137ad`'s predecessor): the whole-path control compared a byte
  *count*, and 64 frames of 4096 bytes delivered in the wrong order sum to the
  same 262144. Fixed at the **fixture** — each frame names its index and the
  streams are compared byte for byte — which is the root, because the check's
  input was what could not separate the cases.
- **the OSV 503** (`e26a9f8`): the root cause is proven to lie outside this
  repository — a third party answered one request with 503 — so a workaround is
  legal, and the commit names the cause. The guard is narrow by construction:
  `retryTransient` retries **exactly** `TransientFailure`, a 404 propagates on
  the first attempt, and exhaustion throws the last failure rather than
  returning. There is no widenable predicate to loosen later.

No loosened check. The one modified proof raised an exact count from 2 to 4
because the file genuinely gained two import sites; an exact count still fails on
a fifth.

### 2. Verified against the easy shape only?

The client's load-bearing case is the **hard** shape and no other case reaches
it: a transport that answers **synchronously inside `write`**. The pending entry
is registered before the write precisely so that answer arrives at a map that
knows the id; written the other way round it is reported as an unknown
correlation — a protocol violation manufactured by the order of two lines.

### 2a. Has a change to HOW something is proven moved the coverage?

`electronImports.proof.mjs` went from 2 pinned sites to 4. That is a
**strengthening** — two more shipped modules are now named and their absence
would fail — and it is recorded here rather than passed over, because a count
moving in either direction reads identically in a diff.

### 3. Would CI have caught it?

Computed rather than assumed. **For DDDD-14, no**, and the half that is uncovered
is nameable: `advisoryRegister.proof.mjs` drives the checker by
`spawnSync(process.execPath, [CHECKER, …])` against the live API, so there is no
seam a fake `fetch` could enter and the added branches only execute when OSV
misbehaves. **For DDDD-15, no** — the fixture passes, and nothing anywhere
compares a fixture's chosen constant against the situation it names.

Is there a defect **this machine** cannot see? No branch added in this range is
keyed on provisioning.

### 4. Are the proofs non-vacuous?

Mutation results, all run when the cases were written: registering the pending
entry *after* the write reddens the synchronous case **alone**, and it hangs five
seconds first, which is the failure itself. Dropping an unknown correlation
reddens three. An ending that settles nothing reddens seven. Making the reader
channel's `stop()` also terminate reddens three, and the third is the one worth
having — the reader never gets to post its own ending, so the diagnostic becomes
*exited with code 1* instead of *stopped while waiting for bytes*.

**DDDD-14 — the retry is proven in the helper and unproven at the call site.**
`retryTransient.proof.mjs` covers the helper with hand-built throws, eleven
cases, and it is registered in `guards.yml` rather than only in `package.json`.
What it does not reach is the three branches the range added *inside* `queryOsv`,
which are where "what is transient **here**" is decided: a `fetch` that throws is
re-thrown as `TransientFailure`, a transient status is re-thrown as one, and a
status OSV answered with is not. Mutating the first to `throw cause` reddens
nothing anywhere.

That is NNN-2's category — a branch that is reachable and load-bearing with no
case at all — and it is the half that would have prevented the red board, so
"the retry protects the board" belongs in the asserted column and not the
executed one. The helper being proven is what makes this easy to miss: the file
that got the new proof is not the file with the unproven branch.

**DDDD-15 — a fixture's constant was chosen from what the type would ACCEPT, and
a missing type state hid behind it.** `client.test.ts` settles a connection with
`{ code: 'frame', detail: 'the reader thread exited' }`, three times. A reader
thread exiting is not a framing violation, and `HostTermination` carries no code
that is not one — every member names something an end did wrong. The cases pass
because they assert only that the promise rejects with `HostConnectionLost`, so
the constant is incidental to them and load-bearing for the reader: shipped, a
host that simply died would render *the engine host connection ended (frame): …*
and send whoever read it to the framing code.

Found by the **first real caller** — the composition being built next has to pass
something to `client.fail` when a host dies, and there is nothing honest to pass.
No check could have found it: both halves parse, and a fixture that lies about
its own subject is exactly what item 4's *never build a fixture the bug also
handles correctly* describes one level up, where the "bug" is a gap in the type.

The fix is two codes, because the distinction is one the range already made and
then dropped at this boundary: `TransportEnd.by` exists so that "a host that
crashed and a host we killed produce the same silence on the pipe, and only the
first is a defect" — collapsing both into one termination code destroys that
distinction at the point the caller reads it.

**Item 4c, asked of the one roster the range touched:** `electronImports.proof.mjs`'s
`sites: 4` is a hand-kept literal, and the failure to fear — a new `electron`
import site appearing — makes the set **bigger**. Hand-kept is the correct
direction there, and a derived count would have agreed with any new site
silently.

### 5. Executed, or asserted?

**Executed:** the 14 client cases · the 12 reader-channel cases · the 10-case
shipped composition on both Windows containment jobs · the mutations above · the
board at `16dc4da` · `npm run local -- --only check:` at 15 of 15 with the index
matching the working tree.

**Asserted:** that the OSV retry protects the board (DDDD-14 — the helper is
proven, the adaptation is not) · that Decision 9's three requirements are
implementable as written, since none of them is measured and no supervisor
exists.

### 6. Did architecture change *before* the feature, or underneath it?

Before, twice. **ADR-0024** preceded the reader worker. **ADR-0023 Decision 9**
was taken this range, before the supervisor, on the reviewing seat's ruling —
and the ruling's two premises were checked in the documents rather than read off
a summary: §2's "a cache that can be thrown away and rebuilt", and Decision 8's
own body, whose subject is a host created with the assignment already failed.

Recorded because the reviewing seat's framing added the part that made it worth
taking before rather than after: *handles are a cache* settles that a dead host
may be rebuilt and settles none of how often, where the death is reported, or
what the other documents do.

### 7. Do the documents still match the code?

NNN-4's cross-document sweep was run for Decision 9's two cross-document claims.
Six files state *session lookup is get-or-miss* and all six agree; nothing
anywhere claims Decision 8 reaches a running host. `documentCommands.ts`'s
comment was corrected in the same commit to separate the policy, now decided,
from the measurement, still owed.

**And asked forward, which is where item 7's newest rule points:**
`runtime.ts`'s `HostTermination` doc says *"which end can raise which is not
symmetric"* and gives a per-code comment naming an end. DDDD-15's fix adds two
codes that **neither end raises** — the connection ended without either end doing
anything wrong — so that framing is falsified by the fix and must be corrected in
the same commit rather than left standing above it. That is the compound-claim
shape: the sentence stays true of the seven existing codes, which is what would
carry it past a reader.

---

## 2026-08-25 — Stage audit: `4880ea0..4f37b51` — three fixtures whose constants chose the input the defect survives, and two reds

**Audited through `4f37b51`.** Pasted from `npm run audit:scope`:

```
Unaudited range: 4880ea0..HEAD

  commits: 6 (one batch is 9)
  files:   24 (one batch is 24)
  Within one batch. An audit is not yet owed.
  Fires at 10 commits (4 more) or 25 files (1 more).
```

**Audited at 6, one file from the gate**, because the next unit — the
`ReaderChannel` factory and its tests — is more than one file.

**0 proofs added**, 1 modified (a pure addition), 0 removed; **5 source files
added**, 5 changed, 0 removed. The range created `packages/nodemode`, built the
reader thread, closed **CCCC-2**, and **reddened `main` twice** — both times on
the same control, both times mine.

### 1. Root cause, or workaround?

- **CCCC-2** (`6ffc14f`): closed by driving the shipped reader over a real pipe.
  Mechanism: `proof:teardown` measures termination and nothing about bytes, so a
  reader that ended cleanly having read nothing satisfied it.
- **the reader's chunk copy** (`6ffc14f`): root, and the recorded reason was
  wrong before it was right — see item 4.
- **the two reds** (`c223618`, `4f37b51`): the first repair is the interesting
  one and it is finding **DDDD-13** below.

No loosened check. The one modified proof gained a declaration.

### 2. Verified against the easy shape only?

**Three times in this range, and that is the range's shape.** In each case a
constant was chosen for a good reason that had nothing to do with what it
quietly excluded:

| the constant | chosen because | what it excluded |
|---|---|---|
| one write batch in the reader probe | simplest way to send frames | the read loop's **second iteration** — all 16 frames landed in one read |
| `FRAME_BYTES = 4096` | sixteen times the pipe's buffer | a **pooled payload**, here; see DDDD-12, which corrects even this |
| one `Buffer.from` sample in a control | the obvious way to check an offset | every **pool refill**, where the offset is 0 |

The first was caught by its own control on the first run. The second and third
went to CI.

**The transferable question is not *is this fixture realistic* but *what does
this constant exclude*** — and in all three the constant was picked for a
defensible reason, which is what stopped anyone asking.

### 2a. Has a change to HOW something is proven moved the coverage?

Yes, and in the good direction twice. Two mutations that did **not** bite were
turned into cases that do, by finding the mechanism instead of recording the
non-result:

- the reader's chunk copy: a view left every case green, because `postMessage`
  clones synchronously. What bites is that cloning a TypedArray clones its
  **entire** underlying `ArrayBuffer` — 512 carried against 65536 weighed. The
  probe now reads each chunk's underlying width.
- the write adapter's payload copy: covered by the pooled-frame phase.

That is the opposite of this checklist's usual finding, and worth naming: a
mutation that does not bite is a prompt to look for the real mechanism, not only
a thing to record at the constant.

### 3. Would CI have caught it?

**It did, twice, and it should not have had to.** `check:lint` caught four
errors before the first push — two of them shape defects rather than style, since
`'operation' | 'stop' | string` has the `string` swallow both literals so no
comparison narrows. That gate is one range old and has now earned itself.

What it could not see is a probe whose behaviour depends on the machine, which
is both reds.

**Asked the other way — a defect this machine cannot see?** Yes, and it is
DDDD-12. This is the first finding in this project where the developing machine
and the runners disagree about a **runtime constant** rather than about
provisioning.

### 4. Are the proofs non-vacuous?

| what was mutated | what went red |
|---|---|
| the reader's wait watching the read alone | the stop cases, at **2006ms with the thread alive**; the delivery cases stayed green |
| the reader posting a view instead of a copy | **nothing**, until the clone-weight case existed; then that case alone, printing `{"carried":512,"weighed":65536}` |
| the write adapter dropping the payload's offset | the pooled-frame case **alone** — the 4096-byte fixture could not see it *here* |

### 4a. Resolution-tested BEFORE it measured anything real?

Yes for the reader: three mutations before any reading reached a document, and
the single-batch fixture was corrected by its own control on the first run.

### 4b. Positive control on every search?

No new search-shaped instrument. The reader probe's controls are of the other
kind — *did the thing I am measuring actually happen* — and one of them caught
the fixture.

### 4c. Does a check derive its extent from the set it governs?

Nothing new derives. `EXPECTED_TARGETS` and the `cases:` literals are unchanged.

### 5. Executed, or asserted?

**Executed:** `proof:readerworker` 8 cases · `proof:writesurface` 14 ·
`proof:workermode` 6 · `proof:boundaries` **202**, generated · five mutations ·
`npm run local -- --only check:` 15 of 15 · board **GREEN at `4f37b51`**.

**Asserted:** nothing new. ADR-0024's cost estimate, carried as asserted in the
previous entry, was **paid and corrected** in this range.

### 6. Did architecture change before the feature, or underneath it?

Before, in the previous range. This range built against ADR-0024 and moved
`workerModeHarnessWorker.ts` as the amendment required, which closed DDDD-9.

### 7. Do the documents still match the code?

ADR-0023 took two appended additions and one appended correction; ADR-0024 took
an appended cost correction; FEATURES row 282 was edited true.

### Findings

| # | finding | state |
|---|---|---|
| DDDD-12 | `Buffer.poolSize` is **8192** here and **65536** on the runners, and I recorded one machine's table in an ADR as a property of Node | **closed** `4f37b51` |
| DDDD-13 | the first repair fixed a real defect that was not the cause, because I reasoned from a local reproduction instead of reading the annotation | **recorded**, no fix |

**DDDD-12 in full.** The addition claiming *4096 is exactly the size that is not
pooled* was true here and false on the runners, where a 4096-byte copy landed at
byteOffset **21504**. So the earlier phases were **already** writing offset
payloads on CI, and the blindness that phase was written to close existed only on
this machine. The phase is still right and worth more than first stated — it
removes the dependence on `poolSize` rather than covering a local gap — and B6 is
the rule that was broken: **a figure carries the number, the date and where it
was read**, and a six-row table went into an ADR with no machine named. It was
genuinely measured, on one of two machines that disagree, which is the case B6
exists for rather than an exception to it.

**DDDD-13 in full, and it has no fix because it is a process finding.** After the
first red I hypothesised a cause, reproduced it locally, found it **real** — a
pool refill putting `byteOffset` at 0, measured at 2 of 40 — fixed that, and
pushed. Still red. The annotation, one unauthenticated GET on a wrapped step,
said `poolSize 65536` and named the actual cause. **The local reproduction was
persuasive precisely because it found a genuine defect**, which is what made it
feel like an answer rather than a candidate. *I can reproduce something that
looks like this* and *this is what happened* are different claims, and only the
second arrives with evidence. Read the failure text before forming the
hypothesis, not to confirm one.

---

## 2026-08-25 — Stage audit: `484460a..4880ea0` — two controls that could not see the branch they were written for

**Audited through `4880ea0`.** Pasted from `npm run audit:scope`, run before this
range's last commit:

```
Unaudited range: 484460a..HEAD

  commits: 4 (one batch is 9)
  files:   20 (one batch is 24)
  Within one batch. An audit is not yet owed.
  Fires at 10 commits (6 more) or 25 files (5 more).
```

**Audited at 4 rather than at the gate, deliberately.** Five files remain before
it fires and the next unit — a new package plus the reader worker — is more than
five on its own. Being blocked halfway through a package is worse than auditing a
short range.

**1 proof added**, 1 modified, 0 removed; **2 source files added**, 4 changed, 0
removed. The range closed the lint gap that reddened `main`, took the B4
placement amendment, and closed DDDD-8.

### 1. Root cause, or workaround?

Every fix root-cause, and one of them was a temptation refused.

- **DDDD-7** (`c04c2de`): `check:lint` reads `package.json`'s `lint` script as
  the authority. Mechanism: `checkLocal.mjs` derives from `check:*`/`proof:*`
  names, so the lint sat outside the sweep.
- **the scanner** (`c04c2de`): `check:annotatecoverage` reported a *comment*
  quoting a command as an unwrapped step. Rewording my comment would have been
  *special-casing the input that failed*, which Rule 0 names as a banned reflex.
  The scanner is fixed instead: a line whose first non-space character is `#`
  runs nothing under either reading.
- **DDDD-8** (`2d60fea`): the cancel-failed branch had no case, and I had
  recorded it as unreachable. It is not — I was looking for a way to make
  `CancelIoEx` **fail** rather than a way to make the **handle** invalid.

### 2. Verified against the easy shape only?

`check:lint`'s fixtures use a minimal flat config with one core rule, and that is
the easy shape. The hard one — this repository's own config, plugins and all — is
what the check runs against on every invocation, so both are covered by
construction rather than by a second fixture.

**Stated limit:** `parseLintScript` handles `&&` chains and this repository's
lint is one segment, so the chained path is fixture-only. It refuses rather than
shrinking when it cannot read a segment, which is the failure that matters.

### 2a. Has a change to HOW something is proven moved the coverage?

`segmentsOf` moved to `scriptSegments.mjs` and is imported and re-exported. Pure
move: `typecheck.proof.mjs` is unchanged and still passes its ten cases, which is
the check on that claim rather than my reading of the diff.

### 3. Would CI have caught it?

**The lint gap: CI is what caught it**, in the previous range, and that is the
finding rather than a reassurance.

**The scanner false positive: yes.** `check:annotatecoverage` runs on the Guards
job and reads the same lines; it happened to fail locally first because the sweep
now runs before the push.

**The missing ADR index row: yes** — `check:docs` caught it locally and runs in
CI. Worth recording because it landed in the one commit whose entire subject was
documents, which is where a document check is easiest to believe unnecessary.

### 4. Are the proofs non-vacuous?

| what was mutated | what went red |
|---|---|
| the cancel-failed branch inverted | the DDDD-8 case, on **time** — 250ms against 0ms — while the strand COUNT was identical |
| the comment rule widened to `#` anywhere | the trailing-comment control **alone** |

**Both of this range's new controls initially could not see the branch they were
written for, and that is the range's shape.**

**DDDD-10 — the count could not separate the cancel-failed branch.** Inverting
the test made the polling path strand all 31 writes *too*, having first spent the
full budget. A case asserting only *everything was stranded* would have passed
against the branch being deleted. The reason is measured and is not what the code
first claimed: with the handle closed, `GetOverlappedResult(…, wait: false)`
keeps answering `ERROR_IO_INCOMPLETE`, because it reads the request's own status
and the status of a request whose handle has gone away does not move. So the poll
can never settle them, and the branch buys 250ms against no different outcome.
**Closed in range** — the case asserts elapsed time alongside the count.

**DDDD-11 — a control varying one character tests the rule at that character and
nowhere else.** The comment-skip pair held everything constant except the leading
`#`. That catches a scan skipping too much at the START of a line and cannot
catch one keyed on `#` **anywhere**, which passes both cases and swallows a real
step carrying a trailing comment — a shape these workflows use. **Closed in
range** by a third fixture, and the mutation reddens it alone.

The transferable form: **skipping is a decision with more than one way to be too
broad, and each way needs the input it alone rejects.** A pair is not a control
set merely because it has two members pointing in opposite directions.

### 4a. Resolution-tested BEFORE it measured anything real?

Yes for both. `check:lint` was run against fixture trees before it was registered
anywhere, and its own comment was corrected by its own case — the comment claimed
a value-taking flag would fail the anchor and refuse, and the anchor is a subset
test, so it does not. **A comment describing a stricter guard than the code has
is what the next reader believes**, so it was corrected rather than quietly
fixed.

### 4b. Positive control on every search?

`check:lint` is not a search; `annotateCoverage.mjs` is, and it already refuses
to report when it recognises no wrapped invocation. That control is what makes
the comment-skip change safe to make at all: a skip that swallowed everything
would leave the scan blind and it says so.

### 4c. Does a check derive its extent from the set it governs?

`check:lint`'s extent is a literal, and the reasoning is in the previous entry.
Nothing new in this range derives.

### 5. Executed, or asserted?

**Executed:** `proof:lintcheck` 9 cases · `proof:annotatecoverage` 21 ·
`proof:writesurface` 11 · `proof:typecheck` 10 after the move · two mutations,
above · `npm run local -- --only check:` 15 of 15 · board **GREEN at
`ebaa95b`** and at `2d60fea`.

**Asserted:** that `packages/nodemode` costs what ADR-0024 says it costs — three
table entries, a tsconfig, a build line. Nothing has been built yet, and the
figure came from reading `eslint.config.js` rather than from doing it.

### 6. Did architecture change before the feature, or underneath it?

**Before, and this is the range that did it.** `ebaa95b` is the B4 amendment and
contains no code. The measurement it rests on was taken a range earlier,
deliberately, so the amendment cites a reading rather than an argument.

### 7. Do the documents still match the code?

The amendment's own sweep covered `CLAUDE.md`'s invariant 26 paragraph and its
repository map, `ARCHITECTURE.md` §1 and §9.26, `eslint.config.js`'s per-runtime
comment, ADR-0022 (appended, not edited) and the FEATURES row.
`docs/DECISIONS/README.md` was missed and `check:docs` caught it.

**ARCHITECTURE §1 and §9.26 still say the host body lives in `packages/kernel`,
and that was deliberately NOT swept up**: the host's subject and mode agree on
the kernel, so the amendment moves nothing whose two answers already agree.

### Findings

| # | finding | state |
|---|---|---|
| DDDD-10 | the cancel-failed branch's case could not separate it by count; only the elapsed time does | **closed** `2d60fea` |
| DDDD-11 | a control pair varying only the leading marker cannot see the other way to skip too much | **closed** `4880ea0` |

Carried from the previous entry: DDDD-3 and DDDD-4 recorded rather than fixed;
DDDD-9 answered by ADR-0024.

---

## 2026-08-25 — Stage audit: `121c0ff..484460a` — the sweep said fifteen of fifteen and could not see the gate that was red

**Audited through `484460a`.** Pasted from `npm run audit:scope`:

```
Unaudited range: 121c0ff..HEAD

  commits: 8 (one batch is 9)
  files:   19 (one batch is 24)
  Within one batch. An audit is not yet owed.
  Fires at 10 commits (2 more) or 25 files (6 more).
```

**Audited at 8 because the pre-commit gate refused the ninth**, whose eight files
took the range past 24. The report above is retrospective and the gate is
prospective, so the two disagreeing at this moment is them agreeing about the
same range — worth stating once, because a reader meeting both in one minute has
every reason to think one of them is wrong.

**0 proofs added**, 3 modified, 0 removed; **4 source files added**, 6 changed, 0
removed. All three modified proofs are additions with their counts raised; no
check in the range was loosened. The range built the write adapter and its
end-to-end probe, measured the write teardown and the worker's runtime mode,
closed DDDD-2 and DDDD-6, and **reddened `main` once**.

### 1. Root cause, or workaround?

Every fix root-cause. Two are corrections to my own claims and one is a red.

- **DDDD-2** (`13d15b8`): two comments stated one thing owned both directions of
  the pipe. Mechanism: the write decision falsified them and neither file is in
  any scope column — one is in the kernel, which the range never touched.
- **DDDD-6** (`6605e04`): the permissive could-not-look outcome exits 0 by
  design, so a runner reading the exit code alone reports a probe that measured
  nothing as a pass. Root fix: a third state in the harness, keyed on a marker
  the printing module owns.
- **the red** (`dd532bd`): four ordinary lint errors. The fix is mechanical; the
  reason it reached `main` is **DDDD-7** below and is not.

### 2. Verified against the easy shape only?

**The write adapter's hard shape is a peer that never reads, and it was used** —
32 frames, 131072 bytes delivered in issue order, the bound refusing past 8
outstanding, a teardown freeing 31 writes in 0ms.

**Two mutations did not bite and are recorded at their constants rather than
acted on** — the `OVERLAPPED`'s completion event, which nothing reads because
this design only polls, and the payload copy, which the named-pipe file system
makes indistinguishable from a view. The second is the sharper one: **I built
that case believing it would separate**, and the comment now says it does not
rather than reading like a proof.

### 2a. Has a change to HOW something is proven moved the coverage?

No. Three widenings — `unverifiable.proof.mjs` +3 cases, `checkLocal.proof.mjs`
+2, `electronImports.proof.mjs` one declaration — and nothing asserted moved to
being derived.

### 3. Would CI have caught it?

**It DID, and that is the finding rather than a reassurance.** `7ba978c` failed
CI 32828958338 at step "Lint" on all three jobs. Answered from the run, not the
workflow file.

**DDDD-7 — the local sweep is structurally blind to lint.** `checkLocal.mjs`
derives its set from `check:*`/`proof:*` names and invokes only bare `node`
command lines; `npm run lint` is neither. `npm run local -- --only check:`
reported **14 of 14 passed** on a tree CI then rejected, and the sweep's
disclosure names the PROOFS it did not run, so nothing named this hole either. A
file-naming convention standing in for a check, one layer up from where W-1 found
it. The gate is written and lands in the next range.

The compensation I was relying on was *lint the files you changed*, by hand, one
at a time. That is the shape this project has written down three times as not
being a mechanism, and it failed on the first file I forgot.

**Asked the other way — a defect this machine cannot see?** `proof:workermode`
is Windows-only and declines elsewhere, which is the inverse shape: CI is
stricter than here, not looser.

### 4. Are the proofs non-vacuous?

| what was mutated | what went red |
|---|---|
| the `OVERLAPPED`'s completion event removed | **nothing** — recorded at the constant, kept because a per-write wait added later is silently wrong without it |
| the payload copy replaced by a view | **nothing** — recorded; the pipe FSD takes the bytes at request time |
| the limit checked before collecting | `hostWriteQueue`'s control, and not the overrun case |
| `abandon` without the cancel | the teardown case, at *31 stranded after 250ms* — reporting where the waiting version produced exit 124 |
| main reporting no usable Electron module | `workerMode`'s control, alone |
| the marker classification removed, then applied to everything | both new `checkLocal` cases, in each direction |

**DDDD-8 — a branch no fixture reaches, and it is load-bearing.** In
`win32PipeSurface.ts`'s `abandon`, the path where `CancelIoEx` fails for a reason
other than `ERROR_NOT_FOUND` strands every write without waiting. Nothing reaches
it: the mutation that removed the cancel exercised the *poll timeout* instead.
Forcing a genuine cancel failure needs a handle in a state this probe cannot
construct. NNN-2's category — reachable, load-bearing, no case — and it is the
one branch of the teardown that decides whether main hangs, so it is recorded as
owed rather than as documentation.

### 4a. Resolution-tested BEFORE it measured anything real?

**Yes for the write surface, and this is the improvement on DDDD-3.** Three
mutations were run against `transportWriteSurface.mjs` before its readings
reached any document, and one of them corrected an over-specified expectation:
I asserted four refusals past a limit of eight and the run gave three, because
the kernel takes the first frame into the pipe's own buffer and the reap frees
that slot. The case now asserts the shape and says why the count is not asserted.

**`workerMode.mjs` was mutated during this audit rather than before**, which is
DDDD-3's order again in a smaller way. Its control reddens alone when main
reports no usable module. Two of its three defects had already been found by
running it — the ESM `__dirname`, and a SETUP case that passed on a harness
failure line because the harness reuses its marker for its own errors.

### 4b. Positive control on every search?

`workerMode.mjs`'s control is main's own row, taken in the same run, and it is
the negative-probe rule in its exact form: build the input from something that
would succeed if the property were absent.

**One search of mine failed the ordinary way and is recorded because it is the
fifth occurrence of the class.** Checking whether the new probes were registered
in CI, I grepped the workflows for `proof:transportwrite` and got nothing — CI
invokes the script path through `annotate.mjs`, not the npm name. The reassuring
answer was *not registered*, and it was wrong.

### 4c. Does a check derive its extent from the set it governs?

One new anchor, and its direction was asked before it was written.
`check:lint`'s extent is a **literal** (`EXPECTED_TARGETS`) rather than derived,
because the lint is one segment and shrinks by having its argument changed —
`eslint .` to `eslint packages` lints less, parses the same, and leaves the
invocation count unmoved. A case requires a narrowed script to fail that anchor,
without which the literal is decoration.

### 5. Executed, or asserted?

**Executed:** the write surface end to end, 9 cases · the write teardown, 5 ·
the worker's runtime mode, 6 · six mutations, listed above · the full
`apps/desktop` suite, 124 · `npm run local -- --only check:`, 15 of 15 · board
**GREEN at `dd532bd`**.

**Asserted:** that `OverlappedWriteSurface`'s members map onto the Win32 calls
the way the adapter spells them, which no case reaches independently of the
adapter · that the reader worker will fit `ReaderChannel` unchanged.

### 6. Did architecture change before the feature, or underneath it?

No architecture changed in this range. The placement question the worker-mode
measurement answers is a **B4 amendment** and is the next commit — measured
first, deliberately, so the amendment rests on a reading rather than on a
document.

### 7. Do the documents still match the code?

ADR-0023 took three appended sections and one appended correction; FEATURES row
282 was edited true three times; two code comments were corrected in the commit
that falsified them. NNN-4's cross-document sweep fired and produced DDDD-2.

**DDDD-9 — and this one is against the range's own finding.**
`apps/desktop/src/workerModeHarnessWorker.ts` runs in a worker thread, which this
range measured to be Node mode, and it sits in the directory the same finding
says Node-mode code must leave. It imports no Electron, so nothing is broken —
which is exactly why it would have stayed. The B4 amendment is where it is
resolved, and it has to answer whether harness files are in scope rather than
leaving the first exception to be argued case by case.

### Findings

| # | finding | state |
|---|---|---|
| DDDD-2 | two comments said one thing owned both directions of the pipe | **closed** `13d15b8` |
| DDDD-6 | the local sweep read a could-not-look as a pass, then certified coverage | **closed** `6605e04` |
| DDDD-7 | the sweep is structurally blind to lint; it cost a red board | **fix written**, lands next range |
| DDDD-8 | `abandon`'s cancel-failed branch is reachable, load-bearing and reached by no case | **open** |
| DDDD-9 | the harness worker sits in the directory this range's own finding says it must leave | **open**, resolved by the B4 amendment |

---

## 2026-08-25 — Stage audit: `4a0ef5d..121c0ff` — a control compared the one thing the defect would not change

**Audited through `121c0ff`.** Pasted from `npm run audit:scope`, run after this
range's last commit:

```
Unaudited range: 4a0ef5d..HEAD

  commits: 9 (one batch is 9)
  files:   21 (one batch is 24)
  Within one batch. An audit is not yet owed.
  Fires at 10 commits (1 more) or 25 files (4 more).
```

**3 proofs added**, 2 modified, 0 removed; **4 source files added**, 5 changed, 0
removed. The range measured the transport's write path, took the write-mechanism
decision, and built the write side's ordering and bound. Two of its nine commits
are corrections to instruments this project had already shipped.

### 1. Root cause, or workaround?

**Nine commits, every fix root-cause.** Two are corrections to a control that
was passing.

- **CCCC-4** (`3188b60`, the reviewing seat's finding): `transportWrite.mjs`'s
  whole-path control compared `received.reduce((sum, chunk) => sum + chunk.length, 0)`
  against `FRAMES * FRAME_BYTES` while its comment said the bytes were compared.
  Mechanism: 64 frames of 4096 identical bytes sum to 262144 in **any** order, so
  a reordered stream — the one failure that would sink the write design — produced
  the reassuring answer. Fixed at the fixture: each frame names its index.
- **DDDD-1** (`48071c0`, mine): `affectedProofsReport` printed *THIS SWEEP DID
  NOT RUN THEM* with nothing passed in that could support the claim. Mechanism:
  the sentence is about the caller's run and the function took only the affected
  set, so `npm run local -- --only proof:transportwrite` ran that proof, reported
  it passing, and then told the reader it had not been run. Fixed by making the
  reached set a **required** parameter — an optional one leaves the false claim
  one omission away, which is B5's argument rather than a preference.
- `86349b5` (before this audit's window but inside the range): two probes exited
  **0** on could-not-look. Root — one resolver, `scripts/lib/unverifiable.mjs`,
  now with four callers.

No loosened check in the range. Both modified proofs added cases; the two
existing `affectedProofsReport` call sites gained a `[]` argument, which preserves
their previous meaning exactly, since *reached nothing* is what the old report
assumed of every run.

### 2. Verified against the easy shape only?

**The write measurement's hard shape is the peer that never reads, and it was
used.** Ordering is now measured over 63 concurrent outstanding writes.

**What is NOT measured is stated as an argument and must be read as one
(DDDD-5).** A batch issued while the peer is actively draining, so inline and
pending completions interleave, is reasoned about rather than run: a write
completes inline only when the pipe has room, and room exists only once the bytes
ahead of it were consumed. The reasoning is mine and nothing has tested it. It is
in the probe's header and in the ADR, marked as an argument in both, because
constructing the case would mean starving a reader at a rate tuned to produce the
mix — a case that passes or fails on the runner's speed.

**And the write queue has met no Win32 at all.** `hostWriteQueue.ts` is exercised
against a fake surface only, because the adapter behind `OverlappedWriteSurface`
does not exist yet. That the surface's four members map onto `WriteFile`,
`GetOverlappedResult(…, false)`, a handle release and a post-close free is
asserted from how `transportWrite.mjs` uses those calls — not proven through this
interface. The next unit is where that becomes a measurement.

### 2a. Has a change to HOW something is proven moved the coverage?

**No.** The one candidate is `affectedProofsReport`'s new parameter: the two
pre-existing cases pass `[]` and therefore assert what they asserted before, and
the four new cases hold the affected set constant while varying only the reached
set — the axis the defect was blind to. A case varying the changed paths instead
would separate nothing.

### 3. Would CI have caught it?

**CCCC-4: no, and no check could have.** `proof:transportwrite` is an
unconditional step on both Windows legs and was green throughout — a byte-count
comparison passes in CI exactly as it passed here. The defect was in what the
control compared, which is not a property any harness can see. It was found by
review.

**DDDD-1: no, for a different reason.** The false sentence is printed by
`checkLocal.mjs`, which CI never runs. `proof:affectedproofs` *does* run —
`guards.yml:406`, `node scripts/ci/annotate.mjs scripts/proofs/affectedProofs.proof.mjs`
— and could not have caught it, because the run-awareness axis did not exist to
be tested. It does now, so the four new cases are on the board.

The write queue and the transport are `vitest` files under `apps/desktop`, which
both CI legs run.

**Asked the other way — a defect this machine cannot see?** No branch in the
range is keyed on provisioning. The nearest thing is `transportWrite.mjs`'s
`--require-transport`, which is the *inverse* shape: the flag makes CI stricter
than here, not looser.

### 4. Are the proofs non-vacuous?

Mutated, all of them, and each mutation is recorded in the commit that made it:

| what was mutated | what went red |
|---|---|
| two frames issued in exchanged order | the ordering case, at *byte 0, inside frame 0*; the byte count stayed 262144 |
| frames filled `index % 2`, uint32 dropped | the distinctness control, at *2 distinct frames out of 64* — while the ordering case still reported *in issue order*, which is the blindness that control announces |
| `missed` no longer subtracts the reached set | two of the four new `affectedProofs` cases; the third stayed green, correctly, since it asserts the state the old report claimed unconditionally |
| the limit checked before collecting | `hostWriteQueue`'s control, and not the overrun case |
| a refused write not ending the transport | the two new `hostTransport` cases |
| `stop` signalled unconditionally | the dead-reader pair |

**Branches no fixture reached (DDDD-4).** `hostWriteQueue.ts`'s `collect()`
carries `if (found === 'failed' && failure === null)`, so the FIRST failure in a
sweep wins. Nothing can observe that today: the detail string is a constant, so
two failures produce identical output and the guard survives its own mutation.
Not vacuous code — it encodes the same *first cause wins* discipline the
transport's ending has — but it is currently unobservable, and it becomes
load-bearing the day the detail names which write failed. Recorded at the
constant rather than deleted, per the rule that a non-biting mutation is evidence
about where the failure lives.

**The fixture SET (NNN-1).** `hostWriteQueue.test.ts` varies the limit across 4,
2 and 1, and varies which writes settle. The one constant is that `abandon` is
never observed receiving an empty list, which is a gap of no consequence: the
queue reaches `abandon` only through `shut`, and every case that gets there has
something outstanding by construction.

### 4a. Resolution-tested BEFORE it measured anything real?

**No, and this is a finding against my own process (DDDD-3).** The ordering
reading was taken first and the two mutations were run afterwards. The number is
sound — the mutations confirmed the instrument discriminates, and one of them
showed the ordering case reporting *in issue order* against a fixture that could
not see a swap — but item 4a asks for that order specifically, because a
confirmation obtained after the fact is a confirmation you already believe. The
reading was not written into the ADR until both mutations had run, which is the
next-best thing and is not what the item asks for.

### 4b. Positive control on every search?

No new search-shaped instrument in the range. `affectedProofs.mjs` already
refuses to answer without `CONTROL_EDGE`, and the change touched its report
rather than its walk.

**One search of my own failed exactly this way during the audit and is recorded
because it is the fourth occurrence of the class.** Checking whether the two new
probes are registered in CI, I grepped the workflows for `proof:transportwrite`
and got nothing — CI invokes the script path through `annotate.mjs`, not the npm
script name. The reassuring answer was *not registered*, and it was wrong.

### 4c. Does a check derive its extent from the set it governs?

One new derivation, and the direction was asked before it was written.
`checkLocal.mjs` derives the reached set from the run log rather than counting
alongside it. The failure to fear is a proof named as **reached** when it was not
— a missing warning — and that needs the set to be too BIG. A set computed from
the rows cannot invent a member, so deriving is the correct half here. The
opposite error makes the set too small, which over-warns.

Both `cases:` literals in the range (`11 → 15`, `7 → 9`) remain hand-kept
anchors, which is the right half for them: a deleted case makes the set smaller.

### 5. Executed, or asserted?

**Executed:** the ordering measurement, twice mutated · the four
`affectedProofs` cases and their mutation · nineteen `hostWriteQueue` and
`hostTransport` cases and four mutations · the full `apps/desktop` suite, 124
passing · `npm run local -- --only check:`, 14 of 14 · board **GREEN at
`48071c0`** (CI and Guards).

**Asserted:** the interleaved-completion argument (DDDD-5) · that
`OverlappedWriteSurface`'s members map cleanly onto the Win32 calls · that the
reader worker will fit `ReaderChannel` unchanged.

### 6. Did architecture change before the feature, or underneath it?

**Before.** `94f39f7` takes the write-mechanism decision and builds nothing;
`121c0ff` builds against it. No seam changed — the transport still registers into
`HostRuntimeTransport` — so this is an ADR decision rather than a B4 amendment,
recorded the way the other decisions in ADR-0023 were.

### 7. Do the documents still match the code?

ADR-0023 took three appended sections (record class, never edited). FEATURES row
282 was edited true twice (live specification). `hostTransport.ts`'s paragraph
saying the channel "does the overlapped reads and writes" was corrected in the
commit that made it false, which is what the decision commit said it owed.

**DDDD-2 — and it is NNN-4's hole, found by NNN-4's compensation.** This range
states a cross-document relationship — *the worker reads, main writes* — so every
other statement of that relationship had to be swept by hand. Two are false and
**neither file is named in any of this range's scope columns**, so no
range-scoped sweep could have reached them:

| where | what it says | why it is now false |
|---|---|---|
| `apps/desktop/src/win32PipeSurface.ts:43` | "Creating it is settled; carrying them is not, and mixing the two here would settle the second by accident" | carrying is settled as of `94f39f7`, and the write half belongs in this very file |
| `packages/kernel/src/host/runtime.ts:32` | "That factory also owns the pipe's overlapped reads and writes" | the factory creates the pipe; the worker reads and main writes |

The second is in the kernel, a package the range never touched. Both are live
specifications and take an edited body. **Open — the next commit.**

### Findings

| # | finding | state |
|---|---|---|
| CCCC-4 | the whole-path control compared a byte count, which a reorder does not change | **closed** `3188b60` |
| DDDD-1 | the affected-proofs disclosure asserted a fact about the run with no input that could support it | **closed** `48071c0` |
| DDDD-2 | two comments state that one thing owns both directions of the pipe; the decision falsified both, in files no scope column names | **open** |
| DDDD-3 | the ordering reading was taken before the discrimination control was mutated, which is item 4a's order backwards | **recorded**, no fix |
| DDDD-4 | `collect()`'s first-failure guard survives its own mutation, because the detail is a constant | **recorded** at the constant |
| DDDD-5 | interleaved inline-and-pending completions are reasoned about, not measured | **open**, stated in two documents as an argument |

**Correction appended 2026-08-25 — DDDD-5's recorded reason was the wrong one,
and the right one had never been written down.** The entry above, and the two
documents it points at, said the interleaved mix could only be constructed by
starving a reader at a tuned rate. True about a fixture; misleading about
production, where it reads as *this state is rare*. It is the **ordinary** state
— any host reading at a moderate rate produces it continuously — so the sentence
invited the next reader to treat an untested branch as unusual.

What protects it is structural and was absent from all three statements because
the constructability sentence occupied that place: `hostWriteQueue.ts` keeps one
`queued` list, its collect walks all of it rather than stopping at the first
pending, and `outstanding()` returns that list's length. The mixed state is the
union of two branches the cases already exercise separately, and the accounting
cannot diverge because there is only one of it.

Raised by the reviewing seat, which went looking for the defect the wrong reason
implied and did not find one. That is why this is a correction and not work — and
it is one more instance of the shape this journal has recorded before: **the
reason written down at the moment of writing is the one that came to hand, not
the one that holds**, and nothing downstream can tell them apart.

---

## 2026-08-25 — Stage audit: `fb9731e..4a0ef5d` — the instrument that measures teardown could not tear itself down

**Audited through `4a0ef5d`.** Pasted from `npm run audit:scope`, run before this
range's last commit:

```
Unaudited range: fb9731e..HEAD

  commits: 8 (one batch is 9)
  files:   17 (one batch is 24)
  Within one batch. An audit is not yet owed.
  Fires at 10 commits (2 more) or 25 files (8 more).
```

**1 proof added**, 2 modified, 0 removed; **4 source files added**, 4 changed, 0
removed. The range built the pipe factory, its adapter and the spike's migration
onto both; closed the previous audit's three findings and BBBB-4; and measured
the transport's termination.

**Audited at 8 rather than at the gate**, deliberately: the next unit is the
transport adapter, which is more than one commit, and hitting the batch gate
halfway through it would mean auditing a range split across an unfinished
module. Auditing early is allowed; being blocked mid-unit is avoidable.

### 1. Root cause, or workaround?

**Nine commits. Every fix is root-cause; two of them are corrections to my own
previous claims, and one is a security defect.**

- **BBBB-4** (`c783f9f`): `GA` for the container mapped to `FILE_ALL_ACCESS` and
  carried `WRITE_DAC`, so the principal invariant 25 declares hostile could
  rewrite the DACL of its own trust boundary. Not narrowed by editing the text —
  the spelling was one three Windows builds had measured, so the narrowing went
  back through the instrument.
- **BBBB-2, BBBB-3** (`91b1d45`): the `&&` semantics and the `FEWEST_INVOCATIONS`
  anchor, both closed; **BBBB-1's second half withdrawn** because it was reasoned
  rather than read.
- **CCCC-3** (`4a0ef5d`): the teardown probe hung instead of reporting. See item
  4a — it is this range's sharpest finding and it was produced by the audit
  rather than by a test.
- `75aa17c`, `9835ea4`, `76b9379`, `7108920`: measurements and the modules they
  produced.

**THE TWO ALLOWLIST WIDENINGS ARE THE ONES TO CHECK**, because an allowlist entry
is the shape item 1 calls *an override standing in for missing coverage*.
`electronImports.proof.mjs` grew a count (2 → 4) and an entry
(`transportTeardown.mjs`, sites 2). Both are bounded rather than amnesty, and the
mechanism that makes them so was verified in the source rather than taken from
its own failure message: the check is `every listed entry matches its live site
count, in BOTH directions`, so an entry left behind after its loads are removed
reds exactly as a new load does. Each entry carries a written reason naming every
load. Not a workaround.

**No check was loosened.** The one deletion that could have been is
`isInvalidHandle`'s import leaving `lowboxSpike.mjs`, and it is coverage MOVING
rather than leaving: the only caller was that file's own `CreateNamedPipeW`, and
the question is now answered inside the shipped surface through the derived copy
`proof:win32handle` requires to agree on every value.

### 2. Verified against the easy shape only?

**The hard shape here was the SECOND wait, and the probe's first version did not
have it.** It issued `ReadFile` immediately and got `ERROR_PIPE_LISTENING`: a
server instance cannot be read before a client connects. So a reader waits for a
client and then waits for bytes, and a design stoppable only in the second would
be stoppable only in the case that does not matter — a host that never connects
is exactly what Decision 8 kills for. Both cells now exist.

Everything in this range that could be measured off this machine was:
`proof:hostcontainment` at 8s and `proof:teardown` at 3s and 2s, on Server 2022
and Server 2025, read from `run_id 32807300585`'s step lines.

**The rich-ambient-environment axis, restated because this range added a new
kind of child:** a worker thread inherits the parent's entire process — handles,
environment, loaded DLLs. That is not a variable the probe controls and not one
the shipped adapter will control either, so it is stated rather than closed.

### 2a. Has a change to HOW something is proven moved the coverage?

**One move, and it is a gain that would have gone unrecorded.** The spike's pipes
were created by the file itself; they are now created by the shipped surface. The
row that measures the shipped descriptor against a contained cell therefore
measures *what a host will be handed* rather than a copy that agrees today. Gains
go unrecorded because nothing goes red when they happen.

**And a reduction that is not one.** `lowboxSpike.mjs` no longer imports
`isInvalidHandle` — see item 1.

### 3. Would CI have caught it?

Answered from runs, identifiers taken from the same payload as the lines.

- `proof:teardown` ran and passed on both Windows images:
  `run_id 32807300585 head_sha 7108920`, Server 2022 `04:02:39 -> 04:02:42`,
  Server 2025 `04:03:11 -> 04:03:13`.
- `proof:hostcontainment` ran on both with the new DACL and the WRITE_DAC rows:
  same run, `04:02:31 -> 04:02:39` and `04:03:03 -> 04:03:11`.
- **CI DID catch one**, and it is the second time this session: `9835ea4`
  reddened `main` on `proof:electronimports`, because two computed loads were
  added to a file whose entry declares a count. The local sweep could not name
  that proof — its reach is static imports and the proof addresses its input by
  glob and by a literal path string.
- **CCCC-3 would NOT have been caught by CI**, and this is the one worth stating.
  It only appears when the probe FAILS, and the probe passes. A CI run in which
  the overlapped flag was ever removed would have hung to the job timeout with
  no named case — which is how it would have been found, expensively, by
  somebody with less context than the person who made the change.

**Is there a defect this machine cannot see?** The probe's own numbers. It prints
`10ms` and `7ms`; CI asserts only that the exit is under 2000ms, and job logs
need owner authentication to read. So the figures in every document are this
machine's, and the containment jobs contribute a bound rather than a
measurement. That is finding CCCC-1.

### 4. Are the proofs non-vacuous?

Mutated, with the results at the constants:

| mutation | result |
|---|---|
| the reader waits on ONE handle instead of two | both cells wedge — `code null` at 2010ms and 2015ms, against 10ms and 7ms |
| `FILE_FLAG_OVERLAPPED` removed from the shipped surface | the probe reddens — 3 named cases — and see CCCC-3 for what else happened |
| `hostPipeDacl` narrowed to `0x0012019B` for BOTH principals | instance 1 refused, `GetLastError 5`, factory names the stage |
| the pipe factory's close-loop deleted | the partial-failure case reddens alone |

The first is the rejected design measured rather than argued: blocking in
`ReadFile` is what waiting on one handle amounts to.

**A branch no fixture reaches**, named rather than left: the worker's `'read'`
outcome — a wait returning because bytes arrived — is reached by no cell, because
neither cell writes. The probe measures termination and says **nothing** about
the transport carrying bytes. That is a scope, and it was unstated until this
audit; it is now finding CCCC-2.

### 4a. Instruments and their resolution tests

`transportTeardown.mjs` was resolution-tested by the wait-count mutation before
its readings were written into any document: two inputs differing by the smallest
thing that changes the answer, reported differently.

**AND THE RESOLUTION TEST IS WHAT FOUND CCCC-3.** Removing the overlapped flag
made the worker block inside `ConnectNamedPipe` — the failure under
demonstration — and `CloseHandle` on that instance then blocked as well. The
probe tidied up before reporting and **hung for ten minutes, printing nothing**.
Skipping the cleanup fixed that half; the process then still would not exit,
because `process.exit(1)` does not end a process whose worker thread is inside a
syscall (measured: `EXIT=124` under an external timeout). It now ends with
`TerminateProcess`.

**A probe whose failure mode is a hang cannot report the failure it exists to
detect.** The instance is worth less than the shape, and the shape here is
pointed: this instrument's entire subject is teardown, and its own teardown was
the part that did not work. **An instrument that shares a failure mode with its
subject will meet that failure mode first**, and it will meet it in the run where
it is trying to report.

### 4c. Rosters and anchors

Three hand-kept counts fired in this range, all in the direction a derived count
cannot see:

- `transportTeardown.mjs` declared 9 cases and recorded 7 — my arithmetic, caught
  before the first real reading.
- `electronImports.proof.mjs`'s per-file site count caught both widenings.
- `FEWEST_INVOCATIONS` in `typecheck.mjs`, added last range, is checked against
  the manifest by its proof so it cannot sit above the real count.

### 5. Executed, or asserted?

**Executed:** the three DACL masks and their outcomes; `WRITE_DAC` allowed for
the contained cell under `GA` and refused under `0x0012019B`; the owner allowed
`WRITE_DAC` despite a mask that lacks it; both teardown waits at 10ms and 7ms;
the one-handle mutation wedging at 2010ms and 2015ms; the overlapped-flag
mutation hanging, then reporting, then failing to exit; every CI step line.

**Asserted:** that the shipped DACL's advantage over `D:(A;;GA;;;BU)` is other
USERS of the machine — a single-account runner cannot measure it, and it is
labelled as reasoning in the ADR. Unchanged from last range and still the only
one.

### 6. Architecture before feature?

**Yes, three times, and all before the adapter exists.** ADR-0023 §4 has two
corrections and an addition; the transport's structure was decided and measured
with nothing built on top of it. The error each avoided is concrete: a descriptor
nothing can open, a design shaped around handing a stream to Node, and a reader
that cannot be stopped.

### 7. Do the documents still match the code?

**One does not, and it is mine from this range.** ADR-0023's teardown table
presents `10ms` and `7ms` immediately after *"seven cases on the Windows
containment jobs"*. Both halves are true and the sentence they form is not: the
jobs assert a bound, the figures are this machine's, and job logs are not
readable without owner authentication. That is the compound-claim shape item 7
warns about, in a document written an hour earlier. **Corrected by appending**,
in this commit, because an ADR is a record.

**AND THE SWEEP FOUND A SECOND INSTANCE, which is what the sweep is for.**
NNN-4's rule fires when a range states a cross-document relationship: every other
statement of it gets swept by hand. `docs/FEATURES.md` row 282 carried the same
compound claim — *"runs it on both Windows containment jobs — the reader exits
10ms and 7ms"* — written in the same commit as the ADR sentence. It is a live
spec, so its **body was edited true** rather than corrected underneath: the jobs
assert a bound, and the figures are labelled as one machine's in the ADR.

Two documents, one wrong sentence, written an hour apart by the same author who
then found neither by re-reading. It was found by writing the correction to the
first one and being obliged to look for the second.

### Findings

- **CCCC-1** — figures measured on the developing machine were presented beside
  a sentence about the CI jobs. **Closed in this commit** by an appended ADR
  correction.
- **CCCC-2** — `transportTeardown.mjs` measures termination and nothing about
  bytes crossing; the worker's `'read'` outcome is reached by no cell. A stated
  scope now rather than an unstated one. **Open**, and it closes when the
  adapter's own proof carries a frame end to end.
- **CCCC-3** — an instrument that shares a failure mode with its subject meets
  that failure mode first, in the run where it is trying to report. **Closed in
  `4a0ef5d`**, in two halves, both measured.

## 2026-08-24 — Stage audit: `7f77999..fb9731e` — two checks were fixed at instance level and re-fixed as a class one commit later

**Audited through `fb9731e`.** Pasted from `npm run audit:scope`, run before the
range's last commit was written:

```
Unaudited range: 7f77999..HEAD

  commits: 9 (one batch is 9)
  files:   12 (one batch is 24)
  Within one batch. An audit is not yet owed.
  Fires at 10 commits (1 more) or 25 files (13 more).
```

**1 proof added**, 1 modified, 0 removed; **1 source file added**, 3 changed, 0
removed. The range closed AAAA-37 through AAAA-40 and the reviewer's ruling on
the expectation vocabulary, added `check:types`, and corrected ADR-0023 §4 twice
from measurements.

**The audit is being paid because the gate BLOCKED a commit**, not because a
number was noticed. The tenth commit was refused at `git commit` with *"this
commit takes the unaudited range past one batch"*. Worth recording because
`check:docs` measures against HEAD and would not have seen it until one push
later — the pre-commit half is what fired, and it fired on a commit whose content
had nothing to do with auditing.

### 1. Root cause, or workaround?

**Nine commits, eight fixes, all root-cause. One is a loosened check and it is
examined below; two were fixed twice.**

- **AAAA-37/38** (`e7f4fbf`): a derivation whose tail described the cleanup
  replaced in the same commit, and a 150ms window against a 100ms tick. Both
  mechanisms, both stated at the constant.
- **AAAA-39** (`1661f0e`): the transport's premise was an inference sitting
  beside a measurement of something else. Fixed by measuring it — three pipes,
  four controls, three Windows builds.
- **AAAA-40** (`b670010`): `verdict()` returns `same` for refused/refused, so the
  row certifying ADR-0023 §4 passed for a pipe neither cell could open.
- **The reviewer's ruling** (`073e6d9`): the above fix, generalised.
- **`1ad6797`**: a `@typedef` block placed between a JSDoc and its function
  severs the two. Mechanism, and it reddened `main`.
- **`ea42923`**: `npm run typecheck` is not a `check:*` name and not a `node`
  command line, so the local sweep could reach it through neither route.
- **`fb9731e`**: ADR-0023 §4's DACL sentence, corrected from measurement.

**BBBB-1 — TWO FIXES IN THIS RANGE WERE INSTANCE-LEVEL AND WERE RE-FIXED AS A
CLASS ONE COMMIT LATER. That is Rule 0's *fix the class, not the instance*
arriving late twice, and the second time it was the reviewer who noticed.**

| the instance fix | what it missed | the class fix |
|---|---|---|
| `b670010`: require the uncontained cell to be allowed on every row | correct for all thirteen rows and wrong as a rule — it forbids a row whose point is that the uncontained side is excluded | `073e6d9`: each row declares the expected outcome of each cell |
| `ea42923`: register `check:types` | closes the typecheck hole and not the class of *gates the sweep's invoker cannot reach* — a `check:*` whose command is not `node`-headed is still reported and skipped | not yet made |

The first was caught within a commit and cost nothing. The second is open, and
it is recorded rather than fixed here because the fix belongs in `checkLocal.mjs`
and this commit is docs-only. **The tell in both is the same: a fix whose
correctness argument mentions the specific thing it was written for.** *These
thirteen rows* and *the typecheck* are both that sentence.

**The loosened check, examined because "raising a limit" is on the banned
list.** `e7f4fbf` widened the pre-kill liveness window from one 150ms sample to
a 2000ms poll. That is a loosening in tolerance and it is legitimate: the check
was **wrong**, not the code. A single window against a counter written every
100ms produces a red on a correct build whenever a runner stretches one tick, and
a red for a case that could not be set up is the outcome the SETUP case fifty
lines below exists to keep separate from a real failure. The same commit ADDED a
constraint — the probe list must be exactly `MAX_SURVIVORS` long — so the net
movement is not toward tolerance.

### 2. Verified against the easy shape only?

**The hard shape here is another Windows build, and it was reached.** The DACL
row and the pair vocabulary both ran on Server 2025 and Server 2022 under
`--require-containment` as well as on this machine.

The **rich ambient environment** axis, which is the quiet one: `runInvocations`
spawns `tsc` with this process's environment, unfiltered. Under the local sweep
that environment carries `npm_execpath` and the rest of npm's exports; under CI's
`npm run build` it carries a different set. Nothing in the compiler's behaviour
is known to depend on either, so this is stated rather than claimed as a defect —
but it is the axis that produced the pre-commit harness's silent branch, and the
question *what does the harness hand its child that the real caller does not* has
not been answered here beyond "nothing we know of".

### 2a. Has a change to HOW something is proven moved the coverage?

**Two moves, and they run in opposite directions.**

- **Verdict → pair (`073e6d9`) is a strengthening everywhere.** A pair is
  strictly more specific than an agreement, it has no provisioning condition, and
  every row that could previously be satisfied by two failures now cannot. The
  remap's risk was not coverage but **translation**, and it is handled under 4c.
- **One-shot → poll (`e7f4fbf`) buys reliability with tolerance.** The property
  is unchanged; the window is 13× wider. Recorded here because the commit's own
  argument is about false reds, and a reader looking only at that argument would
  not notice the check now accepts a build that takes two seconds to do what it
  used to have 150ms for.

### 3. Would CI have caught it?

**Answered from runs, with the identifiers taken out of the same payload as the
lines** (AAAA-32's remedy).

- The `1ad6797` defect: **CI did catch it** — `npm run build` failed on every leg
  of CI 324, which is how it was found. Nothing local could see it, which is the
  whole content of `ea42923`.
- `proof:typecheck` ran and passed on both platforms:
  `run_id 32775656068 head_sha ea42923`, ubuntu `20:46:19 -> 20:46:22`, windows
  `20:46:48 -> 20:46:50`.
- `proof:hostcontainment` ran and passed on both Windows images with the new row:
  `run_id 32778367851 head_sha fb9731e`, Server 2022 `21:16:08 -> 21:16:11`,
  Server 2025 `21:16:55 -> 21:17:01`.

**`check:types` itself is NOT a CI step and that is deliberate**, since CI runs
`npm run build`, which is the same two compiler invocations plus the preload
bundle. What CI carries is its proof. The check exists for the minute before a
push, which is the interval that was uncovered.

**And the other direction — a defect this machine cannot see?** The one branch
keyed on provisioning in this range is `existsSync(tscPath)` in `typecheck.mjs`,
which is false only on a tree with no `node_modules`. No runner reaches it after
`npm ci`, and nothing exercises it. Kept and documented rather than deleted
(JJJ-1's disposition): the fact it encodes is true, and a typecheck that cannot
find its compiler must not report a clean tree.

### 4. Are the proofs non-vacuous?

**Mutated, with the results written at the constants rather than in a commit
message:**

| mutation | result |
|---|---|
| `judgeRow`'s `containedHeld := true` | the discrimination control FAILED — **and all 13 rows PASSED** |
| `judgeRow` reads the wrong side | control FAILED, 8 cases red |
| `judgeRow` always false | control FAILED, every row red |
| `win32Granted` points at a name nothing created | before the pair: `ok same`, exit 0. After: `FAIL same`, exit 1 |
| `@type {number}` on a string constant | `check:types` exit 1, `TS2322` with file, line and span |
| the teardown fixture's tick slowed to 500ms | **nothing went red** — recorded at `CLEANUP_ADVANCE_BUDGET_MS` as a non-biting mutation with its reason |

The first row is the load-bearing one: a predicate that ignores the mechanism's
own side is invisible to every row in the table, because each row supplies one
actual pair and it is the matching one. Only a control posing pairs no run
produces can see it.

**BBBB-2 — `runInvocations` is never exercised with more than one invocation.**
`proof:typecheck` passes a single-element array in both fixtures, and the real
caller passes two. The loop's second iteration, and the behaviour when the first
invocation fails and the second is still attempted, are unexercised. Not a
vacuous proof — the cases that exist separate what they claim — but a branch no
fixture reaches, which is where item 4 says to aim.

### 4a / 4b / 4c. Instruments, searches, and rosters

**Resolution tests, done before the instruments measured anything real:**
`typecheck.mjs` against a clean project and one with a single type error, and
against a real error in the repository itself; `judgeRow` exhaustively over four
expectations × sixteen actual pairs.

**`currentUserSid()` has no resolution test of its own, and does not need a
separate one.** Its failure mode that matters — returning a SID that is not this
process's user — makes the shipped-DACL row's contained cell go red, because a
descriptor built from the wrong principal denies. The row IS the instrument's
control. What the row would NOT catch is a *different but still valid* principal
that happens to include this user; that is recorded as a limit, not a gap, since
the property under test is that the built descriptor admits the container.

**BBBB-3 — `typecheck.mjs` derives its extent from the set it governs, and the
failure to fear makes that set SMALLER.** The check refuses when the parsed
invocations and the `&&` segments disagree, but both come from the same string.
Delete a project from `package.json`'s `typecheck` script and the count agrees:
the typecheck genuinely got smaller, faithfully, silently. That is item 4c's
exact shape, and the remedy item 4c names is an **anchor** — a claim the shrinker
has to touch separately, here a minimum count that is not read from the script.
Open; the fix is one line and belongs in the file, not in this entry.

**The search-shaped instrument in this range is `typecheck.mjs`'s parse**, and it
carries a positive control that runs every time: the repository's own `typecheck`
script must parse into at least one invocation with every segment understood. Its
proof asserts the same thing against the live manifest rather than a fixture.

### 5. Executed, or asserted?

**Executed:** the three DACL spellings and their failures (`GetLastError 5` twice,
at instance 1); `GetFileType(_get_osfhandle(3))` returning `FILE_TYPE_PIPE`; the
container refused by a container-only descriptor; the shipped descriptor admitting
it on three Windows builds; every mutation in the table above; the CI step lines.

**Asserted, and labelled as such where it is written:** that the shipped DACL's
advantage over `D:(A;;GA;;;BU)` is *other users of the machine*. A single-account
runner cannot measure it. It is stated in ADR-0023's correction as reasoning, not
as a reading, which is the disposition this project requires — and it is the one
claim in this range that a second account would settle.

### 6. Architecture before feature?

**Yes, and this is the cleanest instance the checklist has had.** Both ADR-0023
corrections were written **before** the pipe surface exists. The first would have
produced a surface that builds a descriptor nothing can open; the second would
have produced one shaped around handing a stream to Node. Neither error can now
be built, because the module that would contain it has not been written — which
is what "the architecture changes first" buys, stated for once from the side
where it worked rather than from the side where it did not.

### 7. Do the documents still match the code?

**A cross-document sweep was owed and was run.** `fb9731e` states a relationship
between the transport's DACL and what the surface must build, so NNN-4's rule
fires: every other statement of that relationship was swept by hand. Five sites,
of which four needed changing.

| site | class | treatment |
|---|---|---|
| ADR-0023 §4 | record | **appended dated correction** |
| `docs/FEATURES.md` row 282 | live spec | body edited true |
| `packages/kernel/src/host/runtime.ts` | live spec | body edited true |
| `apps/desktop/src/win32HostSurface.ts` (two places) | live spec | body edited true |
| `packages/kernel/src/host/containment.ts` | unaffected — about a directory ACL, not the pipe | left |

**One of the four was a compound claim of exactly the shape item 7 warns
about.** `win32HostSurface.ts` said a LowBox token "passes an access check only
where the DACL grants the container SID … so the user's own rights do not
count". The first clause is true and still true. The second is false in the way
that matters: the user's rights are **necessary and not sufficient**, and the
sentence read as though they were irrelevant. The live half vouched for the dead
half, which is why nothing had flagged it.

### Findings

- **BBBB-1** — two fixes in this range were instance-level and one was re-fixed
  as a class a commit later; the other's class fix is not yet made. **Open.**
- **BBBB-2** — `runInvocations`' multi-invocation path is unexercised. **Open.**
- **BBBB-3** — `typecheck.mjs`'s segment count is derived from the very script
  whose shrinking it should notice. **Open**, remedy named.

### Correction, 2026-08-25 — BBBB-1's second half is withdrawn, and BBBB-2 was worse than recorded

**BBBB-1's second row is wrong, and it was wrong when written.** It claimed that
registering `check:types` left open a class — *a `check:*` whose command is not
`node`-headed is still reported and skipped*. Reported, yes. **Skipped, no.**
`checkLocal.mjs:815` puts `notNode.length === 0` in the `clean` conjunction and
`:829` is `process.exit(clean ? 0 : 1)`, so such a script makes the sweep exit
non-zero. The class was already closed, by that file, before `check:types`
existed. Nothing needed to be built and nothing is owed.

Recorded rather than quietly dropped because of how it was produced. The audit
entry was written in one pass at the end of a range, and this line is the only
claim in it that was **reasoned rather than read** — I inferred the behaviour
from the fact that the sweep prints a message, and did not open the file. It is
the shape a correction is most likely to have: composed at the moment of least
scrutiny, and plausible enough to survive.

**BBBB-2 upgraded from a gap to a defect, and is closed.** It was recorded as a
branch no fixture reaches. Asking *why* — item 4's instruction, rather than
noting the absence — showed the branch was wrong: `runInvocations` ran every
invocation and collected failures, while the authority joins them with `&&`, so
the second runs only if the first succeeded. Two consequences, one of principle
and one visible: it is a second opinion about what the script said, and it checks
the second project against artefacts the first did not build, handing the reader
cascades of the real error. Now stops at the first failure, with a case in each
direction — a failure must stop the rest, and two successes must both run.

**BBBB-3 closed.** `FEWEST_INVOCATIONS = 2` is an anchor the derived comparison
cannot reach, checked against the manifest by the proof so it cannot sit above
the real count and be deleted rather than corrected. Both mutations bite:
removing the stop reddens the `&&` case, and an anchor of 3 reddens both the
check and the proof.

**So of the three findings this audit opened, one was not real.** That is worth
one sentence rather than a paragraph of process: the two that were real were
found by reading diffs, and the one that was not was found by reasoning about a
file I had not opened in that pass.

## 2026-08-24 — Stage audit: `b0a1da4..7f77999` — a requirement was withdrawn, which is the rarest thing this checklist gets to examine

**Audited through `7f77999`.** Pasted from `npm run audit:scope`:

```
Unaudited range: b0a1da4..HEAD

  commits: 8 (one batch is 9)
  files:   9 (one batch is 24)
  Within one batch. An audit is not yet owed.
  Fires at 10 commits (2 more) or 25 files (16 more).
```

0 proofs added, **1 modified**, **2 source files added** and 2 changed. The
range closed AAAA-28 through AAAA-31 and both halves of AAAA-6's residue.

**The unusual thing in it is a WITHDRAWAL.** Every other range in this journal
adds coverage or corrects a claim. This one removed a requirement — the job
object the FEATURES row had owed since WWW-2 — and item 1's question has a
different shape when the answer is *we stopped owing this*.

### 1. Root cause, or workaround?

**Four fixes, all root-cause, and one of them is a removal.**

- **AAAA-28** took a path out of a message rather than asserting the message.
  Two writers existed for where the run log lives and one was already wrong.
- **AAAA-6, first half.** `spawnSync`'s `error` was read **nowhere** in
  `checkLocal.mjs` — zero occurrences — so a failure to create a process
  arrived as `FAILED` at `0.0s` with `(no diagnostic line found)`. That is not
  a symptom of the 35-at-0.0s pass; it is why the pass could not describe
  itself. `classifySpawn` now names it and the sweep stops there.
- **AAAA-6, second half — the withdrawal.** The row required a job object *so
  that a killed script's children die with it*. The premise was never measured,
  and the evidence that motivated it had been withdrawn two days earlier.
  Measured instead of built: an ordinary grandchild dies with the harness 3 of
  3, a `detached` one survives 3 of 3. **Removal was the first move, not a
  footnote** — which is the shape to check when a requirement disappears,
  because the alternative reads identically: a requirement quietly dropped
  because it was expensive.
- **AAAA-31** is the correction to my own withdrawal: the premise was in a
  comment. A withdrawal REMOVES a check, so its premise is the one that must be
  asserted, and it is a property of the runtime — a node bump would falsify it
  in silence. Now a case, on both platforms' Guards legs.

**No override, no loosened check, no widened type.** The one deletion that
could have been a loosening is examined under item 4.

### 2. Verified against the easy shape only?

The hard shapes this range reached: a spawn that produces **no process at all**
(synthesised, because the harness cannot reach it — see the stated gap) · a
timeout that sets **two** result fields at once · a grandchild seen **advancing**
rather than merely present · a platform whose answer is the **opposite** of the
development machine's.

That last one had never executed here. `7f77999` is its first run on Linux, and
it passed — so *an ordinary grandchild survives its parent's death on
ubuntu-latest* is now measured rather than reasoned. The roster is what makes
that readable: 44 cases must run, and on Linux the two `win32` cases cannot
have, so a green leg is 44 including both `else` cases.

### 2a. Has a change to HOW something is proven moved the coverage?

**Yes, and in the direction that needs stating.** A spawn failure used to land
in the `FAILED` branch and the sweep continued. It now lands in `didNotStart`
and the sweep **breaks**. That is a behaviour change inside a classification
change, and **no fixture can reach it** — the harness always spawns
`process.execPath`, so the only failure-to-spawn available is an absent `cwd`,
which is the harness's own root. Tried: a first script that chdirs away and
deletes that root. It does not work, because `recordRow`'s
`mkdirSync(..., { recursive: true })` recreates the chain the moment that script
completes, and the next one then starts normally and reports `MODULE_NOT_FOUND`
in 0.1s.

So the classification is asserted against synthesised results and the branch
that stops the sweep has executed **nowhere**. Stated in `spawnOutcome.mjs` and
here rather than left as an absence.

### 3. Would CI have caught it?

**Computed, not recalled — which is AAAA-29's own remedy applied to the first
range after it.** `affectedProofs.mjs` fed this range's changed paths names
exactly one proof, `proof:checklocal`, resolving to `guards.yml` by path. Read
from the run rather than the file — Guards run 323 for `7f77999`:

```
Secret scan and file policy (ubuntu-latest) :: success
  success  2026-08-24T15:54:36Z  Document consistency
  success  2026-08-24T15:54:47Z  Prove the local check sweep can report a failure at all

Secret scan and file policy (windows-latest) :: success
  success  2026-08-24T15:56:09Z  Document consistency
  success  2026-08-24T15:56:31Z  Prove the local check sweep can report a failure at all
```

So the whole range is on the board on two platforms: the code through that
proof, the documents through `check:docs`.

**And the other way round — is there a defect THIS MACHINE cannot see?** Yes by
construction, and it is now a case rather than a hazard: the platform branch in
the teardown probe has a side that never runs here. That is the branch-keyed-on-
presence shape, and the answer was to assert both sides rather than to remember.

### 4. Are the proofs non-vacuous?

**Seven mutations run this range, each reddening its own case:**

| mutation | reddened |
|---|---|
| seal always `-ok` | the timeout-seal case, alone |
| `-running` is not evidence | the same-timestamp retention case, alone |
| restore `slice(0, -keep)` | the keep-none case, alone |
| start the log named `-ok` | the kill case, alone |
| `SETUP_MARGIN_MS` to 0 | the fixture-outlives-the-wait case, alone |
| classify `error` before `signal` | the branch-order case **and** the existing timeout-stops case |
| the ordinary probe made detached | the win32 teardown case, alone |
| the differential removed | its control **and** the stop-check, whose survivor list goes empty |

**THE MUTATION THAT DID NOT BITE IS THE ENTRY WORTH KEEPING.** AAAA-30's fix
derives a fixture's lifetime from the wait budget so two literals cannot drift
out of order. Setting the margin to `-9900` — a 100ms fixture against a 10s
wait, exactly the inversion — left all 32 cases **passing**. The kill fires
within one poll of the first row landing, about half a second in, so a healthy
run never waits out the budget. The relationship is real and the ordinary path
does not exercise it: item 4a's *branch nothing reaches*, in a guard rather than
in a fixture. The remedy was to stop hoping — one case reads the fixture file
the case just **wrote**, parses the number and requires it to exceed the budget,
which also catches a future edit that puts a literal back.

**The load-bearing column, read line by line.** `checkLocal.proof.mjs` reports
+692/−3 in the range diff while the per-commit figures say −23: twenty deletions
are invisible because a line added and rewritten inside a range nets to an
insertion. Every one of them read from `git log -p`: **six roster bumps (22 → 23
→ 32 → 33 → 38 → 40 → 44, monotonically up)**, three literals replaced by
derivations, one assembled sample promoted to a named constant, two import lines
widened. **No check was deleted and no assertion was weakened.** For a range
containing a withdrawal that is the number that had to be checked, because a
withdrawal is exactly how a check leaves quietly.

### 4a / 4b. Instruments and searches

**Two modules added, both pure classifiers, both resolution-tested by
construction:** `retention` is asked to separate an `-ok` from a `-running` at
the *same timestamp* — where age cannot decide — and to distinguish keeping one
from keeping none; `classifySpawn` is asked for all four states including the
one where two fields contradict each other.

**A search's control found the search.** The detached-spawn scan reported
`checkLocal.proof.mjs` on its first run, **twice, in two commits**, both times
correctly: written as a literal, the sample string and then the fixture text
were real occurrences in a real source file. The fix is to stop being a hit
(the key is assembled, once, in a named constant) rather than to exclude the
file — an exclusion would also hide a genuine detached spawn added there.

**The scan is DERIVED from the tree, and the direction was checked rather than
assumed** (item 4c): the failure to fear is somebody *adding* a detached spawn,
which makes the set bigger, and a derived count tracks growth perfectly. A
hand-kept list would be the wrong instrument here for the same reason it is the
right one for the roster eight lines away.

**STATED LIMITATION, and it is the one this range genuinely carries.** Five
instruments produced this range's load-bearing figures and **none of them is in
the repository** — they were scratch files, so no column names them, not because
the classifier is blind but because they were never tracked. Three of the five
have since been superseded by cases: the timeout's two-field result and the
spawn failure's shape are exactly what the `classifySpawn` cases assert, and the
teardown differential is AAAA-31.

**The fifth is not, and it is the load-bearing one:** node's startup floor —
min 116.0ms, median 129.1ms, max 179.0ms over 15 runs, 0 of 15 under 50ms — is
what turns *0.0s* into *never started*, and it is asserted nowhere and cannot be
re-derived. Ranked as a limitation rather than a defect for one reason: it
interprets a **historical** observation, so a faster node would not change what
the 2026-08-23 machine did, and the *next* occurrence will carry an errno and
will not need the floor argument at all. **It becomes a defect the first time
somebody needs the floor to interpret a new observation.**

### 5. Executed, or asserted?

**Executed:** the startup floor (15 runs, with the instrument printing its own
resolution check first — 3.8ms against 124.9ms — before any figure below it) ·
the spawn-failure shape (3 variants, one an ordinary non-zero exit as control) ·
the timeout's two-field result · the teardown differential (3 runs × 2 variants,
each survivor identified **by command line, not by age**) · seven mutations ·
every proof and check named above · the Guards steps quoted under item 3.

**Asserted and marked as such:** that libuv's job object is the mechanism behind
the Windows teardown — the *behaviour* is measured and the *name* is an
inference from the discriminating variable, which no reading here establishes.

### 6. Architecture before feature?

No architecture change. Two new modules under `scripts/lib/`, both extractions
made **so that something could be asserted at all**: `checkLocal.mjs` starts a
sweep on import, so nothing inside it is reachable by a proof. That is the same
move `runLog.mjs` made and the reason is worth keeping — an extraction whose
purpose is reachability is not a refactor, it is coverage.

### 7. Do the documents still match the code?

**Five live specifications were edited true in this range, not corrected
underneath:** `checkLocal.mjs`'s timeout comment (which asserted the orphan
premise), the refusal message in `sweepScope.mjs` (three times), FEATURES row
319 (twice), and CLAUDE.md item 3. The journal's `991e683` entry took an
**appended dated correction** instead, because it is a record.

**AND THE REFUSAL'S PROSE IS NOW THE FILE TO WATCH.** `sweepScope.mjs`'s
"Unblocked by" line was rewritten **three times inside this one range**, and the
paragraph above it had already been corrected three times in the nine commits
before it. Every version was believed when written and each narrowed the claim,
which is the right direction and the only reassuring thing about it. The file is
a live specification written almost entirely in prose: `proof:checklocal`
asserts its **paths** (AAAA-28) and one of its **claims** (nothing detached),
and nothing at all asserts the rest. No mechanism is proposed here, because the
honest ones are the two that already exist — turn a claim into a case when it
can be, and read this file's diff in every audit when it cannot.

### Correction, 2026-08-24 (findings AAAA-32, AAAA-33)

**The run named under item 3 is the wrong one, and the wrong one is green.**
The entry says *Guards run 323 for `7f77999`*. Guards 323 is `32743980238`,
head sha `8814e59` — **the parent**, the commit before the AAAA-31 case existed.
`7f77999`'s Guards run is **324, id `32747634647`**, and that is where the four
step lines quoted above actually come from; they are correct.

So the label resolves, to a real green run, and that run is the one a reader
would open to check *"`7f77999` is its first run on Linux, and it passed"* — a
run that could not have executed the case. **UU-1's shape exactly**: no link
check can see it and no sweep could, because nothing is broken.

**The corroboration is better evidence than a run number and cannot be mistyped
into being wrong.** The proof step's duration jumped in the run where the case
landed, read from the jobs API:

| | ubuntu | windows |
|---|---|---|
| Guards 323 (`8814e59`) | 15:18:40 → 15:18:46, **6s** | 15:20:57 → 15:21:06, **9s** |
| Guards 324 (`7f77999`) | 15:54:37 → 15:54:47, **10s** | 15:56:19 → 15:56:31, **12s** |

**The transferable part is where the two halves came from.** The step lines were
pasted from the instrument; the run number was written from memory, in the same
sentence, having been read off a review comment about the *previous* commit. One
is now wrong and it is not the pasted one. **Take the identifier out of the same
output the lines came from** — `readStepsTimed.mjs` now prints `run_id` and
`head_sha` beside every step for that reason.

**And the mutation count is wrong in the same entry.** Item 4 says *"Seven
mutations run this range"* over a table with **eight** rows, and item 5 repeats
*seven*. The figure appears verbatim in an earlier entry for a different range,
which is where it came from — a number recalled rather than counted, which is
this journal's standing complaint about itself.

Two smaller corrections to that same table, both in the direction of
understating the result: *"each reddening its own case"* is not what it shows —
**two of the eight rows reddened two cases each**, which is stronger than the
sentence claims. The accurate summary is: eight mutations, six reddening exactly
one case and two reddening two.

**The audit was run VOLUNTARILY, before the gate fired.** The scope block quoted
at the top of this entry says so in its own words — *"Within one batch. An audit
is not yet owed. Fires at 10 commits (2 more)"* — but the entry does not, and
this journal is what anyone measuring audit cadence counts from. A range
containing a withdrawn requirement was worth auditing early; an entry that reads
as gate-driven when it was chosen makes the cadence look tighter than it is.

---

## 2026-08-24 — Stage audit: `71deb64..b0a1da4` — one paragraph corrected three times, each version weaker and truer

**Audited through `b0a1da4`.** Pasted from `npm run audit:scope`:

```
Unaudited range: 71deb64..HEAD

  commits: 9 (one batch is 9)
  files:   10 (one batch is 24)
  Within one batch. An audit is not yet owed.
  Fires at 10 commits (1 more) or 25 files (15 more).
```

0 proofs added, **3 modified**, 0 new source files and 3 changed. The range is
AAAA-21 to AAAA-27; **AAAA-28** was found by the reviewing seat against
`b0a1da4` and is fixed in the commit after this one.

### The range's headline

**The same paragraph in `sweepScope.mjs` was rewritten three times in nine
commits, and every version was believed when it was written.** The 27 deletions
the range diff hides in that file are almost entirely those rewrites:

| version | what it claimed | how it died |
|---|---|---|
| before this range | wreckage comes from scripts that **complete** | measurement: the wreckage I could produce came from scripts that were **killed** |
| after the measurement | sequence **doubles** wall time; orphans accumulate | `proof:shim` measured 1.5s and 9.4s at the **same** position, so machine state was never isolated |
| after that | four **orphaned** node processes prove nothing kills a tree | their command lines: an MCP server with **living parents**, spawned by the editor |

Each correction was a narrowing, and that direction is the only reassuring thing
here. But the useful reading is the other one: **a correction is not a terminal
state.** Two of those three versions were written as the *result* of an audit
finding, reviewed, and passed — and were wrong. The range's own lesson is that
the paragraph a range has just corrected is among the likeliest places for the
next range's defect, which is this project's founding premise arriving one level
up: not in the proof written to close the defect, but in the **sentence**.

### 1. Root cause, or workaround?

**No check was loosened.** The three modified proofs are additive apart from
rewrites in place: `auditScope.proof.mjs` gained the within-budget fixture and
the arithmetic assertion, `checkLocal.proof.mjs` the per-script tree witness
case, `hookProbe.proof.mjs` the repair-before-measuring guard. Every deletion in
`sweepScope.mjs` is prose being corrected, listed above.

**Root cause, mechanism named:** AAAA-21 (a boundary-specific claim replaced by a
**distance**, which cannot be accidentally true at one point) · AAAA-22 (live
specs edited true rather than corrected underneath — the document-class rule
applied where I had applied the record rule) · AAAA-25 (one slot is destroyed by
the act of investigating it; the filename now carries the run's state).

**Explicitly NOT a fix, and it says so: AAAA-23's run log.** It is a **capture
mechanism**. The 0.0s mechanism remains unknown and the log does nothing about
it; what it changes is that the next occurrence keeps its own evidence, which the
founding one did not.

**Explicitly a rule and not a mechanism: AAAA-26.** B6's new sentence — *a label
carries the command that established it* — cannot fire on its own. Its whole
claim to usefulness is that a **missing citation is visible in review** where *be
careful* is not. Recording it as a mechanism would be the overstatement the rule
itself is about.

**No override was added anywhere in the range.**

### 2. Verified against the easy shape only?

The hard shapes this range actually exercised, each of which had been the
unexercised side of a branch: a run **killed mid-flight** with SIGKILL · a run
whose **first** script times out · a **clone** as root · a **within-budget**
range for a report whose only fixture was over budget.

The last two both found defects on their first use, which is the argument for
building the awkward fixture rather than reasoning about the branch.

### 3. Would CI have caught it?

**No, and structurally so: none of this range runs in CI.** `checkLocal.mjs` is a
local harness, the run log is written under a gitignored `.cache/`, and the
clone route is a thing a person types. Every defect here was found by running
something by hand or by the reviewing seat reading a file. That is worth stating
plainly rather than leaving as an absence — this is the part of the repository
where the board is not the mechanism.

**CORRECTED 2026-08-24 (finding AAAA-29). The paragraph above is wrong, and
wrong in the direction that makes coverage look absent.** It stands because this
is a record; what follows is what is true.

Three of the range's ten files are proofs and **all three run in CI**,
unconditionally, on both matrix legs: `scripts/proofs/hookProbe.proof.mjs`
(`guards.yml:214`), `scripts/proofs/auditScope.proof.mjs` (`:270`),
`scripts/proofs/checkLocal.proof.mjs` (`:304`). That file contains no `if:` at
all, so no step in it can be skipped, and its matrix is `[windows-latest,
ubuntu-latest]`. Read from the **run** rather than from the file — Guards run
318 for `247a307`, both legs `success`:

```
Secret scan and file policy (ubuntu-latest) :: success
  success  2026-08-24T12:59:15Z  Prove the tool-use guard gate cannot be claimed unproven
  success  2026-08-24T12:59:24Z  Prove the stage-audit watermark gate can fail
  success  2026-08-24T12:59:30Z  Prove the local check sweep can report a failure at all

Secret scan and file policy (windows-latest) :: success
  success  2026-08-24T13:01:56Z  Prove the tool-use guard gate cannot be claimed unproven
  success  2026-08-24T13:02:40Z  Prove the stage-audit watermark gate can fail
  success  2026-08-24T13:02:49Z  Prove the local check sweep can report a failure at all
```

> **Correction, 2026-08-27 (UUUU-1).** The paragraph below stands as what was
> true then. Since it was written, the refusal it describes has been lifted and
> its module **removed**: a spawn that never became a process is now classified
> as its own state, reported as `DID NOT START` rather than as a failure, and
> stops the run — asserted against an injected non-start with the control the
> other way. `npm run local` runs the scanning roster instead of printing it.

`checkLocal.proof.mjs` imports `scripts/lib/sweepScope.mjs` (since **removed**,
per the correction above) and asserts on the
refusal's text directly, and it **spawns the real harness** against fixture
repositories it builds in a temporary directory. So `sweepScope.mjs`'s
judgement, the whole refusal message, `scripts/audit/scope.mjs` and
`scripts/lib/hookProbe.mjs` are on the board on two platforms every push —
including the AAAA-28 case added at `247a307`, which is the case that would have
caught the defect this range's successor found.

**What is genuinely off the board is narrower, and is worth stating as itself:**
the run-log **files**. The proof reads back `.cache/checkLocal-durations.json`
and nothing under `.cache/checkLocal-runs/`, so the rotation, the `-running`
name surviving a kill, the row sealed on a timeout and the clone route are
exercised by hand or not at all.

**The difference is not pedantry.** *The board is not the mechanism here* tells
the next reader that a case in this area buys nothing in CI, and therefore not
to write one — while the case that caught AAAA-28 runs on two machines every
push. The correct answer to a defect in this area is **write the case**, not
review harder.

**How the wrong answer was reached, which is the transferable part:** item 3 was
answered from the *subject* of the range — a local harness, a gitignored cache,
a route a person types — rather than from the workflow or from a run. This
journal already records the 138-commit precedent in which both seats answered
item 3 "from the workflow file rather than from a run". This is one step worse:
from neither.

**And the answer is computable, which is the remedy rather than the scolding.**
`scripts/lib/affectedProofs.mjs` already derives the proofs a changed set
reaches and carries its own positive control. Fed this range's changed paths it
names `proof:hookprobe`, `proof:checklocal` and `proof:auditscope`, each of
which resolves to `guards.yml` by path. Item 3 has an instrument; run it instead
of recalling what the range was about.

### 4. Are the proofs non-vacuous?

**Three mutations run, each reddening exactly its own case:** renaming a
`registerRule` name reddens the rule-roster anchor in both directions ·
disabling the per-script tree witness reddens the new case while `/THE TREE
MOVED/` still matches, which is why it is a separate case · changing `fileLimit`
to `BATCH.files` reddens the arithmetic trigger assertion.

**THREE FIXTURES THE DEFECT ALSO PRODUCES, IN THREE CONSECUTIVE COMMITS**, all in
cases written to enforce the specificity rule: a header assertion matching
`/one batch/`, which the counts' own parenthetical satisfies · a trigger
assertion matching `\d+`, which any number satisfies · that same assertion
guarded by an escape clause its over-budget fixture never got past. The pattern
is the finding: **a case about specificity keeps checking that specificity is
PRESENT rather than CORRECT**, because presence survives every mutation that
changes a value.

### 5. Executed, or asserted?

**Executed:** SIGKILL 45s into a permitted sweep, leaving
`2026-08-24T11-59-14-19788-running.json` with 11 rows, last `check:advisories` ·
`node scripts/checkLocal.mjs --root <clone> --only proof:`, which selected **64
scripts and began executing** rather than refusing · a killed `proof:advisories`
writing `signal: SIGTERM, bytes: 0` after the timeout row was added ·
`git merge-base --is-ancestor f7dc5fb 7b7824e` · `Get-CimInstance Win32_Process`
for the command lines and parents · the board at `b0a1da4`.

**Asserted and unfinished, named in the row and the refusal:** the 0.0s
mechanism. Nothing in this range explains it.

### 6. Did architecture change before the feature, or underneath it?

Neither. Everything registered into existing seams.

### 7. Do the documents still match the code?

**AAAA-28, found by the reviewing seat and not by me.** `sweepScope.mjs` names
`.cache/checkLocal-lastrun.json` — a file deleted one commit earlier *for being
the defect* — ten lines above the correct `checkLocal-runs/` in the same string.
Item 7's compound shape exactly: the clause written this commit is right, the
clause beside it is a commit old, and nothing about reading it feels wrong
because the part you check is the part that is still true. It tells an
investigator that the rows they came for are in the single slot AAAA-25 removed.

No check can see it: the only case on that message asserts two substrings, which
also makes the module header's *"the proof asserts the text a reader will
actually meet"* broader than the case backing it — an over-claim in the file that
gained the over-claim rule.

**And one I introduced myself, found while reading the row for this audit.** The
AAAA-25 edit to `docs/FEATURES.md` row 319 spliced into the middle of an existing
sentence and orphaned its tail, leaving *"…that copying step is exactly what was
missed for the 35-at-0.0s pass, and Rule 0 permits a workaround only where the
root cause is proven to lie outside this repository."* — a non-sequitur joining
two unrelated clauses. A long row edited by substring is a row where the
surrounding sentence is invisible at the moment of editing.

Both are repaired in the AAAA-28 commit, which is also the commit the gate forced
this audit ahead of.

---

## 2026-08-24 — Stage audit: `6c2017c..71deb64` — a figure composed instead of read, twice, in the direction that makes the gate look breached

**Audited through `71deb64`.** Quoted verbatim from `npm run audit:scope` rather
than restated, which is this range's finding:

```
Unaudited range: 6c2017c..HEAD

  commits: 7 (one batch is 9)
  files:   24 (one batch is 24)

  Within one batch. An audit is not yet owed.
```

1 proof added, **6 modified**, 1 new source file and 8 changed. The range closes
AAAA-14 through AAAA-19 and adds **AAAA-20**.

### The range's headline

**A number I reported was wrong on both axes, and the correction round caught
one.** I wrote *8 commits / 26 files … the file axis is past a batch*. The
instrument printed 7, 24, and *within one batch* — the opposite conclusion, in
words, at the end of its own output. The reviewing seat corrected the file count
and carried my commit count forward unchanged, because it too was reasoning about
my figures rather than reading the instrument's.

> **Correction, 2026-08-24 — the last sentence above is false about what the
> review round did, and it is a claim about evidence, so it is corrected here
> rather than edited away.** The reviewing seat *did* run the instrument and
> quoted its block, and that block carried `commits: 7`. Its prose then named
> only the file axis because that was the half that changed the conclusion — not
> because it was reasoning from my figures. I inferred a mechanism from an
> omission and wrote the inference down as an observation, which is this range's
> own finding pointed at the wrong party. The lesson the entry draws is unchanged
> and rests on my own error alone: I reported two numbers the instrument never
> printed.

That is the second time in two ranges, both in the same direction — the one that
makes the gate look breached. The first was 25 against a measured 24, and I wrote
then that it was the correction to sit with. Sitting with it did nothing, which is
the finding: **this is the class where a resolution to be careful has already been
tried and has already failed.**

**The remedy is not accuracy, it is provenance: paste the instrument's line.** A
pasted line cannot be off by two and it carries the verdict sentence with it, so
the conclusion travels with the numbers instead of being re-derived beside them.
Same shape as *count from the transcript*, which this repository wrote down after
being wrong about the denial count by an order of magnitude.

### 1. Root cause, or workaround?

**No check was loosened, and the modified-proofs column is why that is a
statement rather than a hope.** Six proofs moved. Two carried deletions that read
like removed coverage and are not:

- `hookIntegrity.proof.mjs` deleted *"a project settings file registering NO
  PreToolUse hook is refused"* — and the same label is at line 184 today, rewritten
  in place with a new sibling asserting the refusal now names the **claim**. The
  literal it used to test was replaced by the claim-derived requirement, and the
  case follows the mechanism rather than dying with it.
- `documentRuleScope.proof.mjs` deleted `cases: 7`. That is the roster count
  rising to 8 for `EXPECTED_RULES`, which is AAAA-16's anchor arriving.

**Every fix in the range is a root-cause fix** and each names its mechanism:
AAAA-15 made the documents the anchor; AAAA-16b pinned the rule set in a file the
shrinker must edit separately; AAAA-17 widened the mechanism key to *script@event*
because that pair is what registers; AAAA-16 deleted a failed disclaimer rather
than keeping it beside its replacement; the `prePush` repair made a provisioning
fact **unverifiable** rather than deleting the case.

**No override was added.** The one deliberate weakening in the previous range
(`complainsAboutTheGate`) is not repeated here.

### 2. Verified against the easy shape only?

Hard shapes exercised this range, each of which had been the blind side of a
branch: two hooks rather than one · one script on two events · a guard registered
on the **wrong event** · an unparseable settings file · a claimed hook that is not
registered · **a fresh clone with nothing installed**.

That last one is the range's other real find and it is recorded below.

### 3. Would CI have caught it?

**It did, on the first run, which is the whole point of what was wired.**
`prePush.proof.mjs` had never executed outside a developer machine — it is chained
inside `proof:guards` and the workflow step named three of its four scripts, never
the fourth, since the step was written. Wiring it in reddened `main` immediately.

Asked the other way round: **this machine could not have seen it.**
`core.hooksPath` is set by `prepare`; the Guards job runs no `npm ci`; the proof
read the key with `execFileSync`, an unset key exits 1 and `execFileSync` throws,
so it did not fail one case — it killed the file before any case ran. Every
previous run had been on a machine where `prepare` had run.

### 4. Are the proofs non-vacuous?

**Mutation-tested, this turn:** renaming one `registerRule` name reddens
`documentRuleScope.proof.mjs` and the message names both directions — *NO LONGER
REGISTERED: …* and *REGISTERED BUT NOT NAMED HERE: …*. The anchor separates.

**Resolution-tested before it measured anything:** `affectedProofs` was fed the
exact change that reddened `main` at `3a903fd` and named three proofs, none of
them `proof:guards` — the one that had failed. `proof:guards` chains four scripts
and `proofScripts` took the first, so `preCommit.proof.mjs` sat in **no entry's
path set at all**. The report read identically either way. Widening it found that
`prePush.proof.mjs` ran in no job at all, which is section 3 above.

**Both branches of a provisioning decision now have cases on every runner.** The
unset side is unreachable on any machine where `prepare` has run — which is every
machine that file had ever run on — so the decision was separated from the ambient
answer. The distinction it protects is the whole defect in miniature: an unset key
must be `null`, never the empty string, because an empty string compares unequal
to `.githooks` and reports a **failure** where the honest answer is *nobody
installed this checkout*.

### AAAA-20 — a report that restates an instrument is a second opinion about it

The class is B3a's, arriving in prose rather than in code: the instrument computed
the number and the conclusion, and the report contained a *second* computation of
both. As always, **the finding is the second opinion, not the wrong one** —
patching the figure would have left the next report free to compose a third, which
is exactly what happened between the two ranges.

The trigger is written down so nobody carries it: **the audit fires on the next
commit touching a file not already among the 24, or at 10 commits, whichever comes
first.** A commit touching only files already in the range leaves it at one batch.
Read from `auditWatermark.mjs`, where both comparisons are strictly greater
against `BATCH = { commits: 9, files: 24 }` — not inferred from the printed line.

**And the ordering of this audit was decided by the mechanism, not by me.**
`scripts/audit/scope.mjs` is not among the 24, so the change that makes its verdict
quotable would have taken the range to 25 files and the pre-commit gate blocks
exactly that. The audit had to come first. A gate that decides the order of work is
worth more than one that merely reports.

### 5. Executed, or asserted?

**Executed:** the mutation of the rule roster · the resolution test against
`3a903fd` · `prePush.proof.mjs` in both worlds, 17 cases provisioned and 16 plus an
`UNVERIFIABLE` line in a fresh clone · the reporter's live-ness line, recorded as
**invocation** and not as detection · `git diff --name-only 6c2017c..HEAD | grep -c
.` returning 24 · the strictly-greater comparisons in `auditWatermark.mjs` · the
board at `71deb64`.

**Asserted, and therefore unfinished:** that the two claim documents name hook
scripts by full path *only* for tool-use hooks. That was measured once, on
2026-08-24, and is now a convention the check pins going forward rather than a law
about the documents. The disposition is written into `claimedHooks`' header.

### 6. Did architecture change before the feature, or underneath it?

Neither. Everything registered into existing seams — the verdict machinery, the
document-rule registry, the proof roster, the pass roster.

### 7. Do the documents still match the code?

`CLAUDE.md` line 457 already carries the new `blockEscapeResolvingWrites@PreToolUse`
key, so AAAA-17's rename did not leave a stale command behind.

**One correction made in this commit's own range-mate**, and it is item 7 applied
to text written last round: item 4c's table of three instances stated what each
roster *derived from* with no sentence saying all three had been fixed in the same
range. The remedy line said *"the remedy in each case **is** an anchor"*, which
reads as prescription rather than as record. A reader arriving at that table would
have taken three closed defects for three open ones. Corrected to name what each
one got, and to say the table is kept for the **shape**, which has recurred in a
different form every time.

---

## 2026-08-24 — Stage audit: `51d3da8..6c2017c` — three rosters that cannot notice their own source shrinking

**Audited through `6c2017c`.** 8 commits, 24 files, **3 proofs added, 1
modified**, 3 new source files and 8 changed — from `npm run audit:scope`.
Exactly one batch on both axes.

The range is AAAA-8's correction through the hook-probe reshape. Reviewer
findings **AAAA-12** to **AAAA-15**; my own, from reading the range's diffs,
**AAAA-16** to **AAAA-19**.

### The range's headline

**Three separate mechanisms in this repository now derive a requirement from the
very set the requirement is supposed to protect, and all three go quiet when
that set shrinks.** They were found from three directions within one range — one
by the reviewing seat, one by reading a diff, one by executing a shape nobody
had built a fixture for — and none of them is visible from inside the file that
has it.

That is the same premise as previous ranges arriving at a new level. The earlier
statement was *defects arrive in the instruments written to close the previous
defect*. This range says: **a derivation is not automatically stronger than the
literal it replaced.** Replacing a hand-kept list with a derivation removes one
failure mode — the list going stale — and silently adds another, because a count
computed from a list cannot disagree with that list. Which of the two you want
depends on whether the danger is the set growing or the set shrinking, and that
question was asked in none of the three cases.

### 1. Root cause, or workaround?

**AAAA-12 is a root-cause correction and the root was a NAME.** The FEATURES row
said the registering commit could not come from an older session, reasoning that
a PostToolUse reporter cannot produce a `denied`, so its evidence must be
`executed`-shaped, so the age gate applies. Every step follows from the outcome's
*name*. The property the gate is keyed on is whether an observation is
**self-certifying** — nothing that failed to load a hook can produce that hook's
own output — and a report has that property exactly as a denial does. The
vocabulary now says the property (`fired` / `silent` / `unobserved`) rather than
naming the tool call's fate, so the reasoning cannot be run again.

The correction mattered in the direction that produces a false green: following
the old row, someone registers the reporter, watches the escape probe pass, and
reads the gate as satisfied while the reporter has never fired anywhere.

**AAAA-13 is a root-cause fix to a DATA SHAPE, and that is why no review caught
it.** A single-outcome record was correct while one hook was registered and would
have become a false certificate for the second, with no sentence anywhere
overstating anything. There was nothing for a reader to disagree with.

**No override was added anywhere in the range.**

**One check was loosened, deliberately, and item 2a says to state it.**
`complainsAboutTheGate` in `hookProbe.proof.mjs` narrowed from
`/observed to fire|unrecorded/` to `/observed to fire/`. The effect is not
uniform: it makes the induced-failure control *stricter* (the output must now
carry the gate's own words, not merely the word `unrecorded`) and the quiet case
*laxer*. It is necessary because the new roster half can also print
`unrecorded`, and if the two halves are not distinguishable neither control
separates. Recorded because a narrowing that is right is indistinguishable in a
diff from one that is convenient.

### 2. Verified against the easy shape only?

The hard shape here was **two hooks instead of one**, and it paid immediately:
`makeRoot()` copied the settings file whole but wrote a single entry, so the case
asserting *nothing is missing* went red the moment the reporter was registered.
It was true only because one hook existed — **a fixture pinned to a count nobody
had written down.** Both halves are derived from the resolver now.

The shape I did **not** test is AAAA-17 below, and it is the same axis one step
further: not two hooks, but **one hook on two events**.

### 3. Would CI have caught it?

**No, for AAAA-15, AAAA-16 and AAAA-18** — all three are checks that do not
exist, and a check that does not exist is green everywhere. AAAA-17 likewise: no
fixture reached the shape, so nothing could have gone red.

### AAAA-16 — a roster derived from the set it governs cannot notice that set shrinking

Two instances in this range, found from opposite directions and neither visible
from inside its own file.

**(a) The hook presence requirement, from the reviewing seat (AAAA-15).**
`hookIntegrity.mjs` refuses when the project settings register no `PreToolUse`
hook, naming `blockEscapeResolvingWrites.mjs` in a literal. Nothing makes the
same demand of the reporter, and the per-hook coverage requirement introduced
this range is derived from the settings file itself. So unregistering the
reporter **and** deleting its entry — one plausible edit, "remove the reporter" —
shrinks the roster by one, removes its own requirement with it, leaves
`hookIntegrity` satisfied by the surviving `PreToolUse` entry, and every check
goes green. Two documents would still assert the reporter is registered.

**(b) The document-rule roster, from reading this range's own diff.** AAAA-9
converted nine inline blocks to `registerRule` and replaced
`createRoster(failures, { cases: 9 })` with `cases: chosen.length`. The literal
was an **independent** number: delete a rule and 9 no longer matches. The
derivation is computed from the same array being iterated, so it agrees with any
size. `documentRuleScope.proof.mjs` does not close the gap — it asserts a
partition identity that holds for any N and two `length > 0` floors. **Deleting a
whole document rule is silent today, and was caught before AAAA-9.**

The remedy is the same in both and it already exists in this range as a pattern:
`registeredHooks` refuses unless it locates an anchor it is told must be there.
**An anchor is an independent claim the shrinker has to touch separately.** A
derivation without one is a roster that shrinks quietly; a literal without one is
a roster that goes stale loudly. Loud staleness is the better failure, which is
why the literal was not simply wrong.

### AAAA-17 — the mechanism key is coarser than the registration it identifies

**Executed, not reasoned about.** One script registered on two events produces
two roster rows carrying **one name**:

```
rows: blockEscapeResolvingWrites@PreToolUse blockEscapeResolvingWrites@PostToolUse
distinct names: 1
missing: []
```

So the second registration inherits the first's certificate, and the entry's
`event` field says `PreToolUse` while vouching for both. The mechanism key is
derived from the script's filename; the thing actually registered is a *(script,
event)* pair. **A key coarser than the thing it identifies is one certificate for
two mechanisms — which is AAAA-13's finding, recurring inside AAAA-13's own fix,
in the same commit.**

It is the milder version of the class: the hook table is one file, so a firing on
either event does establish that the script is reachable. What it does not
establish is that the second registration is well formed — its event, its
matcher, the tool it claims to cover. The fix is to key on script *and* event, or
to refuse a duplicate name outright.

### AAAA-18 — the untracked half is a correct checker nobody has proven is called

`6c2017c` added a third state to `probeCoverage` — hooks registered by the
untracked `.claude/settings.local.json`, in force and unvouchable — and
`documentConsistency` refuses on it. The `missing` half of that rule is
mutation-tested against `check:docs`: emptying it reddens exactly one control.
**The `untracked` half is asserted only at the `probeCoverage` level.** Nothing
proves the document check consumes it, which is the display-only sin the
neighbouring control exists to prevent, one commit old and mine.

Found by asking which branches no fixture reached, rather than by mutating the
branches the suite already exercises.

The control is awkward on purpose and that is worth writing down: it has to write
a real `.claude/settings.local.json` into this repository for the duration of the
run, and a hook registered there could be picked up by a live session. The way to
make it safe is for the probe's command to name a script that is already
registered and harmless, so that a session which does load it does exactly what
it would have done anyway.

### AAAA-19 — "registered" and "in force" are two questions, and the record answers only the first

`registeredHooks` reports what the settings file registers. A settings file with
`"disableAllHooks": true` still lists its hooks, so the roster reports them and
the record's `fired` and `unobserved` entries read as coverage while nothing
runs. `hookIntegrity.mjs` does check that key — separately, at commit time, for
the project scope.

Not a defect today, because the check exists. Recorded because it is two modules
holding two opinions about whether a hook runs, which is B3a's shape, and because
the roster's header currently invites the stronger reading. The narrow fix is one
sentence; the wider one is for `registeredHooks` to own the whole question.

### 4. Are the proofs non-vacuous?

`hookProbe.proof.mjs` went from 16 cases to 34. Every deleted case has a renamed
counterpart in the pass list; the only semantic deletion is the predicate
narrowing recorded above.

**Mutation-tested:** emptying `coverage.missing` in `documentConsistency` reddens
exactly the roster control and nothing else, so it separates.

**One case was repaired for a reason worth carrying.** *The recorder refuses when
it cannot establish the session start* asserted on **two alternative refusals** —
`/cannot determine|not tracked by git/` — and its throwaway tree had no commits,
so the recorder returned the git refusal first and the case was satisfied by it
on every run. It never once reached the refusal it is named for. This is item
4b's shape arriving inside an assertion: two ways to be reassured, and the
instrument cannot tell you which one it got. The fixture commits now, and the
assertion names one refusal.

**A branch nothing reaches, kept deliberately.** `mechanismName`'s non-`.mjs`
return is unreachable, because the command pattern that feeds it requires `.mjs`.
JJJ-1's class: kept, because the fact it encodes is true and it becomes live the
day the pattern widens.

### 5. Executed, or asserted?

**Executed:** the escape guard's denial at 2026-08-23T22:28Z, run verbatim in
this session · `od -c` on a deliberate attempt to author `0x01` and `0x00` in a
`Write` payload, which produced two ordinary spaces · the two-event shape in
AAAA-17 · the roster mutation · 34 hook-probe cases, 267 escape-guard cases, 13
local checks, `tsc` and `eslint` · the board at `6c2017c`.

**Asserted, and therefore unfinished:** that no settings layer outside this
repository registers hooks on a CI runner. That is a **declared scope**, not a
measurement — the user-level and enterprise layers are out of reach and a check
that fired on every contributor's personal configuration is one that gets turned
off. It is written into the resolver's header rather than left implied.

### 6. Did architecture change before the feature, or underneath it?

Neither: everything in this range registered into existing seams — the verdict
machinery, the document-rule registry, the pass roster.

### 7. Do the documents still match the code?

`CLAUDE.md`, `docs/FEATURES.md` rows 317 and 318 and the `guards.yml` comment
were all corrected in the commits that made them false. The session-age
relationship was swept across every tracked statement of it, per NNN-4's
compensation; only the workflow comment was stale and it was fixed in the same
commit.

**One count in my own report was recalled rather than measured**, and the
reviewing seat caught it: I wrote *25 files* by incrementing the previous run's
24 by hand instead of re-running the instrument. `git diff --name-only` says 24.
The conclusion was unaffected — the next new file forces the audit either way —
but 25 against a 24 threshold would have meant the gate was already breached and
the board was lying about it. That is the same failure as the denial count this
project already recorded: **a number carried in the head, in the direction that
makes the mechanism look wrong.** The instrument was one command away.

### AAAA-14 — the reporter's live-ness is unfalsifiable, and the disposition is to fix it

**Accepted.** *Closes the first time the reporter catches one* makes the only
certifying event the defect recurring, and this repository has already recorded
what that costs: `engine-host-containment` sat green watching a symbol shipped
code could never name. A gate that can stay open for the life of the project
while reading as pending is a claim whose expiry never fires.

The separation is right. *Does the harness invoke it* is certifiable today and is
what the record is actually about; *does it detect and repair correctly* is
already proven by the module's own cases with numerically-built fixtures. The
escape guard's probe is the precedent — `console.log('hook test')` is harmless in
effect while being the banned shape — and the reporter has no benign input of
that kind, because its trigger is a byte neither seat can author. A reserved
probe path supplies one on a different axis.

Building it next range, with both conditions binding: **one scan, one repair
text, one writer** — the path decides only whether a live-ness line is emitted,
never how the scan works — and **the entry says what it certifies**, invocation
rather than detection, in the record itself rather than in prose beside it. A
`fired` that silently covered detection would be this range's own finding
recurring one layer down, which by now should be the default expectation rather
than a surprise.

---

## 2026-08-23 — Stage audit: `52edb0f..51d3da8` — four of my own errors, two of them mechanised and neither of them fixed

**Audited through `51d3da8`.** 9 commits, 21 files, **2 proofs added, 2
modified**, 3 new source files and **4 changed** — from `npm run audit:scope`.

The range is AAAA-1 to AAAA-7 and the (b) memory probe. Finding **AAAA-8**.

### The range's headline

**Four defects in this range were mine and none of them were in the code under
test.** A hand-built `file://` guard, a piped exit code, an API budget spent on
measurement, and one `|` character in a table cell. Three of the four were
mechanised in the same range; the fourth produced AAAA-7.

That is not a change of subject from the usual headline — it is the same one at a
different level. This project's record says defects arrive in the instruments
written to close the previous defect; this range says they also arrive in **how
the instruments are driven**, which nothing was watching.

### 1. Root cause, or workaround?

**AAAA-2 and AAAA-3 are mechanised, and calling them FIXED would be wrong.**

The piped exit code and the spent API quota were both produced by the same root
cause, and it is one this repository has documented seven times: **a rule that
has to be recalled at the moment a command is composed.** *Never pipe away an
exit code* was already written down — in this project's own memory — and it did
not reach me. Neither did *measurement must not starve verification*, which
nobody had written down at all.

The mechanisms replace the recall. They do not repair the habit, and there is no
repair for the habit; that is the whole argument the escape hook is built on. So
these are recorded as **the rule being replaced by a mechanism**, not as the
defect being fixed — because a range that reports two fixes here would be
reporting the count as stopping, and the count is not going to stop.

**Root cause, mechanism named:** the `file://` main guard — `pathToFileURL` is
the authority and `isMain` is the named thing that ends the re-derivation.

**Not a fix at all, correctly: the `|` in the FEATURES cell.** The character was
a typo. **The finding is AAAA-7**, one level up: six local checks read the INDEX,
so running them before `git add` inspects the previous content and passes. Fixing
the character and stopping would have left that untouched.

**No check was loosened.** Both modified proofs are strictly additive — the only
deletions in either are two roster counts rising and one unused import removed.

**No override was added.** The sweep refusal, the budget reserve and the
mandatory pin all deliberately have none.

### AAAA-8 — the client/server reading is under-determined, and I wrote it into four places

The AppContainer process-creation split was recorded as **client versus server**
on three points: Windows 11 client allows, Server 2025 refuses, Server 2022
refuses.

**Two of those points are GitHub-hosted CI images and the third is this
machine.** So the single client point is confounded — it is not only a client
SKU, it is also *not a CI image*: a different install, different local policy,
different security software, a different AppContainer profile history. **Client
versus server and this-machine versus a-CI-image survive all three readings
equally**, and the recorded claim picks one without saying so.

It does not touch the design. Decision 8 rests on *the container cannot be relied
on for (b)*, which every point supports and which a confounded split supports
just as well. It touches the **prediction**, which was recorded as though a
routine image bump would settle it.

**And the correction has a correction of its own, which is why it was checked
rather than accepted.** The reviewing seat's ruling said the discriminating test
is unreachable on GitHub-hosted infrastructure because the Windows runners are
Server SKUs only. Read from `actions/runner-images` this afternoon, that is not
so: **`windows-11-arm` is Windows 11 — a client SKU — and it is
GitHub-hosted.** (The same table no longer lists a 2019 image at all.)

So the test IS reachable, and the honest statement is about its price rather than
its impossibility: `windows-11-arm` is **arm64**, so running it swaps the
image-provenance confounder for an architecture one and costs an arm64 MuPDF
build and an arm64 Electron. A prediction that is expensive is a different thing
from one that can never fire, and only one of them is safe to leave unfired.

### 2. Verified against the easy shape only?

**The main-guard scan was, and its own resolution test caught it.** Written to
match any mention of `import.meta.url`, it reported 38 files — nearly all of them
`fileURLToPath(import.meta.url)` locating a module's own directory, which is
unrelated and correct. Narrowed to a comparison **before it measured anything**.
A scan that cries wolf is a scan someone turns off.

**`githubFetch`'s missing-header guard was, and its own proof caught it on the
first run.** It tested `Number.isFinite` of the *converted* value, and
`Number(null)` is `0`, which is finite. An absent header would have been recorded
as a measured zero — refusing every bulk caller for the rest of the run. A
missing measurement presented as a measured emergency, which is the reassuring
answer's mirror image and just as wrong.

### 2a. Has a change to HOW something is proven moved the coverage?

**Gains, all stated:** the `either` row asserts both halves now rather than one,
so a pin is a hard failure; (b) memory moved from *no probe* to *measured*; every
DIFFERS row is asserted on a second Windows image.

**One reduction, deliberate and stated at the point of change:** the (b) memory
differential does **not** run against §9.17's 3 GB cap. A differential needs the
uncontained side to succeed, and committing past 3 GB on a runner fails for
memory pressure as readily as for the job — the instrument would report the
runner's RAM as this project's defect. The figure is a derivation and
`proof:composition` owns it. Written into the instrument's own output, because a
scope a reader has to infer is a scope nobody applies.

### 3. Would CI have caught it, and is there a defect this machine cannot see?

**The `|` is the first question answering yes, loudly, and that is the problem.**
CI caught it because CI is the only thing that could: `check:docs` is in Guards
and not in pre-commit, and the local run I made before committing read the old
index. So the guard worked and the latency was the whole defect — B10 makes a
public commit permanent.

**The second question has a new answer this range: `--expect-lowbox-spawn`.** The
pin makes a per-image fact a hard failure, so a difference this machine cannot
see now reddens the board rather than printing into a log nobody reads.

### 4. Are the proofs non-vacuous?

Mutation-tested, each reddening a specific named case: setting the budget reserve
to zero reddens exactly the two refusal cases; blinding the creator derivation
reddens four and leaves the scan printing `all 0 file(s) creating a host name the
property`, which reads as coverage; forcing the unstaged list empty reddens only
the unstaged case; restoring the broken main guard reddens only the CLI case;
giving the memory cell the real 3 GB cap reddens only the memory differential.

**The best of them is the creator derivation**, because the pre-existing positive
control stayed GREEN while the new search was blind. *One control per search, not
one per instrument.*

**The CLI case is built the only way it can separate anything:** against a
fixture carrying a known violation, requiring exit 1 and the violation text. A
case that ran the CLI against this repository and expected exit 0 would be
satisfied by a scan that scanned nothing — AAAA-5 living inside AAAA-5's fix.

### 4a / 4b. Resolution tests and positive controls

All three new instruments were resolution-tested before they measured anything,
and two of them failed that test and were corrected first (§2 above). The memory
probe's resolution test is the mutation that gives its cell the real cap.

**The (b) memory probe took two constraints from the record rather than
rediscovering them.** It runs **last** and **releases**, because the retired
`hostFixture.mjs` committed 768 MB before its reads and the 235 MB document read
then failed with `ERR_MEMORY_ALLOCATION_FAILED` — which its table read as the
*filesystem* property being enforced. And it allocates Buffers rather than a
typed array, because an allocation V8 cannot satisfy aborts the process, and an
aborted host writes no report — arriving as *no report*, indistinguishable from a
host that never started.

### 5. Executed, or asserted?

**Executed:** every mutation above · the memory differential on this machine and
on both CI images · a NUL's three properties against a real file · both mints
against each other · the cold MuPDF build, confirmed twice by the builds this
range paid (340s and 294s against 336s predicted) · the Server 2022 pin, landed
as a probe and resolved on its first run · the runner-image table, read twice.

**Asserted:** that the DIFFERS rows' agreement across two images generalises to a
third · that `windows-2022` remains available — a retired label fails loudly,
which is why the literal is safe · that the escape hook's denial count is *about*
70, which is recalled and not parsed.

### 6. Did architecture change before the feature, or underneath it?

No architecture change. Every unit registered into an existing seam.

### 7. Do the documents still match the code?

Three live specs were corrected **in the same turn the run falsified them**: the
workflow comment that still said the pin might be wrong; the spike's header table
that said `build-dependent` where the reading had narrowed; the FEATURES row that
said AAAA-1's measurement was invisible to CI after it had stopped being. And the
`NOT MEASURED — the probe is missing` block was replaced rather than corrected
underneath, because it sat in the position a reader takes as the current state.

**AAAA-8 is item 7 arriving through a different door**, and it is worth naming as
its own shape: not a document falsified by a later commit, but **a claim recorded
more strongly than its evidence supported at the moment it was written**. No
sweep finds that, because nothing changed.

### What is owed out of this range

AAAA-8's correction · the scoped `check:docs` split · folding `NODE_INVOCATION`
with a corpus equivalence control · the PostToolUse hook.

---

## 2026-08-23 — Stage audit: `e84538d..52edb0f` — a scan CI could not tell had scanned nothing, and a correction that created the defect it was correcting

**Audited through `52edb0f`.** 9 commits, 17 files, **1 proof added, 2
modified**, 2 new source files and **4 changed** — from `npm run audit:scope`.

The range is YYY-1 to YYY-3, ZZZ-1 and ZZZ-2, XXX-1's discharge and XXX-3, the
NUL repair text, and AAAA-1 raised. Findings **AAAA-2** to **AAAA-5**.

### The range's headline

**Three of this range's defects were in the instruments written to close the
previous defect, and one of them was created by the correction of the one before
it.** That is the premise the range-scoped audit exists on, arriving four times
in nine commits.

The sharpest is ZZZ-1. YYY-2 closed a contract that lived in a comment; the
comment written to explain the fix stated the opposite of the measurement, in
the position a reader takes as the contract, and the true sentence sat eighteen
lines below the false one. Item 7's exact shape — **inside the fix for the
finding that item 7 had just been applied to.** NNN-4's sweep compensation was
run for YYY-1 and it worked; it does not prevent a *new* false statement being
written a commit later, and nothing does.

### 1. Root cause, or workaround?

Classified one at a time.

**Root cause, mechanism named:** YYY-1 and XXX-3 (a correction landed in one
place while the file that produced the reading kept the superseded claim) ·
YYY-2's brand (the contract was prose; it is a type where a type can reach) ·
ZZZ-1 (an ambiguous clause, split into two statements that cannot be read
against each other) · ZZZ-2 (a search with no complement) · the main-guard fix
(`pathToFileURL` is the resolver; a hand-built `file://` string is a second
opinion about URL encoding).

**NOT a root-cause fix, and it says so: YYY-3.** The sweep printed 35 failures
at 0.0s that each pass alone, and **the mechanism is not established.** The
broken mode is refused rather than repaired. That is the right direction — it
makes the mode unavailable with no override, and prints what would unblock it —
but it is a containment, and calling it a fix would be the workaround wearing a
fix's clothes that item 1 asks about. The unblocking condition is written into
the refusal: find the mechanism, then a job object per script.

**Partial, and named as such: the NUL repair text.** It reduces the cost of
diagnosing a control character; it does nothing about the window between the
write and `git add` in which the file is corrupt and the symptom is
unattributed. The PostToolUse hook is the owed mechanism and is a deliberate
unit, because registering it invalidates `docs/hook-probe.json` and reopens a
Stage 0 gate.

**No check was loosened anywhere in the range.** Both modified proofs are
strictly additive; the only deletion in either is `cases: 14` becoming
`cases: 19`, which is coverage arriving. Read rather than assumed — the
modified-proofs column is the one that cannot be skimmed.

**No override or escape hatch was added.** The sweep refusal deliberately has
none, on the escape hook's precedent.

### AAAA-5 — a scan wired into CI that had scanned nothing, and CI could not have told

`electronBinaryCallers.mjs`'s first run exited 0 having printed nothing: the
main guard compared `import.meta.url` against a hand-built `file://` string,
which on Windows is `file://C:/...` against `file:///C:/...` and never matches.

**The part that matters is not the bug, it is what would have caught it.**
Nothing would. The scan is invoked in Guards through `annotate.mjs`, which
re-emits output only on failure — so a scan whose main guard never fires exits 0
silently and the step is green. `check:proofcoverage` proves the proof is
*invoked*; nothing proves the scan *ran*. And its own proof calls `report()`
directly, so the CLI path — the one CI uses — is exercised by no case at all.

Caught by the absence of output, which is luck: the same defect in a scan whose
normal output is a single quiet line would not have been noticed.

This is *configured is not run* at the level of a check's entry point, and it
generalises past this file — every `check:*` in this repository is a module with
a main guard, and the guard is what CI actually enters. The remedy is one case
per scan that spawns it as a CLI and requires non-empty output beside exit 0.
Owed.

### 2. Verified against the easy shape only?

**The brand was, and the easy shape was the finding.** `Win32HostSurfaceConfig.
executablePath` is branded, and `npm run typecheck` stayed green — because both
callers import the surface through a computed `import()`, which types as `any`.
Had the measurement not been taken the range would have shipped a type that
protects only the callers that were already correct. The scan exists because of
what that measurement said.

**The board reader was not.** `npm run board` had only ever been run with a
healthy API quota. With the quota exhausted it polled 40 times against HTTP 403
and reported *"that is a timeout, not a verdict"* — correctly, and returning 2.
The hard shape appeared and I misread it, which is AAAA-2 and AAAA-3 below.

### 2a. Has a change to HOW something is proven moved the coverage?

**Two reductions, both deliberate, both stated at the point of change.**

`npm run local` can no longer sweep the proof half at all. That is a capability
this tool had and has lost, and the argument is that what it produced was 35
invented failures with a note attached — but a reduction is a reduction and it is
recorded as one.

The `either` row's contained outcome has **no recorder** (AAAA-1). It was always
printed-for-a-reader, and CI has no reader; the row that exists *because* the
fact varies by Windows build reports that variation where nobody outside the
organisation can look. Raised in-range, ruled, and being closed by pinning the
expectation per image rather than by widening the annotation wrapper.

**One gain, and it is the direction that goes unrecorded:** the second Windows
image asserts every DIFFERS row on Server 2022 as well as Server 2025.

### 3. Would CI have caught it, and is there a defect this machine cannot see?

**AAAA-5 is the first question answering no**, and it is worse than a gap in
coverage: the check was green *because* it had scanned nothing.

**The cold-build figure is the second question inverted.** `~10 minutes` had sat
in `ci.yml` since the cache step was written and XXX-1's whole decision turned on
it. Measured from the Actions API it is **336s**, and the two cold builds this
range then paid confirmed it — 340s and 294s. A number this machine could never
have produced, carried as fact for six days, and nearly used to reject the job.

### 4. Are the proofs non-vacuous?

Mutation-tested, each reddening a specific named case: widening the sweep
boundary from one proof to two reddens exactly the refusal case; removing the
fixture-root exemption reddens nine, because every earlier case in that file
builds a fixture declaring several proofs; blinding the assignment pattern
reddens four including both controls; blinding the creator derivation reddens
four and leaves the scan printing `all 0 file(s) creating a host name the
property`, which reads as coverage.

**The last one is the range's best argument for a second control.** ZZZ-2's
creator derivation is a second search inside an instrument that already had a
positive control, and the existing control stayed green while the new search was
blind. *One control per search, not one per instrument.*

**The end-to-end sweep-refusal case carries its own vacuity guard**, because the
obvious assertion is satisfiable by the defect: a harness that refused only
*after* sweeping would produce exit 78 while still costing twenty minutes and
inventing the failures. The case also requires that nothing was executed.

### 4a / 4b. Resolution tests and positive controls

Both new instruments were resolution-tested before they measured anything:
`sweepScope.mjs` at the boundary that decides it (0, 1 and 2 proofs, plus a
fixture root), `electronBinaryCallers.mjs` against a fixture carrying the bad and
the good shape side by side so *reports everything* cannot pass.

Both carry positive controls in the instrument, not only in the proof, and one
of them refuses when blinded. The empty-walk case throws rather than reporting a
clean tree.

**And 4b arrived a third time, in a helper written this range.** The first
attempt to read the cold-build figure returned nothing at all — not an absence,
an HTTP 403. It was checked instead of accepted, which is the only reason the
number exists. The scratch board helpers have no positive control of any kind,
and that is the class AAAA-3 closes.

### AAAA-2 — the piped exit code

`npm run board -- <sha> | tail -4` reports the exit code of `tail`. The board
returned 2 — *no verdict* — and the wrapper printed `exited with code 0`, and I
came within one step of filing a defect against `board.mjs`, which is correct.

The rule *never pipe away an exit code* is already written down, in this
project's own memory, and it did not reach the moment the command was composed —
which is the escape hook's argument verbatim. **The remedy is not to remember
it.** The reason for the pipe is that the output is long: forty poll lines to
reach one verdict. Make the board print short by default, detail behind a flag,
and there is nothing to pipe. Ruled; owed.

### AAAA-3 — one resolver for the API budget

The unauthenticated GitHub quota is 60 requests an hour and shared by every
helper. Walking 50 runs to find the cold-build figure spent it, and the board —
the caller that must never be starved — had nothing left. **Measurement starved
verification**, and the ordering was accidental rather than chosen.

Two scratch helpers make unbounded per-run requests today, which means the next
one will too. One fetch wrapper reading `x-ratelimit-remaining` and refusing
below a reserve puts the class behind a single door and makes the priority
explicit. Ruled; owed.

### 5. Executed, or asserted?

**Executed:** the mint in both parents, twice, including the re-measurement that
corrected ZZZ-1 · a NUL's three properties against a real file — invisible to a
read, unmatchable by an edit, cleared by a whole-file rewrite · the brand's
failure to reach the `.mjs` callers, via a green typecheck · every mutation
above · the real defect reintroduced into `hostSurfaceProbe.mjs` and named by
the scan at the right line · the cold build, from the Actions API, and confirmed
twice by the builds this range paid · `containment-2022` running on Server 2022,
step-level, 2s, under `--require-containment` · the check-run annotation count
for that job, which is 0.

**Asserted:** that `windows-2022` remains available — a retired label fails
loudly, which is why the literal is safe · that the DIFFERS rows' agreement
across two images generalises to a third · that the escape hook's denial count
this session is *about* 70, which is recalled and not parsed, and this project
has already been wrong about that figure by an order of magnitude.

### 6. Did architecture change before the feature, or underneath it?

No architecture change. The second Windows job is CI configuration; the brand and
the scan register into existing seams; the sweep refusal is a tool refusing a
mode. No B4 was owed and none was taken.

### 7. Do the documents still match the code?

`FEATURES.md` row 285 was corrected twice inside this range — once to state
XXX-1's justification, once because *"its first reading is not yet taken"* stopped
being true the moment the board landed. `ci.yml`'s `~10 minutes` and its
`THE ONLY JOB THAT CAN RUN IT` were both falsified by commits in this range and
corrected in them. `lowboxSpike.mjs`'s header table and its paragraph were the
YYY-1 finding itself.

**The cross-document sweep was run and it is not sufficient.** ZZZ-1 is the
proof: the sweep finds existing statements of a changed fact and cannot prevent a
new false one being written into a fix a commit later.

### AAAA-4 — the range diff is not the change history, and the audit reads the range diff

`audit:scope` reports `win32HostSurface.ts` at +79/−2 with a note that **4
deletions do not appear in the range diff**. They are exactly the ZZZ-1
correction: lines added at `9812349` and rewritten at `fd69856`. A two-point
comparison cannot show a file corrected mid-range, and **the one file in this
range where I corrected myself is the one file whose corrections vanish from the
figures.**

Ruled a stated limitation rather than a defect, with one line of output: the
changed-source column says the figures are net and that a file corrected
mid-range needs `git log -p` over the range. A compensation the instrument
prints at the point of use is a mechanism; one you must recall is not. It becomes
a defect the first time something is found late that reading those per-commit
diffs would have surfaced.

### What is owed out of this range

AAAA-1's per-image pin · AAAA-2's short board output · AAAA-3's budgeted fetch ·
AAAA-4's one line · AAAA-5's CLI case per scan · the (b) memory probe · the
PostToolUse hook as its own unit.

---

## 2026-08-23 — Stage audit: `bc8d94b..e84538d` — three findings a machine could not have produced, and a guard that runs in one place

**Audited through `e84538d`.** 9 commits, 21 files, **2 proofs added, 5
modified**, 2 new source files and **4 changed** — from `npm run audit:scope`.

The range is UUU-3 and UUU-4, the VVV findings, WWW-1, RR-3's migration and its
proof conversion, and three CI round-trips fixing what that proof found.
Findings **XXX-1** to **XXX-3**.

### The range's headline

**Three separate defects were found by running shipped containment code
somewhere other than this machine, and no amount of local care would have
reached any of them.**

1. An undeclared dependency on a **generated** fixture the performance gate
   happens to produce. Always present here; absent on a fresh checkout.
2. The contained host **could not start**: node opens the NUL device through the
   CRT when the inherited descriptors are absent, and an AppContainer token
   cannot open it on that Windows build. Starts fine here, every time.
3. The container's **refusal of process creation is build-dependent** — `EPERM`
   on `windows-latest`, allowed on Windows 11 — which makes WW-1's attribution
   true of one environment rather than of AppContainers.

Each was reported precisely, by an instrument whose three-state discipline kept
*could not look* out of the passing column: the eight rows that needed a
contained reading said UNREADABLE and the run exited non-zero, rather than
printing a containment verdict for a host that never started.

The second is the sharpest, because the FIRST attempt at it was wrong. Supplying
`hStdInput` — the parent opens NUL and hands it in, this file's own rule for the
diagnostic handle — produced an identical fatal. **The Win32 standard handles
are not the CRT's file descriptors**: `CreateProcessW` sets the former and does
not populate `lpReserved2`, so `_get_osfhandle(0)` is invalid however the Win32
handles are set. Both halves ship, because supplying the handles is what makes
`--no-stdio-init` safe rather than silent.

### 1. Root cause or workaround

**`--no-stdio-init` is the one entry that has to answer this**, and Rule 0's
test is whether the cause is proven to lie outside this repository. It is, and
it is named in the file: a Windows AppContainer token cannot open the NUL device
on that build, and node opens it unconditionally when the CRT descriptors are
absent. The alternative — fabricating an `lpReserved2` descriptor block — is a
second opinion about a private, undocumented ABI.

The flag joins two others in `INTERPRETER_FLAGS`, each carrying its own
measurement, which is the shape that stops a flag list becoming folklore.

### XXX-1 — two changes to shipped security code, guarded in exactly one place

`win32HostSurface.ts` gained an inherited stdin handle and an interpreter flag.
**Nothing local fails if either is reverted.** The containment proof is the only
guard, it runs on one job and one platform, and it took three CI round-trips to
establish what it now protects.

That is not *no proof* — it is proof in one place, which the register's own
vocabulary would call a verdict with a single witness. It is recorded rather
than papered over with a source-text scan asserting the flag is present: such a
scan would go green on a flag that is present and ignored, which is the
`available: true` shape this project keeps finding.

**The trigger is the first time either is changed by someone who cannot run the
shim job**, and the mitigation available today is that the step is not
`continue-on-error` and its failure is a red board on `main`.

### XXX-2 — a coverage reduction, taken deliberately

The LowBox-alone process-creation row asserted `same` and now asserts `either`,
because neither direction is true everywhere. It does not become unasserted: it
asserts the half that is invariant — the uncontained cell must still be able to
spawn — without which two dead cells would satisfy it.

Recorded under audit item 2a in the weakening direction, with ADR-0023 taking a
dated correction and both FEATURES rows edited true, since those are live
specifications rather than records.

### XXX-3 — the tree witness has a caller that must NOT have it

`treeMovedSince` is now used by `advisoryRegister.proof.mjs` and by
`checkLocal.mjs`. The obvious next step is to give it to every proof that spawns
subprocesses, and **`documentScope.proof.mjs` is the one that must not have it**:
that proof deliberately removes a tracked file to prove `check:docs` reads the
index, so a witness would report THE TREE MOVED on every correct run.

Written down because the rule *any non-hermetic proof should witness its tree*
is the kind that gets applied uniformly by whoever reads it next, and the
exception is a proof whose whole subject is moving the tree.

### 2. Verified against the easy shape only?

**This range is the answer to that question in its strongest form.** Every
finding above came from the hard shape — a fresh runner — and the local half was
not merely easier, it was incapable of producing any of them. The instrument
passed here at every point.

### 3. Would CI have caught it, and is there a defect this machine cannot see?

The first question is now backwards for this subject: **CI is the only thing
that caught anything.** The inverse question is the live one, and XXX-1 is its
answer — two shipped changes whose only guard is a job I cannot run.

### 4. Are the proofs non-vacuous?

Mutation-tested in range: the two-bucket sort (SSS-1's case), the batch reader's
framing by one byte, the tree digest's mtime, the runner pattern, the quoted-`>`
mask, and the containment proof's expected verdict declared backwards. Each
reddens a specific named case.

**The register proof's throw-catch survived a structural change**, and it was
worth checking rather than assuming: the reporting block moved inside an `else`
when the tree witness arrived, and that block is the one whose comment records a
roster mismatch once printing its diagnosis and exiting SUCCESSFULLY. It is
intact.

**A branch no fixture reaches, kept deliberately:** `witnessTree` catches a
`statSync` failure for a path deleted between the status and the stat. Nothing
constructs that race and the catch is documentation of a real one — JJJ-1's
first kind, where deleting it would produce a false positive the day someone
hits it.

### 5. Executed, or asserted?

**Executed:** both provisioning directions of `--require-containment` with the
build moved aside · every mutation above · the containment proof from a cold
fixture cache · that `tsc --build --force` emits the surface where an
incremental build is a no-op · that the host's stderr breadcrumbs survive
`--no-stdio-init`, which is the channel that made all of this diagnosable · the
350 unit tests · three CI round-trips.

**Asserted:** that `--no-stdio-init` is what fixes the runner. It is consistent
with every reading and the runner has not yet returned a green on it at the time
this was written. The distinction matters because the previous hypothesis was
equally consistent and wrong.

### 6. Architecture before the feature?

ADR-0023 took two dated corrections in range — §6's discharge and the
build-dependence of the container's refusal — both recording measurements
against decisions already taken, rather than changing a decision under something
built on it.

### 7. Do the documents still match the code?

Both FEATURES rows stated *invariant 25(b) is delivered by the job, not the
container* as a flat fact. That is now known to be true of the job everywhere and
false about the container on at least one build, and both bodies are edited.

**NNN-4's cross-document sweep fired** on the build-dependence claim: it is
stated in ADR-0023 Decision 8, in FEATURES row 284 and in row 285, and all three
were found and corrected together rather than one at a time.

### The pattern the range named

**A guard that has never run anywhere but the machine that wrote it has not been
run.** The containment mechanism had been measured here for days and was correct
here at every point; its first three executions elsewhere produced three
findings, one of which — a host that cannot start — would have been a shipped
defect discovered by a user.

That is not an argument for more local care. It is an argument for **getting the
thing to run somewhere else early**, which is what the research→proof transition
bought and what a research instrument that gates nothing would never have
forced.

---

## 2026-08-23 — Stage audit: `167de69..bc8d94b` — a proof registered into no job, and two guards that were right about the wrong thing

**Audited through `bc8d94b`.** 6 commits, 23 files, **1 proof added, 5
modified**, 3 new source files and **6 changed** — from `npm run audit:scope`.

The range is the previous audit's own recording commit, RR-3's control half,
TTT-2 and TTT-4, then UUU-1, TTT-1's class B fix and UUU-2. Findings **VVV-1** to
**VVV-4**.

Taken because the gate blocked a commit that would have crossed the file
threshold, which is the mechanism working: the range stood at 23 files of 24 and
the next commit added six more.

### 1. Root cause or workaround

No workarounds. Two changes deserve the check anyway, because both look like
loosenings and neither is:

- **TTT-1 made the escape guard deny LESS.** That is audit item 1's third
  bullet, and the discriminator is whether the removed denials had a safety
  argument. They did not: a `>` inside a quoted program redirects nothing, and
  the pinned compound cases — which do have one — were required to keep denying
  as a condition of the change. Mutation-tested in the direction that separates:
  removing the mask reddens exactly the four new cases and no others, so classes
  A and C are untouched.
- **UUU-2 replaced `node --check` with `vm.SourceTextModule`.** Different entry
  point, same parser — both are V8 compiling the source. The alternative that
  WOULD have been a loosening is acorn, already in the tree, and a second
  opinion about JavaScript syntax.

### VVV-1 — a proof registered in `package.json` and invoked by no job

`proof:stagedsyntax` shipped in `bc8d94b` with ten cases, three more in the
pre-commit proof, and **no workflow runs it.** It exists, it passes locally, and
CI has never executed it.

**Nothing in this repository can see that class.** `check:annotatecoverage`
asserts that script invocations *which appear in a workflow* are wrapped by
`annotate.mjs`; a proof appearing in no workflow at all is outside what it
examines. `check:jobplacement` asks whether a step needing `node_modules` sits
in a job that installs — also about steps that exist. Both are correct, and
neither is looking at absence.

Found by searching, and the search needed the lesson this project keeps paying
for. The first attempt matched the **npm script name** against the workflow text
and reported sixteen proofs missing, including `proof:escapeguard`, which
plainly runs on Guards. Workflows invoke scripts by **path**. That is the
recognition rule `annotateCoverage.mjs` was rewritten around one range earlier,
and the same mistake I nearly filed a finding on two ranges ago. Re-run against
the executing path, with a positive control requiring a known-present proof to
be located, it reports exactly one.

The fix is a check rather than a wiring change, because a wiring change closes
only the instance. It lands in the next commit, not this one.

### VVV-2 — a filter on a property that does not exist is always true

`stagedSyntax.mjs` filtered staged entries with `entry.status !== 'D'`. The
field is `entry.state`. So the comparison was `undefined !== 'D'`, always true,
and staged deletions were passed through to the blob reader.

The scan stayed correct, and that is the interesting half: a deleted path is not
in the index, so the batch reader reports it absent and it is skipped anyway. A
second mechanism was doing the work the filter claimed to do, which is why
nothing observable changed.

**TypeScript caught it; no case did.** The fixture set contained no deletion at
all — item 4's set-level rule, where the missing input is a whole *state* rather
than a value. A case now stages a deletion and requires `checked` to be zero, so
the filter has something behind it besides the compiler.

### VVV-3 — two Writes put control characters inside string literals

`0x01` once and two `0x00` bytes once, both where a space belonged, both inside
a template literal, both invisible in every editor and in the diff. The first
surfaced because an `Edit` could not match text a `Read` had just displayed; the
second because `grep` reported the file as binary.

`guardFiles.mjs` scans every staged text blob for C0 controls and would have
blocked either commit. Recorded because the standing rule about escape-resolving
tools names shells and inline interpreters — `Write` is the tool that rule sends
you *to*, and it is not exempt from producing a byte nobody typed. The
mechanism, not the tool's reputation, is what protects the commit.

### VVV-4 — two of the three parse goals have no case

`parseSources.mjs` chooses a goal per extension: `.mjs` is a module, `.cjs` is a
script, and `.js` is accepted if it parses under either. Every fixture in
`stagedSyntax.proof.mjs` is `.mjs`.

So the `script` branch and the `either` branch are reachable, load-bearing and
exercised by nothing — item 4's *mutate the branches no fixture reached*, and
the second of its three kinds: reachable, with no case at all. Getting `either`
wrong is silent in the direction that matters, because a `.js` file would then
be reported broken under a goal it does not have. Cases owed in the next commit.

### 2. Verified against the easy shape only?

**UUU-2's cost was measured twice and the design changed both times**, neither
predicted. `node --check` costs ~330 ms per file, almost all startup — and it
accepts several paths while silently checking only the first, exiting 0, which
is a green tick for files nobody parsed. Then the *reader* turned out to be
fourteen times the cost of the parse it fed, because `readStagedBlob` spawns git
twice per path. 2234 ms for seven files became 474 ms for eight, and it no
longer scales with file count.

The second is the one worth carrying: the obvious cost was in the thing being
measured, and the real cost was in the harness feeding it.

### 3. Would CI have caught it, and is there a defect this machine cannot see?

**VVV-1 is the first question in its purest form**: a proof CI cannot run,
because nothing asked it to. It is also invisible to every guard here, which is
why it becomes a check rather than a wiring fix.

**The board went red at `bc8d94b`, and the cause was predicted with the wrong
location.** Changing `blockEscapeResolvingWrites.mjs` in `7246bc2` invalidated
`docs/hook-probe.json`'s recorded inputs. I said `check:docs` would fail in CI;
CI was green and Guards failed, on `proof:hookprobe`. Both read the same
evidence — naming the wrong one cost nothing here, and would have cost a wrong
diagnosis if the repair had not already been in hand.

### 4. Are the proofs non-vacuous?

Every guard in this range was mutation-tested and each reddens a specific named
case: loosening the runner pattern to match anywhere reddens the comment case
only; removing the quoted-`>` mask reddens the four class-B cases only;
advancing the batch reader's offset by one byte reddens two; dropping mtime from
the tree digest reddens the revert case.

**The runner derivation needed its fixture changed before it could be proven.**
`workflow()` emitted jobs with no `runs-on`, so the new control rejected every
existing case in the file. Making the fixture realistic — two jobs, two
different runners, and a comment naming a third — is what let the control exist
at all, and that comment is UUU-1's own shape.

### 5. Executed, or asserted?

**Executed:** every mutation above · the escape guard's three false-positive
classes before and after the fix, with controls · `node --check`'s multi-file
behaviour · both cost measurements · the batch reader against the single reader
on ten real paths · the tree witness's five cases including its two stated
limits · the proof-coverage search with a positive control · the hook probe,
twice.

**Asserted:** that `--experimental-vm-modules` will remain available. If it is
withdrawn, the known-good control turns that into BLIND rather than into thirty
false failures — which is the property that makes the dependency safe — but the
withdrawal itself has not been rehearsed.

### 6. Architecture before the feature?

Nothing architectural moved. ADR-0022 and ADR-0023 took dated corrections in
`9f553fc` for a research instrument's cell removal, which is a record catching
up with a decision already taken rather than a change of decision.

### 7. Do the documents still match the code?

UUU-1 is item 7 in its compound form, fixed in both files, with the reason that
actually holds written in place of the one that did not. `docs/FEATURES.md` row
285 gains UUU-4's dated record of the shipped AppContainer path being executed
for the first time.

**NNN-4's cross-document sweep fired on UUU-1** and found the third statement:
`ci.yml` says "this job is already windows-latest" forty lines below its own
`runs-on`, so the file contradicted itself and the two paragraphs had never been
read together.

### The pattern the range named

**A guard can be right about the wrong thing, and it reads exactly like being
right.** Three instances here. The `entry.status` filter did the correct thing
for a reason that had nothing to do with it. `check:annotatecoverage` correctly
verifies every invocation it can see, and its silence about `proof:stagedsyntax`
is not a failure of the check but of what the check is *about*. And the first
proof-coverage search reported sixteen missing proofs while being wrong about
all sixteen, because it matched the name a manifest gives a thing rather than
the path that runs it.

The common shape is that **the output was correct or plausible and the reason
was not the one anybody would have given if asked.** A mutation test finds the
first kind. Only asking *why is this answer right* finds the other two.

---

## 2026-08-23 — Stage audit: `5889f8a..167de69` — a count recalled instead of read, and a guard's own fixture built from the shape it had already fixed

**Audited through `167de69`.** 8 commits, 21 files, **1 proof added, 4
modified**, 4 new source files and **3 changed** — from `npm run audit:scope`.

The range is the Win32 host surface, PPP-1, OOO-1, QQQ-1 to QQQ-3, RRR-1 and
SSS-1/SSS-2. Findings **TTT-1** to **TTT-4**.

The audit was taken at 8 of a 9-commit batch rather than waiting for the
threshold, so the range ends cleanly before RR-3 rather than falling due partway
through it.

### 1. Root cause or workaround

No workarounds in the range. Two changes are corrections that *look* like
loosenings and were checked as such:

- **`win32Handle.proof.mjs` deleted its zero-cases guard**, on the stated ground
  that `passRoster.format` throws on a count mismatch and zero-against-fourteen
  is the loudest mismatch there is. **Verified rather than accepted**: the throw
  is arithmetic (`recorded !== expected`), not a lookup, so the zero case is the
  same branch `passRoster.proof.mjs` already covers in both directions — 3
  declared against 2 recorded, and 1 against 2. The claim holds and the guard is
  genuinely subsumed.
- **`electronImports.proof.mjs` gained two allowlist entries.** Widening a
  suppression list is item 1's third bullet exactly. Each entry pins an **exact**
  site count and the comparison rejects both directions — more sites than
  declared is a new unreviewed suppression, fewer is a stale entry. Not a
  loosening.

### TTT-1 — the `>` exclusion was fixed one character short, and the proof's own fixture hid it

`TO_FILE` excludes a redirect target beginning `=`, because `awk 'NR>=386'` was
denied and writes nothing. Measured on 2026-08-23: a **bare** `>` inside a quoted
program is still read as a redirect. `awk 'index($0, "x") > 0 {print NR}' f`
denies. `awk '$2 > 100 {print $1}' f` denies. A `sed` substitution whose
replacement text contains a `>` denies. None of the three redirects anything;
there is no `>` outside quotes in any of them and no command in the line writes
a file.

**The proof shows it from the inside.** Its case list carries

> `mustAllow('awk printing when a field exceeds a bound', "awk '$2 >= 100 {print $1}' data.txt")`

— a case whose *name* is about exceeding a bound, written with the one operator
the fix had already handled. The variant that reads more naturally denies. That
is item 4's fixture rule: **the fixture was built from the shape the defect
handles correctly**, so no mutation test would have found it, and its name says
it is covered.

Not fixed. It is a change to what the guard denies, and that is a decision to
take deliberately rather than inside a comment. Recorded at the exclusion it
belongs to, so the next reader of the `>=` argument sees where it stops.

**It is a distinct class from the false positives that were pinned**, and the
argument for those does not reach it: there the guard fails closed on a real
redirect whose *owner* is ambiguous across a compound; here there is no redirect
to own.

### TTT-2 — the register's symbol rule has a fourth reader, and the paragraph that justified it did not travel

OOO-1 consolidated two inline spellings of *what symbols does this claim name*
into `watchedSymbols` (`?? [name]`) and `declaredSymbols` (`?? []`), after the
check written to catch a second opinion turned out to be a third one.

`scripts/proofs/ocrDoors.proof.mjs:252` still spells it inline:
`baseline.reachability?.['ocr']?.symbols ?? []`, with its own hand-written type
for the register's JSON shape beside it. Two files now hold two opinions about
one format, which is the shape `scripts/lib/gitScope.mjs` exists because of.

Two things make it worse than an ordinary duplicate:

- **The rationale was deleted from the file that no longer has the code and was
  not added to the file that now does.** The paragraph explaining why *this* site
  wants `?? []` and not `?? [name]` — the question is what the list explicitly
  NAMES, and defaulting to the verdict's key would add a phantom symbol — lived
  in `engineAdvisories.mjs` and went out with the consolidation. A reader of
  line 252 sees the exact spelling OOO-1's defect had, with nothing saying why it
  is right here.
- **Neither helper is exported**, and `engineAdvisories.mjs` calls `main()` at
  module scope, so importing it to reach them would run the whole register check
  as a side effect. The fix is therefore not a one-line import; it is a small
  shared reader, and it does not belong in a docs-only audit commit.

Recorded, not fixed. **The comparison itself is sound** and was checked rather
than assumed: a broken register lookup, a broken derivation, and both broken at
once are each caught — the third only because the two `CONTROL` cases go red when
both sides are empty.

### TTT-3 — five cases passed prose into the slot that selects the rule set

Found while adding the SSS-2 cases. `ask(command, toolName)` picks
`POWERSHELL_RULES` or `SHELL_RULES`, and five `mustBlock` call sites passed a
one-line rationale as the third argument.

They were **not vacuous**, and only by luck: `firstViolation` treats every name
that is not `PowerShell` as a shell, so the wrong argument fell to the right
default. A PowerShell case written the same way would have been asserted against
the shell rules and passed for the wrong reason.

Fixed in-range. The rationales are comments, and `ask` throws on a tool name that
is not `Bash` or `PowerShell` — B5 over a comment: refuse the value rather than
describe the slot. The throw was executed, not assumed.

### TTT-4 — one roster adopter still exits with writes in flight

`win32Handle.proof.mjs` ends `process.exit(status)` immediately after a
`process.stdout.write`. That is the exact shape that made two other proofs print
every case line twice — Node tears the process down with the write pending and
the buffer is re-emitted, while the roster's own count stays correct, so the
duplication is invisible to every assertion in the file.

**Measured today: no duplication** — 16 lines out, 16 unique. The difference from
the two that broke is output volume, not design, which is Rule 0's *fix the
class, not the instance*: the file that happens to print less is not a file that
is safe. It is the only roster adopter left on `process.exit`; the sweep across
all 24 found no others.

Not fixed in this commit for the same reason as TTT-2 — audit-recording commits
are docs only and alone.

### 2. Verified against the easy shape only?

**SSS-1's three-bucket ordering is proven on a fixture, not against the real
proof half.** That run strands and orphans processes, which is the defect the
stop exists for, so the hard shape is deliberately not exercised — stated rather
than left to be discovered.

**`checkLocal`'s duration figures passed a resolution test on the real
repository** (item 4a): the ten `check:*` scripts came back 0.3, 0.5, 0.8, 0.9,
3.5, 5.8, 10.3, 18.1, 20.8, 46.2 seconds — every pair distinguishable at the
0.1s the table records, across two orders of magnitude. The rounding only
collides at the bucket boundary, and there it rounds a nearly-doomed script into
the doomed bucket, which is the conservative direction.

### 3. Would CI have caught it, and is there a defect this machine cannot see?

**Neither TTT-1 nor TTT-2 is visible to CI.** TTT-1 is a case nobody wrote, and a
missing case is not a red build. TTT-2 needs a check for *a second reader of a
format*, which does not exist.

**Inverse, and it is a branch this machine cannot execute.** The proof's
`typeof copy !== 'function'` block has two arms: `unverifiable` where nothing is
built, and a hard failure where `--require-desktop-copy` is passed. On a
developer machine the build exists, so **neither arm runs**; on Guards only the
first does; and the second fires only when a job that builds has no build — so
**the arm that turns a missing copy into a red build had never executed
anywhere.** Executed now, by moving the built file aside: without the flag it
reports `--  … nothing to check` and exits 0 at *12 passed, 2 not applicable*;
with the flag both cases go red naming the absent path. Both arms correct, and
the file restored.

**`checkLocal`'s ordering is itself keyed on the presence of something.** The
durations table is untracked and machine-local, so on a cold machine every script
is never-measured, the whole set lands in one bucket, and the order is
alphabetical — identical to the behaviour SSS-1 replaced. That is by design and
costs one run, but it means the ordering is a local optimisation whose interesting
branches never execute anywhere but here. CI never runs the sweep at all, only its
proof.

### 4. Are the proofs non-vacuous?

- SSS-1's new case: reverting to the two-bucket sort reddens **exactly** that
  case and prints the order it got. The fixture's alphabetical order is neither
  the expected order nor a rotation of it, so neither an unsorted run nor the old
  sort can pass by luck.
- SSS-2's two pinned false positives carry controls that delete one quoted
  argument each and then allow — so the pinning is a *separation*, not a blanket
  assertion that compounds are refused.
- TTT-3's throw was fired by passing a bad tool name at a real call site.
- The `--require-desktop-copy` arms above.

### 5. Executed, or asserted?

**Executed:** the 65-denial count and its breakdown, by parsing this session's
transcript and replaying every command through the guard as it stands · the three
false-positive classes and the quote-pairing mechanism, with controls · the
`>` versus `>=` asymmetry · TTT-3's throw · both `--require-desktop-copy` arms ·
the two-bucket mutation · the ten real durations · `typecheck`, `eslint` on the
four changed files, the ten `check:*` scripts, both edited proofs, and
`check:emittedtemplates` against the index.

**Asserted:** that `win32Handle.proof.mjs` would double-print at higher output
volume — the *shape* is identical to two measured cases, the behaviour at volume
was not reproduced here. That is why TTT-4 is recorded as a class fix rather than
a defect observed.

### 6. Architecture before the feature?

Nothing architectural moved in this range. ADR-0022 and ADR-0023 both precede it.

### 7. Do the documents still match the code?

**`CLAUDE.md` said the escape guard covers 51 cases, twice.** The journal had
already recorded that number going to 233 and the digest was never updated; it is
257 now. Both statements are corrected, and the figure is gone rather than
refreshed — a count that is false on the next commit is not worth checking by
hand. The pinned false positives are named in its place, because a disposition
nobody wrote down is one that gets relitigated by whoever it inconveniences.

**NNN-4's cross-document sweep fired and found nothing further.** The range
states a cross-document relationship — the digest's account of what the escape
guard covers — so every other statement of it was swept: `docs/JOURNAL.md:7755`
records `51 cases → 233`, which is a **record** and correctly stays as written.

### The pattern the range named

**A number carried in a handoff is a memory, not a measurement.** Both this seat
and the reviewing seat had the escape guard's denial count at **six**. Parsing the
transcript gives **65** — 27 `node -e`/`-p`, 15 `sed -i`, 6 `python -c`, 5 a
heredoc into a file. Wrong by an order of magnitude, and wrong in the direction
that makes the guard look incidental rather than load-bearing.

Nothing was hiding. The transcript was on disk the whole time, the parse is
thirty lines, and neither seat ran it — because the number *felt* like something
already known. That is the same failure as the reassuring answer in item 4b, one
level up: **the memorable denials are a biased sample of the denials, and
remembering is a search whose recall you cannot inspect.**

It also disposes of a claim SSS-2 rested on. *The first denial that was not the
guard being right about the input* was, on the replay, at least the eighth.

---

## 2026-08-23 — Stage audit: `5f07e80..5889f8a` — two guards the fixture set was one-sided about, and a document a range can never falsify

**Audited through `5889f8a`.** 9 commits, 20 files, **2 proofs added, 3
modified**, 2 new source files and **7 changed** — from `npm run audit:scope`.

The range is the host runtime loop, ADR-0023 Decision 8's factory, KKK-1, LLL-1
and MMM-1. Findings **NNN-1** to **NNN-4**.

### 1. Root cause or workaround

One workaround, and it is labelled as one. `engineHostFactory.ts` names no Win32
entry point so that the register's `git grep` triggers do not expire two
invariant-25 verdicts on a module that creates no process. Under the reviewer's
ruling that stays — re-triaging today would narrow a security trigger on the day
it fired, for a subject that has not occurred — and it is now **dated against
the Win32 surface**, written into the comment and carried on the FEATURES row,
because the expiry is an event and a symbol scan cannot see one.

**And the previous range's overturnable call is now settled, in the other
direction.** The `util.inspect` swap in `rendererHarnessMain.ts` was recorded as
the one call most likely to be overturned. The rule that separates it is the
reviewer's:

> A change that stops a trigger is legitimate when it would have been right
> anyway, and suspect when its only benefit is that the trigger stops.

Node owns how a thrown value renders and how `cause` is walked, so calling it is
B3a and would have been right with no register in existence. The factory's
comments fail that test — their only benefit is that the grep stops matching —
which is exactly why one needed a dated expiry and the other did not. The
previous entry stands as written; this is the correction underneath it.

### NNN-1 — the whole fixture set only ever asked half the question

`createContainedHost` reads `IsProcessInJob` rather than trusting
`AssignProcessToJobObject`'s boolean, and the code says so: *the read is what
decides*. Replacing the read with `assigned ? read : 'not-in-job'` — a factory
that trusts a **no** and does not look — **passed all twenty-one cases.**

Every case held `assignToJob` at `true`, including the one explicitly labelled
CONTROL. So the file asked, thoroughly, whether a *yes* from the assign call can
be overruled by the read, and never once asked whether a *no* can be. Those are
different programs: the mutant refuses a host that is genuinely in its job under
our limits, on the word of a boolean the design exists to distrust.

This is item 4's fixture rule at the level of a **set** rather than a case. Each
case here is fine; what is one-sided is the inputs, and no individual case looks
wrong. The tell is that one argument is a constant across an entire file.

Closed with three cases holding assign at `false` and varying only the read:
`in-job` creates the host, `not-in-job` refuses — that is the control, without
which the first is satisfied by a factory that ignores both — and
`could-not-read` is named `job-membership` rather than `job-assign`, because the
tempting shortcut is to blame the assign call that did in fact fail.

### NNN-2 — reachable, load-bearing, and proven by nothing

`stop` guards against terminating twice. Deleting the guard reddened no case.

It is reachable. Every other caller of `stop` sits behind an `isStopped()`
check — `receive`, the frame loop, `answer` — and the **handler-rejection path
does not**. So: a protocol violation terminates the loop; a wrapper rejection
lands afterwards; without the guard `transport.terminate` fires a second time
**and `state.stopped` is overwritten**. A peer's malformed frame would then be
reported as our own `unsendable-response` — this build blaming itself for the
peer's bytes, which is the precise confusion that code names a separate
termination code to prevent.

Reaching the path took a moment's care, and the care is the reusable part:
`wrapHandler` catches a *handler's* throw and turns it into an incident, so the
handler throwing is not enough. The **wrapper** has to throw, which happens when
`incidents.record` throws — it runs outside the wrapper's `try`. A handler that
throws plus a sink that throws does it.

A control asserts the rejection alone **does** terminate, so the case cannot pass
on a build where the wrapper never rejects and the second termination is never
attempted.

### NNN-3 — the one that is stated rather than fixed, and why that is not a dodge

Deleting the `isStopped()` guard at the top of `receive` also reddens nothing,
and this one is **not** a missing case.

Its entire effect is that the frame decoder stops accumulating a refused peer's
bytes. The loop below it already refuses to dispatch, so `written`,
`terminations`, `termination` and `inFlight` are identical either way, and
nothing on this module's surface can see the decoder. There is no assertion to
write that does not first widen the API for the test.

The honest reading is that **the property belongs to the transport**: a pipe that
has been terminated should stop being read. This line is what survives a
transport that keeps calling anyway, which is why it stays. It becomes measurable
when a real transport exists — memory held against a peer that keeps writing
after refusal — and **that is the trigger**, written into the code beside the
line rather than carried in someone's head.

Recorded because the alternative was to leave it looking covered. A guard with
no case is indistinguishable from a guard with a missing case until someone
mutates it, and the next person to mutate this file deserves to find the answer
already there.

### NNN-4 — item 7 is range-scoped, and a document can be falsified by a commit that never touches it

MMM-1 — three documents stating the memory budgets' writer of record backwards —
was found by the reviewing seat. **No stage audit could have found it**, and that
is a property of how item 7 is run rather than of how carefully it was run.

Item 7 asks whether the documents still match the code, and like every other item
it is applied to the range. `windowPolicy.ts`'s false claim became false the day
`memoryBudgets.mjs` was written, and **no range has ever changed both** the
sentence and the code that refutes it. A range-scoped sweep cannot reach it by
construction.

The compensation is narrow enough to be usable, and it would have worked here:
**a range that STATES a cross-document relationship must sweep every other
statement of that relationship.** `budget.ts` asserted the correct version of the
pen-holding relationship *inside this very range* — so the trigger fires on an
addition the columns already name, and the sweep is three greps.

It becomes a defect the first time a false cross-document claim is found late
that this sweep would not have surfaced.

### 2, 2a, 3 — the shape, the coverage, and what this machine cannot see

The hard shape for both new modules is named and not reached: the factory is
exercised against an injected surface and never a real process, the loop against
fed chunks and never a pipe. Both are recorded as **not done** on their FEATURES
rows rather than implied by a green test.

No derivation moved this range, so item 2a has nothing to declare. Nor does the
provisioning axis: neither new module has a branch keyed on something being
installed, and `composition.proof.mjs` **throws** when the build is absent rather
than skipping — the failure mode that would have been green here and red on
Guards does not exist in this range.

**Item 3 answers itself unusually here: CI could not have caught NNN-1 or NNN-2,
and not because of a gap.** Both are missing cases, and a missing case is
invisible to every runner by construction — the suite is green, and it is green
honestly. Only mutation finds them. That is the argument for item 4 being a
manual step that cannot be delegated to a workflow.

### 4a and 4b, applied to the audit's own tools

Two things happened to the mutation harness written for this audit, and both are
the checklist landing on the instrument rather than on the subject.

It reported **"1 failing"** for a mutation that reddened **2**. The first match
for a failure count in vitest's output is the *Test Files* line, not the *Tests*
line. The RED/GREEN verdict was sound because it came from the process exit code
— but the number beside it was wrong, and a number that is wrong in the
reassuring direction is what 4a exists for. Anchored to the `Tests` line in the
second harness, with the reason in its header.

And it **refused** an anchor that matched twice rather than reporting a result
for whichever occurrence it happened to hit. That is 4b's positive control
arriving in a mutation tool: an anchor that matches two places tests nothing
reliable, and reporting GREEN there would have read exactly like a proven guard.

**One more, on me rather than on a tool.** I searched the workflows for
`proof:composition`, got nothing, and was a step away from filing a finding that
the proof runs in no job. CI invokes it **by path**, at `ci.yml:359`, after
`npm run build`. That is precisely the recognition rule `annotateCoverage.mjs`
was rewritten around one range earlier — *the invocation is the path, not the
manifest name* — and I searched by the name anyway. Item 4b's reassuring answer,
in the hands of the person who had just shipped the fix for it.

---

## 2026-08-22 — Stage audit: `d55b893..5f07e80` — a branch nothing executed, and four instruments that were wrong before they measured

**Audited through `5f07e80`.** 5 commits, 23 files, **2 proofs added, 4
modified**, 2 new instrument files and **5 changed** — from `npm run audit:scope`.

The range is FFF-2/3/4, GGG-2/3, HHH-1/2/3, III-1 and GG-1's first closed
member. Findings **JJJ-1** to **JJJ-3**.

### 1. Root cause or workaround

Ten fixes, and the one worth arguing about is the `util.inspect` swap in
`rendererHarnessMain.ts`. The advisory register's expiry fired on it correctly;
the response was to stop naming the watched symbol rather than to re-triage the
verdict. That IS stepping around a guard that fired, and it is recorded as a
decision with the refused alternative beside it — narrowing a security verdict's
glob so a proof harness could use a nicer helper. **If any call in this range is
overturned, it is this one**, and the three limits of that trigger are written
down where the next person meets them.

Everything else is root, and two were corrections to a specified remedy rather
than to the code: HHH-1's derivation as stated over-fired on two green steps,
and GGG-2's first proposed fixture was one the defect also satisfies.

### JJJ-1 — a branch in a new instrument that nothing executed, anywhere

`nodeModulesPlacement.mjs` treats a `.catch()` chain as handling a rejection,
because it does. **Disabling that branch left all nineteen cases green and the
real scan unmoved.** No code in this repository writes the shape, so the branch
was a specification nobody had read — item 3's *a branch keyed on the presence of
something has a side that never executes wherever that thing is absent*, in the
form where the thing is absent **everywhere** and the branch is therefore dead
from birth.

Found by mutation during the audit, not by a failure. Kept rather than deleted —
the fact it encodes is true, and removing it makes the scan report a false
positive the day someone writes it — and now covered by a pair: the chained call
is not reported, and the same call without the chain is. With the branch
disabled, exactly that case reddens.

**The general form is worth more than the instance.** A new instrument's
mutation testing naturally aims at the branches its fixtures exercise. The
branches worth checking are the ones no fixture reached, and the cheapest way to
find them is to disable each in turn and see whether *anything* notices. Two of
this range's four instruments had one.

### JJJ-2 — a proof CASE was deleted, and no column reports that

`annotateCoverage.proof.mjs` lost the case *"proof scripts that yield NO paths
throw"*, because the guard it covered became unreachable: `names` and `paths`
now come from one match, so a non-empty `names` implies a non-empty `paths` (B5,
and the guard went with it). That is a correct removal — the thing being covered
stopped existing.

It is recorded because of **how** it surfaced. The audit report classifies that
file under *proofs MODIFIED*, since the file remains; a removed **case** appears
in no column. This is exactly the granularity limitation AA-1 ruled on, and this
range is the first time its mandated compensation — *read the modified-proofs
diffs* — actually had to do the work for a deleted case. It did. **The
limitation holds, and the trigger has not fired.**

Worth stating precisely, because the failure mode is close: the compensation
works only while someone reads those diffs for deletions specifically. The report
now prints *"N deletion(s) DO NOT APPEAR in the range diff"* for three files in
this range, which is what sent me to `git log -p`. Without that line the removal
nets to an insertion and is invisible in the range diff.

### JJJ-3 — the pre-push hook's blocking path is proven by nothing

Fifteen cases cover the decision — which ranges are parsed, which pathspecs are
watched, when the check fires and when it does not. **None covers what happens
when the register FAILS.** The hook's whole purpose is to block that push, and
that path is asserted by reading it.

The obstacle is real and named rather than worked around: `CHECKER` is an
absolute path into this repository, so a fixture cannot supply a failing
register without the run reaching the real one. Making the checker path
injectable is the fix and it is a unit of its own — and an injectable path is
exactly what `--recorded-advisories` refused to be, for good reason, so it wants
thinking about rather than a parameter.

Until then this is a **stated gap, not a covered one**. The failure text was read
by hand once, which is a person remembering.

### 2, 2a. Shapes, and coverage that moved

The hard shapes are covered for the placement scan — a catch, a try with only a
finally, a mixed module, a bare import, a wrapped line, and prose that says
`npm ci`. What is not: a dynamic `import()` of a computed expression, which is
why `DECLARED_ROOTS` exists and is stated in the header.

Coverage **widened** rather than moved: `annotateCoverage`'s subject went from
`proof:*` to every script the wrapper can spawn, and three registration cases in
three different proofs stopped matching an npm script NAME and started matching
the path that actually executes. That last one is a strengthening that looked
like a regression — all three went red at once when FFF-2 landed, reporting a
de-registration that had not happened.

### 3. Would CI have caught it? Is there a defect this machine cannot see?

GGG-1 was the second question's answer last range, and this range built the
mechanism for it. The new scan **covers its own registration**: it is in the
needing set, so putting it on Guards would make it report itself.

Cost, measured rather than assumed: `check:stackowner` 21 s, `check:jobplacement`
4.5 s, `check:advisories --recorded-advisories` 16 s. The first two run in CI's
build job; the third runs pre-push, on the pushes that can break the register.

### 4a. The instrument that refused before it measured anything

`nodeModulesPlacement.mjs`'s **first run reported BLIND** — the control named
`preloadSurface.mjs`, and no workflow runs that file directly; the proof runs it.
The scan said so instead of printing a clean tree. That is the positive control
paying for itself before the instrument had guarded anything, which is the
ordering item 4a asks for and does not usually get.

Three more versions of the same instrument were wrong before it measured
anything real, and every wrong answer was the reassuring one. The order matters:
with only the prose-matching defect fixed, the scan would have printed a clean
tree while blind.

### 5. Executed, or asserted?

**Executed:** `proof:jobplacement` (21) · `proof:stackowner` (24) ·
`proof:annotatecoverage` (18) · `proof:advisories` (34) · `proof:guards` (30 +
29 + 15 + 10) · `check:docs` (9) · `check:jobplacement` · `check:stackowner` ·
`check:annotatecoverage` · `check:emittedtemplates` · both typecheck projects ·
`eslint .` · `guard:staged` · seven mutations, each reddening the case that
exists for it · **a real `git push` through the new pre-push hook**, which named
its range, ran the register offline and passed · the board green at `5f07e80`.

**Asserted, not executed:** JJJ-3's blocking path; that 21 s in pre-commit is
tolerable in practice rather than in principle; and that the `util.inspect`
decision is the right one.

### 6, 7. Architecture and documents

No architecture changed underneath a feature. ADR-0019 gained an **addendum**
rather than an edit — a general rule extracted from two scans erring in opposite
directions, placed beside the decision it generalises.

`CLAUDE.md`'s command list gained both new checks. `docs/FEATURES.md`'s row 283
is a live specification again, and the class that let it stop being one is now
checked.

**The escape-resolving-write hook fired three times this range** — `node -p`, a
heredoc redirect, and `sed -i` — every one on my own reflex composition, none of
them written. It has now denied more often than the rule was recalled, which is
the whole argument the rule could not make for itself.

Open from earlier ranges: the unattributed red at `a0d2ec0`, the general
proof-to-inputs mapping, (b) memory until RR-3, the spike's invalid-outcome
mutation test and its GPU flake, P1, AA-1's granularity half, AA-3, CC-3, DD-2,
BB-6, OO-1, the MuPDF cache's restore-without-reverify, and **II-2's hard trigger
before Stage 0 exit**.

---

## 2026-08-23 — QQQ-1's sweep, measured: the proof half is not a local operation at all

The `proof:*` sweep promised in the entry below has run. **It did not complete,
and the result is better than a green one would have been.**

```
8 passed, 0 failed, 1 timed out, 0 not run — 9 of 53 attempted.
44 script(s) were never reached and are NOT passes.
Timed out is NOT passed: proof:cff
```

`proof:cff` hit the 240s bound. It is not hung and it is not slow by accident:
`cffOobProof.mjs` **rebuilds libmupdf from a copy of the source with two patches
reverted**, because its control has to reproduce the out-of-bounds read the
pinned build fixes. That is a C library build, and it belongs to a job that
provisions MuPDF — `ci.yml:591`, in the shim job, and in no Guards job.

So the honest finding is sharper than *the sweep is slow*: **the derived
`proof:*` set is not a pre-push operation, and no timeout makes it one.** Raising
the bound until a MuPDF rebuild fits would be bumping a timeout to make a red go
away, which is a banned reflex, and it would still leave the sweep taking longer
than the review it precedes.

That narrows `checkLocal.mjs` a third time, and the narrowing is the point. It is
useful over `check:*` — ten scripts, all fast, all green — and that is precisely
**the half where the defect it was built after could not occur** (QQQ-1). The
tool is worth having and it is not a mechanism, which is what the reviewing seat
said before any of this was measured.

**The fix, named and not built, and it is a derivation rather than a hand-list.**
Which proofs are local-capable is already stated in the workflows: a proof
registered in a job that provisions something is by construction not one to run
before a push. `check:jobplacement` already reads job membership out of that same
YAML to answer a different question. A hand-maintained "slow list" is the
classifier shape this project has now fixed five separate defects in — pattern,
root, state, added-vs-changed, changed-vs-removed — and it would be a sixth.

### Correction, 2026-08-23 — RRR-1: the fix named above is false, and wrong in the reassuring direction

The reviewing seat refused the derivation proposed below, and it was right.

*"A proof in a provisioning job is by construction not a pre-push proof"*
confuses **what a proof needs with what it costs**. A developer machine IS
provisioned — that is what provisioning is for. What excludes `proof:cff` is not
its job; it is that `cffOobProof.mjs` copies the MuPDF source, strips the bounds
checks and runs MSBuild over the patched tree. **The cost is inside the script
and it is not in the YAML.**

Applied literally it takes out far more than intended. `ci.yml:123` provisions
Electron in the build job, so composition, contract, boundaries, kernelload,
stackOwnership, jobPlacement, win32Handle, lintRules, lintIgnores,
electronImports, preloadSurface and testResolution all go with it; the shim job
provisions twice over and takes pageGeometry, purgeCensus, pathDispatch,
documentHandlers, licenceProvenance and shimReach. The local set collapses to
the Guards proofs — roughly thirty fast, unit-shaped checks dropped, and those
are precisely the ones most likely to catch something before a push.

**And it shrinks in the direction that looks good.** A smaller set finishes
sooner and prints all-green sooner, and nothing in the output separates
*excluded correctly* from *excluded by a wrong premise*. That is the classifier
shape this repository has fixed five separate defects in — pattern, root, state,
added-vs-changed, changed-vs-removed — arriving inside the derivation I proposed
to replace a hand-list, using the argument I had just made against the list.

**The discriminator is measured cost, and the tool already measures it.** That
keeps GG-1's distinction intact: a hand-maintained slow-list is a list; a
duration table produced by running the sweep is data. Two changes and it is
done — record per-script duration as an output, and order the run by it
ascending. The stop at `proof:cff` stranded 44 scripts alphabetically, most of
which finish in seconds; ascending order makes the strand set the expensive
tail. No YAML parsing, no premise to be wrong about, and it stays honest on a
machine faster or slower than this one.

Never-measured scripts sort **last**, not first: an unmeasured script is the most
likely next `proof:cff`, and the report prints *never measured* as its own state
so a blank cannot read as cheap. Measured on the real repository — the second
run reorders `check:*` from alphabetical to 0.3s-first — and mutation-tested:
restoring alphabetical order reddens exactly the two ordering cases.

The narrowed conclusion below stands and never depended on the derivation:
`checkLocal.mjs` is useful over `check:*`, it is not a mechanism, and no timeout
makes the proof half a pre-push operation.

**Two things the harness got right under its own first real failure**, both
recorded because they were designed after the previous version got them wrong:
it **stopped** at the timeout rather than reporting results measured against its
own orphans, and it counted from what it attempted, so the 44 unreached scripts
are named as *not passes* instead of vanishing from the arithmetic. Its exit code
was 1; the `0` in the task notification was a trailing `echo` in the shell line I
wrapped it in, which is the same read-the-real-exit-code mistake as the
`| tail` one earlier today, in a third shape.

---

## 2026-08-23 — QQQ-1 to QQQ-3: a wrapper with no proof, a rule still living in prose, and evidence from the half that could not fail

### QQQ-2 — nothing proved the local sweep could report a failure at all

`checkLocal.mjs` had no proof. Its reassuring answer is **"everything passed"**,
and four different things print it: a clean tree, a misread exit code, a
mis-parse of `spawnSync`'s result, and a selected set that came back empty.
4b's shape in the one tool whose whole job is to report failures.

The direction is what makes it worth a proof. The first version **invented
failures** — noisy, and it announced itself inside one run. The mirror,
**inventing passes**, is silent, and after the fix it was the only direction
nothing watched. `annotate.mjs` is also "just" a wrapper and carries a proof for
exactly this reason.

Eight cases. Two of them read the **harness** rather than the results, because
item 2's own remedy rule says only such a case can catch a harness defect —
every assertion about results stays green either way, which is precisely how the
first version shipped with both properties wrong:

- **No shell is interposed.** The fixture repository's path contains a **space**.
  Spawned directly that is nothing; spawned through a shell the command line
  splits and the script is not found. The input is built from something that
  only succeeds when the property holds — the negative-probe rule inverted.
- **A timeout stops the sweep.** The first script hangs, the second would write a
  marker, and the marker's *absence* is the assertion — with a control run
  proving that second script writes it when nothing times out. Without the
  control, "no marker" is satisfied by a sweep that ran nothing at all.

Plus: a failing script is reported FAILED and a passing one beside it is not; a
derivation below the declared floor is refused; a script that is not a bare
`node` invocation is NOT RUN **and makes the sweep exit non-zero**, because
*everything I could run passed* and *everything passed* are different claims.

`--root` and `--floor` exist so the tool can be pointed at a fixture, which is
the only way its failure paths can be exercised. That is the convention
`stackOwnership.mjs` and `nodeModulesPlacement.mjs` already use.

**And writing that proof found a defect PPP-2 had introduced.** Its output
printed every passing line twice. Chased as a `process.exit` flush bug, which it
was not — the sequence numbers proved the cases ran exactly once — and the real
cause is that `passRoster.format` **emits the whole `ok` list itself**. Adopting
the roster while keeping the per-case writes it replaces is taking half a shape,
which is how a second opinion gets written. `composition.proof.mjs` is the shape:
`check` records and prints nothing. Both files now do.

### QQQ-3 — the second rule was still prose

`watchedSymbols(name, claim)` got a name and four callers. The *other* question —
what a verdict's list explicitly names — stayed as `claim?.symbols ?? []` inline
with a paragraph beside it explaining why it was not the first helper.

The paragraph was correct, and that is not the point: **the reason the OOO-1 fix
was a third opinion is that the rule lived in call sites and prose rather than in
one named thing**, and that was now true of the second rule. It is
`declaredSymbols(claim)` with three callers — the two OCR sites were using the
inline form too, and naming a rule while leaving its callers is the half-fix.

B5 over a comment: a future caller now picks between two names instead of
between a helper and a bare expression they must read a paragraph to reject.

### QQQ-1 — the corrected harness was verified where its defect could not occur

All ten `check:*` scripts passed through the fixed sweep. Those are fast and
spawn almost nothing — and the defect being corrected was a shell-killed timeout
orphaning a script's *children*, which **cannot happen in that half**. The
evidence came from the region where the bug was structurally impossible.

Audit item 2, and the third time in one stretch that the easy shape was the one
measured. The header now states this limit beside the two it already stated.

**The `proof:*` sweep is RUNNING as this is written, not finished** — 53 scripts
at up to 240s each, and `proof:advisories` alone took 136s. Its result is
recorded in a following entry rather than predicted here, because a sweep whose
outcome is written before it lands is the thing the board correction earlier
today was about.

### OOO-1 — the register's schema was fail-open in two ways

`assertVerdictShape` now refuses a key no verdict may carry, a key no witness may
carry, and **a witness keyed on a symbol the verdict does not watch**. The last
is the fail-open: a witness exists so a *misspelt* symbol fails — scanned for
absence under `shippedPaths`, witnessed for presence elsewhere, so a typo cannot
satisfy both (T-1). Drop the symbol and leave the witness and nothing is
consulted, so a typo in `symbols` beside the right spelling in `witness` is green
forever. T-1's own failure, reconstructed through the other door.

The control the reviewing seat specified worked exactly as asked: the parked
`witnessOrphanFinding` key turned the build red, and the fix deleted it.

**And the check found a real orphan on its first run** — `pdf_subset_fonts`.
Except it had not. That verdict carries **no `symbols` key at all**, and the rule
is that a verdict's own key is then its symbol. The two call sites that already
knew this spelt it `claim.symbols ?? [name]`; I wrote `?? []`.

**So the check written to catch a second opinion was itself a third one, within
minutes.** B3a does not care how well you know the rule — it cares how many
places implement it. There is now one `watchedSymbols(name, claim)` and four
callers. A fifth site was deliberately left alone with a comment saying why: it
asks what the list explicitly *names*, compared against a derived Electron
surface, where defaulting to the verdict's key would add a phantom symbol.

The proof carries the false positive permanently, and as a **locator** rather
than an invented fixture: the tracked register is asserted to pass, *and* to
contain a verdict of that shape. Asserting only the first would not notice the
day the shape stops being there.

### PPP-2 — a counted total cannot report a case that stopped running

`win32Handle.proof.mjs` printed a tally it computed from its own run, so a case
that silently stopped running took its line and the total together. It became the
file that most needed a roster the moment the desktop-copy cases arrived: 14 with
the build present, 12 without. A runner-dependent count is precisely the state
`passRoster` was built to refuse.

It now declares 14 and records the two build-dependent cases as **skips** where
the build is absent — `advisoryRegister.proof.mjs` solved the same varying-count
problem the same way, and taking its shape was the point. All three states
executed: 14 passed; 12 passed with 2 *not applicable*; 2 failed under
`--require-desktop-copy`.

**The general note is the one worth keeping.** The three-state UNVERIFIABLE
discipline now has two hand-rolled implementations with two different flag names
(`--require-derivation`, `--require-desktop-copy`). **The second opinion is the
finding, not the wrong one** — neither is wrong today, and that is exactly the
condition under which a third gets written. Not consolidated here; recorded so
the next one is a consolidation rather than an addition.

---

## 2026-08-23 — PPP-1: the surface commit went red on two guards, and I had run neither

`63871ad` failed both jobs. Typecheck, lint, the full vitest suite, `check:docs`,
the register, its proof and `proof:win32handle` had all passed locally. **The two
checks that went red are the two I did not run**, and that is the finding — not
the two defects, which were both guards working exactly as designed.

### What failed

**Guards** — the new desktop-copy case in `proof:win32handle`. That job installs
nothing and builds nothing, so `apps/desktop/dist/win32HostSurface.js` is absent,
and I had written the absence as a *failing case* on the reasoning that a missing
copy and an agreeing copy must not share an output. That reasoning is right and
the conclusion was wrong: there are **three** states, not two — `agrees`,
`disagrees`, and `could-not-read` — and failing on the third says *the copy is
wrong* when the truth is *nothing looked*. Exactly ZZ-1's shape, green here and
red there, introduced by me an hour after answering *no* to the audit's own
question about branches keyed on provisioning.

Fixed by reusing a pattern this repository already reviewed rather than inventing
one: UNVERIFIABLE where nothing is built, counted apart from the passes, and
`--require-desktop-copy` in `ci.yml`'s build job makes it mandatory there. The
same shape as `--require-derivation` on the advisory register. All three states
executed: 14 pass with the build, 12 pass plus one UNVERIFIABLE without it, and
1 of 13 FAILS without it under the flag.

**CI** — `proof:electronimports`, and it caught something better than I expected.
Both new files reach the build through a computed `file://` specifier, and that
scan treats a computed specifier not as a violation but as **a site where the
rule cannot answer**, demanding the file be listed with a reason and a site
count. Two entries added. The scan was right to stop the commit: a dynamic
specifier is precisely where an electron import could hide from it.

### The transferable part

**I chose which checks to run, and I chose by what I thought I had touched.** The
surface is a new native adapter, so I ran typecheck, lint, tests, and the proofs
about handles and advisories. Neither failing check was on that list, and neither
would ever have been — the connection from *a research probe importing the build*
to *the proof that nothing can trigger an unpinned Electron download* is not one
intuition makes.

Running the whole Guards set locally afterwards took under a minute and all 34
were green. The CI set cannot be run locally in reasonable time — several spawn
Electron and the sweep timed out at ten minutes — which is what CI is for, and
also why the cheap half should have been run first.

So the rule is not *be more careful*: it is that **selecting checks by relevance
is a search whose reassuring answer is "nothing to run", and it needs the same
treatment as any other search.** The Guards set is cheap, complete, and requires
no judgement. Run it.

### Correction, 2026-08-23 — the remedy above catches neither defect

The reviewing seat measured the last paragraph and it is wrong. *Run the whole
Guards set locally* would have been **green before either fix**, for two
different reasons, and both are worth more than the remedy was.

- **The Guards failure was provisioning-keyed.** The copy is
  `apps/desktop/dist/win32HostSurface.js`, a build output, so on this machine it
  exists and the case passes. That is audit item 3's inverse — the richer machine
  is the one that hides it — and **no local sweep of any completeness can reach
  it.**
- **The CI failure cannot be reached locally at all.**
  `electronImports.proof.mjs` appears only in `ci.yml`, at lines 263 and 436, and
  in no Guards job. No Guards sweep would ever have run it.

So the compensation does not compensate, and closing PPP-1 on it would be the
AA-1 mistake exactly: **a remedy with an unstated scope reading as a mechanism.**
The real mechanism for both is the board, and the discipline is the one stated
above it — do not report before the board lands.

What survives is the **selection** half, and it is worth keeping on its own:
`npm run local` derives the set from `package.json` the way
`annotateCoverage.mjs` derives its proof set, so no judgement enters the path.
`scripts/checkLocal.mjs` states in its own header that it sees neither a
provisioning-keyed branch nor a workflow-only proof, because that is the sentence
this correction exists to have written down somewhere a reader will meet it.

**And building it produced a third instance of the same class.** The first
version spawned `npm run --silent <name>` through a shell with a timeout. On
Windows that kills the shell and orphans the real process, so after three genuine
timeouts, twenty scripts failed in 0.2s with no output — each of which passed in
four seconds when run alone. A harness that invents failures is worse than none;
this project already wrote that *a scan which cries wolf is a scan someone
relaxes*. It now invokes the interpreter directly, and **a timeout stops the
sweep** rather than reporting results measured against its own wreckage. Killing
a process tree properly on Windows needs a job object, which is a real unit and
not one to bury in a convenience script.

---

## 2026-08-23 — The Win32 surface, and OOO-1: an orphan witness passes exactly as loudly as a working one

ADR-0023 Decision 8's factory has had its ordering proven against an injected
surface since `8935b6c`, and nothing behind that surface existed. It does now:
`apps/desktop/src/win32HostSurface.ts`, bound with koffi.

### It carries no `any`, and that was not the plan

B7 permits one adapter module per native boundary to hold `any`. It does not ask
for one, and the cheap version of this file would have had fifteen call sites the
compiler could say nothing about. Each entry point is declared with the signature
from the C prototype on the adjacent line instead — and **no cast is needed to do
it**, which is the part worth knowing: koffi's `func()` returns a callable
assignable to every signature, so those declarations are an assertion the
compiler will never check. The adjacency is the whole review mechanism.

**Four returns are `unknown` rather than `boolean`, deliberately.** Lint reported
the fail-closed `=== true` guards as unnecessary comparisons — correctly, given
that my own declarations had told it they were booleans. That is the runtime
loop's stop-flag case again: *a type asserting away the case the next check exists
for*. Every call whose wrong answer would weaken containment — process creation,
the limits, the assignment, the membership read — is left unnarrowed, so the
comparison is required rather than redundant. Typing them would have been the
adapter deciding a security question.

`isInvalidHandle` is a **copy** of `scripts/lib/win32Handle.mjs`, because
`apps/desktop` cannot import plain Node under `scripts/`. MMM-1's rule decided
it without a new argument: *make a copy only where the reader cannot reach the
source, and prove every copy that exists*. The judgement half is factored out —
which is also the half that was wrong three times, since all four broken
spellings were wrong comparisons and never failures to read an address — and
`proof:win32handle` drives the owner with an identity address reader so the two
are the same function on the same inputs. Fifteen cases now, with a control that
the comparison can see a disagreement.

### It runs, and the differential holds

`scripts/research/hostSurfaceProbe.mjs` creates two real processes through the
shipped surface. First run, no repair needed: `in-job`, `previousSuspendCount`
of exactly 1 — so `CREATE_SUSPENDED` took and the thread had not executed — and
the child reaching its last line. The child under the job is **refused** a spawn;
the same child with no job of ours is **allowed** one. One variable, so the
refusal is evidence rather than a machine that cannot spawn.

Resolution-tested rather than trusted: removing `JOB_OBJECT_LIMIT_ACTIVE_PROCESS`
turned the verdict `UNREADABLE — job cell spawn=allowed, no-job cell
spawn=allowed`, exit 1.

**And that run found a defect in the probe.** The teardown was a `finally` around
the measurement; the mutated run left a grandchild holding the scratch directory,
`rmSync` threw `EPERM`, and the stack trace buried the verdict while the exit
code stopped meaning what the verdict said. It happened to agree that time — both
wanted 1 — which is exactly how this survives review. Cleanup now runs after the
verdict, reports its own failure on its own line, and never touches the exit
code: **a could-not-clean is not a measurement failure.** Demonstrated in anger
on the next run, which failed to tidy up and still exited 0 with the verdict
standing.

The mechanism behind the `EPERM` is stated rather than bumped past: the child
holds the diagnostic log as its stdout, and `TerminateProcess` is asynchronous,
so the kernel releases that handle after our call returns. Waiting properly needs
`WaitForSingleObject`, which is not part of host creation and does not belong in
the surface.

### KKK-1 discharged, on the day the ruling said it would be

Staging the file expired four verdicts — `CreateProcessW`,
`CreateAppContainerProfile`, `AssignProcessToJobObject`, `STARTUPINFOEXW` — for
the first time on **genuine uses** rather than on prose. Three earlier firings
were doc comments, where the reviewer's ruling said reword; the subject has now
occurred, so re-triage is correct. The absence inputs are removed rather than
narrowed, because a symbol that cannot be absent is not an absence claim. The
electron three stay: their meaning changed rather than expiring, and they now
mean *ADR-0022 was reverted and somebody went back to the fork route*.

Worth noting the window the register documents about itself and which held
exactly: `git grep` reads **tracked** files, so the surface was invisible and the
register green until the moment it was staged.

### OOO-1 — the register accepts a witness for a symbol it does not watch

Found by accident, which is the only reason it was found. Removing the four Win32
symbols left their `witness` entries behind, and `check:advisories` stayed
**green** — eighteen symbols verified, four witnesses in the file naming symbols
the verdict no longer lists. It also accepted a deliberately misspelt top-level
key in silence.

**This is T-1's own failure arriving through the witness side.** A witness exists
precisely so a *misspelt symbol* fails; a witness whose symbol is absent from the
list passes exactly as loudly as one doing its job. So a typo in `symbols` beside
a correct spelling in `witness` would be green forever — the pair T-1 was bought
to prevent, reconstructed from the other direction.

Recorded rather than fixed, and the reason is not convenience: tightening a
security register's schema is its own unit with its own control, and it needs the
reviewing seat. The fix is named — reject an unknown key on a verdict, and reject
a witness keyed on a symbol the verdict does not list. The finding is parked in
the register **as an unknown key**, so the day the schema is tightened that line
fails the build and is deleted by the fix that makes it obsolete.

---

## 2026-08-23 — MMM-1: three documents named the wrong writer of record, and the tree held both readings at once

The reviewing seat found that `docs/ARCHITECTURE.md` §9.27, `CLAUDE.md` and
`apps/desktop/src/windowPolicy.ts` all state that **the code holds the pen for
the memory budgets** and that the CSP's direction is deliberately the opposite.
Checked: `scripts/lib/memoryBudgets.mjs` declares
`SOURCE_FILE = 'docs/ARCHITECTURE.md'` and parses §9.17's machine-read line, and
ADR-0012's own title is *machine-read from the invariant*. §9.17 holds the pen
exactly as §9.27 does.

`check:docs`'s restatement rule is not a code-holds-pen mechanism at all. It
forbids §9.17's **surrounding prose** from carrying a second copy of a number the
section states once — prose against prose, inside one section. Reading it as
code-against-document is where the whole error came from.

### There were never two opposite patterns

One pattern, two shapes, and the axis that varies is whether the derived side
keeps a **copy**:

| concern | pen | copy | what checks it |
|---|---|---|---|
| §9.17 budgets | the document | none — the reader parses the line | `check:docs`, against a second copy in the section's prose |
| §9.27 CSP | the document | yes — a renderer cannot parse markdown | `proof:rendererpolicy`, that the copy equals the source |
| the host's job limit | the document | yes — `apps/desktop/` cannot import `scripts/` | `proof:composition`, recomputed from the invariant |

**Make a copy only where the reader cannot reach the source, and prove every copy
that exists.** That covers all three where the contrast covered two, which is the
argument for preferring it beyond its being true: the replacement is a rule about
*readers*, and the thing it replaced was a rule about taste.

ADR-0019's decision is untouched — its rejected alternatives argue from what a
`.ts` diff gets reviewed by, not from the comparison. What falls is the argument
from contrast, and with it the standing of *"which side holds the pen is decided
per concern"*: not shown false, but **no concern in this repository currently
puts the pen in code**, so the sentence survives as a principle with no instance
here. Stated in the correction so the next person to reach for it knows they will
be the first.

### Why no check could have caught it, and why review did not

Every carrying sentence pairs a true clause with a false one. *"This document is
the writer of record, and that is the opposite of the memory budgets"* — the
first half is the half a reader is checking, and it is correct, so it vouches for
the second. Item 7's compound claim, at document scale rather than in a function
comment.

The citation made it worse rather than better. ADR-0019 cites ADR-0012 as the
authority for the claim ADR-0012 contradicts: a cross-reference that **resolves**,
and therefore passes every link check in the repository, while sending the reader
to a real document that says the opposite. UU-1 said a resolving cross-reference
can still be wrong and no check can see it; this is that, with the resolving link
actively lending credibility.

**And the tree held both readings simultaneously.** `apps/desktop/src/budget.ts`
says *"the same direction the CSP takes, with the document as writer of record
and the code derived from it"*, and ADR-0023 §7 says *"the invariant holds the pen
and code reads it"*. Both correct. Both written on 2026-08-22, by me, with
`windowPolicy.ts`'s opposite claim sitting in the same package. Writing the true
version twice in one day did not surface the false one — which is the same
observation the backtick count keeps making, arriving in prose about
architecture instead of in an emitted template.

Document classes handled separately (item 7): ARCHITECTURE, CLAUDE.md and
`windowPolicy.ts` are live specifications and their bodies are edited true;
ADR-0019 is a record and takes a dated correction with the body left as written.

### KKK-1's ruling applied: the reword keeps its vagueness and gains an expiry

Neither answer I proposed was right. Re-triaging the invariant-25 verdicts today
would **narrow a security trigger on the day it fired**, for a module whose
subject — native code creating a process — has not occurred. Rewording is not a
policy either: it pushes a security-relevant file's comments toward saying less,
which is a cost paid by every reader who cannot tell which call is meant.

So the reword stays and is dated. The trigger is the **Win32 surface module**:
when it lands those symbols become genuine uses, the verdicts fire for the right
reason, and re-triage is then correct. Written into `engineHostFactory.ts`'s own
comment and carried on `docs/FEATURES.md`'s Decision 8 row — the row, because the
expiry is an **event** and a symbol scan cannot see one. The real fix is priced
and unchanged: the register's verdict half must stop greping, the way
`stackOwnership.mjs` stopped, with `check:jobplacement` as the precedent for a
compiler-based scan that still works where `node_modules` is absent.

### The rule that separates a legitimate trigger-stopping change from a workaround

Given by the reviewer and recorded because it will be needed again:

> **A change that stops a trigger is legitimate when it would have been right
> anyway, and suspect when its only benefit is that the trigger stops.**

`rendererHarnessMain.ts` swapping `toStructuredError` for `util.inspect` passes
that test and is **not** re-triaged: Node owns how a thrown value renders and how
`cause` is walked, so calling it is B3a and would have been the right call with
no register in existence. The factory's comments fail it — their only benefit is
that the grep stops matching — which is exactly why they need a dated expiry and
the harness swap does not.

---

## 2026-08-23 — LLL-1: the containment spike's blocker is a cell no property reads

RR-3 is the research→proof transition: promote the spike's four-property
differential into a proof that runs on the shim job. The first step is to run
the instrument, and on this machine **it produces no property table at all**.

Chromium's GPU process crash-loops until the app gives up — *"GPU process isn't
usable. Goodbye."* — about one second in, and the run dies with `no report
line` and exit 1. The instrument behaves correctly under the failure; it simply
cannot measure here.

That flake was already recorded as an open negative result, with
`disableHardwareAcceleration()` and `--disable-gpu` **measured not to work**, and
the note ended by saying the reason to keep hunting it is that a red meaning
something other than what it says gets re-run. Hunting it is the wrong move.

### The blocker is the Electron app, and the app exists for one cell

Executed rather than reasoned: `require('electron')` in the spike supplies `app`
and `utilityProcess`, and `utilityProcess.fork` appears **once** — the `baseline`
cell. Every cell the PROPERTIES table reads goes through our own
process-creation route. A parent needing only koffi, Win32 and `net` is plain
Node, and plain Node starts no GPU process.

So RR-3's proof asserts the four properties and their route control with **no
Electron app anywhere in it**. The fix is a removal, not a Chromium switch —
*prove the limit has to exist before designing around it*, applied to a flake
instead of a bound.

This is not a coverage cut. ADR-0022 decided the hosts are processes we create,
which made the forked baseline a historical comparison; it stays in the research
file as a second opinion from a different route, and it was never the
attribution for any property — the spike's own comments say so, and WW-1's
matrix is what made that true by giving every property a same-route pair.

**TT-1 is still discharged.** The cells run the Electron *binary* under
`ELECTRON_RUN_AS_NODE`, so the shim job's Electron provisioning step keeps the
consumer RR-3 says it must have. What goes away is the Electron *app*, not the
Electron dependency.

### What this says about the spike as an instrument

A known flake in a cell that **no property reads** takes the whole measurement
down, because all five cells run inside one app that emits one report line. That
is a coupling worth naming on its own: the instrument's blast radius is the app,
not the cell, so the least important cell can silence the most important table.

Not fixed in the research file, deliberately — the proof is where the reduction
belongs, and changing the spike now would edit the instrument that produced
every reading ADR-0023 rests on. Recorded as the reason the proof is shaped
differently from the spike it comes from.

> **Measured the same day, and it corrects the entry above.** The claim that the
> four properties do not need the Electron app was reasoned from which cell
> imports what. It is now executed: a copy of the spike with the electron import
> replaced by a stub, the baseline cell removed and the parent spawned as plain
> Node ran **all four cells to a report** — `lowbox` and `lowbox-no-job` at
> integrity `0x1000`, `route` and `route-no-job` at `0x2000`, the job present in
> two and absent in two. The whole variant matrix, with **no GPU process and no
> crash**. The copy was deleted after the reading.
>
> **And the run printed no property verdict at all, which is the correction.**
> The entry says the four properties do not use the baseline. That is true of the
> PROPERTIES rows and **false of the route control that gates them**: the control
> compares `route` against `baseline`, so removing the baseline made it
> `unreadable`, and the instrument refused every verdict —
>
> > ROUTE BROKEN — no property verdict is printed.
>
> The control working exactly as designed, on the person who removed its
> counterpart. Dropping the baseline is therefore **not free**, and the entry
> above reads as though it were.
>
> **What RR-3 has to decide, stated rather than absorbed (audit item 2a).** The
> route control must be re-expressed from *our route behaves like the fork route*
> to *the uncontained cell of our route is a working host* — koffi loads, the
> shim loads, a handed document opens, all of which this run observed as
> `allowed`. That is defensible, because ADR-0022 made the fork route historical
> and "our route differs from a route we no longer use" is not a defect. It is
> still a **weaker control than the one it replaces**: the differential could
> catch a route that produces a subtly different host, and the self-contained
> version catches only one that produces a broken host.
>
> Recorded here because a control that changes shape during a promotion is
> exactly the change that gets absorbed into "the proof is a bit different from
> the spike".

---

## 2026-08-23 — KKK-1: the register's scan cannot tell naming a symbol from using it, and the third time is the one to record

The pre-push gate did its job on its second real push and blocked the engine
host factory: three invariant-25 verdicts expired, on `CreateProcessW`,
`AssignProcessToJobObject` and `classifyContainment`.

**All three fired on prose.** The factory names those calls in doc comments
describing what each member of its injected surface maps to. It creates no
process — there is no Win32 surface — and it consults no containment check.
Neither trigger's *subject* has occurred.

### Why the response was to reword rather than to re-triage, which is the opposite of what the verdict's own words say

`engine-host-containment` reads: *"The day shipped code **names** one of the
symbols below, this verdict expires."* By that sentence I expired it, and the
prescribed answer is a re-triage.

The re-triage was drafted and refused. It would have had to re-point the symbol
set at something still absent — `koffi` under the shell was the candidate — and
that is **narrowing a security trigger on the day it fired**, for a module that
does nothing the trigger is about. The alternative reading costs a few comments:
the trigger is aimed at *a host can be created*, that day is when the surface
lands, and the names belong in the surface module where they will be genuine
uses.

So both triggers stay armed at **full strength**, unchanged, and this file's
prose stops spelling them. Recorded here because it is a real judgement and the
opposite one is defensible: a reader who thinks a trigger firing should always
be answered by re-triage should overturn this.

### The class, which is what makes it a finding rather than a chore

**Third occurrence.** HHH-1 was the first — a comment explaining why a helper was
*avoided* kept a verdict red. That was recorded as a stated limit, with
over-firing called the safe direction for a security trigger, which it is.

What three occurrences show is narrower and worse than "it over-fires": **the
modules most likely to discuss a watched symbol are exactly the ones being built
to use it.** The over-fire is not spread evenly over the codebase; it is
concentrated on the files the trigger most wants to watch. And the pressure it
creates is to write vaguer comments in the security-relevant module — which is
the wrong direction for everything except the scan.

**Priced, not built.** `scripts/lib/verdict.mjs` matches with `git grep`. Reading
code rather than prose is what `stackOwnership.mjs` already does with the
compiler, and what `electronSurface.mjs` does for the same reason — its own
header records that `electron.d.ts` is 56% comments and that a text search
"would witness a symbol that had been REMOVED, which is worse than missing one".
**That argument is already in this register, for the witness half.** The verdict
half still greps. Making it parse is a unit; the obstacle is that the scan runs
where `node_modules` may be absent, and the register must keep working there —
which is `check:jobplacement`'s subject, one day old.

Until then, the rule for anyone writing under a watched glob: **describe the
call, do not spell it**, and put the name where it is used.

---

## 2026-08-22 — GG-1 closes for one member: the pre-push gate reads the register's own globs

GG-1 recorded a rule and named the obstacle to mechanising it: *proofs address
their inputs by construction*, so no literal path exists to map a proof to the
files it reads. That is true of proofs and **false of the advisory register** —
its `shippedPaths`, witness `in` and control `from` entries are literal strings
in a tracked JSON file, put there so `git grep` can use them. The mapping
already exists as data.

So the member of GG-1 that produced **all three occurrences** is now a mechanism:
`.githooks/pre-push` runs the register against the tree whenever the pushed
range changes a file any of those globs matches. Nine pathspecs today, read from
the register rather than listed.

**Pre-push, not pre-commit, and the reason is where the harm is.** All three
occurrences were at push. A commit that will be amended or rebased has published
nothing; a push is permanent under B10.

**Offline and deterministic**, using the flag built one commit earlier for a
different caller. What expires a verdict is the reachability walk — baseline,
`git grep`, the compiler — and none of it consumes the advisory feed, so the
local gate passes `--recorded-advisories` and cannot fail because a third party
was unreachable. A gate that can go red for a reason outside the repository is a
gate people disable. `check:advisories` itself still fetches, and a case
requires that.

The positive control is in the hook, not only in its proof: at least one watched
pathspec must match a tracked file on every run. A glob that matches nothing —
or one whose syntax git stopped understanding — answers *this push touches
nothing watched* for every push, forever.

**Still open, and narrower than before:** the general mapping from a proof to the
files it reads. One member of it is closed; the rest is not, and the two
candidates priced in GG-1's entry (a runtime trace, or a declaration beside each
proof) are unchanged.

---

## 2026-08-22 — III-1: a FEATURES item that was not a row, and nothing was red

`docs/FEATURES.md:283` — the engine-host containment item — carried exactly one
pipe, the leading one. It was not a malformed row; **it was not a row**. The
table above it terminated, the item rendered as prose with a stray pipe, and it
appeared in no status count. `check:docs` passed, because every check there
reads rows it can find and this had stopped being one.

**One occurrence, so the defect is an instance. The way it hid is a class**, and
it is the one this project keeps paying for: *an absent status reads exactly like
an empty one*. That is DDD-1's sentence — when one half of a classifier carries
three states and the other carries two, the asymmetry is the finding — arriving
in a document instead of in a report. Nobody audits for a row that is not there.

It matters more here than in a report, because of the document-class rule
already in `CLAUDE.md`: a FEATURES row is a **live specification of what is
owed**, not a record of a moment. An item that silently leaves the table is a
commitment that stops being counted while still looking present to a reader
scrolling past it.

The status is restored as **partly done** with what the row's body now supports:
three of invariant 25's four properties have a mechanism confirmed on a running
process, the job's memory limit is printed as `NOT MEASURED` rather than assumed,
and the readings are taken against a research instrument because the shipped host
factory does not exist. Both triggers are named in the body, RR-3 being the one
that moves the assertions off the spike.

`check:docs` now requires every line opening a row inside a FEATURES table to
carry as many cells as its table declares. It is a search, so it refuses when it
finds fewer than twenty well-formed rows — a separator pattern that matches
nothing makes every table invisible and every row skipped, and reports no
problems while doing it. Both directions measured: fed the real defect it names
`docs/FEATURES.md:283`; with the separator pattern broken it reports the control
rather than a clean document.

---

## 2026-08-22 — HHH-1: the register's expiry fired on my own change, one push later

`d55b893` went red on **both** workflows. Not the network, not a platform: the
advisory register's `renderer-facing-errors-carry-no-text` verdict expired,
exactly as designed, because `apps/desktop/src/rendererHarnessMain.ts` had
started naming `@monstera/shared`'s structured-error helper.

That is the mechanism working at full strength — a claim whose expiry is *the
day shipped code names X*, firing within one push of the naming, on a change
made for an unrelated reason (FFF-1's fix for a discarded `cause` chain). It is
also the third proxy failure on this same directory, and the second finding this
week about where a claim's expiry lives.

### What was done, and the alternative that was refused

The harness now renders with `util.inspect`, which walks `cause` and prints the
errno fields beside it — Node's own answer to "render a thrown value", so B3a
says implement it once and call it rather than hold a second opinion. It names
no watched symbol and no `stack`, so FFF-1's scan stays satisfied with no
exemption.

**The refused alternative is the more interesting half.** Keeping the helper and
re-triaging the verdict would have meant narrowing its stated input — *no code
under `apps/*/src/**` builds a diagnostic* — so that a **proof harness** could
use a nicer helper. The claim itself still holds: this file writes to its own
stderr, is not re-exported by `index.ts`, and owns no channel. But weakening a
security verdict's scope to accommodate a harness is the trade the wrong way
round, and "exclude the file that tripped it" is an exception list with one entry
and room for more.

### Three things the trigger cannot do, and only one of them is a defect

- **Its `shippedPaths` glob is a DIRECTORY PROXY for "renderer-facing".** The
  harness is not renderer-facing and the glob cannot tell. `CLAUDE.md` already
  records that `apps/desktop/src/` is exempted as a proxy for *runs inside
  Electron* and that **the proxy has failed three times**; this is a fourth
  failure of the same directory standing in for a property. The answer there was
  *ask which mode a file runs in, never which directory it sits in* — and the
  precise input here is **reachable from the package's exports**, which is
  derivable and not built. Recorded with its trigger: it becomes a defect the
  first time a genuinely renderer-facing file is missed, or the first time
  someone narrows the glob instead of deriving it.
- **It scans with `git grep`, so a COMMENT naming the symbol expires the verdict
  exactly as a call does.** Measured here: the first fix kept the verdict red
  because the comment explaining why the helper was avoided spelled its name.
  This over-fires, which is the safe direction for a security trigger, and it is
  the opposite choice from FFF-1's scan — where over-firing on prose would have
  needed an exception list, so the walk was made unable to see comments at all.
  **Both are right, and which way a scan should err is decided by what its
  false positives cost**, not by a general preference.
- **Its symbol set is a proxy for "assembles free text", and `util.inspect` is
  outside it.** A real IPC handler using it would not trip the trigger. That
  hole exists whatever this commit does — the trigger has always watched two
  names — but this commit is the first code under the glob to walk through it,
  so it is written down here rather than left for whoever finds it next.

### GG-1, third occurrence, and this one WAS derivable

The reason the red was found by CI rather than locally is GG-1 again: the change
touched `apps/desktop/src/`, `check:advisories` reads `apps/*/src/**`, and I did
not run it. Same class as the two occurrences `3a58ed6` recorded, and the same
cost — a push, a red board, and a diagnosis.

**But the obstacle that entry recorded does not hold for this check.** GG-1 says
the mapping cannot be derived because *proofs address their inputs by
construction*, so no literal path exists to grep for. That is true of proofs. It
is **false of the advisory register**: its `shippedPaths` and witness `in` globs
are literal strings in a tracked JSON file, so "which check reads which path"
already exists as data for this one. A pre-commit rule that runs
`check:advisories` when a commit stages a file matching any declared glob is
derivable today, from the register itself, with no list.

That does not close GG-1 — it narrows it. The general mapping is still
undecided; one member of it is not.

---

## 2026-08-22 — Stage audit: `d3ea661..d55b893` — a flag nothing proves takes effect, and a step on the job that cannot run it

**Audited through `d55b893`.** 9 commits, 23 files, **2 proofs added, 4
modified**, 2 new instrument files and **7 changed** — from `npm run audit:scope`.

The range is EEE-1's re-verification, the OSV fix, EEE-2's requirement, EEE-3,
GG-1's note, and FFF-1. Findings **GGG-1** to **GGG-3**.

### 1. Root cause or workaround

Seven fixes. Six are root cause. **The OSV one needs a sentence it did not get.**

`a8cc7f8` moved 31 of the advisory proof's cases off the live feed onto a
recorded one. That is correct on its own grounds and the grounds are stated: a
case about *register logic* — a missing key, a misspelt symbol, an empty witness
scope — has no business depending on what a third party answers today, and one
proof run was reaching `api.osv.dev` dozens of times with `fetchAdvisories`
throwing on any non-OK status by design.

**But it is not evidence about the red at `a0d2ec0`, and the commit reads as
though it might be.** That failure was never diagnosed — Actions serves logs only
to authenticated callers — and the network hypothesis remains a hypothesis. A
correct change made in the neighbourhood of an undiagnosed failure is the exact
shape that closes a finding without fixing it. The red stays open and
unattributed; the change stands on the reason given, not on that one.

### 2a. A change to HOW something is proven moved the coverage

The same change, and it is a reduction that has to be stated rather than
inferred. Before: 31 invocations exercised the checker end-to-end against the
live feed, so a change in OSV's response *shape* would have reddened all of them.
After: one case does. The parse is still covered — the live case runs the whole
checker — but it is covered once, and the failure of that one case is now the
only externally-fallible signal in the file. It is named that way in the case
title, which is the mitigation.

### GGG-1 — the new steps were registered on the one job that cannot run them

`check:stackowner` and `proof:stackowner` were added to `guards.yml`. **Guards
runs no `npm ci`.** The scan builds a TypeScript Program per project, so both
steps would have failed on every Guards run, on both platforms, from the commit
that added them. `ci.yml` already carries two steps placed there for precisely
this reason, each with a comment saying so.

**This machine could not have shown it**, and that is the finding rather than the
slip. `node_modules` always exists here, so the branch that throws when the
compiler is absent never executes locally. Item 3's second question — *is there a
defect THIS MACHINE cannot see* — found it one commit later and before either was
pushed. Fixed in `d55b893`.

**Its proof case moved too, and the reason generalises.** The registration case
read `guards.yml` **by name** and asserted the string appeared in it. That case
would have stayed green while the steps sat in a job that cannot run them: it
asserted the step was *somewhere*, not that the somewhere could execute. It now
reads every workflow out of the directory. **A registration check that names one
file is a check about a filename, not about registration.**

### GGG-2 — `--recorded-advisories` has no case that proves it takes effect

**Open, with the remedy priced.** The flag selects the recorded feed in
`engineAdvisories.mjs`. If its parse broke — a rename, a typo, an argv change —
every one of the 31 register cases would silently fetch live and **still pass**,
slowly. Nothing in `advisoryRegister.proof.mjs` separates those two worlds.

That is item 4 in its sharpest form: *the reassuring answer here is "the cases
pass", and a no-op flag produces it too.* And the property left unproven is the
one the whole fix rests on — the file's own comment says grepping for `liveRun`
finds every live case, *currently one*, which is true only if the flag works.

The fixture that would separate them is derived, not restated: have the checker
print the advisory **source** and assert that a recorded run says so.

> **Closed the same day, and the first draft of that remedy was wrong.** The
> sentence above originally proposed asserting the *count* — that a recorded run
> reports exactly `osv-recorded.json`'s own length — on the reasoning that a live
> count equals 74 only by coincidence. It is not a coincidence: **the recording
> was made from the live feed**, so the two counts agree by construction, and a
> count assertion is a fixture the defect also satisfies. That is item 4's other
> half — *never build a fixture the bug also handles correctly* — arriving inside
> the remedy for a vacuity finding.
>
> The label is what separates them, because it is downstream of the same
> `useRecorded` decision. Mutated to check: with the flag forced to a no-op,
> **exactly one case goes red** and its diagnostic prints both runs saying
> `from the LIVE feed`, with `74` on both lines.

### GGG-3 — the checker's Usage block does not list the two flags it gained

`engineAdvisories.mjs`'s header ends with a `Usage:` block naming two
invocations. The range added `--record-advisories` and `--recorded-advisories`,
and the block still names two. This is item 7 at comment scale, in the shape that
does not get caught: **the stale half sits in the position a reader treats as the
contract**, and the section explaining the recording lives further down where a
skimmer never reaches. A `Usage:` block is a live specification, so it is
corrected by editing the body.

### 3. Would CI have caught it?

GGG-1, no — it *was* CI, in the sense that CI would have gone red on the first
run. The audit caught it before the push, which is the cheaper end of the same
mechanism. GGG-2, no: a no-op flag is green everywhere. GGG-3, no: no check reads
a comment for completeness, and none should.

The cost of the new scan is measured rather than assumed: **≈18 s** per run, two
platforms, from seven `createProgram` calls. It buys the separation no textual
scan can make, and it fails closed when the compiler is absent.

### 4, 4a, 4b. Vacuity, resolution, and the searches

`stackOwnership.mjs` was mutation-tested three ways and each mutation reddened
exactly the case that exists for it: folding UNRESOLVED into `other`, disarming
both controls, and dropping the destructuring branch. Its resolution test is the
one that matters for this instrument — **the same text on two receivers that
differ only by type**, `Error` at line 6 and a declared field at line 14, must
come back as different verdicts. And it was run against the **real pre-fix file**
rather than a fixture: with `perfBudget.proof.mjs` reverted it names
`perfBudget.proof.mjs:203`.

Stated precisely, because the discipline says *before* it measures anything real:
the first run against this tree happened before the mutation, and it returned a
**finding** rather than silence, so it was never resting on an unverified "found
nothing". That is luck, not method, and the mutation followed within minutes.

Both new instruments are searches and both carry controls that run in the
instrument, not only in the proof: `annotateCoverage` must locate a wrapped
invocation, `stackOwnership` must locate an Error-typed read in **each** owner,
and both refuse to report when they cannot.

### 5. Executed, or asserted?

**Executed:** `proof:stackowner` (24 cases) · three mutations of the scan ·
the real-file pre-fix mutation · `check:stackowner` · `typecheck` (both
projects) · `eslint` on every changed file · `check:docs` ·
`check:emittedtemplates` · `check:annotatecoverage` · `proof:annotatecoverage` ·
`proof:perfbudget` (31 cases, with the `formatError` change in place) ·
`proof:rendererpolicy` (17 cases, real Electron, with the one-line harness
payload) · `guard:staged` · the pre-commit hook twice.

**Asserted, not executed:** that `check:stackowner` passes on both CI runners —
the board will say, and it is the first run of a step that needs `node_modules`
in a job whose sibling does not have it; that 18 s is acceptable there; and
GGG-2's whole subject, which is asserted by a comment and by a call-site split.

### 6, 7. Architecture, and the documents

No architecture changed underneath a feature this range. ADR-0023 §8 was written
**before** any factory exists, which is the order B4 asks for.

`docs/JOURNAL.md` gained the Y-3 closure as an appended note rather than an edit,
because what Y-3 concluded at the time is the record and the useful part is that
its blocking question was answered by being **rejected**. `FFF-1a` — three
opinions about the entry-point test, one of them written yesterday by me — is
recorded there rather than fixed, with the consolidation priced.

Open from earlier ranges: the unattributed red at `a0d2ec0`, GG-1's derivation,
(b) memory until RR-3, the spike's invalid-outcome mutation test and its GPU
flake, EEE-3's `check:*` scope, P1, AA-1's granularity half, AA-3, CC-3, DD-2,
BB-6, OO-1, the MuPDF cache's restore-without-reverify, and **II-2's hard trigger
before Stage 0 exit**.

---

## 2026-08-22 — Stage audit: `1d5e6d6..d3ea661` — the instrument that was dark for four commits, and the column that cannot see a deletion

**Audited through `d3ea661`.** 7 commits, 17 files, **0 proofs added, 3
modified**, 1 new instrument file and **5 changed** — from `npm run audit:scope`.

The range is AAA-1's comment, ZZ-1's residual, WW-1's consolidation, BBB-1, and
CCC-1. Two findings came out of *using* instruments rather than reading them,
which is the whole argument for the scoped audit.

### 1. Root cause or workaround

Six fixes, all root, and two of them named the workaround they refused.

**BBB-1** is the one worth reading. The contained cells of `lowboxSpike.mjs` had
measured nothing since `56f77f7`, because `spawnAtStartup` was a *synchronous*
`execFileSync` as the host's first action and inside an AppContainer the child is
created but does not exit inside main's 60-second wait. Two workarounds were
available and both were refused in writing: **moving the probe later** destroys
the ordering evidence it exists to produce, and **exempting the contained cells**
is special-casing the input that failed. The fix is that the probe now arms **its
own** timer and settles once — which every other probe in that host already did.
It was the only one borrowing somebody else's timeout and the only one that hung.

**CCC-1** does not fix `a0d2ec0`'s red and says so in its own commit message. It
buys the ability to see the next one.

No override was added, no check loosened, no type widened, nothing exempted.

### 2. Verified against the easy shape only?

The hard shape here is the *contained* cell, and it is precisely what was broken
and is now measured. `lowboxSpike.mjs` was run five times against a real
AppContainer with the shim built.

**One axis was checked rather than assumed, in the right direction.** CCC-1
moves 24 Guards steps from `npm run` to a direct `node` spawn, which strips the
npm-run environment — the *rich ambient environment versus the bare one* axis.
Exactly two proofs in the repository touch npm variables:
`rendererPolicy.proof.mjs`, which already runs wrapped in `ci.yml` and passes,
and `preCommit.proof.mjs`, which deletes `npm_execpath` deliberately because
inheriting it hid the branch a real committer takes. Both were run wrapped
before the claim was made.

**And one axis was missed, in the way this seat keeps missing it.** After
deleting `hostFixture.mjs` I ran `check:advisories` and **assumed**
`proof:advisories`. Guards found it. That is the same miss as ZZ-1, in the same
file, in the same session — *ran the neighbour, not the thing whose name is on
the CI step*.

### 2a. Changes to HOW something is proven

Three, and the first is a reduction.

**(b) memory left the coverage.** `hostFixture.mjs` measured it against a job
carrying a **512 MB literal** that its own comment flagged as PP-4's shape.
ADR-0023 §2 makes the shipped limit a derivation from §9.17's absolute cap, so
carrying the literal here would carry PP-4 and carrying the derivation would
implement that rule twice (B3a). The row is **printed as NOT MEASURED at the
point of use** with RR-3 named as its trigger, rather than dropped. A reduction
nobody prints is a reduction nobody reviews.

**Two advisory cases were strengthened.** `no-witness` and `empty-scope` bound on
`!ok` alone, so each passed on the other's output and on any failure neither had
caused. Both now bind to a diagnostic naming the located verdict, with a
RESOLUTION case asserting the two are not interchangeable.

**The 24 Guards steps gained a public failure channel** and lost the npm
environment. Net strengthening, measured as above.

### 3. Would CI have caught it — and can THIS machine see it?

Both directions fired in one range, which is why the question is asked both ways.

**BBB-1: no CI could ever have caught it.** `lowboxSpike.mjs` is research, runs
on no runner, and needs a built shim and a real AppContainer. It was caught by
running the surviving instrument after the consolidation — which is the reason
WW-1's ruling said to consolidate and then read the result.

**`a0d2ec0`: CI caught what this machine could not.** Guards went red on
windows-latest with ubuntu-latest green. Local Windows passes 31 cases, and the
Guards world — reproduced by hiding `node_modules/electron/electron.d.ts` —
passes 30 with 1 not applicable, so it is **not** ZZ-1's derivable branch.

**The register, the checker and the proof are byte-identical between `a0d2ec0`
and `d3ea661`, and `d3ea661` is green on the same platform.** So the failure is
not in the code under test. The step's only non-deterministic input is the live
fetch: `proof:advisories` spawns the checker **20 times** and the checker POSTs
`api.osv.dev` once per watched package, so **one run is 60 live requests per
runner**, and it throws on any non-OK status by design. This journal already
carries *"`check:advisories` and the OSV query"* as the first of two checks
depending on a live third-party fetch; 60 is what that carried item costs per
run, and it was an abstraction until now.

**The specific failure text was never read** and is not guessed at in the code.
Actions serves logs to authenticated callers only — which is CCC-1.

> **Correction, 2026-08-22 — "60 live requests" was calculated and written as
> though measured.** It is `20 × 3` from reading the code, and it is an **upper
> bound**, not a count: `readBaseline()` runs before `fetchAdvisories()`, so
> every mutation that fails on the parse never reaches the network at all. The
> real figure is lower and was never established.
>
> That is **YY-1's shape in this entry's own prose** — a number derived by
> arithmetic and presented with the authority of a measurement — three sections
> above a heading asking whether things were executed or asserted. It belonged
> in the *asserted* column and it was written into the *executed* one.
>
> The conclusion it supported is unaffected: dozens of live third-party requests
> per run, and a checker that throws on any non-OK status, is a flaky guard
> whatever the exact count.
>
> **The figure that replaces it is directly verifiable rather than better
> estimated.** After the fix, exactly one call site in
> `advisoryRegister.proof.mjs` reaches the network — `liveRun()`, greppable and
> currently called once — over the three watched components, so the live surface
> is **three requests per run**, and the way to check that is to count call
> sites rather than to trust this sentence.

### 4. Non-vacuous?

`advisoryRegister.proof.mjs`: binding `no-witness` to the empty-scope sentence
reddens **that case and only that case**. The spike's removed-contained-reading
control runs on every invocation and is mutated on the contained side, because
two absences agree and the other direction never reaches the defect.

**Gap, recorded rather than papered over:** the spike's four-state classifier
gained validation of the outcome *value* — anything that is not
`allowed`/`refused`/`error` becomes `unreadable` — and **that path has no
mutation test**. The control exercises a *missing* reading, not an *invalid* one.

### 4a / 4b. Instruments

The spike's behaviour moved substantially and it was re-run before its own header
was rewritten. One run now prints `DIFFERS`, `same` and `UNREADABLE` in the same
table, which is a resolution demonstration rather than a claim. Its route control
and the backtick scan's positive control both ran and both reported.

### 5. Executed or asserted

**Executed:** every run above, the no-electron world, the wrapped Guards steps,
the mutation, and the stashed pre-consolidation control that excluded WW-1 as
BBB-1's cause.

**Asserted, and labelled as such where written:** the OSV mechanism for
`a0d2ec0`; and AAA-1's bitmap arithmetic, which is stated in the source as
arithmetic with no encoding measured.

### 6. Architecture

Nothing changed. ADR-0023 took an appended dated correction for the deleted
fixture; `docs/ARCHITECTURE.md` was untouched.

### 7. Documents against code

The cross-reference sweep for a deleted file was done by hand (UU-1), because a
reference to a file that no longer exists cannot be link-checked into
correctness: ADR-0023 appended a correction, the advisory register's three `why`
texts were edited as live spec, and `win32Handle.proof.mjs` names the fixture as
retired. `check:advisories` still reports 22 verified, 0 unverifiable, so no
witness rested on the deleted file.

**Item 7 fired at instrument scale, which is where it had not been applied.**
`lowboxSpike.mjs`'s header displayed a measured property table taken at
`36caf21` while the column it described had produced nothing since `56f77f7`. A
dated reading is exactly the kind of claim that goes stale silently, and the
block even said *"re-run it rather than trusting this block"* — which is the
instruction that found it.

### DDD-1 (new, open) — the source columns have two states and the proofs columns have three

**`hostFixture.mjs`, a 636-line research instrument, was deleted in this range
and appears in no column of the report that scopes this audit.**
`scripts/lib/auditWatermark.mjs` computes `proofsRemoved` from
`state === 'D' && isProof(path)` and there is **no equivalent for source files**:
the source side has *added* (`newScripts`) and *changed* (`changedScripts`) and
nothing for deleted.

This is the **fifth** axis of this classifier to fail, after pattern (W-1), root
(X-1), state (Z-1) and added-vs-changed (WW-2). The general form is worth more
than the instance: **when one half of a classifier carries three states and the
other half carries two, the asymmetry is the finding.** Nobody audits for a
missing column — they read the columns that exist, and an instrument leaving is
coverage leaving exactly as a proof leaving is.

It is not fixed here, because an audit-recording commit is docs-only and alone.
It is the first commit after this entry.

### Backtick occurrence 5, and the first one a mechanism stopped

Mine, in `lowboxSpike.mjs`, writing a comment about BBB-1's classifier inside the
emitted `String.raw` — the same shape as 3 and 4. The difference is what stopped
it. Occurrence 4 was stopped by a hand-run `node --check`, which is a person
remembering; this one was **reported by `check:emittedtemplates` at the right
line** during an ordinary check run, and WW-4 had already put that scan in
pre-commit against the index, so it could not have reached a commit either way.
The scan header now says to expect a sixth: the point of moving the check was
that the count stops mattering.

### Operational

The unauthenticated GitHub API allows **60 requests per hour** and `npm run
board` polls up to **40 per invocation**. Two board runs plus diagnosis exhausted
it and blinded both the board reader and the annotation reader for an hour. The
board reader reported *"a timeout, not a verdict"* on 403 rather than inventing a
green, which is that instrument working as designed.

### Carried forward

- **DDD-1**, above — first commit after this entry.
- **`a0d2ec0`'s red is unattributed.** Not in the code under test; the live OSV
  fetch is the only candidate input and remains a hypothesis.
- **`proof:advisories` makes 60 live third-party requests per run.** A guard
  whose red can mean something other than what it says trains people to re-run.
  The proof's subject is register logic, not what OSV says today, so recorded
  payloads for the mutation cases with **one** live case retained would remove
  the flakiness without losing the fetch-path coverage. Not to be done as
  "retry until green".
- The spike's **invalid-outcome path has no mutation test** (item 4 above).
- **(b) memory** is unmeasured until RR-3.

---

## 2026-08-22 — Stage audit: `4d04942..1d5e6d6` — the first host code, and a derived number that was never measured

**Audited through `1d5e6d6`.** 7 commits, 23 files, **3 proofs added, 3
modified**, 3 new instrument files and **8 changed** — from `npm run audit:scope`.

Owed on the **file** threshold, and the gate fired the way it was designed to:
the commit that would have crossed 24 was blocked at pre-commit rather than
reported on the board a push later (Y-2). The work it blocked is stashed and
lands after this entry.

The range is the first engine-host code — the frame layer and the containment
probe — plus WW-1's record, WW-2's fix, and Ruling 1 with XX-1's corrections.

### The new column earned its place on its first run

WW-2 added *source FILES CHANGED* in this very range, and the range's own report
lists eight, of which three are instruments whose behaviour moved: `scope.mjs`
(+32/−29), `auditWatermark.mjs` (+42/−3) and `emittedTemplates.mjs` (+18/−9).
Under the old column every one of them would have appeared nowhere — including
the two that implement the audit report itself.

That is not proof the column was worth adding; it is the column doing on its
first run exactly what its absence had been hiding. Noted because the opposite
result — a first run listing nothing — would have been worth just as much and is
the reading nobody writes down.

### YY-1 (new) — a derived constant whose derivation was arithmetic, and a test band that could not tell

`ENGINE_HOST_FRAME_MAX_BYTES` is derived from `LARGEST_INTENT_PAYLOAD_BYTES`,
the worst legitimate command payload. I wrote that second number as **120,000 by
calculation** — 20,000 five-digit page indices with separators — and the case
asserted `payload.byteLength > CONSTANT * 0.8`.

**That band cannot distinguish a measured number from a guessed one.** It reports
that the constant is *not wildly wrong*, which is not a thing worth knowing about
a figure another figure is derived from.

What exposed it was not the case but the **shape of a mutation run**: tightening
the maximum to 128 KiB reddened the headroom case and left the payload case
green, which says the two numbers were not pinned to each other. Measured
afterwards: **120,057 bytes**, 6.00 per page. The estimate was close, and being
close is why nothing would ever have flagged it.

The case now asserts **exact equality**, and the direction matters: a stated
worst case that is an *under*-estimate makes everything derived from it too
small, so the assertion has to be able to fail upwards.

**And the measurement surfaced a bound the estimate had hidden.** At 6.00 bytes
per page, a 256 KiB frame refuses a whole-document selection at about **43,600
pages**. That is 2.2× the project's stated extreme and entirely defensible — but
it is a real limit, and it was invisible while the input number was a round one.
It is now named in the source, asserted in a case, and carries its answer: split
the intent across frames, never raise the maximum, because raising it spends the
property ADR-0023 §7 exists to protect on the one payload shape with a cheaper
fix.

> **Correction, 2026-08-22 (AAA-1).** *Never raise the maximum* holds. *Split
> the intent across frames* was recorded as **the** answer, and it is the second
> one — the comment in the source said so too, which is what the next person
> would have acted on.
>
> **The bound is an artefact of the encoding, not of the transport.** 6.00 bytes
> per page is the cost of writing a page set as an explicit list of decimal
> indices. A bitmap is one bit per page: 2,500 bytes at 20,000 pages, 5,450 at
> 43,600 — ~48× smaller at the stated extreme and **flat on an adversarial
> selection**, which is the property ranges lack (alternating pages give ranges
> one entry each). At that density a 256 KiB frame holds a selection over two
> million pages, so the bound does not move — it stops existing, and the maximum
> could then shrink, *strengthening* the property rather than spending it.
>
> Chunking is the expensive fallback: reassembly, ordering and partial-state
> handling, added at a boundary whose counterparty is hostile by invariant 25's
> own premise, and it leaves the maximum where it is with new surface
> underneath.
>
> **Arithmetic only — no bitmap encoding has been measured.** Changing the
> payload shape reaches `packages/contract`'s schemas and how every command
> declares a page selection, so it is its own unit, taken when something needs
> it. What changed today is the comment: both answers named, the cheaper one
> first.
>
> The general rule, and the reason this is a correction rather than a
> preference: **prove the limit has to exist before designing around it.**
> Removal is the first candidate, not a footnote. A recorded answer that points
> at the expensive fix is worse than no answer, because it reads as decided.

**The general form, which is item 4a arriving in a constant rather than an
instrument:** where one number is derived from another, assert the derivation
*exactly*. A tolerance band is the numeric version of a search that reports
"found nothing" — it passes for every value anybody ever writes.

### YY-2 (new, process) — a decision and its implementation in one commit

`1d5e6d6` carries ADR-0023 §7 (what crosses the pipe) **and**
`packages/contract/src/hostProtocol.ts` (the number that decision produces).

Not a B4 violation: B4 governs `docs/ARCHITECTURE.md`, and what changed there
was a *correction* of a false statement, not an amendment. But it is the same
shape, and B4's reason applies — the commit that carries a decision is what a
reviewer reads to judge the decision, and here it arrives wearing the diff of the
code that assumes it. The owner's instruction explicitly unblocked the number in
the same breath as the ruling, so this is recorded as a pattern to watch rather
than as a fix owed.

### Occurrence FOUR of the backtick class, and it is the strongest version of the escape guard's argument

I wrote a backtick into `hostFixture.mjs`'s emitted `MAIN` region **while
annotating that file for WW-1** — one commit after shipping the check for the
class, as its author, in the same session. `node --check` reported *Unexpected
identifier 'lower'*.

The rule was not merely written down. It had **just been mechanised, by me**.
That is the sharper reading of the sentence the escape guard paid for seven
times: *having just built the mechanism does not put the rule in reach at the
moment a comment is composed.*

Verified rather than assumed that the scan sees it — fed the broken text,
`backtickViolations` names line 321. It ran only on the Guards job, so what
actually stopped it reaching a commit was a hand-run syntax check, which is me
remembering. **That gap is WW-4**, and it is fixed in the commit after this one.

The new proof case is not a duplicate of occurrence 3, which the file already
carries verbatim. What is new is the **position**: occurrence 4 landed in the
*second* of two emitted regions, and the existing two-region case expects zero
violations, so a scan that finds both regions and walks only the first passes it.

### Item 4 — three mutation runs, and one summary line that was already lying

Every proof added here was mutation-tested, each reddening only its own cases:
the frame codec three ways (maximum checked after accumulation → 2 red; poison
flag removed → 1; allocation sized by the declared length → 1), the containment
classifier three ways (validity check removed → 1; positive side consulted first
→ 4; `origin` ignored → 1), the scope column one way (→ 3).

**`proof:emittedtemplates` printed `14 emitted-template cases passed` while 13
ran.** A hardcoded total, already wrong, and adding a case made it accidentally
right — which is the failure mode rather than the fix. Both it and
`proof:win32handle` now count what ran and refuse to print the reassuring line
when nothing did, since zero cases and every case passing are otherwise the same
output. The class was checked rather than the instance: those two were the only
proofs in the repository with a literal total, and both were mine.

### Item 4a — the one instrument here is a memory reading, and it carries its resolution test in the same run

The frame codec's central property — *nothing is sized by the declared length* —
is structural and no functional assertion can see it. It is measured through
`process.memoryUsage().arrayBuffers`, and the measurement is worthless without
knowing the instrument can see an allocation at all, so the same case allocates a
real 128 MiB immediately afterwards and requires the reading to move.

It resolves exactly: the mutant that allocates by the declared length reported
**134,217,736 bytes**.

### Item 2 — what was verified against the easy shape, and what was not

Stated in both directions because only one of them is comfortable.

- **Hard shape covered:** the frame decoder is exercised one byte at a time,
  which crosses every boundary that exists — inside the header, between header
  and body, inside the body — and pins the frame to the last byte rather than to
  some byte. The `audit:scope` fixture is a file created *before* the watermark,
  because a file created inside the range is `A` however often it is edited and
  could not show the defect at all.
- **Hard shape NOT covered, and said in the file:** the containment probe's
  `refused` outcome is never produced by a real access denial. That needs an ACL
  edit, which is machine state, and it belongs to the spike and to RR-3's proof
  on the shim job. What the unit tests do cover is the distinction the classifier
  leans on hardest — a missing path reports `absent`, never `refused` — with a
  present file beside it in the same directory so that "absent" is a reading and
  not a broken probe.

### Item 5 — executed against asserted

**Executed:** every proof and every mutation above; the payload measurement; the
resolution test on the backtick scan against `hostFixture.mjs`'s real text; the
advisory register's own refusal of five malformed additions.

**Asserted, and not re-run in this range:** ADR-0023 §7's budget argument quotes
`perf:gate`'s 2.00× figure for two resident images from the record rather than
from a run made here. The ruling is the owner's and the figure is theirs; it is
listed here because an audit that lets a quoted number pass as a measured one is
how the distinction gets spent.

### Item 7 — a stale sentence this range is about to create

`emittedTemplates.mjs`'s occurrence-4 row ends *"it runs on the Guards job … that
gap is finding WW-4"*. WW-4 lands in the very next commit, which makes that
clause false one commit after it was written — the compound-claim shape, caught
before it existed rather than after. It is corrected in the commit that closes
WW-4.

### Open after this range

**YY-1** and **YY-2** are recorded, not owed — the first is fixed, the second is
a pattern.

**WW-1's consolidation** is owed and gated: `hostFixture.mjs` measures a process
type the architecture withdrew, its header and its printed output both say so,
and **no containment assertion may be written against it** until the variant
matrix and the four-state classifier move into `lowboxSpike.mjs`.

**P1** is unmeasured, with an expiry at packaging, an elevated read, or Stage 7.
**WW-4** is fixed in the next commit. Older: OO-1, MM-1, AA-3, CC-3, DD-2, BB-6,
Y-3, the MuPDF cache's restore-without-reverify, and **II-2's hard trigger before
Stage 0 exit**.

**AA-1** is narrowed rather than open — see the correction appended to its entry
below.

---

## 2026-08-22 — Stage audit: `0548ad6..4d04942` — the decision range, and two guards that were blind in the direction they were pointed

**Audited through `4d04942`.** 8 commits, 21 files, **2 proofs added, 0
modified**, 3 new instrument files — from `npm run audit:scope`.

The range is one arc and is audited at its own boundary rather than mid-build:
the spike's findings, the B4 amendment, both ADRs, the cross-reference sweep, and
two new guards. Feature code starts after it.

### The load-bearing column is EMPTY, and that is information

**No proof was modified in this range.** Every other recent audit has had that
column carrying the reading — a check whose meaning changed looks identical to
one that was loosened. Here there is nothing to read, and the honest statement is
that *this range added coverage and changed none*.

It is worth saying rather than skipping, because an empty load-bearing column and
an unread one produce the same silence.

### Item 2a — coverage moved four times, and two of them REMOVED a mechanism

| | direction | what moved |
|---|---|---|
| invariant 25 (c) and (d) | **arriving** | *no mechanism* → an AppContainer, measured against a route control, with the native `CreateFileW` refused `ERROR_ACCESS_DENIED` |
| PP-6's fork→assign handshake | **REMOVED** | withdrawn, and replaced by `CREATE_SUSPENDED` + assign + `ResumeThread` — a construction rather than an agreement |
| the host lowering its own integrity | **REMOVED** | the LowBox token is Low at creation, so the mechanism does not exist rather than being deferred |
| the five ACL grants | **reclassified** | from *the mechanism* to *a development accommodation* — a claim withdrawn about what ships |

The two removals are the ones that need stating. A withdrawn mechanism reads in
a diff exactly like a mechanism that was never there, and both of these are
replacements by construction — which is the outcome B5 asks for and also the
outcome that leaves the least trace. **Neither was removed on an inference:**
`previousSuspendCount: 1` beside a running thread reporting `0`, and
`integrityBeforeResume` reading `0x1000` contained against `0x2000` uncontained,
are the differentials that made each a reading.

### Item 1 — every fix in the range, classified

All root-cause. The two that were nearly not are worth the space.

| fix | why it is not a workaround |
|---|---|
| **TT-2** — `INVALID_HANDLE_VALUE` | one resolver for Win32's own rule, with the emitted copy *derived* from the function rather than kept by hand. Patching the file that failed would have left the other two, and the next caller free to write a fourth (B3a) |
| **VV-1** — the scan's blind spot | fixed on **two axes**, because fixing one changed nothing: the opener matcher and the file-level filter both said `String.raw`, so the four blind files were skipped before the widened matcher saw them |
| the spike's missing child log | a channel nobody subscribed to. Adding an inherited log handle is the fix; guessing at the exit code would have been the workaround |
| the handed directory granted `RX` | the grant was wrong, and the host said so with its own exit code. Widening the grant is the repair, not an accommodation |
| escaped backticks reported as violations | a false finding in a guard is how the guard gets switched off, so escapes are stripped before the check rather than allowlisted after it |

### VV-1 is the range's best finding, and it was found by auditing the previous commit

The backtick guard reported *"11 emitted-source templates carry no backtick"* and
meant *"11 of the 15 I can see"*. Four emitted bodies in `scripts/research/` are
plain template literals — and a plain template is the **more** dangerous of the
two, because it interpolates as well as terminating.

That is the **pattern axis of a classifier (W-1) reappearing inside a check
written to close a different class**, one commit after it was committed and green
in CI. The range-scoped audit exists for exactly this shape.

**Widening to every template was tried and rejected on a measurement**, which is
the part worth keeping: 36 reports, nearly all openers whose terminator is not a
bare backtick-semicolon. *Where a template ends cannot be determined textually* —
the same wall the parser hits — so a check over all of them either guesses a
boundary or drowns. Marking the class makes it decidable, and the escape hatch
that opens with a marker is closed by a second rule scoped to the directory where
every occurrence has happened.

### VV-2, OPEN — the scope report has no column for an instrument that CHANGED

`audit:scope` distinguishes proofs **added** from proofs **modified**, and for
instruments reports **added only**. So an instrument file that already existed and
whose behaviour changed appears in no column at all.

This range changed four of them: `hostContainment`, `hostSurface` twice and
`permissionProbeControl` were converted to `String.raw`, which alters escape
handling in the program each one writes to disk. **Every one could have been
broken by it**, and what caught them was running all four, not the report.

**This is not AA-1 and must not be filed as it.** AA-1 is *granularity* — an
instrument arriving as a function inside a module that already existed — and its
stated compensation is to read the modified-proofs diffs. That compensation
cannot reach this: these are not proofs, so they appear in no diff the disclosure
sends you to. It is a fourth axis of the same classifier, beside pattern (W-1),
root (X-1) and state (Z-1): **added-versus-modified, for instruments.**

The fix is named: report modified instrument files the way modified proofs are
reported, with the same warning, since a loosened instrument and a corrected one
are indistinguishable outside the diff.

### Items 3, 4, 4a/4b, 6, 7

**3 — would CI have caught it?** Not TT-2: the refusal branch had never executed,
so nothing in the suite reached it. Not VV-1 either — the guard was green in CI at
`f71cd9d` while blind to four files, because a search's silence is its most
convincing failure. Both now have proofs on the Guards job, and both proofs run on
Linux with no native library, since a defect living in three files at once should
not need a Windows runner to catch.

**4 — mutation.** `proof:win32handle` reverted to `value === -1n` reddens two
cases; one of them reddened with the **wrong message**, a true-sounding diagnosis
of a defect that was not there, because it was a compound assertion — split.
`proof:emittedtemplates` narrowed to skip comment lines reddens two cases **and**
makes the scan itself refuse to report, because its own control goes silent: two
independent detections of the same blinding.

**4a/4b.** Both new instruments carry positive controls that run in the
instrument, not only in the proof — the proof runs in CI and the instrument gets
run by hand on the day someone needs an answer. The backtick scan's control is a
fixture it must locate every run; the spike's is the grant itself, since after
granting the same search must find the principal it just called absent.

**And the scan shipped with the class it guards, in its own entry point.** Its
first run printed nothing and exited 0 — the module-is-main test built a `file://`
URL by string concatenation, which is wrong on Windows. *A scan that does not run
and a scan that finds nothing print the same thing.*

**6 — architecture before the feature.** This range **is** that, in the strongest
form the project has managed: measure → spike → amendment → mechanism ADR, with
no host code written. The B4 went from four properties to two to zero on
measurements, and the amendment landed alone with its own CI verdict.

**7 — documents.** UU-1 is item 7 at cross-reference scale, and it is the case
`check:docs` structurally cannot see: **a renumber leaves both targets existing**,
so the link resolves and the reader lands on a real ADR that says something else.
Worse than a broken link, which announces itself. Three references swept by hand;
the class recorded in `DECISIONS/README.md` beside *never renumbered*, which was
previously a convention with no stated mechanism.

The compound-claim check found two more in this range's own files, and both are
the exact shape it hunts: `hostFixture`'s *"nothing yet delivers them"* and
`hostNativeRead`'s *"the property goes back to having no mechanism"*. Each was
true when written and false eight commits later, and in each the live half —
*a utility process cannot* — kept vouching for the dead half beside it.

### Verification state

Green at `9741cc3` and at `f71cd9d`, both CI and Guards. `4d04942` is pushed and
unverified; it carries VV-1's widened scan, so its verdict is the one that matters
for the guard.

---

## 2026-08-22 — Stage audit: `f7c74ff..0548ad6` — the containment claim loses a property, and a control that could not fail becomes one that can

**Audited through `0548ad6`.** 9 commits, 14 files, **1 proof added, 1
modified**, 3 new instrument files — from `npm run audit:scope`. The range is
2026-08-21's work; the audit is written just past midnight after it, which is
why the dates differ by one.

**Owed between the two thresholds, which sit one apart on purpose.** The report
reads *"within one batch"* at 9 commits against a batch of 9; the Y-2 pre-commit
gate counts `commits + 1` and so refuses the next code commit. Neither number is
wrong — the report describes the range that exists, the gate describes the range
the next commit would create. This range is exactly between them, which is the
gate working rather than a disagreement.

The range: PP-1, QQ-1, QQ-3 and QQ-4 closed; row 283 rewritten from three
assertions to four; item 7 given a document-class rule; RR-1 and GG-8; the crash
race CI found; and RR-2's fixture with SS-1 and SS-2 on top of it.

### The headline is item 2a, and it fired twice in opposite directions

**A claim being withdrawn and coverage arriving read identically in a diff, and
neither announces itself.** Both are in this range, in the same document, and
one of them is the range's whole point.

| | direction | what moved |
|---|---|---|
| invariant 25's property **(d)** | **coverage WITHDRAWN** | *obtainable through `NODE_OPTIONS`, enforcement measured* → **no mechanism**. The candidate fell to QQ-1: the model is enforced inside Node's own filesystem bindings, and a `CreateFileW` never reaches them. |
| row 283's assertion count | **coverage ARRIVING** | **three assertions → four**, against a law that has named four properties since it was written (PP-1). |
| (a) integrity and (b) job object | **coverage arriving** | from a *description* to a fixture with a per-property differential — 0x2000 → 0x1000 read by main, and a job whose removal is the only variable that changes. |

The withdrawal is the one that needed saying out loud. Nothing in the row's
rendering distinguishes *"we measured this and it does not hold"* from *"we have
not got to it"*, and the second reads as ordinary backlog. **Every gap line reads
as rigour, including the ones that used to be claims** — which is item 2a's
sentence about `UNVERIFIABLE`, arriving at a checklist row instead of at a
register.

So the row now says it in its own body: *(a) and (b) have a mechanism, a fixture
and a differential; (c) and (d) have none — (d) had a candidate and it fell.*

**And the principle underneath it predicts more than it summarises:** *only
kernel-enforced mechanisms contain native code.* That is why QQ-1 leaves (a) and
(b) untouched while it removes (d)'s only candidate, and why (c) is settled
without a further measurement — no Node-level mechanism will ever deliver it.
Of any proposed containment mechanism, ask **who enforces it** before asking what
it denies.

### The modified proof changed MEANING, and it is a strengthening — here is which

`rendererPolicy.proof.mjs` is the load-bearing column this range, and its crash
control now asserts a **mechanism** where it asserted an **outcome**:

```
- seen.failuresReceived.includes('render-process-gone'),
+ seen.failuresReceived.includes('render-process-gone') && seen.crashResolvedBy === 'event',
```

**A conjunct was added, so the case can only fail more often than before** — that
much is settled by inspection and needs no run. What a run adds is that the new
conjunct is not decorative: with the harness reverted to a fixed 400 ms, long
enough on this machine that the sink *did* receive the crash and the old boolean
passed, the case fails reporting `resolved by: already`. A loosened check and a
corrected one look identical outside the diff; this one is a strengthening in
both senses — strictly narrower, and separating something the old form could not.

`'event'` is producible only by a waiter that was installed and then fired. A
`setTimeout` cannot reach it, and deleting the mechanism deletes the field, which
fails to compile against the `Readback` the proof carries. **That is the post-BB-4
rule satisfied rather than cited: the control asserts what the harness passes,
not what the run produces.**

### Three findings I raised against my own instruments — classified (item 1)

All three are root-cause, and the reasons differ enough to be worth separating.

| finding | the fix | why it is not a workaround |
|---|---|---|
| the fixture's raw-string comparison | each probe reports `{ outcome, detail }` decided **inside the `try/catch` that produced it** | the decision moved to where the answer is known. The first attempt classified the probe's own prose, which is a second opinion (B3a) about a question already answered one frame up — that moved the defect a layer rather than closing it. |
| the memory probe poisoning later reads | reordered so the allocation cannot disturb what follows | the interference was removed, not compensated for. A subtracted baseline would have been the workaround. |
| SS-2's second layer — a missing reading classifying as *refused* | `host()` gained a fourth state, `unreadable`, terminal on either side and non-zero | *could-not-look* and *looked-and-found-containment* stop sharing an output. Guarding the symptom would have been a check for the empty case; the shape says an empty intermediate result is a broken parse, not a clean input. |

**"I found it myself an hour later" is not the same as "I fixed the class",** and
the middle column is where the difference shows. The one that came closest to
being a workaround is the first: I had already "fixed" raw-string comparison
once, by classifying raw strings.

### The live specification and the record disagreed for a whole range

At `f7c74ff`, `docs/JOURNAL.md` said property (d) was obtained through
`NODE_OPTIONS` with enforcement measured. `docs/FEATURES.md` row 283 said the
permission model was **withdrawn**. Both were written by the same seat, a day
apart, and neither was aware of the other.

The divergence happened to be in the safe direction — the spec understated what
the record claimed — and by the end of this range the record moved back to
agreeing with it. **That agreement is luck and not a mechanism.** Had position 2
been right, the specification would have been under-claiming a delivered property
for a range, with nothing able to say so.

This is exactly what item 7's new document-class rule (landed at `18eef01`) is
for, and the rule alone does not close it: nothing *checks* that a FEATURES body
agrees with the record. Prose agreement is not mechanically checkable, so this is
recorded as the reason the rule is written as strongly as it is, rather than as a
finding owed a guard.

### AA-1's compensation fired again, for the sixth consecutive range

`sinkReceives` is a new instrument added **as a function inside a module that
already existed** — precisely the granularity blind spot the new-files column
discloses in its own output. It appears in no column. The modified-proofs diff
for `rendererPolicy.proof.mjs` is what surfaced it, which is the compensation the
report prints at the point of use.

The ruling stands on its own terms: it becomes a defect the first time an
instrument is found late that reading those diffs did not surface. That has still
not happened.

> **Correction, 2026-08-22 (WW-2).** The paragraph above is sound for the
> instrument it describes — `sinkReceives` is inside a modified *proof*, so the
> compensation genuinely reaches it. What it generalises from is not.
>
> **The ruling's stated basis was wider than the compensation it rested on.**
> *Read the modified-proofs diffs* reaches instruments **that are proofs** and
> nothing else. A non-proof instrument whose behaviour changed appeared in no
> diff the disclosure sent anyone to — for that class there was no compensation
> to print, so the distinction the ruling turned on (*printed at the point of use
> is a mechanism, recalled is not*) had nothing to attach to.
>
> Measured on the range that produced this correction: four research instruments
> were converted to `String.raw`, which alters escape handling in the program
> each writes to disk, and every one could have been broken by it. They appeared
> in no column. What caught them was running all four by hand.
>
> **And that is why the trigger did not fire, which is the part worth keeping.**
> Nothing was found *late*, so on a literal reading the limit held. Diligence is
> not the mechanism, and counting a near miss as the trigger not firing is how a
> stated limitation becomes permanent. It is treated here as the trigger firing.
>
> The added-vs-changed axis is therefore a **defect**, fixed in the same commit
> as this correction: `audit:scope` now reports source files ADDED and source
> files CHANGED as two columns. Four axes of that classifier have now been
> defects and been fixed — pattern (W-1), root (X-1), state (Z-1),
> added-vs-changed (WW-2). What remains a stated limitation is narrower and is
> the thing AA-1 was named for: an instrument arriving as a function inside a
> file the columns *do* name.

### TT-1 — a provisioning step with no consumer and no expiry

RR-1 added `npm run provision:electron` to the shim job, because that job is the
only one that can host the containment fixture: it is windows-latest, it already
builds MuPDF, and it had no Electron. The step works — `d0352a9`'s CI run is the
evidence, where the shim job succeeded and the failure was elsewhere.

**Nothing in that job consumes it.** Today the step's own success is its whole
value, and that value is already banked. From here it is a prerequisite for
something ADR-0022 has not yet decided, held by nothing.

So it needs a trigger rather than good intentions: **RR-3's research→proof
section either names the step's consumer, or the step is removed in the same
commit that says the fixture stays research-only.** A provisioned capability with
no consumer is the shape that survives long enough to be assumed load-bearing by
whoever finds it next.

### Executed, or asserted (item 5)

**Executed:** `proof:workflowpins` (7 cases) and `check:workflowpins`, both green,
the scan reporting that it located its own positive control · the mutation on the
crash control, in both directions · the fixture's built-in control mutated on the
contained side, verified to report ASSERTED and exit 1 with the terminal check
removed · the range's diffs, read per commit rather than netted — the report
warned that 5 deletions in `rendererPolicy.proof.mjs` do not appear in the range
diff, and the per-commit read is where the meaning change is visible.

**Asserted, and named as such:** that `CRASH_BOUND_MS = 15_000` cannot push the
proof past its own `timeout: 120_000`. The arithmetic is not close — the worst
observed run was 37 s and the bound adds 15 s to it — but no run has exercised
the bound, because the mechanism has never failed to fire.

**Not claimed:** that any of this explains MM-1. Same proof, same runner,
different symptom, and one plausible mechanism is not evidence for another
failure. It stays open on its original terms.

### Items 3, 4a/4b, 6, 7

**3 — would CI have caught it?** It *did*, and that is the range's best result.
The crash race was green on this machine and on ubuntu and red on windows-latest
only; nothing local could have found it. The correction it prompted also makes
the next occurrence self-diagnosing, so a repeat costs one annotation read rather
than a round trip.

**4a and 4b.** Both new research instruments carry paired controls by
construction: `hostNativeRead.mjs` runs an inside-the-allow-list read beside every
outside one, in both the JavaScript and the native surface, so a refusal cannot be
a broken call and a success cannot be a binding that never fired.
`hostFixture.mjs` runs its control every time and refuses to print a verdict it
did not measure. `workflowPins.mjs` carries its positive control **in the scan**,
not only in the proof — the instrument gets run by hand on the day someone needs
an answer, and the proof runs in CI.

**6 — architecture before the feature, or underneath it?** Before. No host has
been written. The sequence is fixed and has not been bent: measure → spike →
amendment if one is owed → then the host. The B4 question is now on **two**
properties rather than four, which is a smaller amendment than the range started
with, arrived at by measurement rather than by scoping.

**7 — do the documents still match the code?** Row 283 rewritten as a live
specification, body currently true, all three positions kept below it because a
reader who knows only the final one will re-propose the middle one. `CLAUDE.md`
item 7 carries the document-class table. The compound-claim check was run against
the two files this range rewrote: `rendererHarness.ts`'s `settle()` doc still
describes what `settle()` still does, and `hostContainment.mjs`'s PP-2 note is
placed **above** the paragraph it qualifies rather than below it, so a reader
meets the correction before the claim.

### Verification state

`0548ad6` is pushed and **unverified**. `77ee5a3` completed and is green — CI 224,
reported by the reviewing seat. `d727843` has **no verdict and never will**: a
push overtook it and cancelled runs do not resume.

**A correction to my own reading of that rule.** I wrote that `77ee5a3` "was
never watched, so by QQ-5 only the tip carries a verdict." That conflates two
different facts. A run nobody looked at still runs and still records a
conclusion; what removes a verdict is **cancellation**, which happens only when a
later push lands while the run is still going. Unwatched-but-completed commits
have evidence sitting there for free, and treating them as gaps discards it.

---

## 2026-08-21 — Stage audit: `fac1e4a..f7c74ff` — the audit record stops being a search, and I drew two conclusions wider than their measurements

**Audited through `f7c74ff`.** 9 commits, 14 files, **0 proofs added, 2
modified**, 5 new instrument files — from `npm run audit:scope`. Owed on the
commit threshold, and the Y-2 gate is what stopped the next commit rather than a
decision to audit.

The range: OO-3a, OO-3b and OO-2 closed; the AA-1 ruling; and then five research
instruments measuring what an engine host can actually be made to do.

### The headline is about me, and it happened twice

**Two conclusions in one session, both wider than the measurement under them,
both with every clause of the evidence true.**

| | measured | concluded | what it cost |
|---|---|---|---|
| OO-3 | `check:docs` exits 0 with the advance unstaged | *the scope split lets an audit-recording commit land without the watermark* | the split is real and is not what causes that; the fix does not change the outcome |
| the withdrawal | `--permission` via `execArgv` is accepted, visible, and inert | *Node's permission model is withdrawn as a mechanism* | one route was inert; the model works through `NODE_OPTIONS`, with enforcement measured |

Neither was a guess. Both were written in the voice of the thing that had been
executed, with the reasoned half carrying the weight. **And in both cases the
tell was available at the time and is the same sentence: I had not run the thing
I was concluding about against the case my conclusion covered.** For OO-3 that
was the fix against the shape it claimed to close; for the withdrawal it was any
route other than the one that failed.

That is item 5 with a sharper edge than "executed, or asserted". The dangerous
entry is not the asserted column — it is a claim standing on something executed,
one inference further out than the execution reaches.

### OO-3b — the record requirement was a search, and its silence was history

"Does this sha appear in the journal" answers yes for **any** sha the journal has
ever named, and it names every one of them forever. So the property was satisfied
by history rather than by evidence: it caught a watermark advanced with no entry
only while the sha happened to be new, and it could never catch an entry written
with no advance.

`auditRecordDisagreement` compares the newest recorded heading's range end
against the watermark, exactly, both from the index. Six cases, and the load-
bearing one sets the watermark to a sha that **is** in the journal — the input
the absent guard lets through — with a control asserting that of the fixture, so
it cannot quietly become a case that separates nothing. Restoring the search
reddens that case alone.

**One of my own cases was vacuous and the mutation found it.** The ref case
asserted `!== null` and survived deleting the branch it existed for: a watermark
is always a commit id, so `HEAD` is refused by the mismatch branch regardless.
That branch decides the **message**, not the verdict. The case now asserts the
text. Item 4's fixture rule, in the file where it had just been written down.

### OO-2 — a proof that discarded findings it had already made

A throw in the measured section ended the process before `failures` printed.
Measured during a mutation run: two pure controls had recorded failures and
neither reached the output. The section now runs through `guarded`, which
**returns** the failure text — returning rather than throwing is what makes it
testable in both directions — and says the remaining cases are UNRUN, so a
shortened list cannot read as a complete one.

### Item 4a — five instruments, and two shipped without adequate controls

Both were caught in-range, which is the column doing its job:

- **`hostSurface.mjs`'s permission probe had no positive control**, and its
  `false` was load-bearing — it withdrew a mechanism. `false` is also what a
  typo, a wrong object or a Node without the feature reports. Found by applying
  item 4b to my own instruments rather than to code, prompted by the
  audit-scope column that lists them. Closed with an anchor that must report
  `true` where the model is known to work, and a control that reports `false`
  without the flag: *"can say true"* and *"says true regardless"* are different
  instruments.
- **`hostContainment.mjs` ran step 4 on step 3's unanswered question** (PP-2,
  raised by the reviewing seat). Step 3 came back ACCESS_DENIED and was recorded
  as a could-not-look; step 4 then produced "a Low host still connected a socket"
  about a process whose Low state was never established. Closed by reading the
  child's token **from main**, twice — 0x2000 before, 0x1000 after — because two
  readings that differ across the one action are the only shape separating a
  working reader from one that always says Low.

The other three carry their controls in the file: `hostJobObject.mjs`'s
unassigned run, `hostIntegrityFromMain.mjs`'s before-reading, and
`permissionProbeControl.mjs`, which is itself a control.

### What the instruments established

Invariant 25 names four properties. Three now have a mechanism, a fixture and a
differential; **(c) no network alone has none.**

- **(a)** a host can lower its own integrity and afterwards cannot read its own
  token; main reads it instead.
- **(b)** a job object assigned from main, nesting inside the one Chromium
  already applies, refuses a spawn and a 768 MB commit where the same host
  unconstrained does both. The cleanest differential in this range, and asking
  `IsProcessInJob` **before** assigning is why one error code could not have had
  two explanations.
- **(d)** through `NODE_OPTIONS`, not `execArgv`: reading a file the host was
  never handed is refused `ERR_ACCESS_DENIED` while reading one it was handed
  returns 3,692 bytes, against three variants where both succeed.

**The `--permission` result is worth keeping for its shape rather than its
content.** Through `execArgv` it is set, readable back as set, and inert — a
check reading `execArgv` reports containment in force. Through `NODE_OPTIONS` it
works and leaves `execArgv` empty — so the same check reports it absent while it
is active. **The read-back misleads in both directions**, which is worth more
than either half.

### Item 3 — CI sees none of this

The five research instruments run nowhere but here. That is correct for scripts
that assert nothing, and it is a gap the moment row 283's assertions are built:
they need Electron and Windows, and the containment row is the one place where
"it worked on my machine" is least acceptable. Named now so it is a decision
later rather than a discovery.

### Item 2a — coverage moved one way

`auditScope.proof.mjs` +156/−2, 40 cases to 48. `perfBudget.proof.mjs`
+220/−164, 23 to 31 — the deletions are the measured section re-indented into
`guarded`, and every case survived, which the count is what verifies. Nothing
removed, nothing loosened.

### Open

**PP-1** — row 283 asserted three of the four properties the invariant names, so
it could have gone green while its own title was true of three quarters of it.
Fixed in the commit after this one; the Y-2 gate refused to let it share a commit
with the audit, which is that gate working.

**PP-4** — `ProcessMemoryLimit` is a literal in the research script. In the
shipped host it would be a second opinion about §9.17's `mupdf-host = 6x, 3 GB`,
B3a, and it hides well because it lives inside a Windows struct rather than a
config object. Derive it undefaulted, as the composition root's ceiling is.

**PP-5** — a job memory limit and ADR-0007's designed response are different
failure modes. The ADR must say which is primary: main monitors and kills, with
the job limit as the backstop that bounds the damage when the monitor is late.
"We set a job memory limit" reads as satisfying ADR-0007 and does not.

**PP-6** — the window between `fork` and `AssignProcessToJobObject` is time under
no limits. Not to be documented: the host's first act blocks until main confirms
assignment, and no document byte is accepted before it. B5, not a caveat.

**The 403, and the cadence ruling.** Nine pushes in two and a half hours, each
followed by a board run polling up to forty times, against ~60 requests an hour
per IP. One-unit-per-push stays; the board discipline changes — check once per
group of related commits, cut the poll cap, and do not watch a commit CI cannot
fail on.

Also open: OO-1, AA-3, CC-3, DD-2, BB-6, Y-3, the MuPDF cache's
restore-without-reverify, and II-2's hard trigger before Stage 0 exit. AA-1 is
now a stated limitation with a trigger, not an open finding.

### Executed, and asserted

**Executed:** every measurement above, each with a differential or an anchor ·
four mutations on `perfBudget` · four on `auditScope` · `typecheck`, `lint`,
`check:docs`, `proof:auditscope`, `proof:perfbudget`, `proof:electronimports`.

**Asserted:** that `84ec8da` is green — the board hit 403 and reported a timeout,
and the reading came from the reviewing seat's separate quota.

---

## 2026-08-21 — Stage audit: `9a951d6..fac1e4a` — CI caught what this machine could not, and a comment named the hazard it was creating

**Audited through `fac1e4a`.** 8 commits, 17 files, **1 proof added, 2
modified**, 4 new source files — from `npm run audit:scope`.

The range: II-2's attribution, the annotation wrapper, LL-4's owed role, and
then **three commits spent on one red `main`** — which is the part worth
reading.

### The headline is item 3 answered the other way round

Every previous entry in this journal asks *would CI have caught it?* and answers
no. **NN-2 is the first defect in this project that CI caught and the local
machine did not**, and the reason is worth stating precisely, because it is not
luck: the case's outcome depended on a **measured** value, so the passing world
and the failing world differ by no line of source.

It cost three pushes to read, and the three are a fair record of what it takes
to see a machine-dependent failure from a seat that cannot read logs:

| commit | what it established |
|---|---|
| `f84f796` (NN-1) | the job never built what the gate measures — the step went 3 s → 26 s, so the build gap was real and the failure **moved** |
| `4810586` | wrapped the proof in `scripts/ci/annotate.mjs` — not a fix; it makes the failure's own words public |
| `fac1e4a` | the fix, read off the annotation |

**`cfdaba4` paid for itself on its first real use.** A one-line
`Process completed with exit code 1` became a stack naming
`memoryBudgets.mjs:177`, the message ``main` is declared twice`, and the exact
call site in the proof. Logs need a token; annotations do not.

### NN-2 — the deduplication was keyed on the formatted string

`main` has been answered to by two roles since LL-4. Building the neutralising
entries for the `mupdf-host` case takes both, and the formatted string embeds
`Math.ceil(ratio)`. Two ratios either side of an integer boundary give two
**distinct strings that both declare `main`**, and the parser refuses that —
correctly. The defect was upstream of the check that caught it.

Measured here after the fix, on the dense shape: `main` **1.00x**,
`main-service` **1.01x** — ceilings of 1 and 2. The gate's own display rounds to
two decimals and therefore **cannot show which side of the boundary a ratio
sits on**, which is why the output looked identical in both worlds.

This is item 2 — *verified against the easy shape only* — arriving where the
"shape" is not a fixture but a **bucket boundary the machine chooses**. The hard
shape is unreachable from the source, so the control had to construct it: two
results sharing one budget with ratios that ceil differently, asserted to
produce one declaration. Item 4's fixture rule decided the numbers — ratios that
ceil alike are exactly what the defect handles correctly — and the fixture now
carries a case asserting its own ratios diverge, because the fixture is where
this one hid.

### NN-3 — the comment named the hazard, and then the code implemented it

Raised by the reviewing seat. `Math.max(0, peak - baseline)` is verbatim the
fourth entry in CLAUDE.md's list of blind instruments, live in the instrument
that decides the Stage 0 memory gate.

What makes it worth more than the fix is the comment that stood above it:

> Floored at zero: a run that lands below its own baseline is noise, not a
> negative cost, **and a negative ratio would pass every multiplier silently.**

The clamp's stated justification is that the unclamped value passes every
multiplier silently. A clamped value **also** passes every multiplier silently —
it just does so while looking like a perfect result rather than an absurd one.
The comment identified the exact hazard it was creating and drew the opposite
conclusion from it. `documentCostBytes` now refuses the pair and says the two
runs are not comparable.

**Item 3, honestly:** CI could not have caught this and neither could any proof
here. A clamp that fires produces a pass. It was found by reading.

### Item 7 — the compound claim, in the commit that wrote it

The comment above the defective block read:

> BUDGET NAMES, not role labels, **and deduplicated** — `main` is measured twice
> and a declaration line naming it twice is not a line the parser accepts.

The first clause was true and load-bearing. The second was false. This is
precisely the signal CLAUDE.md says to search for by hand — *the change
invalidated one clause of a compound claim* — and the live clause vouched for
the dead one, so nothing about reading it feels wrong. It reached review twice
in that state, in LL-4's commit and in mine.

The rule earns its place again: a wholly false sentence is caught by the next
reader; a half-true one is not caught by anybody.

### Item 4 — the mutations, and their direction

Four controls, four mutations, each reddening its own case and no other:

- restoring the format-keyed dedupe **reproduces the CI stack on this machine,
  verbatim** — the strongest available evidence the diagnosis is the cause;
- taking the **minimum** rather than the maximum across roles sharing a budget
  reddens the generosity case alone. That is the mutation direction that
  separates: "deduplicated" and "deduplicated to whichever came first" both
  produce one entry, and only the second quietly lets a neutralised term start
  deciding verdicts;
- a fixture whose ratios ceil alike reddens the fixture's own guard;
- restoring the clamp reddens the negative-cost case, with a positive case
  beside it so a function that always threw would not satisfy it.

### Item 2a — coverage moved in one direction only

`perfBudget.proof.mjs` is the load-bearing modified proof: +143/−14 in the
range, 23 cases to 29, **no case removed and none loosened**.
`rendererPolicy.proof.mjs`'s single deletion is a diagnostic line replaced by
four — MM-1's staleness message now names `npx tsc --build --force`, because the
guard could otherwise sit red through the command its own message named.

### AA-1 fired, concretely

`documentCostBytes` is a new instrument that arrived **as a function inside a
module that already existed**, and the scope report's instrument column lists
new *files* only, so it appears nowhere in the range's own audit output. AA-1
has been open as a stated blind spot; this is the first time it has hidden
something real. It is now evidence rather than a caveat.

### Open

**OO-1 (new)** — NN-1 fixed one job. The class is *a CI job that runs a proof
depending on built output without a step that builds it*, and nothing checks
for it. The instance is closed; the class is not.

**OO-2 (new, small)** — `perfBudget.proof.mjs` collects failures and prints them
at the end, so a throw in the measured section discards findings already
recorded. Observed during the mutation run: two pure controls had recorded
failures and the process died before either was printed. Exit 1 either way, so
this costs diagnosis rather than correctness.

**OO-3 (new) — `check:docs` reads two documents through two scopes, which is
Z-2's mechanism left standing in the sibling check.**

Found while writing this entry, which is what a range-scoped audit is for.
`documentConsistency.mjs` reads `docs/JOURNAL.md` through `readStagedBlob` — the
**index** — and then calls `auditScope({ root: ROOT })` with no watermark, so
`auditScope` falls back to `readFileSync` and takes the watermark from the
**working tree**.

Z-2 closed exactly this in the pre-commit gate by handing `auditScope` a
`pending` watermark, and `auditWatermark.mjs` states the rule in its own header:
*a gate's inputs all come from the scope its decision is about*. One caller was
converted and the other was not.

**Measured, not argued.** With this entry staged and the watermark advance left
unstaged, `check:docs` exits **0** and prints
*"the audit watermark is recorded in the journal and within one batch"* — a
commit that records an audit without advancing the watermark. Nothing catches it
afterwards either: on a clean checkout the watermark is the *old* sha, and the
old sha appears in its own older journal entry, so CI passes as well. The next
range then silently re-inherits this one, and the only signal is the batch gate
firing early against an audit that was in fact performed.

Not fixed here: the commit that records an audit is docs-only by rule. The fix is
one line plus a control that must be built from the failing shape — a staged
journal beside an unstaged watermark, which is the input the absent guard lets
through.

> **CORRECTION, 2026-08-21, written the same day and after building the fix.**
>
> **The measurement above is right and the attribution is wrong.** The scope
> split is real and the exit 0 is real; the split is not what caused it, and
> this entry read one as the explanation of the other.
>
> Measured with the split closed: the same shape — a journal entry staged beside
> an unstaged advance — **still exits 0**. It has to. The check's only property
> is that the watermark's sha appears somewhere in the journal, and with the
> advance unstaged the index carries the *old* sha, which appears in its own
> older entry. Reading both documents from one scope changes which sha is
> compared; it does not make the comparison able to tell the two cases apart.
>
> So this was two findings written as one, and they separate cleanly:
>
> **OO-3a — the scope split. Fixed.** `documentConsistency.mjs` read the journal
> through the index and the watermark through the working tree. `check:docs` now
> takes both from the index via `stagedWatermark`, which is Z-2's rule applied to
> the caller Z-2 did not convert. Its own symptom was a false **positive** — the
> check failing on an unstaged pair that no commit would ever contain, which is
> how it was found.
>
> **OO-3b — the gate is one-directional. Open.** It catches *a watermark
> advanced without a record*. It cannot catch *a record written without the
> watermark advancing*, because every sha the journal has ever named stays in it
> forever, so the property is satisfied by history. The batch budget does catch
> it, later, and with a message demanding an audit that was in fact performed —
> which is the confusing shape, not a silent one. Closing it means asserting
> something about the **newest** entry rather than about the document, and that
> is a design decision rather than a line.
>
> Recorded rather than tidied because the error is item 5's, in the sentence
> where I was most confident: the exit 0 was executed, the *chain from it to the
> split* was reasoned, and I wrote the reasoned half in the executed half's
> voice. The tell available at the time was that I never ran the fix against the
> shape I said it closed.

**MM-1 stays open, and correctly.** The bound was not raised — the probe loads
in 205 ms against a 15,000 ms bound, so a runner that hit 15 s was structurally
different and a bump would have hidden it. The load duration is now reported on
the success path, which is an instrument added rather than a cause found.

Also open: II-2 (before Stage 0 exit), GG-8, AA-1, AA-3, CC-3, DD-2, BB-6, Y-3,
and the MuPDF cache's restore-without-reverify.

### Executed, and asserted

**Executed:** the annotation read from
`check-runs/96800061993/annotations` · four mutations, each verified to redden
its own case alone · `typecheck` · `lint` · `proof:perfbudget` (29 cases) ·
`perf:gate` on both content shapes.

**Asserted:** nothing in this entry.

---

## 2026-08-21 — Stage audit: `7223851..9a951d6` — the app runs, and the kernel was loading the parser to hold bytes

**Audited through `9a951d6`.** 3 commits, 21 files, **3 proofs added, 3
modified**, 4 new source files — from `npm run audit:scope`.

The range: the accounting findings closed, and **the composition root — the
first commit in which this application runs.**

### LL-1 — importing `DocumentService` loaded the native MuPDF shim

```
commandLog.ts: import { type PriorPageRotation } from './rotatePages.js';
```

emits `import {} from './rotatePages.js'` — the specifier survives and runs — and
`rotatePages.js` imports `withDocument` from `mupdfWriter.js` as a **value**.
Measured: importing `documentService.js` took RSS from **54.5 MB to 92.6 MB**.
38.1 MB of native parser pulled into the module whose entire argument is that it
holds bytes and never parses them (§2, and §9.17's base term).

`import type` erases the statement: **38.1 MB → 9.0 MB.**

**Second instance in two days of one mechanism, with a different bill.** The
first made a unit test download Electron. The tell is identical and it is the
reason the fix ships with a proof that reads the **emitted** JavaScript: the
source cannot distinguish `import type { X }` from `import { type X }`, and one
of them runs.

**Item 3: CI could not have caught it.** Nothing measured what importing the
kernel costs. `proof:kernelload` now walks the emitted import graph.

### LL-2 and LL-3 — the ceiling counted one of two terms, and `byteLength` is the view's

Raised by the reviewing seat, closed in-range. `Checkpoint` is a whole byte image
per terminal entry and uncapped, so with a 1.00× image against a 1.5× budget
**the first checkpoint written puts `main` over budget while `open` still reports
capacity**. And a `BytesReader` returning `big.subarray(0, n)` retains all of
`big` while reporting `n` — under-reporting in the unsafe direction.

The log now reports what it **physically retains**, redo tail included: `entries`
is the applied view, undo moves a cursor rather than popping, and summing what
the log shows would drop a checkpoint the instant a user pressed undo. Mutation:
count `this.entries` and the redo-tail case reddens *alone*.

### LL-4 — "sized by measurement" was arithmetic about bytes, not evidence about the code

`roleMain.mjs` is a **model** of main — read, hash, hold, report — and never
constructs a `DocumentService`. ADR-0021 and the FEATURES row both read as though
main-with-the-implementation had measured 1.00×. Corrected in both to say which
process ran.

The gap is the harness axis this project paid for at BB-4: *what does the harness
hand its child that the real caller does not* — here the harness does the
retaining itself, so the real caller's version is exercised by nothing. The
`perf:gate` role that closes it was **blocked by LL-1** until this range and is
now owed rather than blocked.

### LL-5 — the new proof's own control fired on its first run

`kernelLoad.proof.mjs` matched `import … from` and `index.js` **re-exports** the
adapter, so the walk reported `mupdfWriter.js` unreachable from the one module
that certainly reaches it — a wrong pattern producing this proof's *passing*
answer. Caught by the known-present control, not by luck, and the fix widened the
pattern to cover re-exports and bare side-effect imports, matched on `from '…'`
anywhere rather than anchored to a statement start because `tsc` wraps long
import lists.

### LL-6 — a claim about the code's behaviour, written before running it

`composition.ts`'s first draft said `document.execute` "is registered and
reachable and fails with `internal`" — the CC-2 shape, argued as a cost to
accept. Run through the real bridge it returns **`document-not-open`**, a
declared failure: `DocumentNotOpenError` fires before the session is looked up,
and the missing-session path needs an *open* document, which is not a channel.

Item 5, on my own comment, in the same file that argues for measuring. The
paragraph now states the measured answer and `proof:shell` asserts it.

### Item 2a — coverage added, and one amnesty list grew

Three proofs added and none removed. Worth naming because it is the one
loosening: `ACCOUNTED_COMPUTED` in `proof:electronimports` grew from three
entries to four, for `composition.proof.mjs`'s `file://` import of the built
budget. That list is a standing amnesty and EE-10 is the finding that gave it a
declared site count in both directions; the new entry carries one.

### Item 4a — the four new source files

`budget.ts` is a constant whose correctness is a **derivation**, checked by
`proof:composition` against §9.17 with a control rejecting a ceiling that forgot
the baseline. `composition.ts` and `entry.ts` are proven **to run**, not to
compile — `proof:shell` makes the page invoke `app.info` across the real bridge,
mutation-tested by changing the handler's value. `shellHarness.ts` is that
proof's instrument.

**Open:** II-2 (before Stage 0 exit), LL-4's owed `perf:gate` role, GG-8, AA-1,
AA-3, CC-3, DD-2, BB-6, Y-3, and the MuPDF cache's restore-without-reverify.

---

## 2026-08-21 — Stage audit: `03fcf9b..7223851` — the shell learns to report its own failures, and a unit test was downloading Electron

**Audited through `7223851`.** 6 commits, 24 files, **1 proof added, 4
modified**, 1 new source file — from `npm run audit:scope`. Owed on the file
threshold again, 24 of 24.

The range: the three HH closures, the owner's rulings recorded, `DocumentService`
gaining the canonical image, and the shipped app learning to hear the failures
Electron announces.

### KK-1 — a unit test was downloading Electron, and the invariant that forbids it could not see the route

```
import { type App, type WebContents } from 'electron';
```

emits `import {} from 'electron'` — the braces keep the specifier, so a
**side-effect import survives**. `shellFailure.test.ts` imports that module and
vitest runs it in plain Node, where importing `electron` *is* the download.
`node_modules/electron/dist` appeared at 11:30, the minute the new test first
ran. Invariant 26, tripped by the commit that closed II-1.

Neither enforcer can reach it: ESLint's boundary exempts `desktop`, the runtime
scan's root stops at `scripts/`. And invariant 26's own rationale is what made
the import look safe — *"`apps/desktop/src/` runs inside the Electron
runtime"* is true of the app and false of its tests. Corrected in the same
commit.

### KK-2 — and CI was structurally blind to it, which is the general half

`ci.yml` asserted `node_modules/electron/dist` absent **90 lines before**
`npm test`. The same download would have happened inside the run that went
green.

**An assertion about what a job has not yet done is only true at the point it
runs. Its position in the file is part of the claim.** Fixed by running the
proof again after the suite — and the class is every other order-dependent
assertion in both workflows, so the pass was made rather than a rule written:

| assertion | position-dependent? |
|---|---|
| `proof:electronimports` — dist absent | **yes**, and it was wrong. Now runs early *and* late |
| `guard:tree`, `scan:secrets`, `proof:lintignores` | no — tracked files, history and `.gitignore` do not change mid-job |
| `proof:testresolution` | yes, and already correct: it runs after the suite *by explicit comment*, because it poisons build output |
| `proof:rendererpolicy`, `proof:kernelload` | read `dist/`, and both are protected — the first by HH-6's staleness comparison, the second by running immediately after the build |

One instance, and it was the one already found. The others are static inputs or
already position-aware with a stated reason.

### KK-3 — II-1's probe was vacuous, and its first fix was still half vacuous

Counting listeners on the shipped window and requiring `count > 0` **passed with
the subscription deleted**: Electron attaches one listener to each of those
events itself, so the reassuring reading was produced by something other than
the thing under test. HH-2's class, an hour after HH-2's rule was written into
`CLAUDE.md`, by the author who wrote it.

Made differential against a bare window — and *that was still half vacuous*,
because the harness kept its own `preload-error` listener, so a probe about the
shell's subscription was satisfied by the test's own. The harness now reads the
preload's failure out of the shell's sink. All three components read 0 under the
mutation.

**No proof catches this class.** Only mutating the thing the case guards
separates a vacuous case from a real one, and that is the second range running
where the mutation step was the only thing that found the defect.

### KK-4 — the window's background was a raw hex that had never been true

`'#00000000'` reads back from a running window as `#000000`: Electron honours an
alpha channel only for a `transparent` window. The window painted opaque black
for its whole life while the source said fully transparent.

Worse than the raw hex it was raised as. A reader checking what the window paints
got an answer that had never been true, and the next person wanting transparency
would have found it already "set". Now read back, with the original value as the
mutation that proves the case.

### KK-5 — a number's cause inferred from a document rather than from the instrument

`perf:gate` reads `main` at 1.00×, and that was taken to mean *main holds
nothing* — from a `docs/FEATURES.md` row, without opening `roleMain.mjs:35`,
which does `readFileSync`. 1.00× has always meant **one resident image**.

Acting on it would have produced a false *"the gate is blind"* when it was not.
Recorded because the shape is general and this project has it on record already:
**a document explains a number; only the instrument produces it.** The
replacement test — one image against two, 1.00× against 2.00× — separates the
quantities that change the decision, which is what item 4a asks for.

### Raised by the reviewing seat inside this range

**II-1** (closed) — `preload-error` was subscribed in exactly one place in this
repository, the test harness, so the shipped app had HH-1's property: if the
bridge stops loading the window comes up looking correct and nothing says
otherwise. Closing the one broken preload and leaving the channel unsubscribed
in production is *fix the class* with the class untouched.

**II-2** (open, with a hard trigger — **before Stage 0 exit**) — the independent
evidence offered for `sandbox: true` was Chromium refusing to start without a
SUID helper, which is evidence for a *different* proposition: the helper backs
the browser's OS-level sandbox and would be required with the flag off. The
wrong attribution was removed rather than defended; the probe that attributes to
the flag alone is owed. **Five of §2's seven items verified reads as complete to
a skimmer, and the two that are not are the two nobody will re-check.**

**II-3** (closed) — KK-4 above.

**JJ-1, JJ-2, JJ-3** (raised at the end of this range, fixed in the next
commit) — the perf measurement is of a *model* of main and not of
`DocumentService`; the ceiling counted images and not checkpoints, so the first
checkpoint written puts `main` over budget while `open` still reports capacity;
and `byteLength` is the view's length, so a reader returning a subarray
under-reports in the unsafe direction.

### Item 2a — three movements, two of them reductions

The advisory register lost a verdict and two symbols (5/19 → 4/17) when
`kernel-holds-canonical-bytes` was retired. Deliberate, and it should not read as
tidying. `proof:rendererpolicy` grew from 13 cases to 16. And
`proof:electronimports` now runs **twice** in CI, which is not duplication: the
early run is fast feedback on the static shapes and the late run is the only one
whose absence assertion means anything.

### Items 4a and 7

`shellFailure.ts` is the range's one new instrument: its messages are
unit-tested, its subscription is read back off the shipped window, and its
delivery is proven by killing a renderer. Documents corrected in the commits that
invalidated them — invariant 26's rationale, invariant 27's predicted trip,
`preload.ts`'s "that window does not exist yet", the FEATURES contract row's "no
binary exists to run a window with", and `window.ts`'s sibling `preload.js`.

**Open:** II-2 (before Stage 0 exit), JJ-1's owed `perf:gate` role, GG-8, AA-1,
AA-3, CC-3, DD-2, BB-6, Y-3, and the MuPDF cache's restore-without-reverify.

---

## 2026-08-21 — Stage audit: `a66e1e6..03fcf9b` — the CSP becomes law, and the preload turns out never to have run

**Audited through `03fcf9b`.** 5 commits, 24 files, **0 proofs added, 2
modified**, 3 new source files — from `npm run audit:scope`. Owed on the **file**
threshold rather than the commit one: 24 of 24, so the next commit crosses.

Zero proofs added and one of them at **+252/−15** is the shape this checklist
says to read closely, and it was worth reading: every deletion is a rename, a
count, or prose. No check left. Six arrived.

The range's substance: **invariant 27 pins the renderer's CSP** and the document
becomes its writer of record, and the read-back is extended from one §2 item to
five — which found, on its first run, that the preload had never executed.

### HH-1 — the preload had never loaded, and every check about it passed

`dist/preload.js: SyntaxError: Cannot use import statement outside a module`.
`tsc` emits ESM into a `"type": "module"` package; a **sandboxed preload is
loaded as CommonJS**. Announced through Electron's `preload-error` event and
through nothing else — no stderr, no exception in main, no failed-load. The
window opened, the page rendered, `window.monstera` was undefined.

`proof:preload` derives the permitted import set from the file's syntax.
`proof:contract` proves the channels are exhaustive. Both passed, **correctly**,
about a file nothing had ever run. Reading the source could not have found this,
and no amount of care in review would have either: the defect is not in the file.

Closed in-range by bundling to CommonJS ([ADR-0020](DECISIONS/0020-the-preload-is-bundled.md)),
entering the contract through a new `@monstera/contract/bridge` leaf —
**137,809 bytes through the package root, 233 through the leaf**, because
`channelIds = Object.keys(channels)` is a top-level evaluation in the index and
nothing prunes around it.

**Item 3: CI could not have caught it.** Nothing ran the preload anywhere. It now
runs on both platforms every push.

### HH-2 — my own new probe was vacuous, and only the mutation step found it

With the navigation guard's `preventDefault` removed, the case stayed **green**.
The probe navigated to `https://example.org/`, which produces zero loads when the
guard refuses it *and* zero when the machine has no network. It could not tell a
working guard from an offline runner.

Item 4's fixture rule — **in the same file that already records being bitten by
it**, on `example.invalid`, four commits earlier, in a comment I had read while
writing the probe beneath it. Knowing the rule, having written the record, and
having the counter-example on screen did not stop me reaching for a remote URL.

The fixture is now the loaded document plus a query string: on disk so it loads
with no network, different href so `isPermittedNavigation` refuses it — and it
exercises that function's whole-href claim as a side effect. Red under the
mutation, green with the guard.

**No proof catches this class.** A vacuous case passes; only mutating the thing
it guards separates it from a real one. That is why item 4 is mandatory rather
than advisory, and this is the argument for it in one line.

### HH-3 — ADR-0020 stated two reasons and had executed one

The ADR says a sandboxed preload's `require` "resolves a small fixed set, not
`node_modules`", and offers it as independently sufficient. **That was asserted.**
The measured error was only the ESM one; nothing had ever run a CommonJS preload
carrying a bare specifier.

Measured during this audit by making the contract external to the bundle:
`Error: module not found: @monstera/contract/bridge`, from the same
`preload-error` channel. The claim is true. It was not evidence when it was
written, and an ADR is where a future reader goes to find out what was
established — so the ADR now carries a dated note separating what was measured
when.

### HH-4 — the honesty mechanism hand-maintains a number the roster computes

`rendererPolicy.proof.mjs` prints `UNVERIFIABLE — 9 case(s)` followed by nine
hand-written lines, beside a roster declared as `RUNTIME_PRESENT ? 13 : 4`. The
9 is `13 − 4` and it is a **literal**. Add a runtime case and the roster is
correct while the block that exists to say *what could not be looked at* names
eight of nine and calls it nine.

B3a, inside the mechanism whose entire job is to not overstate. The count and the
list must be derived from one array. **Open**; the fix is one array and is next.

### HH-5 — item 7's compound claim, created by the commit that corrected its neighbour

`window.ts` line 14 describes `HERE` as resolving "the sibling `preload.js` and
the `renderer/` beside the package root". The second clause is true. The first
became false **eight lines above the comment written in the same commit to
explain why it is `preload.cjs` now**.

Exactly the shape the checklist names: a compound claim whose surviving clause
vouches for the dead one, sitting in the position a reader treats as the
contract, with the correction below it where a skimmer never reaches. Ninth
occurrence of item 7 in this record, and the second created *by* the fix. **Open**,
one word.

### HH-6 — the read-back reads `dist/`, and nothing detects a stale one

`proof:rendererpolicy` resolves the harness, the declared policy and the preload
from `apps/desktop/dist/`. `npm run build` is `typecheck` + `build:preload`; a
contributor who runs `npm run typecheck` alone — which is what `CLAUDE.md`'s
Commands section shows — edits `preload.ts` and gets a **stale bundle**. The
bridge still loads, all thirteen cases still pass, and they pass about the
previous preload.

This project already recognises the class: `proof:testresolution` exists to prove
the tests read source and not a stale build. The renderer read-back is the same
shape and has no equivalent. And it is the one failure `CLAUDE.md` names as
unreachable by a positive control — a stale answer contains the known-present
anchor too. **Open**; the remedy is a freshness comparison, not a wider probe.

### Item 2a — two movements, and the second reads worse than it is

The pin agreement is a **strengthening with no provisioning condition**: it
compares two strings and runs on every machine, including the ones that can never
start Electron.

The UNVERIFIABLE block grew from **3 lines to 9**. That reads like a blind spot
tripling and is not one: the *intent* half of §2 is `windowPolicy.test.ts`, which
runs everywhere and gained an assertion this range. What is newly unverifiable on
a runtime-less machine is *enforcement* — which was not verified there before
either, because it was not verified anywhere. The block got longer because the
coverage got wider, and the honest reading is that the list now names six things
it previously did not think to mention.

### Item 4a — the three new instrument files

`rendererHarness.ts` — resolution-tested by four mutations, each reddening a
distinct case, and one of them (`PERMITTED_PERMISSIONS` emptied) reddening
**only** the control while the deny case stayed green, which is the separation
the control exists for. `scripts/build/preload.mjs` — two known-different inputs,
137,809 bytes and 233, by `wc -c` on the artefact. `scripts/ci/sandboxHelperPath.mjs`
— **not** resolution-tested; its output derives from `electronRoot()`, whose
agreement with the pin is covered by `proof:electronprovision`. Derived, not
measured, and recorded as such.

### Items 1 and 6

Every fix in the range is a mechanism named in one sentence: a version literal
replaced by the module's return value (`c8aa6ea`), a SUID helper configured
rather than the sandbox disabled (`ddc9e16`), a policy pinned in the law with the
code derived from it (`c98d62e`), a preload bundled at the build (`03fcf9b`). No
loosened check, no override, no repair that could regenerate — with HH-6 as the
qualifier, which is not a regeneration but a staleness.

Architecture moved first where it moved: ADR-0019 is the amendment, and the
constant changed in the same commit because the new agreement check makes any
other order a red build. ADR-0020 amends nothing in `ARCHITECTURE.md` — it
records how a thing the law already requires is produced.

### Also recorded

**`style-src 'unsafe-inline'` was dropped rather than pinned**, which the ruling
that ordered the amendment did not cover and which is flagged as such. Nothing
needed it; pinning it would have made an unproven grant into law by arriving
early, which is the failure the pin exists to prevent.

**GG-8's trigger has not fired.** The open finding — no check stops a version
literal returning to a workflow — closes convert-on-touch, on the next commit
that adds or edits a workflow step **touching the Electron tree**. `03fcf9b`
edited two workflow steps; both are `Typecheck and build` and neither touches it.
Stated because a trigger nobody checks precisely is a trigger that fires when
it is convenient.

**Open:** HH-4, HH-5, HH-6, GG-8, AA-1 (granularity), AA-3, CC-3, DD-2, BB-6,
Y-3, and the MuPDF cache's restore-without-reverify.

---

## 2026-08-21 — Stage audit: `d4c01c1..a66e1e6` — the shell starts, and `main` is red at the end of it

**Audited through `a66e1e6`.** 9 commits, 20 files, **2 proofs added, 2 modified**,
6 new source files — from `npm run audit:scope`.

**Recorded while `main` is RED.** The audit is owed because this commit would
otherwise cross a batch, and the gate is right to hold: Y-2's design counts
`commits + 1`, so it catches the commit that *crosses* rather than the one after.
The pending fix is written, proven locally, and waiting behind this entry. Saying
so is part of the record — an audit entry that reads as though the range ended
tidily would be the first false thing in it.

The range's substance: **Electron is provisioned in CI and the shell starts.** A
hardened `BrowserWindow`, both permission handlers, the sender check, a launcher
that names the pinned binary through `electronBinaryPath()`, and — on
windows-latest — **the first security property this repository has ever verified
against a running Chromium** rather than against the source that configures it.

### The headline, stated plainly because it is easy to lose in the red

`windows-latest` passes the renderer read-back. The CSP is read from the response
as Chromium received it, compared to what the shell declares, and the renderer is
observed refusing a `connect-src` fetch and an `eval`. Delivered *and* enforced,
on a real runner. Linux fails for a reason that has nothing to do with the
policy, which is the next entry's problem and not this claim's.

### GG-1 — a commit added a file under `scripts/` and did not run the proof that scans `scripts/`

`20c7789`'s Executed line lists `proof:rendererpolicy`, 228 tests, typecheck,
lint, `check:docs`, `guard:staged` — and not `proof:electronimports`. The new
file contains a computed specifier, `EE-10`'s unlisted branch fired in CI, and
`main` went red on a check that runs in under a second locally.

**G-1's shape exactly**: the checks that were run were the ones the change *felt*
like it was about. The rule that follows is narrow and worth keeping: **when a
commit adds a file to a directory some proof scans, that proof is in the
pre-commit set for that commit, whatever the change is about.**

The mechanism itself worked. `EE-10`'s branch was built for a new site appearing;
the previous two entries were found by widening the check, and this is the first
one found by a commit *adding* a site. Closed in `446a37a` with the reason
recorded — the path is a build output resolved at run time, and a literal would
compare the declared policy against a copy of itself.

> **Note, 2026-08-22 — this recurred twice in one session, and the rule as
> written cannot stop it.** Both times the file touched was
> `docs/security/engine-advisories.json` and the proof not run was
> `advisoryRegister.proof.mjs`, which reads it. Both times what *was* run was
> `check:advisories` — the neighbour. The second time it turned Guards red on
> one runner.
>
> **The bolded rule above is a rule you must recall at the moment you choose
> which checks to run**, which this project has written three times is not a
> remedy. The derivable version is the one to build: *when a commit touches a
> file some proof reads, that proof is in the pre-commit set*, with the mapping
> **computed from what each proof reads** rather than kept as a table.
>
> **Not built, and the obstacle is specific rather than a lack of time.** Proofs
> address their inputs by construction — `join(ROOT, 'docs', 'security',
> 'engine-advisories.json')` — so the path exists nowhere as a literal to grep
> for, and a scan matching segments would produce a mapping with holes that
> reads as complete. That is the enumeration disease again, which is exactly
> what EEE-3 refused to ship for Y-3.
>
> The two candidates worth pricing: a **runtime trace** — run each proof once
> with `fs` instrumented and record the tracked files it opened, which is a real
> derivation and needs an answer for staleness; or a **declaration each proof
> makes about itself**, which is still a list but one that sits beside the code
> it describes rather than in a central table, and can be checked against a
> trace. Either is a unit; neither is a five-minute change.

### GG-2 — the premise under four hypotheses was asserted, and cost two pushes

"Only the read-back step fails" was never read. Every hypothesis built on it —
`xvfb`, the Chromium sandbox, `debugger.attach`, `did-finish-load` — was about a
step that **had not run**. Step 17 failed; step 18 was `skipped`.

**Step conclusions are on the public API. Only raw logs are behind the 403.** One
unauthenticated `GET /actions/jobs/<id>` lists every step with its conclusion,
and this project's own notes record the 403 as the thing only the owner can pass
— a fact about logs, applied to a question it does not cover.

Two mechanisms came out of it, both used later in the same range and both worth
keeping:

- **Read the step list before forming a hypothesis about which step is at
  fault.** Ask for a log only once you know whose log you want.
- **Step *durations* are public too, and they discriminate.** The Linux failure
  lasted **one second**, which eliminated every hang hypothesis at once —
  nothing that starts Electron and waits for a window fails that fast.

### GG-3 — the harness could only fail by hanging

`void reportDeliveredPolicy()` discarded the rejection, and Electron does not
exit on an unhandled rejection in the main process. Any throw left the app idling
until the proof's 120 s timeout, and the proof then reported "no marker line" —
identical to the output of a harness that never started. **FF-2's shape**:
impossible to miss, impossible to attribute. Closed in `2cbf658`, along with a
real race where `app.exit()` could truncate the report on the very path that
produces it.

**And `2cbf658` is itself a finding.** Both fixes are correct on their merits and
neither changed the outcome, because the code was never reached — they were
written in response to a symptom that had not been confirmed. *The banned reflex
with good engineering attached* is the version that does not feel like one.

### GG-4 — three second opinions in one module, all B3a, all found by running it

`scripts/provision/electron.mjs` had written its own answer to three questions
siblings had already settled, and **each second opinion agreed with the authority
on every input anyone had tried** — which is the shape B3a describes and the
reason review passed over all three.

| question | the authority | what the second opinion did |
|---|---|---|
| "am I run directly?" | `gitleaks.mjs:852`, `mupdf.mjs:346`, `electronSurface.mjs:351` | built `file://` + path, giving `file://C:/…` against `import.meta.url`'s `file:///C:/…`. **Exit 0, provisioning nothing**, on Windows only |
| "where do I stage a published tree?" | `gitleaks.mjs:770` | `mkdtemp(tmpdir())`, which `rename` cannot leave: the runner's workspace is `D:` and `TEMP` is `C:` → EXDEV |
| "which program extracts this?" | — | the extractor's own comment claimed "bsdtar first"; the Linux list held three GNU-tar paths, and GNU tar cannot read a zip |

The third is the sharpest. That comment is **true on macOS and false on Linux**,
and the list was used on both. Every earlier caller escaped by accident —
gitleaks ships `.tar.gz` for Linux and zip only for Windows, MuPDF is a source
tarball. Electron ships *every* platform as zip, so it was the first caller to
reach the case.

None of the three could have been found by reading. The first produced a green
step that did nothing; the other two required a runner whose filesystem layout
and toolset differ from a developer machine's.

### GG-5 — the enforcement probe was a fixture the defect handles correctly

The CSP read-back's first enforcement probe asked whether `fetch` rejected and
whether `new Function` threw. Measured: loosening `connect-src` to `'self'
https:` left **both answers unchanged**, because `https://example.invalid/` fails
DNS whatever the policy says. The probe reported "blocked" for a request CSP had
just been loosened to *permit*, and survived the exact mutation it existed to
catch.

**Item 4's fixture rule, caught by running the mutation rather than by reading
the code.** Now read from `securitypolicyviolation`, which only the CSP
implementation fires — an event that cannot be produced by a network failure, a
hostname typo, or an offline runner. The difference between measuring the policy
and measuring the weather.

### GG-6 — nothing established that the published binary could be executed

`extract.mjs` performs no `chmod` and no mode assertion, and the provisioner
deliberately never spawns what it publishes — correctly, after the gitleaks
EPERM, because "does it run" is a question about the machine at this instant and
must not gate a publish.

The consequence went unstated: on POSIX **nothing checked that the published
binary was runnable at all.** The `available: true` shape — a green provisioning
step for a file that may not execute. Reading the mode is a question about the
*file*, so it is safe to gate on, and it is a check rather than a guess since
nothing in the extractor sets it. **Raised by the reviewing seat; the fix is in
the commit this entry unblocks.**

### Item 2a — coverage moved in both directions again

- **The CSP read-back is a strengthening where the runtime is provisioned and a
  new "could not look" everywhere else.** The policy used to be asserted from a
  constant, unconditionally. The meaningful half now has a provisioning
  condition, and prints `UNVERIFIABLE` — never "nothing to check", which would be
  false — when it cannot look.
- **`securitypolicyviolation` replaced two behavioural questions with one
  precise one.** Strictly stronger, and it narrows what the probe can see: it
  now reports only violations CSP itself raises, so a *non*-CSP failure of the
  same operation is no longer visible to it at all. Correct, and a change in what
  green means.

### Executed rather than asserted

Provisioning was run end to end on real bytes: a 150,154,788-byte archive
downloaded and verified, extracted, published, and `electron.exe --version`
printing `v43.4.1`; a cache hit verified in 7.3 s with no download; **100 random
bytes appended to the cached archive → refused, expected/received digests named,
file deleted unread**; and recovery by re-download on the next run.

The read-back's mutations were run against the live runtime: `connect-src`
loosened → red on `connectBlocked` (and *green* before the probe was fixed, which
is GG-5's whole evidence); `applyContentSecurityPolicy` no-opped → two red; the
runtime hidden → `UNVERIFIABLE` printed with the string half still green.

### Carried forward, still open

**AA-1** (granularity), **AA-3**, **CC-3**, **DD-2**, **BB-6** (ruled not-now),
**Y-3**. **The MuPDF cache has the same restore-without-reverify property the
Electron cache was given** (`ci.yml:313`) — raised in `55cfe69`, not fixed, and
not the same shape: it caches a *built tree*, which has no pin to check against.

Next: the Linux sandbox helper, then the §9 CSP amendment, then the composition
root.

---

## 2026-08-21 — Stage audit: `90d9b6e..HEAD` — a range of instruments, audited before feature code joins it

**Audited through `d4c01c1`.** 9 commits, 14 files, **1 proof added, 1 modified**,
1 new source file — figures taken from `npm run audit:scope`, because a
hand-count disagreed with it three times in this range and the instrument was
right every time.

**Why this range is audited now rather than after the window unit.** It is made
almost entirely of instruments and proofs written to close the previous finding
— the composition `CLAUDE.md` names as producing most of this project's defects.
The window unit would have put instruments and the first feature code into one
range, and an audit reading two kinds of change at once reads neither well. The
batch threshold was reached at the same time, which is a coincidence rather than
the reason.

The range's substance: `require('electron')` became unreachable from plain Node,
enforced by two mechanisms split along the line ESLint actually draws, and
promoted to **invariant 26** in its own B4 commit before the launcher it governs
exists.

### FF-1 — a shared list with two consumers had a proof on one of them

`PLAIN_NODE_EXTENSIONS` exists so that widening it moves **both** the lint glob
and the runtime scan. Only the scan could demonstrate it moved: its `.cjs`
fixture in the shapes case. ESLint's half was asserted.

The fact that made the gap invisible is the fact that will change — **there is no
`.js` or `.cjs` under `scripts/` today**, so no run ever put ESLint in front of
one, and a glob that had quietly stopped matching them would look exactly like a
glob that works. That is the general shape worth carrying: *a shared definition
whose whole purpose is to move two things needs a control on each, and the
consumer with no live inputs is the one that will be missing it.*

Closed in `d4c01c1`: a `.js` probe under `scripts/` must report
`no-restricted-imports`. Narrowing the globs back to `.mjs` alone reddens it and
nothing else.

Measured while writing it, and kept: a `.cjs` doing `require('electron')` is
caught by `@typescript-eslint/no-require-imports`, **not** by
`no-restricted-imports` — invariant 26's two-mechanism split seen from the other
side.

### FF-2 — a single-element brace glob is not expanded, so it matches nothing

`PLAIN_NODE_GLOB` built `scripts/**` + `/*.{mjs,js,cjs}` by joining the list.
Measured by swapping only the braces: the one-element form `/*.{mjs}` matches
**nothing**, while `/*.mjs` matches everything. With three extensions the brace
form works, so the defect was invisible — and it fires the day someone narrows
the list to one, which is what removing an extension eventually means.

**It fails loudly and still fails badly.** 103 errors, all of them `Parsing
error: … not found by the project service`, because `projectService` then
type-checks the files the `disableTypeChecked` block no longer covers. Nothing in
that output says a glob stopped matching. **A failure that is impossible to miss
and impossible to attribute is not much better than a silent one** — the reader
goes and edits `tsconfig.json`.

So the fix has two halves. The glob is now an **array, one entry per extension**,
which makes the length-one case unrepresentable rather than checked (B5, chosen
over a `length === 1` conditional). And the attribution went into the new case's
own diagnostic: *if the message is a parsing error rather than a rule id, the
config block stopped matching this file.* That is the half that is still useful
in six months.

### Item 2a — the coverage moved to a job that can only look after `npm ci` succeeds

Paid explicitly, because this range moved coverage in two directions and every
commit message treated both as pure improvement.

A **first draft of this entry said** the static-shape check "used to run in both
workflows and now runs in one." That is not the history, and it was corrected on
measurement: `d66143a` put the scan in `proof:electronprovision`, registered in
`guards.yml` only, where it was red from its first run; `f0aedc2` moved it to
`proof:electronimports` in `ci.yml` only. **One workflow throughout — what
changed is which one.** Platform coverage is unreduced: both jobs are
`os: [windows-latest, ubuntu-latest]`.

The real reduction is a different axis. In `guards.yml` the check ran with
**nothing installed** — that job has no install step at all. In `ci.yml` it runs
after `npm ci --ignore-scripts`, and so does `lint`, which is where the static
shapes now live. **Both halves of this range's coverage now share one
provisioning condition where there was none.**

That is invariant 25's shape exactly — symbols moving from witnesses to a
derivation — and it is correct by the register's own philosophy while still being
a reduction: a failed install does not mean the checks report *no violations*, it
means they **do not report at all**. This is not theoretical here. This
repository has a 138-commit precedent in which every run died at `npm ci` and
both seats answered "would CI have caught it?" from the workflow file rather than
from a run.

Not a defect, and not fixed here. Stated, because every unverifiable-shaped
output reads as rigour, including the ones that used to be failures.

### AA-1 again — third range in which the granularity half hid something

The instrument column lists **one** new source file, `plainNodeScope.mjs`, which
is a constants module. The three things in this range that actually needed
resolution-testing arrived as **functions inside a module that already existed**
— `scriptsLoadingAtRuntime`, `isModuleLoad`, `unpinnedRuntimeExists` — and
appeared in no column at all.

Both findings above came from reading the modified-proof diffs, which is what the
report's own note instructs and what no column does for you. AA-1's granularity
half remains **open**, and this is the third consecutive range where it is the
axis that hid something. Pattern (W-1), root (X-1) and state (Z-1) were each
fixed and each left the next standing; granularity is the one still standing.

### The net-diff caveat earned its keep

`electron.proof.mjs` reads **+8 −0** across the range while its roster went
**8 → 11 → 8** inside it. A rule check was added in `d66143a` and removed in
`f0aedc2`; the net diff shows neither. Without the per-commit column and its
warning, the range's most consequential proof change — the one that turned Guards
red on both platforms — would have appeared as an eight-line comment.

### Findings raised and closed inside the range

Nine, all by the reviewing seat, all closed here:

- **EE-1** the unpinned-runtime probe had never returned true anywhere and could
  not — and its prescribed control caught a real defect on its first run:
  `unpinnedRuntimeExists` was built on `fileExists`, which ends in `.isFile()`,
  and `dist` is a directory.
- **EE-2/EE-3/EE-5/EE-6** the hand-rolled scan was a second opinion about static
  imports; measured against ESLint 10.8.1, `ImportExpression` appears **zero**
  times in `no-restricted-imports.js` and its visitor has no `CallExpression`, so
  the residue is real and is now implemented once. The launcher's home in
  `scripts/` closes EE-6 by B5 rather than a fourth rule.
- **EE-4** the sentence offered as the demonstration was false about the file it
  named — a checked claim with an unchecked detail attached, where the checked
  half makes the other read as checked.
- **EE-8** `ts.isStringLiteral` rejects a backtick specifier, and a computed one
  was reported as absent; the scan now returns a **third state**.
- **EE-9** the corrected reason lived sixty lines from the point of use, in a
  compound claim whose surviving clause vouched for the dead one — item 7,
  created by the commit that recorded the measurement.
- **EE-10** the suppression list was keyed on a file while its recorded reason
  described a line, so a new site inside a listed file reached no diff — the
  property `.gitleaksignore` is banned for, reproduced by a list whose comment
  cited that ban.

### EE-7 — a process finding: an over-generalised sentence bought a wrong ruling

`passRoster.mjs` and `docs/JOURNAL.md` both said "ESLint does not reach
`scripts/`". `eslint.config.js:348` globs every `.mjs` under `scripts/`; the true
claim is the narrower one the *proof* had carried all along — no `no-shadow`
reaches it.

Asked whether `no-restricted-imports` should own the rule (B3a), the reviewing
seat read the two over-generalised sentences and ruled it B4-sized work not to be
started while `main` was red. **It is three lines in a block that already
exists.** "Does not reach" and "reaches with one rule enabled" are not the same
claim at any scale, and the gap between them is a whole conversation about
architecture.

The correction is to **the reason, not the finding** — AA-2 is untouched and
still correct. That is why the false premise survived: everything it was offered
in support of stayed true, so nothing went red and no reader had cause to check
it. Recorded as a dated correction above the original wording.

### Executed rather than asserted

Every mutation in this range was run and restored, not reasoned about: the rule
disabled (2 lint cases red, clean-lint control green) · recursion removed (3 red
including the real-tree control) · callee-blind (the rule case red, on this
repository's own proofs) · extension refusal removed · `isStringLiteralLike` →
`isStringLiteral` (4 red) · unreadable swallowed · `sites` up and down · the
glob narrowed. `ELECTRON_SPECIFIERS` narrowed reddened **nothing**, which is how
a case that separated nothing was found.

Also executed: `no-restricted-imports.js:334` builds `matcher: ignore({…})` and
line 802 calls `group.matcher.ignores(importSource)`, so `patterns.group` uses
gitignore semantics and every `/**` entry in this repository's three groups is
redundant.

### Carried forward, still open

**AA-1** (granularity), **AA-3**, **CC-3**, **DD-2**, **BB-6** (ruled not-now),
**Y-3** (17 handlers). **DD-1 is closed in substance** — the rule, both
enforcers and invariant 26 exist — with its last consumer, a launcher that spawns
the pinned binary, being the window unit's first job.

Next: the window unit, on a range that starts clean.

---

## 2026-08-20 — Stage audit: `598b50e..90d9b6e`

**Audited through 90d9b6e.** 6 commits, 23 files, **4 proofs added, 1 modified**,
6 new source files. The range Stage 0 has been waiting for: **all four contract
surfaces exist**, `packages/ui` stopped being `export {}`, and the Electron
runtime is provisioned against a pin this repository records.

Two findings, and the first is against the range's own headline unit — which is
the shape a range-scoped audit exists to catch.

### DD-1 — the pin is a record, not an enforcement, and `--ignore-scripts` defers the hatch rather than closing it

`90d9b6e` provisions Electron against a recorded SHA-256 precisely so the
installer's own check — which `electron_use_remote_checksums` can repoint at a
remote source — is never trusted. The reasoning holds. The **premise underneath
it does not**, and it was measured rather than argued:

`node_modules/electron/index.js` ends with `module.exports = getElectronPath()`,
and `getElectronPath` calls `downloadElectron()` when the binary is absent. So
**`require('electron')` runs the install path lazily, at first use.**
`--ignore-scripts` moves the hatch from install time to run time, where nobody is
watching, on a machine that installed cleanly.

Three consequences, each checked:

1. **Nothing consumes the pinned binary.** `git grep` finds no caller of
   `electronBinaryPath` or `provisionElectron` outside the module and its own
   proof. The pin records a value; it enforces nothing — the same *recorded
   versus enforced* distinction this project's own journal draws about a hash,
   recurring one commit later **inside the module that drew it**.
2. **`require('electron')` resolves to `node_modules/electron/dist`, not
   `.tools/`.** The default spawn path is the unpinned binary; the pinned one is
   reached only by code that explicitly asks. The window unit is where that
   becomes a decision rather than a default.
3. **There is no `.npmrc`,** so `ignore-scripts` lives only on CI's command
   lines. A contributor running `npm install` gets the install-script path at
   install time as well.

**The obvious fix is a trap, and it is worth writing down before anyone reaches
for it.** An `.npmrc` carrying `ignore-scripts=true` also disables this
repository's own `prepare` script — `package.json:22`, `node
scripts/bootstrapHooks.mjs` — which is what sets `core.hooksPath` and installs
the secret scan and the escape-resolving-write guard. `CLAUDE.md` states hooks
are enabled automatically by it. The naive fix **silently disarms the hook
chain**, which is far worse than the problem it closes.

The remedy instead, and it is B5 rather than a discouragement:

- **`ELECTRON_OVERRIDE_DIST_PATH`**, read at `index.js:30` — *before* both
  `downloadElectron()` call sites. Pointing it at the provisioned tree makes
  `require('electron')` return the pinned binary and **never reach the download
  at all**: the path becomes unreachable rather than deprecated.
- **plus a guard that fails when `node_modules/electron/dist` exists**, so a
  second binary arriving is loud rather than silent — the `.gitleaksignore`
  refusal shape.

Neither touches `prepare`.

**One measured wrinkle in that remedy**, found by reading the line rather than
trusting the name: `index.js:31` joins the override with
`executablePath || 'electron'`, and `executablePath` comes from `path.txt`,
which exists only after a successful install. It is **absent here**. So the
override yields `<dir>/electron` — with no `.exe` — on Windows. The provisioned
tree needs a `path.txt`, or the override names a file that is not there. Verify
that before relying on it.

**Open.** The pin, the six platforms and the refusal-with-no-override are all
correct and stay; what is owed is the consumer that makes them bite.

### DD-2 — the thing not read was the record, and it produced a contradiction rather than a gap

While designing the provisioner I asked the owner to rule on a question
`docs/JOURNAL.md` had already settled at `132c2e7` — the pin, the `install.js`
hatch, the decision and even the *"chain is recorded rather than trusted at each
link"* framing, all recorded that morning. Then I filed a correction stating
**"there is no recorded Electron pin in this repository."**

Had that been accepted, the journal would hold two entries disagreeing about one
fact. That is **B3a arriving in the record rather than the code** — two opinions
about one authority, where the authority is this project's own journal, eleven
commits after B3a became law. `CLAUDE.md` names `docs/JOURNAL.md` as where
project state lives.

**Two failures, and they need separating because their remedies differ.**

- **The root axis.** The digest search was `Grep(pattern, path: 'scripts')`. It
  never looked at `docs/`. That is **X-1 exactly** — a classifier fixed on
  pattern, root, state and window, failing on root again, in a search I ran by
  hand.
- **A hit list is not a result.** `git grep -il electron -- docs/ scripts/`
  then printed `docs/JOURNAL.md`, and I read the **filename list** as the answer
  without opening it. This one is not 4b's shape: **the search worked.** It
  returned the right file. No positive control catches it, because the control
  passes — the instrument was correct and the reader stopped early. It is the
  staleness lesson's sibling, one level up: a sound instrument whose output was
  not consumed.

The remedy for the first is scope discipline; for the second there is no
instrument, only the rule that a list of places to look is not a finding.
**Recorded as a process finding rather than a code one**, and left open because
whether it earns a mechanism is not obvious from one instance.

### Executed, not asserted

- `index.js:20-52` and `install.js:71,84` read directly — the lazy download, and
  `ELECTRON_OVERRIDE_DIST_PATH` preceding both fallbacks;
- no `.npmrc`; `prepare` at `package.json:22`; `path.txt` absent;
- `git grep` for consumers of the pinned binary — only its own proof;
- all six Electron digests, from the release `SHASUMS256.txt` **and** the
  package's `checksums.json`, agreeing on every one;
- `proof:electronprovision` 8, with **both** mutations red — the version bump,
  and a hand-typed asset version, the second run only because the first did not
  redden that case;
- `proof:preload` 10, including amending invariant 1 in `ARCHITECTURE.md` to
  permit `app` and watching two cases go red, then reverting;
- `proof:electronsurface` 8 unchanged after `loadTypeScript` moved out of it;
- 178 tests; `check:advisories` 19/19.

### A correction made inside the range

*"Two independent sources agreeing byte for byte"* was wrong and is now
**"two channels, one publisher"** in the module's own words. The release
`SHASUMS256.txt` and the package's `checksums.json` both come from the Electron
project's single pipeline: agreement defeats a compromise of one distribution
path and is not two attestations. The distinction matters because
*"independently corroborated"* is what a future reader would lean on when
deciding how hard to check a version bump.

### Status

**DD-1 and DD-2 open.** From earlier ranges: CC-2 **closed** in `35632fe`; CC-3,
AA-1's granularity half, AA-3, BB-6 (ruled not-now) and Y-3 (17 handlers) remain.

Stage 0's four-surfaces row is now three-quarters green in substance: all four
exist, and what is owed is **enforcement rather than existence** — nothing calls
`registerContractHandlers`, no window loads the preload, and invariant 1's
*sandbox on* clause is unmet by absence. That is the window unit, and DD-1 is now
part of its scope.

---

## 2026-08-20 — Stage audit: `6827c1d..598b50e`

**Audited through 598b50e.** 9 commits, 16 files, **2 proofs added, 2 modified**,
3 new instrument files. Five open findings closed (BB-1 to BB-5), the board
instrument given a file and a proof, item 4b given a sixth axis — and, in the
last three commits, **the first renderer-side code in this repository**.

### The range that changed what the ranges are for

The reviewer's observation is the most useful thing in this entry, and it is not
a defect: **the audit's input had become its own output.** BB-6 is a finding
about a roster about proofs. AA-1 is a finding about the report that scopes
audits. Every one of them was real, found by a real mechanism — and the audit is
range-scoped precisely because defects arrive inside the fixes for the previous
defect, which reliably produces a range consisting of the previous range's
instrument fixes, which produces instrument findings. Nothing in the process
measures whether the machinery still buys more than it costs, and the mechanism
has no stopping condition of its own. Only something outside the loop can notice.

Measured, and the cost was already on the board: **seven Stage 0 rows are
renderer-side and all seven read `—`.** `packages/ui/src/index.ts` is
`export {};`. The CSP invariant is deferred with its reason given as *"once a
renderer exists to read it from"* — a security invariant blocked on the missing
half. The exit criterion is *open → render → rotatePages + undo → save → one
registered dialog, setting and shortcut*, and `render` is the only verb in it
with nothing behind it. There is no pending ADR and no owner decision. The reason
was that the tooling queue kept producing work.

The audit was also deliberately **deferred by one commit** so it would land on a
range containing feature work rather than on a pure tooling range — auditing at
commit 8 would have fed the loop one more time.

### CC-1 — the board instrument called a cancelled run GREEN

`scripts/ci/board.mjs`, found by auditing the range that added it, one commit
later. Greenness was decided by substring-matching the instrument's own
human-readable summary:

```js
const green = reason.includes('=success') && !reason.includes('=failure');
```

Measured on the real strings rather than reasoned about:

```
GREEN      CI=cancelled, Guards=success    <- 9292d1f's exact state
GREEN      CI=timed_out, Guards=success
GREEN      CI=skipped,   Guards=success
NOT GREEN  CI=failure,   Guards=success
```

`9292d1f` is the commit whose CI run was cancelled by the next push. **It is the
reason the module exists, and the module would have called it green.**

Two things were wrong and only one was the predicate. Greenness was read off a
*rendering* of the data rather than the data, so every conclusion but the literal
`failure` counted as harmless. And it lived in the **fetch shell, which has no
proof** — the split was made so the decider could be proven without a network,
and then the one piece of judgement in the whole instrument went on the untested
side. **A split that leaves logic on the untested side has not been made.**

**Closed in `598b50e`:** `green` is derived in `boardStatus.mjs` as equality
against one conclusion, and is false for every non-complete verdict including
`blind` and `stale` — an answer nobody could read is not a passing one. An
allowlist of one cannot acquire a hole when GitHub adds a conclusion.

CI would not have caught it and still would not: `board.mjs` is a development
instrument CI never runs. What changed is that the judgement now lives where CI
does prove it. **Moving logic out of the unproven shell is the fix; adding a test
for the shell would have been the workaround.**

### CC-2 — a declared channel with no handler, in the file that forbids exactly that

`packages/contract/src/channels.ts` states: *"A channel is added here only when a
real handler for it exists… a declared channel with nothing behind it is a call
that hangs, which is worse than a call that is absent."*

**False for `app.info`, and since it was declared.** Its only implementations are
test fixtures and `contract.proof.mjs`; `apps/desktop` has none, and no
`ContractHandlers` map is registered with `ipcMain` at all. `2b9153c` gave it a
shim-side handler, which does not discharge the claim.

Found by asking item 7 of the shim's own diff. **Open**, and the next unit — the
assembled handler map plus the preload bridge — is what closes it.

### CC-3 — the digest describes a live override in the past tense

`CLAUDE.md`'s item 1 gives `MONSTERA_GITLEAKS` as its example of *"an override or
escape hatch standing in for missing coverage"*, in the past tense: *"existed so
contributors on unpinned platforms had a route; the fix was to pin all ten."* A
reader concludes it was removed. It is live at `gitleaks.mjs:464` and takes
precedence over the provisioned binary.

**And the finding is narrower than it first looked, which is why it is recorded
with the correction rather than as written.** The mechanism is sound: both
callers — `preCommit.mjs` and `scanSecrets.mjs` — run `verifyScannerCapability`
immediately after resolution, checked rather than taken from the comment that
says so, and the canary makes the binary find real secret shapes and match the
pinned version. So this is a documentation mismatch, not an open door.

Low severity, and it is in the **checklist an auditor reads to decide what to
look for**, which is the only reason it is worth a finding at all. **Open**: it
needs an owner ruling on whether the override should go, not a unilateral
removal of a route a contributor may use.

### Stated limits, not findings

- **The shim's outbound structured clone covers nothing a test can see.**
  `wrapHandler` returns `parsedResult.data`, an object zod's parse just built, so
  results are fresh either way; removing the clone reddens no case. It stays as
  wire fidelity, with the reason written as an **expiry**: the moment a channel
  declares a result schema that can return its input by reference, zod stops
  supplying the property and that line becomes the only thing supplying it.
- **A test of mine had the wrong attribution and is kept with it corrected.** The
  copy-independence case was written to cover that clone and passes without it.
  It guards a real property; it now says the property comes from the boundary's
  schema parse. A case that passes for a different reason than its name claims is
  the vacuous shape with a green check on it.

### A new place for item 4's direction rule

CC-1's own cases produced it. Restoring the old predicate reddened only **one** of
four new cases, because the second paired `timed_out` with `skipped` — no
`=success` anywhere, so the **old** predicate answers that fixture correctly, for
the wrong reason.

Item 4 says mutate towards disagreement, because agreement is also what absence
produces. The sibling: **do not build a fixture the bug also handles correctly.**
Same rule, applied to the fixture rather than to the mutation. One instance, so
it is recorded here rather than written into `CLAUDE.md` — an axis earns a place
in the law when it recurs, and this one has not yet.

### Executed, not asserted

- the green predicate, on the six real conclusion strings — the table above;
- `proof:board` 15 cases, mutation red on **two** after the fixture correction;
- `node scripts/ci/board.mjs 2b9153c --once` → GREEN live; `9292d1f` → BLIND,
  correctly, because `per_page=8` no longer reaches that far back;
- both worlds on `proof:advisories`, 29 and 28 + 1 skip, after the BB-1 and BB-5
  changes;
- the shim's inbound clone removed → the non-serialisable-param case goes green;
- `childEnvironment`'s siblings: the other two `spawnSync` sites in
  `preCommit.proof.mjs` are `git` calls, which do not consult `npm_execpath`;
- twelve proofs spawn a Node script with `process.execPath`; the six scripts that
  read `process.env[...]` read `PATH`, `PATHEXT`, `SystemRoot`,
  `ProgramFiles(x86)`, `CL` and `MONSTERA_GITLEAKS`. Only the last is not a
  variable the real caller also has, and it is CC-3;
- the canary running after `resolveGitleaks` in both callers, read rather than
  taken from the comment asserting it.

### Status

**CC-1 closed** in the recording range. **CC-2 and CC-3 open.** From earlier
ranges: AA-1's granularity half, AA-3, BB-6 (**ruled not-now**, with the shape
recorded — convert-on-touch gated on the staged set, because a declared count's
value scales with how often a proof is edited and universal adoption would spend
31 files of churn on files carrying no risk) and Y-3, now at 17 handlers.

**Y-1 is fully closed**, verified this range: all 32 proofs that print a total
derive it — 30 from `passed.length`, and `contract.proof.mjs` and
`guardFiles.proof.mjs` from `CASES.length`, which counts *declared* cases and is
stronger. Limit stated: a total assembled from a named constant would evade both
patterns used.

**Next is the skeleton, not the queue.** The assembled `ContractHandlers` map
with `app.info`, registered with `ipcMain`, and the preload bridge — which closes
CC-2 — then per-document stores, registries, design substrate, i18n, in the order
the exit criterion needs them.

---

## 2026-08-20 — Stage audit: `418bcea..6827c1d`

**Audited through 6827c1d.** 9 commits, 23 files, **2 proofs added, 3 modified**,
1 new instrument file. The range is Electron landing, the Guards red it caused,
the npm resolution defect found underneath it, the doctrine pair, and the
honest-output split.

Most of the audit went to one file, because the report pointed at it and four
properties compound there: `advisoryRegister.proof.mjs` carries 15 deletions
invisible to the range diff (U-2's shape, and the only file in the range with
it), was rewritten twice inside the range, changed a case's posture from failure
to unverifiable — a coverage reduction, not a correction — and holds the controls
for the derivation invariant 25 now rests on. **Read per-commit, not net.**

The two rewrites reconcile: `+52 −5` then `+77 −19` against a net of `+114 −9`.
The invisible deletions are the `shortList` block added in `a0ebd81` and
re-wrapped in `f890716`; its assertion text is byte-identical across the move, so
that half is a re-indent rather than a loosening. The T-1 rewrite **is** a
meaning change and says so in its own comment.

### Executed, not asserted

Everything below was run. Kept separate from the reasoning deliberately, because
the range's own headline correction was a sentence that read as a measurement
while sitting beside three that were.

- **The hard-member mutation on the Electron derivation.** A copy of
  `electron.d.ts` with all three `const utilityProcess: typeof UtilityProcess;`
  declarations deleted by whole-line filter and the `[!NOTE]` prose at line 15693
  left intact. The instrument **throws**, by the anchor control, naming
  `utilityProcess`. A text-based fallback stays green on that file, which is the
  whole reason the derivation is a parse. Declarations 437 → 436, consistent with
  three same-named declarations collapsing to one `Set` entry. Byte delta 144
  reconciles only under CRLF (145 removed, one LF appended by the filter), and
  the source file has no trailing newline; checked rather than waved past.
- **Both worlds on `proof:advisories`**, by hiding `node_modules/electron`: **29
  passed** with it, **28 passed + 1 printed skip** without. Restored and
  re-verified.
- **The split's control, both directions.** Same mutation (`if (false)` on the
  depth-cap case): pre-split prints `17 honest-output cases passed.` and exits 0;
  post-split exits 1 with `1 case(s) STOPPED RUNNING`.
- **The `npm_execpath` harness fix, reverted.** See BB-4. 22/22 still green.
- **The board waiter, both directions.** Known-present sha → two rows; absent sha
  → `BLIND`, not "not yet".

### BB-1 — the advisory proof reimplements the roster, and its total was already invariant

`advisoryRegister.proof.mjs` collects `passed`, `failures` and — added in
`f890716` — a `skipped` array, then prints `${passed.length} advisory-register
cases passed.` All of that is `passRoster.mjs`'s job, including the `--` channel,
which this range hand-wrote a second copy of one file over from the module that
owns it. **B3a: the finding is the second opinion, not the wrong one.**

It has no declared count, so a case that stops running takes its line and the
total with it — Z-4 exactly, in the proof that guards invariant 25.

And the measurement that makes it easy: **the total is invariant across both
worlds.** 29 + 0 and 28 + 1 both record 29, and `format` checks
`passed + skipped`. A single `{ cases: 29 }` is correct in both. The reason to
record it as a finding rather than fold it in silently is Rule 0's *fix the class,
not the instance*: `a3f4225` converted two siblings for precisely this reason and
left this one, which is the classic half-fix, one range after the doctrine
commit that named the shape.

### BB-2 — the derivation's own module still documents the limit this range removed

`scripts/security/engineAdvisories.mjs`, in the section headed **"## What this
still does not do"** — the paragraph a reader consults to decide what is *not*
covered:

> It checks spelling, not **completeness**. `utilityProcess` and
> `MessageChannelMain` are two hand-picked names … **Only derivation fixes that,
> and derivation needs the same dependency the condition above watches for.**

All three halves moved this range. The completeness check exists (it prints
`does not name: …` and has a case); the register names **three** symbols, derived
rather than hand-picked; and the dependency arrived on 2026-08-20.

**Item 7's compound-claim signature, sixth occurrence, and the sharpest instance
yet** — because the surviving clause is not merely true, it is *scope*-true. The
completeness check is a sibling of `unwitnessedSymbols` rather than part of it,
so "it checks spelling, not completeness" is literally correct **of this
function**, and that is the clause a reader verifies. It then vouches for the two
beside it that are simply false. A reader deciding whether to build completeness
checking reads this and concludes nothing has.

Fail-open in the way that matters here: the wrong belief it produces is *add a
second mechanism*, which is a B3 violation with a documentation comment
authorising it.

### BB-3 — CLAUDE.md describes the instrument column as it was before two of its fixes

Line 405: the report prints *"commits, files, proofs added, **proofs modified**,
proofs removed, and new scripts."*

**"new scripts"** is stale twice. X-1 widened that column's root beyond
`scripts/` after a filesystem probe landed under `packages/kernel/src`, and AA-1
established it sees **added files only** — a disclosure the report itself now
prints and the digest does not carry. So an auditor following CLAUDE.md expects
exactly the pre-X-1 behaviour, in the operational digest whose job is to tell
them where to look.

The column has needed fixing on four axes — pattern (W-1), root (X-1), state
(Z-1), granularity (AA-1, open) — and the digest describing it has tracked none
of them.

### BB-4 — the harness fix that closed item 2's newest axis has no control

`9e185ec` deleted `npm_execpath` from the environment `preCommit.proof.mjs` hands
its child, because `npm run` exports it, a child inherits it, and every hook case
was therefore short-circuiting `npmCliPath`'s first branch while a real `git
commit` takes the second.

**Measured: with the deletion removed, `preCommit.proof.mjs` prints `22 hook
cases passed.` and exits 0.** Nothing fails. The three `globalPrefixOverride`
cases test that function directly and in isolation; no case ties *the hook, run
as git runs it,* to the branch a committer takes.

So the fix is correct and unguarded — audit item 4 applied to a **harness**
change rather than a check. The general form is worth more than the instance:
when the defect is *what the test inherited*, the repair is invisible to every
assertion in the file, because assertions look at outputs and this changed an
input. A control has to assert on the environment itself, or spawn the hook with
a deliberately poisoned `npm_execpath` and require the hook to ignore it.

### BB-5 — T-1's no-derivation branch asserts two presences, not one fact

In the world where the derivation cannot run, the T-1 case asserts
`/utilityProcesss/.test(output) && /UNVERIFIABLE/.test(output)` — two independent
searches of the whole output. The intent, stated one comment above, is that *the
misspelt symbol must appear in the unverifiable list, by name*.

`UNVERIFIABLE` appears in that world for the correctly spelt symbols regardless
of the mutation, so the second test is satisfied by the background. The case
therefore passes if the misspelt name is echoed **anywhere** — a verdict summary,
a count line — without ever being classified. The unverifiable symbols are
printed on their own indented lines under the header, so an assertion that binds
the two is available and cheap.

Not a regression: before `f890716` there was no branch, the case simply failed in
that world. It is a new assertion weaker than its own stated intent, which is the
harder thing to see and is exactly where a rewritten file hides one.

### The waiter: fixed, and fixed nowhere that keeps it

Recorded as a decision rather than left implied, because *"we fixed it"* and
*"we fixed it somewhere nothing keeps"* read identically in an entry like this
one.

The instrument that decides whether `main` is green failed **twice in one day**,
differently each time — matching short shas against a field that carries full
ones, then a three-line `grep` window against a field five lines down — and both
times printed the answer that was hoped for, which for a waiter is *"not yet"*
exactly as *"found nothing"* is for a search. It was rebuilt correctly, with the
positive control inside the loop and a resolution test in both directions, and
**none of that is in the repository.** It lives in a shell history that ends with
this session; the next one writes a third version and can be blind a third way.

**Decision: it earns a tracked file, in the range after this one.** Three
reasons, and the third decides it: it decides whether `main` is green; item 4b
says the control belongs *in the instrument*, and an untracked instrument has no
"in" to put one in; and nothing in this repository reads the Actions API, so the
moment a second thing does, two hand-written parsers of one payload is **B3a
before there is even a second caller** — a parser this session has now hand-rolled
three times.

**Condition: its proof must not touch the network**, or it is the third instance
of the open four-live-fetches item, landing in CI. So the instrument splits — a
pure decider (`payload, sha → rows, completed, verdict`) with the control inside
it, and a thin fetch shell — and the proof runs the decider over recorded
fixtures: known-present sha yields two rows, absent sha yields `BLIND`, and a
payload with `status` removed yields `BLIND` rather than "not yet".

### Item 2a, and one process note

The coverage reduction this range made — a misspelt symbol moving from *fails
everywhere* to *unverifiable where nothing can look* — was stated in `f890716`
and written into `CLAUDE.md` as item 2a in `71e7bd9`. That is the rule working in
the range that produced it.

The process note is smaller and is the same shape as a guard this project already
mechanised. `proof:provision` was run against a diff containing **zero
non-comment lines**, spending four live github.com fetches on a change no
consumer could observe. `touchesDependencies` was narrowed from *which file was
staged* to *what changed inside the manifest*; "which proofs does this diff's
blast radius reach" is the identical question, and the difference is that one is
mechanised and the other is a judgement made fresh each time — which is why the
unmechanised one is the one that slipped.

### Status

**BB-1 through BB-5 open.** BB-2 and BB-3 are documentation and fail-quiet;
BB-1 and BB-4 are missing mechanism; BB-5 is a weak assertion in a file that
should be read again when it is next touched. AA-1's granularity half and AA-3
remain open from the previous range; AA-2 closed in `6827c1d`, which also
recorded Z-4's stated limit — the declared count checks a roster against itself
and cannot see the wrong roster being formatted.

---

## 2026-08-20 — Stage audit: `8519e64..418bcea`

**Audited through 418bcea.** 8 commits, 17 files, **0 proofs added, 4 modified**,
0 new instrument *files* — and that last figure is the first finding, because the
range added three instruments.

The range is the four Z findings closed, plus the Windows EPERM that took Guards
down at `93cd471` and its diagnosability follow-up. **It contains this session's
first defect that CI caught rather than an audit**, which is worth recording: the
board found the one failure that was intermittent and platform-specific, and the
audit found the ones that were deterministic and quiet. Those are different nets
and this range shows both working.

Audited a unit earlier than planned. The next unit is Electron, whose honest file
count is seven against a remaining budget of seven — it fits only by folding a new
derivation into `engineAdvisories.mjs` instead of giving it its own module the way
`ocrDoors.mjs` has. That is the file ceiling dictating the architecture, so the
audit went first and Electron gets a full budget.

### AA-1 — the instrument column reports files, and this range's instruments were not files

`npm run audit:scope` printed, for this range:

```
new scripts — instruments to resolution-test (items 4a, 4b): none
```

The range added `transienceNote`, `probeOutsideStaging`, and the shared
`parseNameStatus` / `changedPaths` reader. All three are instruments in the
plainest sense — one decides whether a retry is legal, one decides whether a
binary may be published, one decides what every audit looks at — and all three
landed inside **modified** files. `newScripts` filters `state === 'A'`, so it saw
none of them.

Fourteen function declarations were added or changed inside modified files in this
range. The column that exists to say *resolution-test this* named zero of them.

**This is the fourth axis of one classifier, and the pattern is now the finding
rather than any instance.** W-1 fixed its *pattern* (`*.proof.mjs` only, blind to
`*.test.ts`). X-1 fixed its *root* (`scripts/` only, blind to `packages/*/src/`).
Z-1 fixed its *states* (`A` and `M` only, blind to renames and deletes). This is
its *granularity*: file-level, blind to anything added inside a file that already
existed. Each fix was correct and each left the next axis standing, and every
version of the failure prints the same reassuring word.

Fix: for modified source files, report added function declarations from the diff.
It will name ordinary functions too, and the column's own comment already settles
that trade — *"a column that misses the instrument is worse than one that also
names its neighbours."* **Open.**

### AA-2 — the roster's contract paragraph says there is no second thing to keep in step

`scripts/lib/passRoster.mjs`, in the "## The shape" section a reader treats as the
contract:

> Deleting a section takes its label with it, because the label is an argument to
> the call that concludes it — **there is no second list to keep in step.**

`418bcea` added a declared case count that must be kept in step. The sentence
survives on a technicality — a count is not a list — and that is precisely item
7's half-true compound claim: the clause a reader checks is still true, so nothing
about reading it feels wrong, while the thing they take from it (*delete a case
and nothing else needs touching*) is now false. The correction is thirty lines
below, in a section added by the same commit.

Fourth occurrence of this shape, and the second found by applying item 7 to my own
change in the commit that created it. It is **fail-closed** — the build stops and
says exactly what to do — so it costs a reader one confused minute rather than a
wrong belief. Recorded at that severity.

**Closed by** naming what the sentence is about — no second list *of labels* —
and pointing forward from it to the section that added the number, rather than
leaving the reader to reach a correction thirty lines down.

> **And Z-4 gained a stated limit in the same commit, from a live reproduction
> rather than from reasoning.** While `passRoster.proof.mjs` was being split out,
> a fixture roster inside `main()` was also named `roster` and shadowed the
> file's own. Eight cases executed and recorded into one roster; the OTHER was
> formatted. The run printed `1 pass-roster case passed, 1 not applicable` under
> this proof's heading and **exited 0** — the pre-Z-4 failure mode, inside the
> proof for the mechanism built to prevent it, minutes after the paragraph about
> it was written.
>
> The declared count did not catch it and **could not**: both rosters were
> internally consistent, each agreeing with its own declaration. So the count
> protects a roster from disagreeing with ITSELF; it does not protect against the
> wrong roster being formatted.
>
> `no-shadow` is the instance — ESLint's config does not reach `scripts/` — and
> the class is **consistent with the wrong object**, which no count of a single
> object can see. Written into the module header under what it does not catch.
> Not fixed here: a fix is a lint-config change with its own proof, and naming
> the limit is what stops the count being read as more than it is.

> **Correction, 2026-08-20 — "ESLint's config does not reach `scripts/`" is
> false, and the over-generalisation produced a wrong ruling.** Measured:
> `eslint.config.js:348` globs every `.mjs` under `scripts/`, in a block that
> extends `disableTypeChecked` and enables one rule. What is true is the narrower
> claim `passRoster.proof.mjs` had all along — ESLint has **no `no-shadow`**
> reaching `scripts/`.
>
> Nothing about the AA-2 finding changes: the class is still *consistent with the
> wrong object*, the count still cannot see it, and running the proof is still
> what caught it. **The correction is to the reason, not the finding**, which is
> the case where an inaccurate premise survives longest — everything it was
> offered in support of stayed true.
>
> **The cost was paid on 2026-08-20.** Three places said it: this entry,
> `passRoster.mjs`'s header, and — correctly — the proof. Asked whether to bring
> `scripts/` under lint so `no-restricted-imports` could own the
> plain-Node-imports-Electron rule (B3a), the reviewer read the two
> over-generalised ones and ruled it a B4-sized piece of work not to be started
> while `main` was red. It is three lines in a block that already exists.
>
> **"Does not reach" and "reaches with one rule enabled" are not the same claim
> at any scale, and the gap between them is a whole conversation about
> architecture.** The module header is corrected in the same commit; this entry
> keeps its original wording above, because what was believed at the time is part
> of the record.

### AA-3 — the spawn guard's Set is keyed on a case-sensitive path

`spawnedFrom` holds `resolve(dirname(binary))` and `refuseIfSpawnedFrom` looks up
`resolve(directory)`. Windows paths are case-insensitive, so two spellings of one
directory are two entries.

**No live defect**, and the reason is worth stating precisely: both sides derive
from the same `gitleaksBinaryPath` computation, so the strings are identical
today. That is a property of the current callers, not of the guard — which is the
X-2 shape exactly, where a case-folding guard read the whole path instead of the
basename and was measuring the wrong thing while nothing failed.

It is a regression guard rather than a runtime net, so a miss costs the
determinism, not the fix. Fix: normalise case on Windows at both ends. **Open,
lowest priority of the three.**

### Classification of this range's fixes

Every one is root-cause, and the range contains no workaround. Two are worth
their own line:

| commit | note |
|---|---|
| `20f1ffe` spawn/rename | root cause, and the retry was explicitly refused. Rule 0 permits a workaround only when the cause is outside the repository; the handle was ours, and a retry *would have looked like it worked* |
| `98c31b1` Z-2 gate | root cause with a hole, found by review three commits later and closed in `7fbc7e4` — the injected watermark bypassed the only validator |

`98c31b1` is the one to learn from: a correct fix for a scope bug created a
fail-open by routing around a check it did not know it was routing around. Same
shape as AA-1 — each repair correct, each leaving one axis standing.

### Item 4 — every fix in this range was mutation-tested, and one mutation mattered more than its fix

Thirteen mutations across eight commits, each reddening its own case or set:

- Z-1: five, including `-z` removal reddening **ten audit cases and six hook
  cases at once**, which is the shared parser demonstrating that it is shared;
- the spawn fix: reintroducing the exact `93cd471` defect reddens the proof
  **deterministically on the first attempt**, where the original was intermittent
  and Windows-only;
- the watermark validator: two, and **the second is the one that matters** —
  keeping the regex and restoring a swallowing `catch` around it reddens the same
  three cases. That proves the cases test the *path*, not the *predicate*. Most
  proofs here test the predicate only.
- Z-4: run against a live caller, not only the unit proof. Removing one `record`
  from `documentConsistency.mjs` now fails the run; before, it printed seven `ok`
  lines and exited 0.

### Executed, or asserted

**Executed:** the rename probe at `R100` and `R090` · the gate bypass live at
`EXIT=0` with nothing staged · the ref-watermark defect, all three refs, before
the fix · the EPERM regression reintroduced and caught · `proof:canary` — the
step that was red — green locally on Windows · **the `copyFile` mode assumption,
by the ubuntu leg of Guards at `20f1ffe`**, which runs the probe against a real
binary and requires `ok` · `mupdf.proof` (5) and `cffOobProof` (2) with their
declared counts, in CI's native job at `418bcea`.

**Asserted:** that a roster's declared count is stable on a machine where a case
*skips*. The reasoning holds by construction — `record` is called either way and
`passed + skipped` is what is compared — but every runner that has executed
`mupdf.proof` has `System32`, so the skipping variant has never run. Same
unexercised branch as `transienceNote`'s PERSISTED half, which its own header
already declares.

### Would CI have caught these?

AA-1 and AA-2 are invisible to CI by construction — one is a report a human reads,
the other is a paragraph. AA-3 needs a caller that spells a path differently, and
there is none. That is three findings CI cannot see, in a range where CI caught
the one thing an audit would have struggled to find. Neither net replaces the
other, and this range is the clearest evidence of that so far.

---

## 2026-08-20 — Stage audit: `9303bb5..8519e64`

**Audited through 8519e64.** 9 commits, 17 files, **0 proofs added, 5 modified**,
1 new instrument. Almost nothing in this range is product code: it is a roster
module, a pre-commit gate, a quarantine sweep, a trigger narrowing, and the
proofs around them. That is the shape the watermark exists for, and three of the
four findings below are inside fixes written in this range to close findings from
the last one.

**The exemption was exercised before the audit was written, not after.** The gate
this range added refuses every ordinary commit at 10 > 9, so the only commit that
can be made is this one — and `recordsAudit` had been exercised in a fixture and
never live. Running it at the end of a long audit is how you discover that the
single commit which closes the finding is the single commit that cannot be made.
Both directions, live: nothing staged → refused on the budget; the watermark
advance staged → exit 0. Then `check:docs` red on the journal requirement until
this entry named the sha, which is the coupling that makes the exemption safe
rather than an escape hatch.

**`142a2d6` carries no board verdict, and that is worth stating rather than
glossing.** Both of its runs were cancelled by the `cancel-in-progress`
concurrency group when `8519e64` was pushed. A cancelled run is not a weaker
green; it is no verdict at all. So "the range is green" is a fact about the tip
and about nothing else — which is the ordinary consequence of rapid pushes under
a concurrency group, and it means a bisect through this range lands on commits CI
never evaluated.

### Z-1 — the audit report's classifier drops every rename, and a moved proof lands in no column

`buildScope` parses `git diff --name-status <range>` with `line.split('\t')` and
keeps states `A` and `M`. A rename is `R100\told\tnew`. So the state is `R`, the
"path" becomes the two paths joined by a tab, and the entry matches neither
column.

Measured in a scratch repository, both shapes:

```
R100  <a>.proof.mjs -> <b>.proof.mjs        (a plain move)
  proofsAdded: []   proofsModified: []   newScripts: []
R090  <a>.proof.mjs -> <b>.proof.mjs        (moved AND edited)
  proofsAdded: []   proofsModified: []   newScripts: []
```

`R090` is the case that matters: a proof moved *and* rewritten — a control
loosened inside a file that changed address — is reported nowhere, and `files`
carries a path that does not exist. The blind window is exactly similarity ≥ 50%;
below that git emits `D` + `A` and the new file at least reaches `proofsAdded`.
So the instrument is blind precisely when the file is *mostly the same*, which is
the case its "read each diff" instruction is written for.

**This is the same defect as the one fixed in this range, in the other
instrument.** `142a2d6` rewrote `touchesDependencies` to consume three fields for
`R`/`C` and two otherwise, with a control proving a rename earlier in the list
cannot hide a later dependency change. The identical field-alignment bug was
sitting in `auditWatermark.mjs` and was not looked for. Rule 0's "fix the class,
not the instance" — the half-fix here is not a forgotten sibling handler, it is
the sibling I was reading the diff of at the time.

It has never fired: `git log --diff-filter=R` over the whole history is empty.
That is why it survived, and it stops being true at the first move — the split of
`reportError.proof.mjs` into two files is already queued.

Fix: parse the rename states, report the destination path, and give the proof a
case that renames a proof within the range and requires it in `proofsModified`.
**Open.**

### Z-2 — the gate reads the watermark from the index for the exemption and from the working tree for the range

`pendingAuditScope` decides `recordsAudit` by comparing `git show HEAD:` against
`git show :` — the commit and the index. It then calls `auditScope`, which reads
the watermark with `readFileSync` — the **working tree**. Two scopes, one
decision, which is the defect `proof:docscope` already exists to prevent in
`documentConsistency.mjs`.

Measured live, with **nothing staged at all**:

```
index:     "commit": "9303bb5"
worktree:  "commit": "8519e64"
node scripts/hooks/preCommit.mjs  →  EXIT=0
```

The identical invocation minutes earlier, with the working tree unedited, was
refused on the budget. So editing the watermark and forgetting to `git add` it
does not fail loudly — it silently shrinks the measured range to nothing and
waves the commit through, while `recordsAudit` stays `false`. The board then goes
red one push later on the size threshold, which is precisely the failure Y-2
existed to remove.

Every case in `auditScope.proof.mjs` writes the watermark and then stages it with
`git add -A`, so index and working tree never diverge in the fixture. That is
audit item 2 exactly: verified against the easy shape only.

The two scopes are visible inside a single check. Writing this entry and running
`check:docs` before staging it reported the watermark as having no journal
record — because the document checker reads the journal from the **commit**, by
the `proof:docscope` fix, while the `auditScope` call in the same check reads the
watermark from the working tree. One check, two scopes, and only one of them was
ever aligned.

Fix: compute the range from the index watermark (`pending ?? recorded`), so the
gate reasons about the tree the commit will contain, with a case where the two
scopes disagree. **Open.**

### Z-3 — the lockfile guard's contract sentence still states the trigger this range removed

`scripts/hooks/lockfileIntegrity.mjs` line 55, in the file header:

> It runs only when a manifest or the lockfile is staged, because it costs a few
> seconds and nothing else can cause the failure.

`142a2d6` removed that. It now runs when a manifest's *resolution-relevant
content* changed; a `scripts`-only edit stages a manifest and does not arm it.
The correction is 130 lines further down, on `touchesDependencies` itself, where
a reader deciding what may arm this guard does not necessarily go.

This is the third occurrence of item 7's shape and the first with an aggravating
circumstance: **the signal for detecting it was added to `CLAUDE.md` in
`9ff2dec`, the commit immediately before the one that created this instance.**
And it is the half-true compound claim that rule names — "because it costs a few
seconds and nothing else can cause the failure" is still exactly true, so the
live clause vouches for the dead one and nothing about reading the sentence feels
wrong.

Writing the detection rule down did not put it in reach at the moment of
composing the change. That is the same argument the escape-resolving-write hook
makes, arriving in a second place, and it is the argument for a mechanism rather
than a sharper sentence.

Fix: correct the header. **Open**, and cheap.

### Z-4 — the roster makes a deleted case silent instead of false, and nothing counts

Y-1's fix is real: a label is now an argument to the call that concludes its
case, so there is no second list to keep in step, and the mutation confirms it —
forcing `record` to ignore `ran` reddens `a case with nothing to check is NOT
counted as passing`.

What it does not do is notice that *less ran*. Delete a case and its line goes
with it, the derived total drops to match, and the output is entirely honest
about a proof that now checks less than it did. The old defect was a number that
disagreed with the lines; the new residual is that both move together — and
moving together is also what absence produces, which is item 4's direction rule
one level up from where it was applied.

Nothing anywhere pins how many cases a proof must execute. `record` also remains
a separable statement: deleting a case's *body* and leaving its `record` call
still prints the label. That was stated in `93656f6`'s commit message rather than
hidden, and it is the part of Y-1 that is still open.

Fix, when taken: a declared floor per proof, checked by the proof itself, so a
count that drops has to be a diff somebody wrote. **Open.**

### Classification of this range's fixes

| commit | root cause or workaround |
|---|---|
| `93656f6` roster | root cause, partial — the second list is gone; the separable `record` call is Z-4 |
| `ef92b2e` setup crash | root cause — the rename is inside the case with `try`/`finally`, so a throw cannot end the run before the roster speaks |
| `fe512f0` quarantine sweep | root cause — the old removal named one path built from the current pid, a name no later run computes |
| `739fae4` audit gate | root cause with a hole — Z-2 |
| `142a2d6` trigger narrowing | narrowing, not loosening — but taken while blocked by it, which is the circumstance under which a loosening is most likely to be self-serving |

`142a2d6` deserves its own line because item 1 names exactly this shape. The test
recorded in its commit message is the one that settles it: would the narrowing be
correct if the npm here were already 11.17.0? Yes — the trigger would still be
over-broad, merely harmlessly so. The blockage is what made someone look; it is
not what makes the over-breadth a defect. The npm floor was not lowered, the
allowlist is one measured key, and every state that is not provably inert trips.

### Executed, or asserted

**Executed:** the rename probe, both shapes, in a scratch repository · the gate
bypass, live, `EXIT=0` with nothing staged · the exemption, live, both
directions · `check:docs` refusing the advanced watermark until this entry named
it · two proof mutations (`commits + 1` → `+ 0` reddens two `auditScope` cases;
`ran` ignored reddens the roster's skip case) · CI at `8519e64`, both workflows
green, with `proof:shim` and `proof:cff` — the two roster conversions no local
machine here can run — succeeding in the native job · `142a2d6`'s two runs
cancelled rather than green.

**Asserted:** that `mupdf.proof.mjs`'s new *skip* branch behaves — it is
unreachable in practice, because the proof exits early without a built shim and a
Windows runner always has `System32`. The mechanism is proven generically in
`reportError.proof.mjs`; this site is not exercised anywhere.

### Would CI have caught these?

No, and the reason is the same for all three of the mechanical ones. Z-1 needs a
rename inside an audited range and there has never been one. Z-2 needs the
working tree to differ from the index, which on a runner it never does. Z-3 is
prose. A defect CI cannot see is waiting for a contributor, which is why each
fix above carries a case rather than a note.

### CORRECTION 2026-08-20 — review of the entry above, before any of it was fixed

All four findings confirmed against the source. Four things in the entry above
were narrow, misleading, or wrong, and they are corrected here rather than edited
away, because the fix each one licenses is different from the fix the original
text licenses.

**Z-1's fix is not "teach `buildScope` about `R`".** There are exactly two
`--name-status` parsers in this repository and one of them is already right:
`lockfileIntegrity.mjs` passes `-z` and consumes three fields for `/^[RC]\d*$/`;
`auditWatermark.mjs` passes neither and splits on tab. **Two opinions about the
same porcelain in two files is the finding**, and patching the wrong one in place
leaves the third caller to repeat it. `gitScope.mjs` already owns `git()`,
`filesInCommit()` and `readStagedBlob()`; the shared parser belongs there and
both callers take it. Three things follow that the narrow fix would have missed:

- **`D` is unclassified too**, and unlike rename it can fire today. A deleted
  proof lands in no column and shows up as an ordinary line in `files`. The
  modified-proofs column exists because a check whose meaning changed must be
  visible; a check that *vanished* is the limit case of that.
- **`-z` closes a defect unrelated to rename.** Without it git C-quotes any path
  with a non-ASCII or special character (`core.quotePath` defaults true), so
  `files` would carry `"\303\251…"`. No such path exists today — which is the
  expiry shape, not a reason to skip it. One flag closes rename, copy, delete
  alignment and quoting together.
- **A trap inside the fix:** `churnFor` runs `git log --numstat` with no
  `--follow`, so per-commit churn for a renamed proof stops at the rename and
  everything before the move is missing. The resolution test is the churn
  figures on an `R090` fixture, not merely that the path reaches a column.

And the sequencing above is wrong. `git log --diff-filter=R` is empty, so **the
queued split of `reportError.proof.mjs` is the first rename this repository will
ever have.** Z-1 is not the last item; it is a blocker on that queued unit.

> **Correction, 2026-08-20 — the split is not a rename, and the claim above was
> never executed.** The split landed and git reports `A` + `M`: a new
> `passRoster.proof.mjs`, a modified `reportError.proof.mjs`. Measured across
> `--name-status` with no flags, with `-M`, and with `-C50`, `-C40`, `-C30`,
> `-C20` and `-C10 --find-copies-harder` — every one reports `A`.
>
> **The two halves have different standing, and the first draft of this
> correction ran them together.**
>
> - **`R` is structurally impossible here.** Git pairs an addition with a
>   DELETION to call it a rename, and the old path survives a split because part
>   one still belongs to it. No pairing is available, so similarity never enters
>   into it. Permanent, for every split.
> - **`C` is merely not requested.** `-C` pairs an addition with a source that
>   still exists, and similarity DOES enter — none appears here only because the
>   moved content left the source's post-image. A duplicate-then-trim refactor
>   would produce a live `C`. It is irrelevant today solely because `buildScope`
>   passes no `-C`, and Z-1's parser already handles `C` states, so someone may
>   one day add the flag.
>
> Saying "impossible" of both would claim more than was measured — the flag is a
> decision, not a law.
>
> So Z-1's rename parsing still has only its synthetic fixture cases, and this
> repository still has no live rename. The sentence above was written from the
> shape of the queued work rather than from git's rule, and it read as a
> measurement because it sat beside three that were. **That is the "asserted,
> not executed" column, inside the entry that names the column.**

**Z-2's exemption is not what fires.** With an unstaged advance `recorded ===
pending`, so `recordsAudit` is `false` — the gate passes because the range
*collapsed*, not because the exemption granted anything. Hardening the exemption
would not touch it. Said explicitly because "an unstaged watermark buys the
exemption" is the reading a later fixer would act on. The rule to name in the
comment is the general one: **a gate's inputs all come from the scope its
decision is about.** `pendingAuditScope` models "the index applied to HEAD", and
the `readFileSync` is the one input that is not. The fix is half-written already
— `pending` is the index sha; pass it down.

The proof case for it **must stage nothing.** Every existing case calls
`git add -A`, which moves index and working tree together, and moving together is
what the absence of this bug also produces. That is why the fixture could never
diverge, and it is item 4's direction rule again.

Blast radius, which is smaller than the entry above implies:
`documentConsistency.mjs` computes the range too, and in CI the working tree
equals HEAD, so an over-budget range still reddens the board. Z-2 degrades the
gate to exactly pre-Y-2 behaviour — red one push later — rather than losing the
range. That is what makes taking Z-3 first defensible rather than a delay.

**Z-3 is 127 lines, not 130** (line 55, correction at 182); immaterial, recorded
for the same reason as everything else here. The material point is how to rewrite
it: "runs only when a manifest or the lockfile is staged" is **still true as a
necessary condition**, which is precisely why no reader flagged it. It is false
as the *sufficiency* a reader takes from it. So it is corrected as insufficient,
not as wrong — a rewrite treating it as simply false overshoots in the other
direction and installs a new false sentence in the same position.

**Z-4 does not reopen Y-1.** Y-1 was "a line outlives its case", and that is
genuinely closed: the label is an argument to the call that concludes the
section. Z-4 is the next gap out, and saying so matters — a later reader who
concludes Y-1's fix failed reverts toward the thing it replaced.

And **the obvious fix for Z-4 is the regression.** A hand-written list of
expected labels per proof is exactly the second list Y-1 deleted; any roster
someone maintains by hand is the original defect wearing a control's clothes. The
property to pin is "the case count did not silently drop", and the only honest
source for what it was before is **the tracked previous value — the diff**, not
an expectation somebody keeps in step.

---

## 2026-08-20 — Stage audit: `81b9b2b..9303bb5`

**Audited through 9303bb5.** 9 commits, 32 files, **1 proof added, 11 modified**,
1 new instrument. The range is almost entirely instruments — a floor job, a
reporter, a comparison, and the proofs around them — which is the shape this
project's record says produces most defects, and it produced two.

The gate bit on the **file axis only**. `commits: 9 (one batch is 9)` is exactly
one batch and the comparison is `>`, so it does not trip; `check:docs` names
files alone. Recorded because "over on both" would misdescribe where the
threshold actually bit, and because the commit-count threshold has now been shown
to be the looser of the two.

### Y-1 — four proofs print a roster of `ok` lines that no longer has to be true

`scripts/provision/gitleaks.proof.mjs`, `scripts/provision/mupdf.proof.mjs`,
`scripts/security/cffOobProof.mjs` and `scripts/hooks/documentConsistency.mjs`
accumulate failures, and then — if the failure list is empty — print a **fixed
block of `ok` lines and a hand-written total**. Neither the lines nor the number
is derived from the checks that ran.

So a deleted case leaves its `ok` line printing. Measured, not reasoned:
replacing the missing-file comparison in `gitleaks.proof.mjs` with `if (false)`
so the check cannot execute at all still printed

```
  ok  an unreadable destination is neither same nor different

10 provisioning cases passed.
```

and exited 0. That is the display-only sin wearing a green check, inside the
proofs.

**It is a half-fix, and the range contains both halves.** `preCommit.proof.mjs`
was converted to a counted total in `01b32ca` — inside this range — with a
comment recording that it had "carried a stale one twice". Four siblings with the
same shape were left, and the worse half was not addressed anywhere: converting
the *total* to a count still leaves a roster of labels that no case has to
justify.

The instrument pointed straight at it and nobody read the finger. The two
deletions the scope report flags as **invisible in the net diff** — in this
range's largest modified proof — are exactly this counter being rewritten by
hand, `6` → `7` → `10`.

Fix: emit each label at the moment its case passes, from the same `check()` that
records failures, and count. Nineteen proofs in `scripts/` already do this; the
four are the remainder, not the pattern.

### Y-2 — the pre-commit gate cannot see the commit that crosses the threshold

`check:docs` measures `watermark..HEAD`. At pre-commit, **HEAD is the parent** —
the commit being made is not in it — so the commit that takes a range over one
batch is invisible to the gate by construction, and the board goes red one push
later. That is exactly what happened here: `check:docs` reported 8/8 immediately
before `8130551`, and CI reported the gate red at `8130551`.

"Run `audit:scope` before pushing" is **not** the fix. By this project's own
doctrine a rule you must recall at the moment of composing a command is not a
defence — that is the whole argument for the escape-resolving-write hook, and it
has been demonstrated seven times.

Specification: measure `watermark..HEAD` **plus the staged change** — commits +
1, files unioned with the staged list — and refuse the commit that crosses, the
same move `contractDrift.mjs` makes. It converts a red board nobody reads into a
blocked commit. Two things it needs, and neither is optional:

- **A control in both directions.** A staged change that takes the range from
  under to over must be refused, and one that leaves it under must pass.
  Without the first the gate is vacuous; without the second it is always-red,
  and an always-red gate is one somebody turns off.
- **A check that it cannot block the audit-recording commit.** That commit
  advances the watermark, and is by construction made while the range is at its
  largest — so a naive gate makes the one commit that closes the finding the one
  commit that can never be made.

### Y-3 — the reporter closed sixteen sites by hand and nothing stops the seventeenth

`8130551` replaced `error instanceof Error ? error.stack : String(error)` in all
sixteen top-level handlers under `scripts/`, and `packages/shared`'s
`toStructuredError` already covered the renderer-facing path. The class is closed
**as of today**, by enumeration.

Nothing prevents the next script from being written with `.stack`. This is a
claim with an unstated expiry, and the mechanism that would fix it is a check
that no top-level handler prints a bare `stack` — search-shaped, so it needs a
positive control that finds a known-present conforming site on every run, or its
silence is worthless (item 4b).

Recorded rather than built: the sixteen are correct now, and a search-shaped
guard written in the same hour as the fix it guards is precisely the fix-induced
shape this range already produced two of.

> **Note, 2026-08-22 — the precedent exists now, and it does not fully
> transfer.** EEE-3 built exactly the shape this entry asked for, for a different
> subject: `scripts/lib/annotateCoverage.mjs` derives the set of proofs from
> `package.json`, requires every workflow line running one to name the wrapper,
> carries a positive control that must find a correctly wrapped invocation on
> every run, and **refuses to report at all** when it cannot. `CCC-1` was the
> same disease as this entry — a remedy rolled out by enumeration, where nothing
> makes the list complete.
>
> **Y-3 is NOT closed, and the reason is worth recording rather than leaving as
> a to-do.** What made EEE-3 a derivation is that its subject has an authority to
> derive from: a proof *is* a `proof:*` script, and `package.json` owns that
> definition, so a proof added tomorrow is covered the moment it is registered.
> Y-3's subject is *a top-level handler*, and nothing in this repository defines
> what one is. A scan for a bare `.stack` finds twelve files, of which
> `scripts/lib/reportError.mjs` and `packages/shared/src/result.ts` **own** the
> rule and two research instruments print it inside emitted host bodies where no
> reporter exists.
>
> So the obvious implementation is a pattern plus an exception list — which is
> the enumeration problem again, wearing a derivation's clothes, and worse than
> the current state because it would read as closed. **The open question for Y-3
> is not "write the scan", it is "what owns the definition of a top-level
> handler".** Answer that and the scan is fifteen minutes.

> **CLOSED, 2026-08-22 (finding FFF-1). The expiry fired first, and the
> blocking question above was the wrong question.**
>
> **The prediction, measured.** `scripts/proofs/perfBudget.proof.mjs:203`
> acquired a seventeenth instance in `5ce1bc3` (2026-08-21) — one day after
> `8130551` (2026-08-20) closed the class by enumerating sixteen.
> `git merge-base --is-ancestor 8130551 5ce1bc3` succeeds. The paragraph above
> says "nothing prevents the next script from being written with `.stack`", and
> the next script was written with it inside twenty-four hours, by the same
> author, in a range this project audited. **A claim recorded with an expiry and
> no mechanism is a claim that expires on schedule.**
>
> **The question was wrong, and every answer to it shared a false premise.**
> *What counts as a top-level handler* asks the rule to define its compliant
> **population**, which is the enumeration disease with a predicate on the front.
> A rule does not have to define its subjects; it has to name its **owner**
> (B3) — one component writes a property, many read it. So the rule is *only an
> owner of stack rendering may name the property*, and the owners are declared:
> `scripts/lib/reportError.mjs` and `packages/shared/src/result.ts`. Two entries,
> and that list does not grow with the codebase. A list of subjects does.
>
> This is the transferable half. **When a derivation looks blocked on defining
> its subjects, ask who owns the thing instead** — a list of writers is B3, a
> list of subjects is the disease.
>
> **The scan asks the compiler, so three of the four hard cases need no rule.**
> `scripts/lib/stackOwnership.mjs` builds a program per project and walks for
> property accesses named `stack`, then asks the checker what the receiver is.
> A textual scan cannot separate these, and all four occur here:
>
> | the text | what it is | how the walk decides |
> |---|---|---|
> | a caught Error's stack, read | the defect | receiver is Error-family |
> | a `StructuredError`'s, read | a declared field — B3 says readers are fine | receiver is `StructuredError` |
> | `shim.stackCookie` | a different property | never seen |
> | the same read inside a `String.raw` body | text, not code | never seen |
>
> The last two are B5 rather than filtering: a comment, a template's contents and
> a differently-named property are not property accesses, so nothing has to
> except them. The one thing the walk is told is that a **write** is not a
> rendering — planting a stack on a fixture reads no chain to discard.
>
> **Three controls, every run.** Each owner must yield at least one Error-typed
> read, or the scan reports BLIND and refuses (item 4b). Every tracked source
> file must be a root of some project — 197 of 197 at the time of writing —
> because fixing a classifier's pattern and leaving its root is half a fix (X-1).
> And a receiver typed `any` is reported as UNRESOLVED rather than clean: *could
> not look* and *looked and found nothing* must not share an output. There is no
> such receiver in this repository, which is exactly why the proof supplies one.
>
> **Widening the root found a second live instance, and it was worse than the
> seventeenth.** `apps/desktop/src/rendererHarnessMain.ts:47` rendered
> `${name}: ${message}` on the marker line and the stack on the lines after it —
> and `rendererPolicy.proof.mjs` keeps only lines that START with the marker, so
> the stack was written and then dropped by the one thing that reads it. A
> diagnostic emitted onto a channel nobody subscribes to, in the file whose own
> header explains that a hang reading as a timeout is impossible to attribute. It
> now emits one line: `toStructuredError` serialised, cause chain included.
>
> That instance is the argument for the root control. The finding as reported
> named `scripts/`; scoping the scan there would have left a second live
> instance, in a different language, unreported and reading as covered.

### FFF-1a — three opinions about "am I the entry point", and one of them is mine

Found while writing the above. The test appears in three forms under `scripts/`:
`resolve(process.argv[1]) === fileURLToPath(import.meta.url)` in six modules,
`import.meta.url === pathToFileURL(process.argv[1]).href` in
`emittedTemplates.mjs`, and `import.meta.url.endsWith(...)` in
`annotateCoverage.mjs` — which I wrote yesterday, without looking at either
existing form.

`scripts/provision/electron.mjs:613` already carries a comment explaining that a
hand-built `file://` prefix is wrong on Windows, and `emittedTemplates.mjs`
records that the same bug made that module run **nothing** and exit 0. So this
repository has paid for the question twice and still holds three answers to it.

**The finding is the third opinion, not the loose one.** `endsWith` is not wrong
today; it asks a looser question than the one intended, and the next module
copies whichever form it happens to see. Not fixed here — `stackOwnership.mjs`
uses the majority form and says why in a comment, and consolidating all three
into one exported predicate is a unit of its own. Recorded so it is a decision
rather than drift.

### Y-4 — one thing 9303bb5 called unproven is in fact enforced

That commit removed `version` from `publish`'s parameters so the function cannot
ask whether the destination runs, and its message said the branch's correctness
rests on cases and the removed parameter "not on an integration test".

Executed during this audit: re-adding `if (!force && reportsPinnedVersion(binary,
version)) return;` to `publish` fails `npm run typecheck` with **TS2304, `Cannot
find name 'version'`**, on the line itself. CI runs `typecheck` on both
platforms, so the regression is caught mechanically rather than by review. The
commit message understated its own guarantee; this entry is the correction.

### What was executed, and what is only asserted

Executed: the deletion demonstration for Y-1; the TS2304 regression for Y-4; two
mutations on `compareContents` (size-only comparison reddens the one-byte case,
folding `unreadable` into `different` reddens the missing-file case); the
`.stack` mutation on `gitleaks.mjs`, which reproduced the CI text frame for
frame; the full diff of all six `+2 −1` proofs, confirming they carry the
reporter swap and nothing else.

Asserted, and named as such: that the intermittent windows-latest provisioning
failure at `f0a2090` was a held handle. It **did not reproduce** at `8130551` —
the step passed on both platforms — so no errno was captured and no explanation
is established. One non-reproduction is not evidence for either reading. Chasing
it with repeat runs was considered and rejected: the proof makes four release
downloads per run, which is the live-fetch exposure already on the register, and
multiplying a known cost to chase a maybe is the wrong trade.

### Carried forward

- The new guards step invokes `node scripts/lib/reportError.proof.mjs` directly
  rather than through an npm script, because registering it means staging
  `package.json` and the lockfile guard correctly refuses that below npm 11.6.3.
  Owed a conversion at the first commit that stages `package.json`.
- The quarantine sweep — nothing ever removes another process's
  `.superseded-<pid>` directory, so the code's stated justification for
  tolerating one is false — is specified and unbuilt. Deliberately audited
  before it lands, so the fix is not folded into the audit of the instrument
  that produced it.
- `proof:provision` fetches from github.com four times per run and nothing
  caches it. Second instance of a check depending on a live third-party fetch,
  after `check:advisories` and the OSV query.

> ## Correction — 2026-08-20
>
> **Item 7 was reported clean for `scripts/provision/gitleaks.mjs` and was not.**
> `publish`'s doc comment states the rule `9303bb5` removed, and states it
> *first*: "a destination that runs and reports the pinned version is kept",
> eighteen lines above the new section explaining that the function no longer
> spawns the destination at all and cannot, because the parameter is gone. That
> commit is inside the audited range, and it is the range's headline change.
>
> Two occurrences now, both in this file and both inside their own audit range —
> this one, and the quarantine comment that excused a leftover with a cleanup
> that never existed. The mechanism is the same and it is not carelessness: a
> fix that removes a behaviour gets a new section explaining the change, and the
> original paragraph stays. The stale half then occupies the position a reader
> treats as the contract, and the correction sits in a section a skimmer never
> reaches — while the reader of that contract is exactly the person deciding
> whether the removed behaviour may return.
>
> A half-true sentence survives hardest. `--force` still meant what that
> sentence said it meant, so the false clause beside it read as current.
>
> Corrected in the comment, and item 7 in `CLAUDE.md` now carries the specific
> question rather than the general one: **when a commit removes a behaviour,
> does the changed function's own comment still assert it earlier in its own
> text?** That is answerable from the diff already open.

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
