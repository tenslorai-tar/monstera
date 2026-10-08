# ADR-0172 — One font resolver; open fonts bundled by fingerprint; subsets made in the host

- **Status:** Accepted
- **Date:** 2026-10-05
- **Amends:** `docs/ARCHITECTURE.md` §3, three rows: *In-place text editing* (its fallback to a twin in a standard
  font), *Content composition* (what a composed document's text is set in), *Office document → PDF* (the fonts `x2t`
  sees).
- **Supersedes:** [ADR-0097](0097-a-page-is-translated-as-one-block-edit-and-a-font-that-cannot-carry-it-falls-back.md)'s
  fallback to a twin in the nearest standard font, which carried WinAnsi alone, its consequence *"languages are
  those WinAnsi can write"*, and its rejected alternative *"embedding a system font"*. `composeLayout.ts`' refusal of a whole import for one character the standard fonts cannot
  draw (`unencodable-text`). In part, [ADR-0128](0128-the-shim-carries-mupdfs-layout-engine.md)'s rejected alternative
  *"bidi and shaping in TypeScript, or a second shaping library"*, for page text only (Decision 10); ADR-0128 stands for
  annotations.
- **Relates:** [ADR-0169](0169-a-pdfium-rewrite-is-saved-only-when-it-reads-back-as-edited.md) (the read-back every
  write keeps), [ADR-0060](0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md) (the compose
  host), [ADR-0120](0120-office-import-is-onlyoffices-x2t-contained.md) (`x2t`'s fonts),
  [ADR-0136](0136-the-package-has-no-size-target.md) (no size target).
- **Context:** Part B, Phase 1 of the text-editing rebuild. The owner's D2 (*one font resolver, used by Office
  conversion, text editing and the composers; the closest installed font the licence allows, then bundled open fonts*)
  and the owner's answers of 2026-10-05 to the planning list: skip fonts licensed *view and print only* (Q2); bundle the
  small set now, CJK only if a check on Windows CI finds a gap, at most 100 MB, pinned, fingerprint checked, in the
  licence notice, never committed (Q3); subset with a small well-known tool inside the sealed engine process, keeping
  the whole font only where the subset fails, MuPDF's own subsetting off (Q4); a character no font can draw is a
  visible box, the real character kept in the text, and the person told which and where (Q5); a letter the document's
  font lacks takes the whole word into the nearest font and the rest of the line keeps the document's (Q6). The owner
  approved the planner's decisions 1 to 3 and 7 the same day: PDFium keeps editing existing text and gains loading a
  font; one resolver; line breaking from the engine process's own word boundaries; a small open shaping library inside
  the sealed engine process for right to left and joined scripts.

## What was measured

All on 2026-10-05, with scratch probes run against the pinned libraries below, on generated text and the bundled
fonts, never a person's document. Readers: PDFium 155.0.8044.0 Linux (the pinned development build, `c10d9807`) and
pdf.js 6.2.108, the application's own viewer.

**HarfBuzz as the font reader and the subsetter.** `harfbuzzjs` 1.6.2 (MIT, npm, published by the HarfBuzz project)
ships two WebAssembly modules. `harfbuzz-subset.wasm` (651,027 bytes) declares **no imports at all**, so it cannot
reach a file, a clock or the network; `harfbuzz.wasm` (433,766 bytes) imports five functions, `proc_exit`, `_abort_js`,
`_setitimer_js`, `_emscripten_runtime_keepalive_clear` and `emscripten_resize_heap`, none of which touches a file. Both
were listed with `WebAssembly.Module.imports`.

| font | whole | subset for one line | time |
|---|---|---|---|
| Arimo (variable, pinned at `wght` 400) | 496,268 bytes | 3,676 | 22.0 ms (first call) |
| Arimo pinned at `wght` 700 | 496,268 | 2,116 | 1.4 ms |
| Tinos Regular | 521,588 | 6,856 | 1.0 ms |
| Carlito Regular | 628,032 | 7,732 | 2.0 ms |
| Noto Naskh Arabic (variable, `wght` 400) | 307,592 | 4,876 | 2.3 ms |

