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
