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
