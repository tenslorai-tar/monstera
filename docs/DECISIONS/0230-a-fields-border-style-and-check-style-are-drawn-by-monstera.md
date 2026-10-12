# ADR-0230 — A field's border style and check style are drawn by Monstera

- **Status:** Accepted
- **Date:** 2026-10-12
- **Amends:** [ADR-0229](0229-a-form-field-in-a-real-font-has-an-appearance-monstera-draws.md) (the step that draws a
  field's value is also what draws its border where the style is not solid) and
  [ADR-0193](0193-a-field-that-exists-is-changed-copied-and-ordered-by-three-commands-written-by-pdf-lib-with-formats-and-calculations-as-data.md)
  (the properties an edit may name gain a border style, a check style and a validation range).
- **Decided by:** the owner's A3.1: *border style, check style and Validate in a field's Properties*.

## What was measured

Throwaway cases on 2026-10-12, MuPDF 1.28.0 and `@cantoo/pdf-lib` as pinned:

| the field | what is drawn |
|---|---|
| a text field with `/BS /S` set to `/S`, `/D` (with `/D [3]`), `/B`, `/I` or `/U`, redrawn by MuPDF | the same solid rectangle for all five (`2 w 0 0 0 RG 1 1 150 25 re s`) |
| the same, redrawn by pdf-lib's own appearance provider | a solid rectangle: the provider reads the width alone |
| a tick box with `/MK /CA` set to each of ZapfDingbats' `4 l 8 u n H` (check, circle, cross, diamond, square, star), drawn by pdf-lib | one fixed check-mark path for all six |
| the same tick boxes toggled and updated by MuPDF | the appearance pdf-lib drew, unchanged: MuPDF does not redraw a button on a toggle |
| a text field with no `/MK /BC`, its empty value redrawn by MuPDF | the background and the inset clip, and no border |

So neither engine draws a border style or a check style; both store them and draw a solid border and one check.

## Decision

1. **The style is the file's own keys**, written by pdf-lib's edit, the field-style writer: `/BS /S` (and `/D [3]` for
   dashed) for the border, `/MK /CA` with the ZapfDingbats character Acrobat writes for the check. A reader that draws
   its own reads the same keys.
2. **A text field or a dropdown whose border is not solid is drawn by ADR-0229's step**, the one that draws a value in a
   real family: before the redraw's update the border colour is lifted with the value, so MuPDF's base is the
   background and the inset clip alone, and after it the border is drawn by its style and the words in the field's
   family or, with none, in the standard face `/DA` names, by the same typesetter. So the step's condition is *the field
   carries a family or a border that is not solid*, and every route that redraws a field takes it.
3. **A tick box and a radio button are drawn by an appearance provider of Monstera's**, handed to pdf-lib where the edit
   draws them: the box and its border by style, and for *on* the check style as a vector shape in the text colour, no
   font. MuPDF never redraws a button (measured), so the edit is its only writer.
4. **A list box and a push button keep a solid border**, so their Properties offer none: the panel offers what is drawn.
5. **Validate is a number range, data and never run** (invariant 24): `AFRange_Validate(...)` in `/AA /V`, as a format is
   `/AA /F` (ADR-0193), read back by the one parser beside the format's, and checked by Monstera's own fill check, which
   says what is expected and fills what was typed (ADR-0226 Decision 4). A script it did not write is kept and shown as
   a script.

## Rejected

- **Leaving the style to the engines.** Both draw solid (measured), so the control would store a key and change nothing
  a person sees: a control that does nothing.
- **ZapfDingbats glyphs for the checks.** pdf-lib's provider returns operators and no resources, so a font would have to
  be added to every button's appearance by hand; six vector shapes need none.
- **A second step for borders beside ADR-0229's.** Both replace MuPDF's drawing of a text field after the same updates;
  two steps would be two opinions about one appearance (B3a).
