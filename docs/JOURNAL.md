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

- **The stage audit found a data-loss risk on its first run.** Written into
  `CLAUDE.md` and applied immediately to `CapabilityRegistry`. The question that
  caught it was item 2 — *was this verified against the easy shape only?* The
  easy shape is a well-formed path string; the hard shape is the same file named
  three different ways.

  `C:.pdf`, `C:/a/b.pdf` and `c:\A\B.PDF` are one file on Windows and mint
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
