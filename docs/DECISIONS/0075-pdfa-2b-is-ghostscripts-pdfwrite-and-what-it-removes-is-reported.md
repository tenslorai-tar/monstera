# ADR-0075 — PDF/A-2b is Ghostscript's `pdfwrite`, contained, and what it removes is reported

- **Status:** Accepted
- **Date:** 2026-09-17
- **Amends:** `docs/ARCHITECTURE.md` §3's *PDF/A-2b export* row, from *unexecuted* to the
  build and the reading; §8's external-converter contract, which gains *a converter's
  diagnostics are read on success too*.
- **Relates:** [ADR-0013](0013-pdfa-export-and-text-extraction-engines.md) (Ghostscript's
  row, provisioned only when the feature is built — now),
  [ADR-0063](0063-an-office-file-is-converted-by-a-pinned-libreoffice-in-a-contained-process.md)
  and [ADR-0071](0071-layout-preserving-text-is-popplers-pdftotext-in-a-contained-process.md)
  (the seam and the conda-forge provisioning shape).
- **Context:** D10's *PDF/A-2b export (honest blocker reporting)* (`BUILD-PROMPT.md`:505).
  The owner consented to Ghostscript, and to veraPDF with a Java runtime for validation
  only, never shipped.

## Measured, 2026-09-17 (scratch; the corpus's names withheld)

1. **The build.** conda-forge's `ghostscript-10.08.0-hac47afa_0` for win-64 (19,295,904 B,
   SHA-256 `512be941…adb0`), built by the feedstock with `psi\msvc.mak` from Artifex's
   `ghostscript-10.08.0.tar.gz`, whose SHA-256 `caf199e3…edda06b3d` the recipe pins and the
   tarball fetched from Artifex's release matched — two sources agreeing. Artifex publishes
   `SHA512SUMS` and no signature. `gswin64c.exe` and `gsdll64.dll` import only Windows DLLs
   and the MSVC runtime (`dumpbin /dependents`), so the build is **five files**: those two
   and `msvcp140.dll`, `vcruntime140.dll`, `vcruntime140_1.dll` from the `vc14_runtime`
   build ADR-0071 already pins. Its init files, fonts and `srgb.icc` are in the DLL's ROM.
2. **The licence chain.** The package's index says `AGPL-3.0-only`; its `LICENSE` grants the
   AGPL *version 3 or any later version*, and the notice renders the text. Strings in
   `gsdll64.dll` show statically linked FreeType, zlib, IJG libjpeg, libpng, OpenJPEG, Little
   CMS (`lcms2mt`), jbig2dec, libtiff, Tesseract, Leptonica, extract, IJS and brotli; each
   one's terms are in the source release and **none is GPL-2.0-only** — FreeType is taken
   under the FTL; jbig2dec and extract are AGPL-3.0; the rest are permissive.
3. **The output intent is the whole difference.** ENGINE-SPIKE H6's shape, generated — an
   unembedded standard font, a translucent fill, an untagged image. veraPDF 1.30.2 on the
   input: **FAIL**, five rules. Ghostscript with `-dPDFA=2` alone: **FAIL**, 6.2.4.3-2 and
   6.2.10-2, both *no RGB output intent*. With `lib/PDFA_def.ps`'s pdfmarks passed inline
   and the profile read from `%rom%iccprofiles/srgb.icc`: **PASS**. The font was replaced by
   an embedded Nimbus Sans.
4. **The corpus: 11 of 11 PASS**, 0.3 to 3.7 s each, uncontained.
5. **Ghostscript's exit code does not report what it did.** On the one corpus document with
   an annotation Ghostscript cannot carry, all three compatibility policies exited **0**:
   policy 0 said *reverting to normal PDF output* and veraPDF **FAILED** it; policy 1 said
   *annotation will not be present in output file* and it **PASSED**; policy 2 said
   *aborting conversion* — and wrote a file that **PASSED**.
6. **The validator, for development.** veraPDF 1.30.2's installer verified against its
   signing key `13DD102B…78B17FE7`, and Temurin JRE 21.0.12.1 against Adoptium's
   `3B04D753…65F8F04B`, each with a wrong-file control refused.