The `wght` 700 instance drew bold and the 400 instance regular, rendered by PDFium and looked at.

**What each reader takes the text from.** A Type0 font, `Identity-H`, a `CIDToGIDMap` and a `ToUnicode` map:

| written | PDFium reads | pdf.js reads |
|---|---|---|
| glyph ids with `/ActualText` spans, no `ToUnicode` | the logical text | **ignores `/ActualText`**: letters in drawing order, or `\u0000` |
| one CID per glyph and its characters, in `ToUnicode` | the text | the text |
| a CID with no `ToUnicode` entry, or an empty one (`<0004> <>`) | the code as a character | `\u0004` |

**The missing character.** Arimo's `.notdef` glyph is **blank**, so a character drawn as glyph 0 shows nothing. A
drawn rectangle with the character as invisible text beside it was copied by pdf.js but **dropped by PDFium's text
page whenever that glyph ended its run**, in four variants (render mode 3 and 0, glyph 0 and the space glyph); a glyph
with an outline in the same place was kept. Arimo, Tinos, Cousine, Carlito and Noto Sans Symbols 2 carry `□` (U+25A1).

**PDFium and a loaded font.** `FPDFText_LoadFont(…, FPDF_FONT_TRUETYPE, cid)` with the whole Arimo and with two
HarfBuzz subsets of it, each on its own text object, one page:

| subset names | page font resources written | read back by both |
|---|---|---|
| all three `Arimo-Regular` | **one**, `/FXF1`, for all three objects | the first line only; the others as `!!"'*()$` |
| `AAAAAA+Arimo-Regular`, `AAAAAB+Arimo-Regular` | three | every line |

So **PDFium writes every loaded font of one name as one page resource**, and a second subset is drawn with the first's
glyph table. With unique names a subset drew **527 of 527** ink pixels against the whole font's line. A subset that
lacked the Cyrillic was given the Cyrillic word: `FPDFText_SetText` answered **1** and the characters were written as
nothing (PDFium read `Hello Ωμέγα `, pdf.js `\u0000` six times), which is why coverage is decided before a write and
the read-back stays.

**Joined scripts and order.** `bidi-js` 1.1.0 (MIT, the Unicode Bidirectional Algorithm in JavaScript) against
Unicode's own `BidiCharacterTest-17.0.0.txt` (SHA-256 `a3e6e905…5488`, from `unicode-org/unicodetools` at
`6661370193d3`): **91,707 of 91,707** cases right in both the resolved levels and the visual order, in 0.8 s. A mixed
line ordered by it and shaped by HarfBuzz rendered right to left with its Arabic letters joined, and copied in pdf.js
and PDFium as its letters. HarfBuzz gave Noto Naskh's medial yeh **two glyphs for one character**, so one glyph of that
cluster has no character of its own to carry.

**Word boundaries.** `Intl.Segmenter('und', { granularity: 'word' })`, ICU 77.1 in Node 22.22 and ICU 78.2 in the
pinned Electron's Node mode, the same answers in both: Thai `ภาษาไทยไม่มีการเว้นวรรคระหว่างคำ` in 8 segments, Chinese
`中文没有空格分隔词语` in 5, Japanese in 11.

**The bundled faces**, every one from `google/fonts` at commit `7085eb89a950e85db5b166b7a58d414544b4140c`, read with
HarfBuzz (`OS/2` `fsType`, `cmap`):

