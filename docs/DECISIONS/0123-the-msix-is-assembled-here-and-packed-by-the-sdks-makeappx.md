# ADR-0123 — The MSIX is assembled here and packed by the Windows SDK's MakeAppx

- **Status:** Accepted
- **Date:** 2026-09-29
- **Decided by:** the owner's list of 28 September, item 14 — *"Test MSIX … Tool by research + ADR"* — and the
  owner's order of 2026-09-29 (*"I need an MSIX file ASAP"*).
- **Amends:** `docs/ARCHITECTURE.md` §8 (the packaged layout gains its builder).
- **Supersedes:** [ADR-0004](0004-toolchain-versions.md)'s `electron-builder` 26.15.3 pin, which was never installed.

## Context

Nothing packages this application. The packaging row in `docs/FEATURES.md` records that `electron-builder` is pinned
in ADR-0004 and not installed, and [ADR-0122](0122-native-components-one-resolver-a-pinned-manifest-status-and-verify.md)
names a packaged layout — `resources/native/<component>/` beside a manifest — that no step builds. Distribution is
the Microsoft Store only (ADR-0018), so the one format owed is MSIX.

Read on this machine, 2026-09-29: the Windows SDK 10.0.26100.0 is installed, with `makeappx.exe` and `makepri.exe`
under `Windows Kits\10\bin\10.0.26100.0\x64\`, and the App Certification Kit's `appcert.exe` beside it. The Electron
runtime is already provisioned here, pinned and verified (`scripts/provision/electron.mjs`).

## Decision

1. **The tool is the Windows SDK's `makeappx.exe` and `makepri.exe`, driven by `packageMsix.mjs` under
   `scripts/release/`.** The script assembles the package's folder and hands it to MakeAppx; it downloads nothing. It
   refuses to run where the SDK is absent, naming the folder it looked in.
2. **The layout.** The provisioned Electron runtime, with `electron.exe` renamed `Monstera.exe` and
   `default_app.asar` removed; `resources/app/` holding the desktop package's `dist/` (tests, maps and declarations
   left out) and a `node_modules/` of the workspace packages' `dist/` and npm's production tree for them;
   `resources/native/<component>/` and `manifest.json` per ADR-0122, built from the manifest generator so every file
   copied is one the manifest pins, and hashed against that pin on the way in; `NOTICE`, `LICENSE` and the third-party
   licence texts at the root (the packaging row's obligation (b)); the Store images from `scripts/brand/storeAssets.mjs`,
   indexed by MakePri so Windows picks each scale.
3. **Nothing ships that does not resolve.** Before packing, every literal bare import in the shipped JavaScript is
   looked up from inside the staged folder the way Node walks `node_modules`, and a single miss refuses the package
   by name. A dependency declared only at the repository root resolves in a checkout and vanishes from a package —
   measured: `@cantoo/pdf-lib` is imported by the kernel and was declared only as a root development dependency, so
   the lockfile marked it and twelve dependencies `dev` and npm's production tree left them out (corrected in the
   commit before this one, which also added them to `NOTICE`). The check carries its own positive control: a
   specifier known to be shipped must resolve, or it refuses to report. A specifier built at run time is out of its
   reach, and that is stated in the script.
4. **Two flavours, one switch.** `--flavour test` writes a Publisher carrying
   `OID.2.25.311729368913984317654407730594956997722=1`, the only form Windows installs unsigned; `--flavour store`
   takes the identity Partner Center reserves, from a tracked configuration that is empty until it is reserved, and
   **refuses any Publisher carrying that OID**, because a Store package with it is one Windows treats as unsigned. The
   two flavours have different identity names, so a test install never collides with a Store one.
5. **A version is four parts, the fourth 0, and never reused.** The Store reserves the fourth part. The script refuses
   a version not greater than every one it has already packed, from a tracked record it appends to, so B8's *never
   reuse a number* is a check rather than a memory.
6. **The manifest.** Name *Monstera PDF Editor*; full trust (`runFullTrust`), the webcam, and the `.pdf` file-type
   association — the one part of the file-associations row that was owed to packaging.
7. **A packaged build reports its install channel as `store`.** `entry.ts` decides it from `app.isPackaged`, which is
   fixed for a package, so E4's *baked, never detected between launches* still holds. The web flavour ADR-0018 keeps
   has no build; when it gets one it bakes its own.

## Not decided here

- **Whether the contained engine host starts under the install root.** ADR-0023 Decision 16 expects it not to
  (premise P1 is false) and names three routes, none measured. Building a package cannot observe it; installing one
  can, and that is the first thing the owner's install test measures.
- **Installing needs an administrator.** Microsoft's *Create an unsigned MSIX package* (Microsoft Learn, read
  2026-09-29): no Developer Mode is needed, but a package with executable content is installed for all users, and so
  *"In most scenarios, you'll need to run PowerShell as administrator."*
- **The 150 MB target.** The runtime alone is 358 MB unpacked (`electron.exe` 225 MB) and ONLYOFFICE's converter
  174 MB, read from the provisioned trees on 2026-09-29. What the package weighs compressed is measured when it is
  built and reported against the target; what to remove, if anything, is the owner's.

## Rejected

- **`electron-builder` (ADR-0004's pin).** Its MSIX target brings its own Windows Kits bundle through its
  `toolsets.winCodeSign` setting and caches it under `AppData\Local\electron-builder\Cache` (electron.build's MSIX
  page, read 2026-09-29; not run here) — a second, downloaded copy of tools this machine already has from the SDK's
  own installer, beneath a transitive tree ADR-0004 records as never licence-scanned. What it would add over the SDK
  is the collection of `node_modules`, which npm itself answers.
- **The MSIX Packaging Tool.** It captures an installer, and there is no installer; it is also a GUI and cannot run
  in CI.
- **An `asar` archive.** It changes how every path under `resources/app` resolves — the engine host finds its entry
  through `createRequire` — and a Store package's folder is already read-only.

## Correction, 2026-09-30 — the install test answered the first open question the other way

*"ADR-0023 Decision 16 expects it not to"* start: the owner's install of 0.1.1.0 measured the host **starting** under
the install root and being refused by its own startup check, because a packaged `main` makes it a child container of
the package, which holds the package's capability and so its whole data folder. ADR-0023's correction of this date has
the measurement. The packaging itself is unaffected; the containment route is ADR-0023 Decision 16's.

## Correction, 2026-10-02 — the runtime is not staged unchanged: the executable takes the brand's icon

Decision 2 stages the runtime with one rename and one removal. Since 0.1.8.0 it also edits one thing in it:
`Monstera.exe` carried Electron's icon, which Windows shows for the file, so `brandExecutable` sets
`assets/brand/logo.ico` with `rcedit` 5.0.2 (the Electron organisation's tool, MIT, pinned in the lockfile, a
development dependency because nothing of it ships — the file's resources change and no code is added). Decision 1's
*downloads nothing* still holds: rcedit arrives through npm's lockfile with every other development tool, its
download approved by the owner on 2026-10-02, and the script fetches nothing.

The step is read back, not trusted: `scripts/lib/peIcons.mjs` reads the first icon group from the file's resources —
the one rcedit replaces and Windows shows — and the package is refused unless its images are the `.ico`'s, byte for
byte. `proof:packagemsix` applies the packager's own step to a copy of the provisioned `electron.exe` and reads it
back, against the same copy without the step, which shows Electron's four images and not the brand's seven; the
Windows leg of CI requires those cases.

## Correction, 2026-10-02 — 0.1.7.0 did not start, and a package now has to

Decision 3's *nothing ships that does not resolve* read a package's presence, and decision E's closure read imports
and literal file names. Neither saw `createRequire(import.meta.url).resolve('@monstera/nodemode')` in
`readerHostSurface.ts`: the package's entry is types only, the desktop imports it with `import type`, and so the
closure left `dist/index.js` out while the shell's first act was to resolve it. The installed 0.1.7.0 showed *A
JavaScript error occurred in the main process* and no window. Reproduced on the 0.1.7.0 stage (alive, no page, nothing
on either stream for 25 s), which started in 5.0 s with that one file put back.

Three changes, each for the class: a resolve is an edge, read by one function both checks take
(`moduleSpecifiers`); a staged workspace package must hold the entry its `exports` name; and the staged `Monstera.exe`
is STARTED before packing and must reach a window on the application's page whose renderer mounts, with the stage
unchanged by the run. The third is the one that does not depend on knowing the next edge: every earlier check read
files, and a file list says which files exist, not that the program runs.

## Correction, 2026-10-02 — the 150 MB target is withdrawn

*Not decided here*'s **The 150 MB target** bullet left what to remove, if anything, to the owner. The owner answered on
2026-10-01: nothing — the size is accepted and growth is fine. [ADR-0136](0136-the-package-has-no-size-target.md)
withdraws the target, and the packager now prints the package's size with no comparison and no verdict.