## Decision

1. **PDF/A-2b is Ghostscript's `pdfwrite`**, run through §8's external-converter seam under
   its own container, with fixed arguments: `-dPDFA=2 -dBATCH -dNOPAUSE -dSAFER
   -sColorConversionStrategy=RGB -dPDFACompatibilityPolicy=1 -sDEVICE=pdfwrite
   -sOutputFile=<out> -c <the output intent> -f <in>`. The output intent is
   `PDFA_def.ps`'s pdfmarks with the ROM's sRGB profile, passed as an argument, so no file
   of ours is written for Ghostscript to read.
2. **Policy 1, and the removals are the report.** Reading 5 makes policy 2's *abort* a
   message rather than an outcome, and policy 0 produces a file that is not PDF/A under a
   name that says it is. Policy 1 produces a conformant file by removing what cannot be
   carried and says so, so **every Ghostscript line saying something is not permitted in
   PDF/A is shown to the person after the export**, as the converter's own words. A
   conversion that exits non-zero or writes nothing writes no file.
3. **§8's seam reads a converter's diagnostics on success as well.** An external converter
   was *"run once, producing one output"* and its words mattered only when it failed;
   reading 5 is a converter that reports a change and succeeds.
4. **Provisioned as ADR-0071's shape**: the pinned conda package and runtime, the five
   files, every licence text compared with the committed copy taken from the pinned source
   release, and Ghostscript and each bundled component in the notice with a written offer
   of source.
5. **veraPDF validates in development and never ships.** A provisioning script pins and
   verifies the JRE and the installer; a research instrument runs the shipped conversion
   path and validates the result. The application does not claim a file was validated.

## Rejected

- **Policy 2 (abort).** It does not abort (reading 5).
- **Policy 0 (fall back).** Writes a file that is not PDF/A.
- **Shipping veraPDF.** A Java runtime in the installer for a check the owner scoped to
  development.
- **Artifex's `gs10080w64.exe` installer.** An NSIS installer that asks to write the
  registry; the conda build is a pinned archive whose licence texts can be compared.
- **Our own output intent and font embedding over MuPDF.** ADR-0013's reason: the PDF/A
  schema, output intents and font substitution are exactly the standard a second opinion
  gets partly right.

## Consequences

- §3's row and §8's contract are amended; the amendment log and the index gain a line.
- The adoption commit adds the provisioning, the licence texts, the notice entries, the
  container grant and the executable resolver; the veraPDF provisioning lands in its own
  commit, since nothing ships from it.
- **Unexecuted until the adoption commit**: Ghostscript starting inside the AppContainer
  holding only its input and output, and where it writes temporary files there.

## Correction, 2026-10-13 — what was left out is named in plain words, at a level the person chose (the owner's N7)

Amends `docs/ARCHITECTURE.md` §3's PDF/A row, which said every *not permitted* line is shown to the person.

### What the owner saw

In 0.1.13.0, exporting a two-page sheet with one Note: a console window titled `gswin64c.exe` for two to four seconds;
a result quoting Ghostscript (*"not permitted in PDF/A, annotation will not be present in output file"*); and the
Note still in the saved file. No level was offered.

### Readings

Taken 2026-10-13 on Linux with Ubuntu's Ghostscript **10.02.1**, not the shipped 10.08.0 (no Windows here, and the
conda-forge listing was refused by this sandbox's network policy), with the shipped arguments except that Debian's
build has no `%rom%`, so the sRGB profile was named by its path. The document was annotated by the app's own writer
(`applyAddAnnotation`), as the owner's was.

1. **The Note is kept; its Popup is what is dropped.** The Note (`/Text`) carries `/F 28` (Print set) and an
   appearance. Its Popup carries no `/F`, and Ghostscript prints *"Annotation set to non-printing, not permitted in
   PDF/A"* and leaves it out. So the message named nothing the person could find, and the reviewer's suspicion holds.