| face | files | bytes | code points | `fsType` | stands in for |
|---|---|---|---|---|---|
| Arimo | upright and italic, variable `wght` | 1,039,464 | 3,010 | 0 | Arial, Helvetica, and sans in general |
| Tinos | four styles | 2,263,460 | 3,011 | 0 | Times New Roman, and serif |
| Cousine | four styles | 1,210,076 | 2,282 | 0 | Courier New, and monospace |
| Carlito | four styles | 2,734,244 | 2,117 | 0 | Calibri |
| Caladea | four styles | 333,228 | 435 (Latin only) | 0 | Cambria |
| Noto Sans Arabic | variable `wdth`, `wght` | 844,676 | 1,561 | 0 | Arabic, sans |
| Noto Naskh Arabic | variable `wght` | 307,592 | 1,551 | 0 | Arabic, text |
| Noto Sans Symbols 2 | one | 1,233,128 | 2,955 | 0 | symbols, `✓` among them |

**9,965,868 bytes** in all. Arimo, Tinos and Cousine carry Greek, Cyrillic and Hebrew. None carries CJK or emoji.
Tinos' folder at that commit holds no licence file; its own `name` table names the copyright and the SIL Open Font
License 1.1.

## Decision

1. **One resolver.** `fontResolver.ts` in the kernel, a pure function over a catalogue, answers for each **word** of
   text to be written which face draws it. Its callers are the composers (Markdown, CSV, plain text), the in-place
   editor's new text and Replace. A word goes to the first source that carries **every** character of it:
   1. the font the text already has, when editing;
   2. a sibling in the same document: the same base name once a subset tag (`ABCDEF+`) is removed;
   3. an installed font of the same family and style, when its licence allows (Decision 3);
   4. the bundled face that stands in for that family (the table above), then the bundled face of the same class;
   5. any installed, then any bundled, face carrying the word's characters;
   6. otherwise each character no source carries is drawn as the missing-character box (Decision 8), and the word's
      other characters stay in the face chosen for most of them.

   **A word is never split between two faces except by Decision 8**, and the rest of the line keeps its own font (the
   owner's Q6). A word is an `Intl.Segmenter` word segment (Decision 9).

2. **Fonts are parsed only in a contained host.** The catalogue is read there, by HarfBuzz: family and style from
   `name`, the licence from `OS/2`, the characters from `cmap`. `main` never parses a font; what the renderer may do
   with one is a separate decision, because it changes the renderer's policy (§9.27), and it gets its own ADR before
   it is built.
   The installed fonts are the ones Windows keeps in its system font folder, read by the host when its containment lets
   it read them. **That reach is measured on the Windows leg in the piece that builds it, and if the host cannot read
   the folder, installed fonts are not a source** and this decision says so in a correction rather than widening the
   host's grants.

3. **The licence rule is the font's own `fsType`** (OS/2): `0` (installable) and bit 3 (editable) are used; bit 1
   (restricted) is never embedded; bit 2 (*preview and print*) is skipped, the owner's Q2, so a document stays editable
   in every program; bit 8 (*no subsetting*) is embedded whole; bit 9 (*bitmap only*) is skipped. A font with no `OS/2`
   table is skipped. Every bundled face is `0`.

4. **The bundled set** is the table above: one pinned commit of `google/fonts`, each file pinned by SHA-256,
   provisioned into `.tools/` by a script that refuses a file whose digest differs, packaged as a native component, and
   listed in `NOTICE` with each family's licence text committed under `scripts/release/licences/fonts/` (Tinos' from its
   own `name` table). **Never committed.** CJK is not bundled: Windows ships its own, and a face is bundled only if a
   check on the Windows leg finds a script with no installed face whose licence allows, up to 100 MB (the owner's Q3).

5. **A subset is made by HarfBuzz's subsetter in the host**, from the glyphs the text needs, with a variable face
   pinned at the weight asked for. **Every subset carries a unique PostScript name, `TAG+Name`**, where `TAG` is six
   capitals taken from a digest of the subset's bytes, because PDFium writes fonts of one name as one resource (measured
   above) and because that is how PDF names a subset. A subset HarfBuzz refuses is replaced by the whole font when its
   licence allows, and by the next source when it does not. **MuPDF's `pdf_subset_fonts` stays withheld**
   (ARTIFEX-BUG-709567, a memory overwrite in its CFF2 subsetting that no release fixes, which the advisory register's
   reachability watch holds unreachable). HarfBuzz's subsetter is not that code, and it runs as WebAssembly with no
   imports: a fault in it is bounded by its own linear memory, so the worst it can hand back is a wrong font, which the
   read-back and the reader see.

