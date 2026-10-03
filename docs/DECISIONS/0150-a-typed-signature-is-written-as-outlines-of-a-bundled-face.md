# ADR-0150 — A typed signature is written as outlines of a bundled face

- **Status:** Accepted
- **Date:** 2026-10-03
- **Decided by:** the owner, in the cloud-4 list, item 3c: *"About 15 fonts, roughly 80% handwriting/script/italic,
  picked from a dropdown that shows the typed name in each, plus a large preview. This changes a recorded decision
  (commands.ts SIGNATURE_FONTS), so ADR first. Route: ship OFL fonts, record each in NOTICE, and write the typed
  signature into the PDF as outlines (the same shape as a drawn one), so no font program and no subsetting goes into the
  document. Say what happens to characters a font cannot draw."*
- **Supersedes:** the decision recorded on `SIGNATURE_FONTS` in `packages/contract/src/commands.ts` (*"pdf-lib's
  standard fonts, so what is written is a name and not a font program"*), and
  [ADR-0133](0133-a-signatures-mark-is-drawn-once-for-both-writers.md) Decision 1's typed half (*"`F0`, a base-14 Type 1
  font in `WinAnsiEncoding`, for a typed mark"* and *"the typed mark's metrics are the base-14 fonts' own AFM data"*).
  ADR-0133's rule that one module draws a mark for both writers is kept and is what this builds on.

## The problem, in one sentence

A typed signature can only be set in four base-14 faces, none of which looks like handwriting, because the decision
that kept a font program out of the document did it by naming a font the reader already has — and a reader has no
script face to name.

## What was measured, 2026-10-03

- **The faces, from npm**: fifteen `@fontsource/*` 5.3.0 packages, each declaring `OFL-1.1`, each shipping its font
  as WOFF files split by script (`latin`, `latin-ext`, and for some `cyrillic`, `greek`, `vietnamese`). The fifteen
  chosen below come to **1,187 KB of WOFF** across their subsets at weight 400.
- **The parser**: `opentype.js` 2.0.0, MIT, with no dependencies. It reads every one of those WOFF files and answers
  each glyph's outline in font units, TrueType quadratics for all fifteen.
- **Its layout is not usable as it stands**: `font.getPath(text)` applies the font's substitution tables and threw on
  Great Vibes (*"lookupType: 6 - substFormat: 2 is not yet supported"*). Glyph by glyph — the font's own character map,
  each glyph's advance, and the font's pair kerning — reads all fifteen.
- **What an outline costs**: *Jonathan Smithson*, seventeen characters, is 1,355 points in Herr Von Muellerhoff and
  2,691 in Sacramento, counting one per line end and two per quadratic. The most complex single glyph in any face is
  514 points (Allura's *Ǆ*).

## Decision

1. **Fifteen faces, every one OFL, twelve of them script or italic.** Dancing Script, Great Vibes, Allura, Alex Brush,
   Sacramento, Parisienne, Pinyon Script, Mr Dafoe, Herr Von Muellerhoff, La Belle Aurore and Caveat (handwriting and
   script); EB Garamond Italic; and EB Garamond, Source Sans 3 and Courier Prime as the upright serif, sans and mono.
   They are npm dependencies of `packages/ui`, so `NOTICE` lists each from the lockfile like every other shipped
   package, and no font file is committed to this repository.

2. **The renderer makes the outline, from the face's bytes in the bundle.** Each subset is its own lazily imported
   chunk, as `cmaps.ts` bundles PDF.js's CMaps: `script-src 'self'` allows the chunk, and nothing is fetched, which
   `connect-src 'none'` would refuse. One module, `signatureFaces.ts`, owns everything the faces answer — which
   characters each can draw, the outline of a name, and the `FontFace` that shows the name in the dialog — so the
   preview and the page are set by the same glyphs (B3a). §9.27's policy is not changed.

3. **The outline crosses as a mark of its own, `outlined`, and the library keeps the name** (the operators' form is
   corrected below). A typed signature reaches
   `main` and the hosts as `{ kind: 'outlined', text, font, outline }`, where `outline` is a path: `ops`, a string of
   `M`, `L`, `Q`, `C` and `Z`, and `points`, a flat list of whole numbers on a grid of 32,767, y down, with the `frame`
   the face's line box (advance by ascender to descender) on the same grid. The library keeps `{ kind: 'typed', text,
   font }` as before: the outline is derived from the name and the face, and storing a derived value is a defect, so a
   kept typed signature is turned into an outline by the renderer each time it is placed, exactly as a new one is.

4. **The kernel draws the path, filled, and writes no font.** `signatureDrawing.ts` turns each quadratic into the cubic
   that is the same curve (PDF has no quadratic operator), fills with the nonzero rule both outline formats use, and
   fits the union of the frame and the ink into the box, so a swash past the advance is never cut. The drawing names no
   font resource, so neither writer writes one: no font program, no subsetting — which also keeps typed signatures off
   the font-subsetting path the advisory register watches.

5. **A character a face cannot draw is said, never drawn as something else.** The face's own character map decides
   (B3a: the font is the authority on what it can draw). The text is taken in NFC first, so an accent typed as a
   combining mark finds the face's precomposed letter. In the dialog, each face in the list that cannot write the
   name says so beside it, and choosing *Use Signature* with such a face says which characters it cannot write and
   points to Draw or Upload; nothing is placed. There is no silent fallback face and no empty box for a missing glyph.
   **The honest limit**: none of the fifteen draws Arabic, Hebrew, Chinese, Japanese or Korean, so a name in those
   scripts is signed by drawing it or uploading it. Cyrillic is drawn by Caveat, Great Vibes, EB Garamond (both) and
   Source Sans 3; Greek by EB Garamond and Source Sans 3; the other nine faces draw Latin alone.

6. **A kept signature in a face that no longer exists is kept, and shown in its nearest face.** The library on disk
   may hold `helvetica`, `times-roman`, `times-italic` or `courier`. Reading accepts them and maps each to Source Sans
   3, EB Garamond, EB Garamond Italic and Courier Prime, so no kept signature is dropped. Writing takes only the
   fifteen.

7. **The bound is in the shape** (its figure is corrected below): at most 12,288 points. A coordinate is at most five digits and a comma, so the
   points are at most 147,456 bytes and the operators 12,288, well under three quarters of the engine host's frame,
   where `hostRoutes.test.ts` holds every command it can measure. At the measured cost that is about seventy
   characters in the most complex face. A longer name is refused in the dialog with that reason, never thinned: a
   path cannot lose points the way a stroke can and still be the same letters.

## Rejected

- **The kernel or the engine host makes the outline.** The host would have to read font files, and what a contained
  host may read in a packaged install is ADR-0023 Decision 16's open question, measured as wrong once already. A font
  shipped inside the host's own bundle would be read by the host alone, while the dialog's preview needs the same
  bytes in the renderer — two copies of each face, and two places a face is decided.
- **`main` makes the outline.** `main` parses no fonts today, and the dialog would still need the faces for its list
  and preview, so `main` and the renderer would each read the same font: two opinions about which characters a face
  can draw.
- **Embed the font, subset to the name.** It is the route the owner ruled out, and font subsetting is the advisory
  register's watched path (a memory overwrite no MuPDF release fixes).
- **Flatten the curves to lines.** It needs more points for the same smoothness and is still not the curve the face
  draws; turning a quadratic into a cubic is exact.
- **Keep the outline in the library.** A derived value stored beside its source goes stale when the face is updated,
  and the kept list would be the only place where a signature looks different from the same name typed again.
- **Keep the base-14 faces as four of the fifteen.** A base-14 face has no outline we ship, so it would need the
  font-name route beside the outline route: two ways a typed signature is written.

## Consequences

- `@pdf-lib/standard-fonts` and `drawsInStandardFont` stop being part of the signature path; `main`'s check before the
  host is replaced by the renderer's, which is where the person can still change what they typed.
- The renderer's bundle grows by about 1.6 MB of base64 in fifteen sets of lazy chunks, loaded only when the Type tab
  opens or a kept typed signature is shown. The application's start does not load them.
- A typed signature in a document is a filled path. It is not searchable text, as a drawn one is not. That matches
  what it is: a mark, not a field value.

## Correction, 2026-10-03, before anything was built on it

Decision 3 said the operators cross as **a string** of `M`, `L`, `Q`, `C` and `Z`, and Decision 7 put the bound at
**12,288 points**. Both were wrong in the same way, and `hostRoutes.test.ts` said so the first time it read the
schema: it prices a string at a `\u` escape a character, six bytes, because that is what a string *can* cost, and read
the placing command at **297,806 bytes against 196,608**. The arithmetic in Decision 7 had priced the operators at one
byte each, which is what an honest encoder writes and not what the bound has to hold at.

So the operators cross as **small whole numbers**, `OUTLINE_OPS`' codes 0 to 4, two bytes each with the comma; a path
rule, `outlineOpsArePath`, says every subpath is a move followed by at least one line or curve, which caps the
operators at one and a half a point; and the bound is **10,240 points**. Points 122,880 bytes and operators 30,720,
under three quarters of the frame; about sixty letters at the measured 160 a letter. Nothing else in the decision moves.
