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

**Done and green in CI (Windows + Linux):** pre-commit guards with proofs ·
pinned-hash provisioning · governing documents and ADRs 0001–0006 · monorepo
with import boundaries proven by violation · the IPC contract with compile-time
exhaustiveness · `CapabilityRegistry`.

**Next, in order:**

1. **`DocumentService` + `CommandBus`.** Blocking requirement recorded before
   the code exists: document identity must be established by canonicalising with
   `fs.realpath`, **not** by comparing `FileHandle`s or raw path strings.
   `CapabilityRegistry` mints per path *string* — `C:\a\b.pdf` and
   `c:/A/B.PDF` are one file and three handles — so keying identity off a handle
   opens one file as two documents with two command logs, and the second save
   discards the first's edits. Needs a proof with a control: the same file opened
   by two path forms resolves to **one** `DocId`.
2. **`rotatePages` as the first real command**, with its inverse, exercising the
   command log. Page reorder, when it arrives, uses the algorithm in
   `scripts/spike/reorderInPlace.mjs` — never `rearrangePages`, which orphans
   `/AcroForm`.
3. Per-document stores · command/dialog/settings registries · design substrate
   (tokens per ADR-0003, `docs/UI-GUIDE.md`, four primitives) · i18n scaffold ·
   logging and crash-consent · both utility hosts on the shared worker contract.
4. **Both remaining Stage 0 gates:** the performance budget assertion (200 MB
   generated fixture, **per-process** peak RSS per ADR-0007 — main ≤ 1.5×,
   MuPDF host ≤ 6×, renderer ≤ 2.5× — IPC bytes bounded per L11), and the
   Stage 0 exit path end to end.

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
admission can read both terms before loading a page.

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
limit whose breach means kill-and-restart, the renderer ≤ 2.5×.

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
  heredoc used a non-raw string containing a Windows path; `` and ``
  resolved to BEL and BACKSPACE, so `C:.pdf` was committed as two control
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
