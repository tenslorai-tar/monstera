<div align="center">

<img src="assets/brand/logo-256.png" alt="Monstera PDF Editor" width="132">

# Monstera PDF Editor

**Built For The Way You Work**

A free, open-source, professional-grade PDF editor for Windows.

[![Guards](https://github.com/tenslorai-tar/monstera/actions/workflows/guards.yml/badge.svg)](https://github.com/tenslorai-tar/monstera/actions/workflows/guards.yml)
[![Licence: AGPL-3.0-or-later](https://img.shields.io/badge/licence-AGPL--3.0--or--later-blue.svg)](LICENSE)

</div>

---

## Status: nearly there, not yet released

**There is no release yet.** Almost every feature is built, and the project is in
its last stage: accessibility, visual checks, performance and getting ready for
the Microsoft Store. All of that work is public, as every stage before it was.

This section is the honest picture and it is kept current. Until the release, you
can build and run it yourself (see below) — and please tell us what breaks.

| Stage | Scope | State |
|---|---|---|
| 0–4 | The architecture, the viewer, page management, annotations, forms | **done** |
| 5–9 | Text editing, OCR, security and signatures, import/export and conversion, AI and cloud | **done** |
| 10 | Ship: accessibility, visual QA, performance, the Store | **in progress** |

Feature-by-feature status, including what each stage left for later and why,
lives in [`docs/FEATURES.md`](docs/FEATURES.md).

## What it is

A PDF editor that is genuinely professional-grade — the benchmark is PDF-XChange
Editor parity or better — and genuinely free. View, organise pages, annotate,
fill and create forms, edit text in place, OCR, redact, sign and verify, convert
and export, with an optional AI assistant and OneDrive and Google Drive, in a
calm Windows desktop interface with light, dark and high-contrast themes. Help is
built in and works offline: press F1.

It will be available from the **Microsoft Store** only; monsterapdf.com links to
the Store listing.

### Things it will not do

- **No telemetry.** None. Today the app makes no network call on its own. The
  one it is built to make — the Store build asking whether an update is
  available, one plain request that reads version numbers back — is off until
  its address is live, and the About window says how updates reach you.
- **No silent cloud upload.** Document content reaches an AI provider, an online
  reading service or a cloud drive only when you ask, and the window you ask from
  names who receives it.
- **No automatic crash uploads.** A crash report is written on your computer and
  leaves it only if you choose to share it.
- **No plaintext secret storage.** API keys are kept encrypted with Windows' own
  protection, or the app says it cannot store them and refuses. There is no
  silent fallback.

## Why the codebase looks the way it does

**The codebase is the product as much as the app is.** It is written to be read.

Two documents govern it:

- **[`BUILD-PROMPT.md`](BUILD-PROMPT.md)** — the founding record. Never edited
  after its first commit.
- **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** — the living law. Changed
  only through a recorded amendment, with the rejected alternatives written
  down.

The rule underneath both:

> When you hit a problem, do not quickly find a workaround. Investigate the root
> cause and fix it from the root. Your first intuition must not be a workaround;
> it must be investigation.

Every workaround in a public codebase is a permanent, signed statement that
nobody understood the problem. So the standard here is that you can state the
actual mechanism in one sentence before you change a line — and every fix ships
a proof with a control case, meaning the proof fails if the fix is removed.

If that sounds like the kind of codebase you want to work in, see
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Help us

**Bug reports are the most helpful thing you can send.**
[Open an issue](https://github.com/tenslorai-tar/monstera/issues) and say what
you did, what you expected and what happened. Please never attach a PDF with
personal or confidential content. Code is welcome too:
[`CONTRIBUTING.md`](CONTRIBUTING.md) explains how, including that code
contributions are assigned to Tenslor Inc. and that you are credited for them.

## Building from source

Requires **Windows**, Node.js 22.19 or newer and Git.

```bash
git clone https://github.com/tenslorai-tar/monstera.git
cd monstera
npm install
```

`npm install` also enables this repository's git hooks, which scan for secrets
and reject binaries and oversized files before they can enter the permanent
public history. If a commit is rejected because the scanner is not installed,
run `node scripts/provision/gitleaks.mjs` — **do not bypass the hook.**

To run it, fetch the pinned Electron runtime, let the contained engine host run
it, build, and start:

```bash
npm run provision:electron
npm run provision:grants
npm run build
npm start
```

Some features need a further tool, each fetched and hash-checked by its own
command — `provision:pdfium` (editing text in place), `provision:tessdata`
(OCR), `provision:poppler` (text export with layout), `provision:ghostscript`
(PDF/A) and `provision:mupdf` (Optimize; needs Visual Studio's C++ tools). The
app starts without them; a feature whose tool is absent is either not offered
(OCR) or refused with a message that says so (editing text in place).

`provision:electron` downloads the pinned build and verifies it against a
recorded SHA-256; it is a separate step because importing the `electron`
package is itself a download, through an installer that can be repointed away
from our pin. `npm run build` is a typecheck **plus** both bundles, and `npm
start` refuses to launch a build older than the source it was made from —
otherwise the window shows the previous version of the app and looks identical.

## Licence

**[AGPL-3.0-or-later](LICENSE).**

Monstera PDF Editor is built on **MuPDF**: the `mupdf` package (MuPDF compiled
to WebAssembly) opens and edits documents, and a native library we build **from
MuPDF's source and statically link** runs Optimize. Either is a combined work by
any reading, and MuPDF is AGPL, so Monstera PDF Editor is AGPL. In plain terms: you may use, study, modify and
redistribute this software, and if you distribute it — or run a modified version
as a network service — you must offer the corresponding source under the same
licence.

### The source offer

Because the linkage is static rather than a bundled upstream binary, the offer
covers more than this repository. It is everything you would need to rebuild what
actually ships, at the exact versions shipped:

- **MuPDF 1.28.0** itself — the hash-verified upstream tarball, listed in
  [`scripts/provision/mupdf.mjs`](scripts/provision/mupdf.mjs);
- **the build configuration** used to produce the static libraries, which is what
  makes the result reproducible rather than merely available;
- **the source of the C shim** that links it,
  [`native/mupdf-shim/`](native/mupdf-shim/);
- **the separately AGPL-licensed components inside MuPDF's own tree** —
  `extract` and `jbig2dec`, both AGPL-3.0-or-later. These arrive within MuPDF, so
  "the MuPDF version" arguably covers them already. Naming them costs a line and
  removes the argument;
- **the `mupdf` package 1.28.0**, the WebAssembly build, from its published
  release.

Ghostscript (AGPL) and Poppler (GPL) run as separate programs, never linked; their
written source offers are in [`NOTICE`](NOTICE), with every other third-party
component's terms.

[`NOTICE`](NOTICE) is generated from
[`scripts/release/nativeComponents.json`](scripts/release/nativeComponents.json)
and the lockfile. This list is a summary written by hand; if the two ever differ,
`NOTICE` is right.

**To request it:** [open an issue](https://github.com/tenslorai-tar/monstera/issues)
in this repository. We will send a copy for at least three years after the last
distribution of the corresponding binary.

### Third-party notices

[`NOTICE`](NOTICE) is generated, not hand-maintained: from the lockfile's
production tree, and from the libraries the shim actually compiles. Every bundled
licence names the file its terms were read from, inside MuPDF's source tree, so
each claim can be checked in one command rather than taken on trust. One is worth
calling out because it looks wrong and is not: **MuJS 1.3.8 is ISC here**, read
from `thirdparty/mujs/COPYING`, although Artifex positions MuJS publicly as
AGPL-or-commercial. The grant in the tree we ship is what governs.

Two components carry conditions beyond attribution, and both are discharged in
`NOTICE`: **FreeType** is dual-licensed and we take the FreeType License, whose
binary-distribution clause requires a disclaimer that this software is based in
part on the work of the FreeType Team; and **zint** is BSD only for its backend,
which is the only part compiled here.

The **name and the brand assets** in [`assets/brand/`](assets/brand/) are owned
by Tenslor Inc. and are not covered by the code licence — a fork must use its
own, so users can tell whose build they are running. What you may do with them
without asking is in [`TRADEMARKS.md`](TRADEMARKS.md) (a draft, for legal review
before launch).

## Security

Please report vulnerabilities privately. See
[`SECURITY.md`](SECURITY.md).

---

<div align="center">
<sub>© 2026 Tenslor Inc.</sub>
</div>
