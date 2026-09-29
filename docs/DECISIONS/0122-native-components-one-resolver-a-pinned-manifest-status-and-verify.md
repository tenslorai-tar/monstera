# ADR-0122 — Native components: one resolver, a pinned manifest, status and verify — and nothing downloaded

- **Status:** Accepted
- **Date:** 2026-09-29
- **Decided by:** the owner's list of 28 September, item 12 — *"Native-binaries manager (row 306)"*; the owner's
  order of 2026-09-29 places it before the MSIX (item 14), which builds the layout this names.
- **Amends:** `docs/ARCHITECTURE.md` §8 (native binaries).
- **Supersedes:** `BUILD-PROMPT.md`:519's *native-binaries manager (status, verify, **download**)* in its download
  half; :403-404's and :801's *resolved from `app.asar.unpacked` when packaged*.

## Context

Row 306 built *verify* for the development trees (every file of each pinned `bin/` folder, byte for byte) and left
*status and download owed to packaging*, because a packaged build resolved none of these paths: each reader —
`pdfiumLibraryPath`, three `providedConverterExecutable` calls, the MuPDF shim's, the OCR models' — read one launcher
variable and answered *absent* otherwise. Six readers, each its own opinion of where a component is (B3a), and the
founding record's answer (`app.asar.unpacked`) belongs to an asar-based installer this build does not make.

`monstera/no-install-root-writes` bans `process.resourcesPath` outright, on the ground that a rule cannot tell a read
from a write. The ban's subject is writing beside the install; loading a read-only file from it is the one thing an
MSIX build must do.

## Decision

1. **The packaged layout.** Each component lives read-only under the package's `resources/native/<component>/`,
   holding exactly the files its development tree pins, beside `resources/native/manifest.json`. Item 14 builds it.
   Components: `pdfium`, `poppler`, `ghostscript`, `onlyoffice`, `mupdf-shim`, `ocr-models`.
2. **One resolver.** `apps/desktop/src/nativeComponents.ts` answers every component's path from a `NativeRoot` —
   the packaged folder, or the launcher's variables in development — and the six readers take its answer. `entry.ts`
   alone reads `process.resourcesPath`, only when `app.isPackaged`, and hands the folder down; the lint rule confines
   the name to `entry.ts` as it already confines `getPath`, with the planted offender extended to prove it still
   reports it elsewhere.
3. **A pinned manifest, generated, never hashed from disk.** A generator under `scripts/release/` writes each
   component's name, version and `{ path: sha256 }` from the provisioning scripts' own pin constants
   (`PDFIUM_BIN`, `POPPLER_BIN`, `GHOSTSCRIPT_BIN`, `onlyofficePins.json`, the tessdata table). The MuPDF shim is
   built here and has no reproducible digest; its entry is the digest of the DLL the build produced, recorded when
   the manifest is generated, and says so (`pinnedFrom: 'build'`). In development the launcher generates it into
   `.tools/` and passes its path.
4. **Status and verify, on request.** A **Components** command — Tools › Diagnostics and the Help menu — opens a
   dialog listing each component: its name, version and state — *verified*, *not in this build*, or *changed* — and
   *Verify* re-hashes every file against the manifest. On request rather than at every start: hashing the Office
   converter's tree is not free, and a start is not when a person asks. *Changed* says to reinstall the application
   from the Store, which is the only repair a read-only package has.
5. **Nothing is downloaded at run time.** A Store package's folder is read-only, so a component fetched later
   would live somewhere other than where the manifest and the package's integrity cover it; the one data set that
   was a candidate — the OCR models — is bundled whole (14 models, 18,013,460 bytes, the `fast` variant chosen for
   the installer budget). The founding record's *heavy optional runtimes download on demand* has no subject today:
   the local handwriting engine was removed on 2026-09-18 (JOURNAL, ADR-0085's build). One that arrives brings its
   own ADR — and with it the question of what the Store's policies allow an application to fetch, which this ADR
   does not assert either way.

## Rejected

- **Six readers, each learning the packaged path.** Six opinions of one layout (B3a).
- **Verify at every start.** A cost paid on every launch for a state a read-only package cannot drift into by itself.
- **A manifest hashed from the files present.** It would certify whatever is there — the failure row 306 fixed in
  the development trees.
- **Keeping the `resourcesPath` ban and reading the folder through `__dirname`.** A way around the rule, not a
  statement of what is allowed.
