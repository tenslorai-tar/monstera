# ADR-0282 — Text to curves saves a new copy whose every letter is a shape

- **Status:** Proposed — not built. The owner approves the design first.
- **Date:** 2026-11-01
- **Requested by:** the owner, 2026-11-01: *a tool that turns every letter of a PDF into curves (outlined text), for
  printing and for sending a file whose look must not depend on fonts.*
- **Relates:** [ADR-0075](0075-pdfa-2b-is-ghostscripts-pdfwrite-and-what-it-removes-is-reported.md) (Ghostscript's
  `pdfwrite`, contained, and its removals reported), ARCHITECTURE §8's external-converter seam.

## The problem, in one sentence

A PDF whose letters are drawn from fonts can look different where those fonts are missing or substituted, and nothing in
Monstera today makes a copy whose letters are fixed shapes.

## What was measured

`scripts/research/textToCurves.mjs`, 2026-11-01, on six fixtures. The shipped Windows build could not run on the cloud
machine, so the behaviour was read from conda-forge's Linux build of the same Ghostscript, 10.08.0 (`hd2095e1_0`,
SHA-256 `8b414fd2…`), uncontained, and the shipped `gsdll64.dll` was checked (its pinned SHA-256 `ce99e646…`) to carry
the `NoOutputFonts` parameter beside `PDFACompatibilityPolicy`, which PDF/A already passes.

| fixture | time | size before → after | kept | lost |
|---|---|---|---|---|
| ordinary page (two standard fonts, not embedded) | 108 ms | 1.6 KB → 124 KB | everything drawn | the text |
| dense page (56 lines) | 461 ms | 3.7 KB → 946 KB | everything drawn | the text |
| Type 3 heading beside embedded subsets (`chromium-type3.pdf`) | 106 ms | 52 KB → 85 KB | the title | the text, the tag tree |
| a form: a text field, a ticked box, a list | 68 ms | 4.0 KB → 6.1 KB | what the fields show | the three fields and their widgets |
| a highlight, a note, a link, two bookmarks | 78 ms | 1.4 KB → 7.3 KB | all three annotations, the link's address, both bookmarks | the text |
| an attachment, a layer, a title, tags | 65 ms | 1.6 KB → 9.0 KB | the attachment, the layer, the title | the text, the tag tree |

- **No font is left** in any copy: no `/Type /Font` object anywhere in the file, annotation appearances included. No
  letter can be extracted from any copy.
- **The pages look the same.** Drawn by MuPDF at 300 dpi, no pixel differs by more than 192 of 255 levels; at most 0.283%
  of a page differs by more than 128 (the dense page); and of the pixels differing by more than 64, at most 0.1% sit inside
  a letter, the rest at its edge. So the difference is anti-aliasing, a letter drawn as a filled shape rather than as a
  glyph, and not a changed shape.
- **Ghostscript announces none of its removals.** On every fixture it printed its banner and the page count alone.
- **The form's fields go whatever the option**: plain `pdfwrite`, with no option at all, removes them too in this version.
  And they cannot stay fillable in any route: a field draws what a person types with a font, so a copy with no font has
  no field that can be filled.
- **MuPDF cannot do it in this build.** Its object model walks a page's glyphs (`Text.walk`), but its `Font` offers no
  glyph outline, and its writer constructor is withheld from the shim (invariant 23). A MuPDF route would need a new shim
  export for glyph outlines and a writer of our own for the paths.

## Decisions (proposed)

1. **One command, registered, never wired by hand:** `document.convert-text-to-curves`, titled *Convert text to curves…*,
   in the ribbon's Tools section beside *Export PDF/A* (its Convert group), shown where the document has pages. Its
   menu-bar and palette entries are the registry's projections of it.
2. **It always saves a NEW copy.** The person picks where, through the save picker, offered the open file's name with
   *(curves)* added. The open document is never written: its bytes and its session are as they were before the command
   ran, and a pick of the open file's own path is refused with the reason. When the copy is written, the person is offered
   to open it in a new tab.