6. **A composer writes text as CIDs that each carry their own characters.** Through pdf-lib's own objects: a Type0
   font, `Identity-H`, a `CIDToGIDMap` stream, and **one CID for each pair of glyph and characters**, so the
   `ToUnicode` map says exactly what each drawn glyph stands for. A cluster's characters are shared over its glyphs in
   logical order; **a glyph left with no character of its own is drawn as its outline**, as a path, never as text,
   because pdf.js cannot read a glyph whose map is empty (measured). Nothing relies on `/ActualText`, which pdf.js does
   not read.

7. **The editor writes new text through PDFium**, as it writes existing text: `FPDFText_LoadFont` with the uniquely
   named subset, then `FPDFText_SetText`, and the read-back of ADR-0169 for every write. The resolver decides coverage
   before the write, because PDFium writes a character its font lacks as nothing and answers success. **This replaces
   the twin in a standard font** (ADR-0097), which carried WinAnsi alone, and it is the route the owner's Q1 named for
   Replace.

8. **A character no source carries is the `□` glyph of a bundled face, mapped to the real character.** It is visible in
   every reader, its `ToUnicode` entry is the character itself, so copying and search find what was typed, and PDFium
   keeps it because the glyph has an outline. The person is told which characters and where: a composer names the
   source line and column of each; the editor names them in its message. **One character never refuses an import**
   (`unencodable-text` is withdrawn from the composers).

9. **Words and line breaks come from `Intl.Segmenter`**, the ICU in the process that lays the text out, so a language
   written without spaces breaks between its words. A segment wider than its line is broken by characters, as one is
   today.

10. **Right to left text is ordered by `bidi-js` and shaped by HarfBuzz, in composers now and in the editor in Phase
    4.** `bidi-js` is held to Unicode's own conformance file by a proof, pinned by digest and provisioned rather than
    committed (6,880,771 bytes, over the commit limit). This takes the owner's approval of decision 7 into Phase 1 for
    composers only, because accepting a Hebrew or Arabic source without it would draw it backwards and unjoined
    (measured). **It is a second implementation beside MuPDF's**, which still lays out annotations (ADR-0128), and that
    is stated rather than hidden: two UAX #9 implementations and two HarfBuzz builds are in the product, MuPDF's for
    annotation appearances and these for page text. Each answers to the authority it implements (Unicode's conformance
    file; the font), and a difference between them would show as an annotation and a page line ordering the same text
    differently.

11. **`x2t` is given the bundled faces in its own font folder**, beside ONLYOFFICE's set, so an Office document naming
    Calibri, Cambria, Arial, Times New Roman or Courier New finds its stand-in. **Which face `x2t` then picks is
    ONLYOFFICE's rule, not this resolver's**, and this decision does not claim otherwise.

12. **A composed or edited document depends on the catalogue.** The same input on the same machine gives the same bytes
    (the subset tag is a digest); on another machine with other installed fonts it may not. A `docs/FEATURES.md` row that
    claims the same bytes every time is narrowed where that stops being true, in the commit that makes it untrue.

## Rejected

- **pdf-lib's own font embedding with fontkit.** A second font parser beside HarfBuzz for the same questions (B3a),
  and its subsetter is not the one the owner chose.
- **Embedding whole fonts always.** About 0.5 MB a face per document for a few words, and 10 to 20 MB for a CJK face.
- **MuPDF's subsetting.** A memory overwrite no release fixes (the advisory register).
- **`/ActualText` for every run.** pdf.js, the application's own viewer, does not read it (measured).
- **The face's `.notdef` as the box**, blank in Arimo; **a drawn box with an invisible twin**, dropped by PDFium's text
  page at the end of a run (measured).
