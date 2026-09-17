# ADR-0072 — Office Open XML exports are written by this build, over `fflate`, in the engine host

- **Status:** Accepted
- **Date:** 2026-09-17
- **Amends:** `docs/ARCHITECTURE.md` §3 — three writer-of-record rows: *PDF → Word*, *PDF → PowerPoint*, *PDF → Excel*.
- **Supersedes:** `BUILD-PROMPT.md`:67, *"Use exceljs, never xlsx (audit history)"* — its first half; the second stands.
- **Relates:** [ADR-0035](0035-extracted-text-is-never-resident-in-main.md) (extracted text is never resident in `main`),
  [ADR-0050](0050-the-ocr-binding-is-tesseracts-core-driven-directly.md) (the same refusal, at one package's scale).
- **Context:** D10's *Word (rich / layout / text)*, *PowerPoint* and the four *Excel* rows, built on 2026-09-17 under
  the owner's run rule: *"A question does not stop the run … Take the answer the record gives, or the option that keeps
  the most rows moving, and write the question in your report."* The question is in the report.

## The gap

§3 has no writer for any Office format. MuPDF writes no DOCX, PPTX or XLSX, and neither does anything else this build
ships.

## The record's answer refuses itself

Part A says two things in one paragraph: *"Use exceljs"*, and *"Third-party notices are generated from the lockfile"* —
which `generateNotice.mjs` does by refusing any shipped package with no licence text, because *"an SPDX identifier is
not a licence notice"*. Measured 2026-09-17 in scratch trees (`npm install --omit=dev`, each package's files read):

| writer | packages | shipping no licence text | `npm audit --omit=dev` |
|---|---|---|---|
| `exceljs` 4.4.0 | 97 | `binary`, `buffers` (no licence declared at all), `chainsaw`, `isarray`, `saxes` | findings |
| `docx` 9.7.1 | 22 | `hash.js`, `isarray` | 0 |
| `pptxgenjs` 4.0.1 | 19 | `https`, `isarray` | 2 high, `image-size` (GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq) |
| `fflate` 0.8.3 | 1 | none | 0 |

All three document libraries reach `isarray@1.0.0` through `jszip` → `readable-stream`, so no choice among them clears
the notice rule. ADR-0050 met the same refusal for `tesseract.js` → `tr46` and found an ADR exception *"not available,
and not by judgement"*; that stands here.

## Decision

1. **The OOXML packages are written by this build**: the XML parts of WordprocessingML, PresentationML and
   SpreadsheetML that each export needs, assembled as strings with every text value escaped by one function, and zipped
   by **`fflate`** (MIT, no dependencies, its licence text shipped).
2. **They are composed in the engine host**, from the reads the host already makes — MuPDF's structured text, and
   page rasters where a mode needs pictures — and written into the host's granted output directory, as a page image is.
   `main` moves the file; it never holds the document's text (ADR-0035).
3. **A format is written to the subset its export needs, not to the standard.** A Word text export needs paragraphs; a
   layout export needs positioned frames; an Excel export needs cells, styles and merges. Each part is proven by being
   opened in the application that owns the format, not by a reader of ours.
4. **`xlsx` (SheetJS) stays refused**, which is the half of Part A's sentence this does not supersede.

## Rejected

- **`exceljs`, `docx`, `pptxgenjs`.** The table above: each ships packages the notice generator refuses, and one carries
  two high-severity advisories.
- **An exception to the notice rule for `isarray`.** ADR-0050's reason — an exception is an override standing in for
  missing coverage — and the substance: the terms would not travel with the software.
- **Vendoring `isarray`'s licence from its repository.** A text the package does not ship is a guess about what it
  grants, and *"one resolver per authority"* makes the package the authority on its own terms.
- **LibreOffice converting PDF to Office formats.** Its PDF import yields drawing objects rather than text flow, and its
  contained start is blocked (ADR-0063 item 3).
- **Leaving the Office rows unbuilt until the owner decides.** The run rule answers that.

## Evidence

2026-09-17, scratch tree: a four-part WordprocessingML package — content types, package relationships, the main
document with three paragraphs carrying a tab, `&`, `<` and non-Latin text — zipped by `fflate` to 1,011 bytes, opened
by Microsoft Word through COM read-only, which reported `paragraphs=3` and each paragraph's text unchanged.

## Correction, 2026-09-17 — composed in `main`, streamed, not in the engine host

Decision 2 put composition in the engine host so that `main` would never hold the text. That was the wrong route to
the right bound. The plain text export already reads **one page at a time in `main`** and streams it to disk, which is
ADR-0035's own bound — *at most the largest page* — and `fflate` zips as a stream: each chunk of a part is deflated as
it is pushed and handed on at once. So the Word export reads each page's structured text through the same substrate the
plain export uses, writes that page's XML, and the zip carries it to the destination before the next page is read. What
is resident is two pages' text (the page being written and the one held back to know whether it is the last) and the
compressor's window.

What the host route would have cost, and this avoids: a new engine channel, an export dependency inside the hostile
process, a second copy of the substrate's reading there, and the output file read back into `main` or streamed out of a
granted directory. Nothing about the decision's substance changes — the parts are this build's, `fflate` zips them, and
each format is proven in the application that owns it.

Measured the same day through the built modules on a corpus document's first five pages (391 lines): all three modes
open in Word; layout mode keeps five pages, five sections and one frame per line; Word's own PDF of it, read back by
MuPDF, places **328 of 383** lines with identical text within **1 pt** of the original (median 0 pt across, 1 pt down),
while the reflowed text mode — the control — places 8.