3. **What the person reads before it runs**, in a dialog through the one `<Dialog>`, every string an i18n key:
   - Title: *Convert text to curves*
   - *Monstera will save a copy of this document where every letter is drawn as a shape. The copy looks the same and
     prints the same on any computer.*
   - *In the copy, the text can no longer be searched, selected, copied, edited or read aloud, and the file may be
     larger. Your document stays as it is.*
   - Where the document has form fields: *Its form fields become part of the page: what they show now is kept, and they
     can no longer be filled.*
   - Where it has tags: *Its reading order and tags are removed.*
   - Buttons: *Save a copy…* and *Cancel*.
4. **What is kept is counted, and a loss is said, never silent.** Because Ghostscript reports nothing, Monstera reads the
   document before and the copy after for: pages, annotations by kind, links and their addresses, bookmarks, attachments,
   layers, the title, form fields and tags. Every count that falls, except the fonts and the text that the command exists
   to remove, is told to the person when the copy is written, by name and number (*2 of 3 links kept*), in the result
   dialog ADR-0075's removals already use. Fields and tags, which are said before it runs, are said again only if the
   count differs from what was said.
5. **It runs as PDF/A runs**: Ghostscript's `pdfwrite` through §8's external-converter seam, under its own container,
   with fixed arguments and nothing of the document's choosing among them:
   `-dBATCH -dNOPAUSE -dSAFER -sDEVICE=pdfwrite -dNoOutputFonts -sOutputFile=<copy> -f <input>`. No new dependency:
   it is the Ghostscript already shipped for PDF/A.
6. **The proof** (`proof:texttocurves`, on the shipped build where Ghostscript runs, unverifiable elsewhere):
   - **no font left**: no `/Type /Font` object anywhere in the copy, appearance streams included;
   - **every page pixel-equal within the measured tolerance**, at 300 dpi: no pixel differs by more than 192 of 255 levels,
     no more than 0.5% of a page's pixels differ by more than 128, and no more than 1% of the pixels that differ by more
     than 64 sit inside a letter of the original;
   - **the original unchanged**: the document's bytes have the same SHA-256 before and after, and its session reads the
     same version;
   - **the report is true**: the counts said match the counts read from the copy;
   - **controls**: a copy written by plain `pdfwrite`, fonts kept, fails *no font left*; a copy with one word removed fails
     the pixel check; a run that writes over its input fails *the original unchanged*.
7. **The size is stated, never capped.** A page in fonts that are not embedded grew 77 and 257 times in the readings
   above, because every letter becomes a shape of its own; refusing a large copy would refuse the person for their
   document.

## Questions for the owner

1. **The form's fields become part of the page.** No route can keep them fillable without a font. Is that acceptable, said
   before it runs as above? (Recommended: yes.)
2. **The name.** *Convert text to curves* uses the owner's word; *Convert text to outlines* is the name some readers know.
   (Recommended: *curves*, the owner's word.)
3. **Whole document only, or chosen pages too?** (Recommended: whole document first; a page range can be added later as a
   setting of the same command.)

## Rejected

- **MuPDF, in place**: it would keep the document's own object graph, but it needs a new shim export and a path writer of
  our own, and it can keep fields fillable no better, since a field needs a font. Reconsidered if Ghostscript's removals
  prove too many on real documents.
- **Each page drawn as a picture**: no font, but the copy loses every vector edge, prints soft, and grows far more.
- **Keeping the fonts that form fields use**: the copy would then depend on fonts, which is the one thing it exists not to.
- **Writing over the open document**: the copy cannot be searched or edited, so replacing the person's file would lose
  what they cannot get back.

## Before it is built

The readings above are from a Linux build of the same version, uncontained. The shipped `gswin64c.exe`, contained as
PDF/A runs it, is measured with the same instrument on Windows first, and this ADR is corrected with what it reads.