- **Keeping the standard-font twin as a step** before the bundled faces: it is never embedded, carries WinAnsi alone,
  and Arimo, Tinos and Cousine stand in for its three families with metrics to match.
- **Laying composed text out through MuPDF's HTML engine**, the route ADR-0128 took for annotations: the composers'
  table layout (`composeTable.ts`) is pdf-lib's, rebuilt on the owner's order a day earlier, and the editor's host holds
  no MuPDF.
- **Exposing MuPDF's own bidi and HarfBuzz through new shim exports** to keep one implementation: native work across
  two hosts for an algorithm Unicode defines with its own conformance test, which the chosen implementation passes
  whole.
- **Bundling CJK now**, before a Windows check shows a gap (the owner's Q3).
- **Using fonts licensed *view and print only*** (the owner's Q2).

## Consequences

- Two runtime dependencies in the kernel, `harfbuzzjs` and `bidi-js`, each loaded only in a host; `proof:kernelload`
  and `proof:hostload` keep them out of `main`.
- The package grows by about 10 MB of fonts (ADR-0136: no size target).
- `NOTICE` gains eight font families and HarfBuzz's and `bidi-js`' licences.
- A document can now carry a font Monstera embedded; a protected document's fonts are inside its encryption like any
  other object (ADR-0171).
- Office import, the composers and the editor see the same faces, and only the composers and the editor choose by this
  resolver's rule.

## Correction, 2026-10-05: a word no face carries whole, the licence bits, and a subset's notice

Three places where the code `0ab44edf` and `389cc010` built differs from the decision above, found by the stage audit
of `974df9f5..389cc010` (RRRRRRR-3, -12 and -14) and written here before the composers that build on them land.

**1. A word no face carries whole is split by grapheme, and only then.** Decision 1's step 6 drew every character the
word's face lacks as the box. Where another face carries one of those characters, that turns a character a face can draw
into a box, which the owner's principle *preserve, never drop* does not allow, and the owner's Q6 did not reach: it says
where a word goes when some face carries it, and that is unchanged. So step 6 becomes:

- a word goes whole to the first source that carries every character of it, as before;
- where no source does, the face carrying most of its characters draws what it carries, each **grapheme** it lacks goes
  to the first source that carries all of that grapheme, and only a grapheme no source carries is the box (Decision 8);
- the unit is the grapheme cluster (`Intl.Segmenter` with `granularity: 'grapheme'`), never the code point, so a base
  letter and its combining marks stay in one face where HarfBuzz can place the marks on it.

The sentence *a word is never split between two faces except by Decision 8* is withdrawn: it now reads *a word is never
split while one face carries all of it*. `389cc010` split by code point, and the composers' correction to grapheme comes
with the resolver's fixes.

**2. The licence bits follow the OpenType specification's own rule for more than one.** Decision 3 read each permission
bit alone. `fsType` bits 1 to 3 are one permission, and the specification says that where a font sets more than one the
**least restrictive** applies. So a face marked *preview and print* and *editable* is editable and is used, and one marked
*restricted* and *editable* is editable too; a face whose least restrictive bit is *preview and print* is skipped, the
owner's Q2, and one marked *restricted* alone is never embedded. `fontFaces.ts`' `embeddingOf` is that rule, the one
place it is written.

**3. A subset keeps its copyright notice and its licence.** `fontSubset.ts` rebuilt each subset's `name` table with the
family, full and PostScript names alone, so an embedded subset of an open font carried neither its copyright notice
(name 0) nor its licence (names 13 and 14). Keeping them is the direction that loses nothing, and it costs a few hundred
bytes a font: the rebuilt table keeps records 0, 13 and 14 as the face had them. Whether embedding a subset named
`TAG+Carlito-…` touches Carlito's Reserved Font Name stays the owner's question (the run's ledger, R3).
