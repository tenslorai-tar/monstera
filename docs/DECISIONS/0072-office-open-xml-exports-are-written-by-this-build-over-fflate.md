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

## Amendment, 2026-10-01 — the Word export carries pictures, and is composed in the MuPDF host

The owner's list (29 September, night, item 4): the Word export carries pictures — inline in reading order when the
text reflows, at the picture's own box in the exact layout, none in the text-only mode — **composed in the engine
host, as Decision 2 said**. This restores Decision 2 for the Word export and leaves the correction above standing for
PowerPoint and Excel.

### Why the host, now

A picture is the document's pixels. The host already holds the page and draws it; composing in `main` would carry
every picture across the pipe as a file, page by page, only for `main` to zip it. In the host the package is written
into the session's granted output directory and `main` **moves** it to the destination through `writeDocumentCopy`'s
order — destination checked first, then produced, then placed by the atomic write — never reading it
([ADR-0121](0121-main-never-holds-two-images.md)'s `moveOutput`, which a checkpoint already takes).

The correction above named four costs of the host route. What each is now:

1. **A new engine channel**: yes, `engine/word`, a session, a mode and an output name in; a byte count and a picture
   count out. Nothing that grows with the document crosses the pipe.
2. **An export dependency inside the hostile process**: `fflate`, one package with no dependencies, which the
   application already ships.
3. **A second copy of the substrate's reading**: no. The host runs the same `structuredJson` read and the same
   `parsePageText` — one reader of MuPDF's format, now called in two processes by two consumers (B3a is about the
   reader, not its address).
4. **The output read back into `main`**: no; it is moved.

**What this changes in the code's stated reasons.** Five comments say `parsePageText` "lives main-side so nothing in
the hostile process holds an opinion" about MuPDF's structure (`engineHandlers.ts`, `engineChannels.ts`,
`remoteEngine.ts`, `hostEntry.ts`, `pageText.ts`). The reason that holds is B3a — one reader, no second format for the
same answer — and it still holds for every channel that answers text. The trust clause does not decide anything
here: a package the host writes is a file `main` never parses, as a page image is, and a compromised host could
already write any bytes into any output. The comments are corrected in the build.

### How a picture is found and drawn

Measured 2026-10-01 on the native engine (MuPDF 1.28.0), on a generated two-column page with a picture between two
paragraphs of the left column, a second picture rotated 90°, and a PNG whose right quarter is transparent:

- **Position comes from the read the text comes from.** The shared read (`segment,preserve-images`) gives each
  picture its place in reading order, between the two paragraphs, and its box in whole points as MuPDF's JSON prints
  it.
- **Pixels come from a second read with `preserve-images` alone.** Segmentation puts every picture inside a structure
  block, and MuPDF's own walk does not descend into one: over the shared read it found **0 of 2** pictures, over the
  flat read **2 of 2**. The flat read's boxes, truncated as MuPDF's JSON writer truncates them, equal the shared
  read's exactly, so each picture is matched to its place by box, in order.
- **A picture is drawn as MuPDF's interpreter draws it**: clip to the image's own mask, fill, pop
  (`pdf_show_image`), with its page transform, onto a transparent RGB pixmap at the picture's own resolution, and
  written as PNG. Read back: the upright picture's quadrants are its colours and its transparent band is transparent;
  the rotated one comes out turned as it is on the page. Two wrong turns on the way, both measured: `toPixmap` alone
  drops the soft mask (the band came back opaque), and a pixmap cleared with a value is opaque black under the
  picture, where a bare clear is transparent.

### Decision

1. **The Word export is composed in the MuPDF host**, one page at a time, and written into the session's output
   directory; `main` moves it.
2. **Two passes over the pages.** The first streams `word/document.xml`, holding one page, and records each picture's
   place and box. The second reads each page's pictures flat, matches them, draws each, and streams it into the
   package as `word/media/imageN.png`. A page whose second read does not find every picture the first recorded is
   refused: a reference with no picture behind it is a file Word calls damaged.
3. **Rich mode** carries a picture inline, as its own paragraph, in reading order, scaled down to the text column when
   it is wider. **Layout mode** anchors it to the page at its box, behind the text frames, in the paragraph that
   already ends the page's section, so it adds no line to the page. **Text mode** carries none.
4. **A picture is drawn at most 16,777,216 pixels** (4,096 squared, 64 MiB as RGBA) and scaled down to that if its
   own resolution is larger. A chosen bound on the host's memory, not a measurement.

**Stated limits.** A stencil mask is drawn black, because the structured text keeps no fill colour. A clip on the
page is not applied: the picture is carried as its transform draws it. Two pictures with the same whole-point box on
one page are paired in the order each read met them.

### Rejected

- **Composing in `main` with each page's pictures crossing as files.** The correction's route, extended; the owner's
  decision is the host, and it would move every picture through `main`.
- **A glue export that walks a structure block's children**, so one read serves both. An addition to the shim's ABI
  (ADR-0124) for a read MuPDF already makes flat.
- **Rendering the page region under each picture.** It carries the text drawn over the picture.
- **Holding the pictures until `document.xml` ends, or writing them to scratch files.** The first is every picture in
  the host's memory; the second is a new filesystem surface for what a second read gives.
