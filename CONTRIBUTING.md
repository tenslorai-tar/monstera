# Contributing to Monstera PDF Editor

**Bug reports are the contribution we value most** — you do not need to write
code to help. See [Reporting bugs](#reporting-bugs). Code is welcome too, under
the terms in [Contribution terms](#contribution-terms).

The rest of this document is short on ceremony and specific about the two or
three things this project is genuinely strict about, so you do not discover them
in review.

## The one rule that governs the rest

> **When you hit a problem, a bug, or an issue, do not quickly find a
> workaround. Investigate the root cause of the problem and fix it from the
> root. Your first intuition must not be a workaround; it must be
> investigation.**

This codebase is public and permanent. Every workaround in it is a signed
statement that nobody understood the problem, readable by everyone, forever.

In practice, a change is ready when **you can state the mechanism in one
sentence.**

> "chokidar holds a directory handle open for `ReadDirectoryChangesW`, and an
> open handle blocks RENAME, so electron-builder's rename fails with EPERM."

(An example of the form, from an Electron build that used electron-builder;
this one does not.) That is a mechanism. "The build was flaky so I added a retry" is not.

These reflexes will be sent back in review, however green the result is:

- retrying with different flags until something passes
- `catch {}` that swallows the problem
- special-casing the input that failed
- raising a timeout to make a race go away
- disabling or narrowing the check that went red
- widening a type — or reaching for `any` — to make an error disappear

A workaround **is** acceptable when the root cause is proven to lie outside this
repository. In that case the commit message names the cause and says why the
workaround is the correct response. That is a fix with a citation, not a patch.

**Fix the class, not the instance.** Closing one vulnerable handler and leaving
its six siblings is the classic half-fix.

**Be equally suspicious of things that work.** A green check that does not
verify what it claims is worse than a red one.

## Every fix ships a proof with a control case

Not "a test". A **proof with a control**: the control reproduces the original
bug without the fix, so **the proof fails if your fix is removed.**

A proof that passes both with and without the change proves nothing, and it is
the most common reason a pull request is sent back here. Before opening one,
try deleting your fix and confirm the proof goes red.

Proofs exercise real project code, run in CI, and use the fixture corpus. If
your fix needs a new fixture, see the fixture rules below.

## Before you write a feature

Features land by **registration**, not by wiring. There is a registry for
commands, dialogs, settings, annotation types, tools, providers and formats, and
the ribbon, menu bar, context menus, command palette, shortcut map, start
screen, status bar and title bar are all *projections* of the command registry. There is no second place where a feature gets wired in.

**If your feature cannot be built by registering into an existing seam, stop.**
Do not bend the seam. Open an issue describing the gap, and the architecture is
amended first — in its own commit, with an ADR recording the rejected
alternatives — before the feature is built. This is rule B4 and it is the rule
that keeps the architecture ahead of the features instead of underneath them.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before a first substantial
change, and [`CLAUDE.md`](CLAUDE.md) for the condensed version.

## The wired-tools rule

**A control that renders but does nothing is a defect, not a placeholder.**

Never register a command without a working `run`, and never mount a button for
an unimplemented command. Done for a tool means end to end: click it, use it on
a real document, see the correct effect, and have it survive save and reopen.

It is proven by a **pair** of tests and neither half counts alone — a kernel
proof that the command produces the document effect, plus a UI test that the
control dispatches exactly that command. The UI test runs against a stubbed
kernel, so on its own it would only prove that a button dispatches into the
void.

## Getting set up

Node.js **22.19 or newer** (the floor is set by `@lingui/*`, which declares
`engines: node >=22.19.0`; below it npm emits `EBADENGINE`).

```bash
git clone https://github.com/tenslorai-tar/monstera.git
cd monstera
npm install
```

`npm install` points `core.hooksPath` at `.githooks/`, which installs the
pre-commit gate and a pre-push gate (it runs `npm run typecheck` when a push
changes a file the compiler reads).

The application runs on **Windows** only: documents are parsed in engine hosts
that are Windows AppContainer processes.

```bash
npm run proof:guards    # prove the guards still catch what they claim
npm run guard:staged    # file policy against what you have staged
npm run scan:secrets    # full-history secret scan
```

## Running it

```bash
npm run provision:electron   # the pinned runtime, verified against a SHA-256
npm run provision:grants     # lets the contained engine host run that runtime
npm run build                # typecheck + preload bundle + renderer bundle
npm start                    # the shell, on that runtime
```

`npm start` refuses a build older than the source it was made from. That guard
is not politeness: the only thing a person observes here is a window, and a
window built from stale sources is indistinguishable from a current one — so
without it, editing a file and running the app shows you the previous version
with nothing anywhere saying so.

If it says the runtime is missing, run `provision:electron`. **Do not install
the `electron` package's own binary** — importing that package *is* the
download, through an installer that reads an environment variable which can
repoint it away from our pinned hash.

## What the pre-commit hook blocks, and why you must not bypass it

This repository has been **public since its first commit**, and GitHub retains
commits by hash even after a history rewrite. There is no later scrub. That is
why the safety net is mechanical.

The hook rejects:

- **secrets**, via gitleaks over your staged diff. Findings are printed
  redacted, so catching a credential does not copy it into your scrollback.
- **files over 5 MB.** Large fixtures are generated by script at test time.
- **binary content** outside a short allowlist (`.png .jpg .jpeg .webp .gif
  .ico .pdf .ttf .otf .woff2`), and **executables detected by magic bytes**
  whatever their extension says. Native binaries are downloaded against pinned
  SHA-256 hashes; none are ever committed.
- **PDFs outside the fixture corpus**, or fixtures with no provenance record.

If the hook blocks you because gitleaks is missing, run
`node scripts/provision/gitleaks.mjs`. **Do not use `--no-verify`.** The hook
refuses to pass a commit it did not scan, on purpose: "scanner absent,
continuing" reports success for a scan that never ran.

If you hit a genuine false positive, add a **narrow** rule to `.gitleaks.toml`
in its own commit explaining why — never a blanket allowlist.

### Fixture rules

Test fixtures are **self-generated or verifiably public domain. Never a
real-world document.** A fixture PDF carrying a stranger's name or metadata
becomes permanently public the moment it is pushed. Fixtures are generated by
script at test time into `packages/testing/fixtures/generated/`, which is not
committed. A fixture that must be committed is declared in
`packages/testing/fixtures/PROVENANCE.md` (created with the first one), and the
hook enforces the declaration.

## Style

- **TypeScript strict everywhere. `any` is an error**, not a warning. The one
  sanctioned exception is a single typed adapter module per native boundary,
  where the koffi edge and the WASM heap are genuinely untypeable; that file
  carries the lint disable and everything outside it is fully typed.
- **React function components only**, except `ErrorBoundary.tsx`, because React
  has no function form for an error boundary (ADR-0036); a lint rule enforces the
  rest. `eslint-plugin-react-hooks`' recommended
  set — 17 rules in the pinned version, covering the React Compiler's
  requirements — is registered against `packages/ui` and every one of them is an
  **error**, including the four the plugin ships as warnings. They were turned on
  while the package was still empty, deliberately: a rule about how components
  are written cannot be applied to components already written.
- **Comment only where the *why* is non-obvious**, and state the **mechanism** —
  not the history of who fixed what. In a public codebase this is what makes
  every non-obvious decision auditable by a stranger.
- **No literal user-facing strings in JSX** — a lint rule enforces it. Every
  dialog uses the one `Dialog` primitive.
- **Design tokens only, in components.** No raw hex and no magic pixel values in
  a component (a lint error), and **no emoji as icons anywhere**. Contrast-bearing colors are computed at the point of use;
  storing a derived color is a defect.
- No premature abstractions inside modules. The architecture provides the
  boundaries; interiors stay concrete and plain.

## After a substantial change, audit it

Maintainers run the full stage audit in
[`CLAUDE.md`](CLAUDE.md#the-stage-audit--scoped-to-a-range-not-to-a-moment)
over each range of commits. Every item on it exists because it caught something
real that no test had failed on. Before a pull request, ask yourself the two
that catch the most:

- **Could your fix regenerate?** If the same action recreates the problem, you
  repaired a symptom. The fix is whatever makes it unable to happen again.
- **Did you verify against the easy shape only?** A flat page tree, one
  platform, a machine that already had the tool installed. Ask what the hard
  shape is and test that too.

## Commits and history

- Commit **after each working, proven unit** — not in large batches.
- Write the message for a stranger, because one will read it. Say what changed
  and **why**; if you fixed something, name the mechanism.
- **`main` is append-only.** No force-push, no amending a pushed commit, no
  rebasing published history. A bad commit is corrected by a new commit that
  says what was wrong. GitHub retains orphaned commits anyway, so a rewrite adds
  dishonesty without adding safety.
- Branches are cheap and disposable. Open pull requests against `main`; CI must
  pass before one is merged.

## Reporting bugs

Bug reports and "this looks wrong" flags are the most useful thing you can send.
[Open an issue](https://github.com/tenslorai-tar/monstera/issues) with:

1. **The steps**, in order, from opening the application.
2. **What you expected**, and **what happened** — the exact message if there was
   one, or a screenshot.
3. **The version and install channel** from **Help › About**, and your Windows
   version.

Include the mechanism if you found it. **Never attach a PDF containing personal
or confidential information** — anything attached to a public issue is public
for good. A minimal file generated by script is worth more than a real one, and
carries no risk to you; if only a private file reproduces it, say so and do not
attach it.

The diagnostics log can help: **Help › Reveal diagnostics log** opens the folder
that holds it. Read it before attaching it, and remove anything you do not want
to be public.

## Security issues

Do not open a public issue. See [`SECURITY.md`](SECURITY.md).

## Contribution terms

> **DRAFT** — the agreement below is for review by Tenslor Inc.'s counsel before
> launch, and outside code contributions are accepted once it is adopted.

Code contributions are **assigned to Tenslor Inc.** under the
[Contributor Assignment Agreement](CONTRIBUTOR-AGREEMENT.md). In short: you
assign the copyright in your contribution, you receive a licence back to use it
yourself however you like, you are credited by name, and Tenslor Inc. may license
it under any terms — always also keeping it available under the licence the
project uses on the day you contribute, **AGPL-3.0-or-later** today. Read the
agreement itself; this summary is not a substitute. A pull request is merged
only once its author has signed. [How to sign: to be confirmed by Tenslor Inc.]

## Name and logos

The code is AGPL; the name **Monstera PDF Editor** and its logos are not. If you
publish a fork or a modified build, give it your own name and your own logos.
See [`TRADEMARKS.md`](TRADEMARKS.md).