2. **A pop-up cannot be kept as a pop-up.** Given `/F 4`, the Popup is written, but `pdfwrite` drops both the note's
   `/Popup` and the Popup's `/Parent`: an orphaned window with nothing to show. ISO 19005-2 exempts Popup from the Print
   and appearance rules; Ghostscript's pdfwrite does not, and it cannot carry the link either way.
3. **With pop-ups removed first, Ghostscript removes nothing** and prints no removal line, at `-dPDFA=1`, `2` and `3`.
4. **The output declares its level**: its XMP metadata holds `pdfaid:part` (1, 2 or 3) and `pdfaid:conformance` B
   uncompressed, and the catalogue an `/OutputIntents` entry naming `GTS_PDFA1`, at all three levels.
5. **The console is ours, not Ghostscript's.** `win32HostSurface.ts` creates every contained process with
   `EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED`. A console-subsystem program started
   by a process with no console of its own is given a new one unless `CREATE_NO_WINDOW` is passed, and `wShowWindow` is
   read only with `STARTF_USESHOWWINDOW`, which is not set. `gswin64c.exe`, `x2t.exe` and `pdftotext.exe` are all
   console programs, so every converter flashed a window; the engine hosts run `electron.exe`, a GUI program, which is
   why nobody saw one there. It is the one process-creation site in the product (`shell.openPath` aside, which starts
   nothing of ours).

### Decision

1. **No contained process gets a console**: `CREATE_NO_WINDOW` is in the creation flags for every program, at the one
   site, from one named constant set that a test reads. Not `gswin64.exe` instead: it is not among the five pinned
   files, and swapping one executable would leave x2t and pdftotext flashing.
2. **The person chooses the level** before the file is picked: PDF/A-2b, the default; PDF/A-1b, for a system that asks
   for the oldest; PDF/A-3b, which may carry attached files. One line each. Only `-dPDFA` changes. veraPDF validated
   2b (reading 3 of this ADR); validating 1b and 3b is owed in development, as 2b's was.
3. **A copy is prepared before Ghostscript reads it, in the compose host** (ADR-0060: it opens what main hands it and
   holds no document), from the save's own flush:
   - every markup annotation that is shown on screen but not printed is given the Print flag, and one with no
     appearance is given MuPDF's, so Ghostscript keeps it;
   - what cannot be kept is removed there and **named by kind and page**: a comment's pop-up window (reading 2; the
     comment and its text are kept), a mark hidden from view (making it visible would change what the page shows), and
     the kinds PDF/A forbids outright (sound, movie, screen, 3D, rich media);
   - links and form fields are left as they are.
4. **Ghostscript's words are never shown.** A removal line it still prints is counted and said as *other content the
   archival format cannot hold*, never quoted, and the converter is not named.
5. **The output's declarations are checked as it streams to the file**: its `pdfaid:part` must be the chosen level,
   its conformance B, and an `/OutputIntents` present. A missing one writes no file and says the document could not
   be made PDF/A. This is a fixed substring match over bytes our converter wrote, not a parse: no structure is read in
   `main` (threat model §2), and reading 4 is what makes the text findable.
6. **On success the person reads "Saved as PDF/A-2b."** (the level chosen), then what was left out, if anything.

### Rejected

- **Giving pop-ups the Print flag.** Reading 2: Ghostscript keeps an orphan, which is worse than a named removal.
- **Clearing a hidden mark's Hidden flag.** It would appear on the page in the archive though it did not on screen.
- **Quoting Ghostscript, even beside our words.** The owner's ruling, and reading 1 shows its words mislead.
- **Checking the output with a PDF parser in main.** Threat model §2; reading 4 makes a substring sufficient.
- **Bundling veraPDF to validate.** Unchanged from this ADR: a Java runtime in the installer.

### Consequences

- `win32HostSurface.ts`' flags, `pdfaArguments` gains the level, a compose-host channel prepares the copy, the
  contract's PDF/A outcome carries what was left out by kind and page, and the renderer gains a level dialog.
- **Owed on Windows**: no console for any converter, and Ghostscript 10.08.0 reproducing readings 1 to 4.
