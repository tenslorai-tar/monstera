# ADR-0229 — A form field in a real font has an appearance Monstera draws

- **Status:** Accepted
- **Date:** 2026-10-11
- **Amends:**
  [ADR-0211](0211-a-text-box-with-styled-words-has-an-appearance-monstera-writes-itself.md) (the appearance Monstera writes
  itself, until now a text box's alone) and
  [ADR-0228](0228-the-formatting-set-is-whole-in-both-text-writers-and-a-tab-is-a-marked-gap.md) Decision 3 (real fonts,
  until now a text box's alone): both now reach a form field's value.
- **Decided by:** the owner's instruction of 2026-10-11, A8.4: *a form field drawn in its chosen real font through the
  same writer. The picker must offer only what the writer can draw.*

## What was measured

A throwaway case on 2026-10-11, MuPDF 1.28.0 (the shim) and the bundled Carlito, on a text field made by pdf-lib:

| the field | what MuPDF's widget update draws |
|---|---|
| `/DA (/Helv 14 Tf 0 g)`, the control | `/Helv 14 Tf (Hello) Tj`, a Helvetica resource |
| `/DA (/FCarl 14 Tf 0 g)`, `/FCarl` in `/AcroForm /DR` as Carlito, simple TrueType, WinAnsi (`addSimpleFont`) | `/Helv 14 Tf`, a Helvetica resource: the named font is not used |
| the same, Carlito as a whole CID font (`addFont`) | the same: Helvetica |
| an empty value | `/Tx BMC q` the background, the border and the clip, an empty `BT 0 g 2 11.3 Td ET`, `Q EMC` |

So MuPDF draws a field's value in its three `/DA` faces alone, as it draws a FreeText's (ADR-0211's own measurement):
naming an embedded real font in `/DA` is stored and painted in Helvetica. And pdf-lib, which creates and edits fields
here, embeds a font file only through fontkit, which this repository does not install
(`@cantoo/pdf-lib` lists it as a development dependency).

## Decision

1. **A field's real family is a fact of the field**, the private `/MonsteraFamily` string on the field dictionary,
   written by the writer that already owns the field's style: pdf-lib's create and edit commands, beside the `/DA` they
   already write. `/DA` keeps the base 14 nearest the family (ADR-0228 Decision 3's `daFaceOf` rule, one function for
   both), so a reader that regenerates the appearance itself, as another reader does while a person types, draws that
   face: the text box's behaviour exactly.
2. **Its appearance is Monstera's, drawn by the text box's typesetter** (`textBoxStyle.ts`' typesetters and
   `TextBoxFaces`), so the face is embedded as a subset and every character it lacks goes to the resolver as a text
   box's would: ONE way words are set in a real font. The base is what MuPDF draws for an empty value (the background,
   the border, the clip, all from `/MK` and `/BS` as MuPDF reads them, so no second opinion on borders exists), and the
   value is drawn inside it, before its closing `Q EMC`, where a reader's own editing looks for variable text.
3. **One finishing step, `refaced`, runs wherever a field can be redrawn:** in `redrawn` (`pageAnnotations.ts`), the
   step every MuPDF redraw already ends with, beside `restyled` for text boxes, which covers a fill, an import of field
   data, a calculation and a reset; and after pdf-lib's own field commands, which run in the same host process as MuPDF:
   `applyPdfLibImage`'s result is opened in MuPDF and finished there when, and only when, the command touched a field
   carrying the marker. One composed function serves the host and the in-process engine, so a test and the product take
   the same route (B3a).
4. **What it draws:** a text field's value on one line (vertically centred), on several (wrapped, from the top), or in a
   comb's cells, and a combo box's chosen value, each in the field's size, colour and alignment. **A list box, a check
   box, a radio button and a push button are not drawn by it**, so their pickers offer the standard faces alone: the
   picker offers only what this writer draws (Decision 5).
5. **The picker offers what the writer can draw, decided once.** A field kind this writer draws is offered the same
   families a text box is (`fontFamilies`, with the faces whose licence forbids embedding marked as a text box's are),
   and the others the three standard faces. The kernel refuses a family on a kind it does not draw, so a stale renderer
   cannot set what nothing draws.

## Consequences

- A field in a real font looks the same in Monstera, in a saved copy, in a print and when flattened, since all of them
  read the appearance. Typed into in another reader, it is drawn by that reader in the `/DA` face, as a text box is.
- A pdf-lib field command on a document with a marked field pays one MuPDF open and save of the result; a document with
  none pays nothing, decided from the field the command named before anything is opened.
- `/MonsteraFamily` is private and harmless to other readers, `/MonsteraStyle`'s argument (ADR-0211).

## Rejected

- **A whole real font in `/DR`, named by `/DA`, and MuPDF left to draw.** Measured above: MuPDF draws Helvetica. And
  the whole file of a real font can be megabytes in every document that names it.
- **fontkit for pdf-lib.** A second way to set words in a real font beside the text box's typesetter, with its own
  shaping (none for joined scripts) and metrics: two opinions about how a field's words look (B3a), and a new dependency
  to research and pin.
- **Moving field creation and editing to the MuPDF writer.** About 1,300 lines of pdf-lib field code ported for the
  same appearance this decision draws, and a writer-of-record change for every field property, not only the font.

## Correction, 2026-10-13: the faces whose licence forbids embedding are left out, not marked (the owner's N12)

Decision 5 offers a drawn field kind the text box's families *"with the faces whose licence forbids embedding marked as a
text box's are."* Since the owner's N12 the one picker marks nothing: such a face is **not listed**, for a text box and so for
a field (ADR-0211's correction of the same date). The decision's rule, *the picker offers what the writer can draw, decided
once*, is unchanged and is now stricter: a face the writer would only replace is not offered.
