# ADR-0231 — A list box's options are drawn by Monstera

- **Status:** Accepted
- **Date:** 2026-10-12
- **Amends:** [ADR-0229](0229-a-form-field-in-a-real-font-has-an-appearance-monstera-draws.md) and
  [ADR-0230](0230-a-fields-border-style-and-check-style-are-drawn-by-monstera.md) (the step that draws a field's value
  after MuPDF's update also draws a list box's options and its chosen ones).
- **Decided by:** the owner's A6.1: *flatten the filled form and check nothing drawn is lost; fix the mechanism if it is*.

## What was measured

The owner's three-page test form, filled through `applyFillFormField` and flattened with `bake(false, true)`, on
2026-10-12, MuPDF 1.28.0. Rendered at 2× before and after the flatten, every page is pixel-identical and no widget
remains: borders, comb cells, radio circles and ticks all survive the bake. One field did not survive the FILL:

| the list box *Interests*, seven options | its normal appearance |
|---|---|
| as the document arrived (drawn by pdf-lib) | the frame and all seven options, `Reading` to `Photography` |
| after a fill of one choice (`setChoiceValue`, which marks the widget) and a save, whose redraw is MuPDF's | `BT 0 0 0 rg 2 84 Td ET`: the frame and an empty text block, **no option at all** |
| after a fill of several choices (`/V` and `/I` written through the object, nothing marked) and a save | pdf-lib's appearance unchanged: every option, and the new choices **not shown** |

So MuPDF's appearance writer draws a list box with no options, and the first fill of a single-choice list box empties
it on the screen, in print and, once flattened, in the page itself. The second route keeps the options and shows none
of what was chosen. Neither is what a reader that draws its own list shows.

## Decision

1. **A list box is always drawn by ADR-0229's step**, whatever its family or border: MuPDF's update draws the base (the
   background, the border and the clip, from `/MK` and `/BS`), and the step then draws the options over it. The step's
   condition becomes *the field carries a family, or a border that is not solid, or it is a list box*, and both
   `setAside` and `drawnByMonstera` read that one condition.
2. **What is drawn:** each option's text as the document lists it for people (the second member of an `/Opt` pair),
   one line each, from the top index `/TI` down, in the standard face `/DA` names and its size (12 where it says 0),
   aligned by `/Q`, clipped to the box. A chosen option, by `/I` where the file has it and otherwise by `/V`, is laid
   on pdf-lib's own highlight, `rgb(153, 193, 218)`, the full width of its row. The line pitch is 1.11 times the size,
   pdf-lib's for Helvetica (measured on the form: 11.1 for 10 pt), so a list pdf-lib drew keeps its rows where they were.
3. **Options the typesetter cannot set** (only possible where the bundled faces are not bound, which a host always binds)
   leave the list to the engine, as a value does under ADR-0229: never emptied for words nothing then draws.
4. **Both fill routes take the step**: the single choice through `redrawFamily`, which now redraws a list box, and
   several choices through `setChoices`' own `redraw`. A pdf-lib edit of a list box is followed by the step as every
   edited field is (`pdfLibFieldFaces.ts`).

## Rejected

- **Writing `/V` for a single choice through the object, as several are, so MuPDF never redraws.** It keeps pdf-lib's
  appearance, which shows no choice: the measured second route. A filled form that does not show what was filled is
  the defect in another place.
- **Keeping the appearance the document arrived with.** It shows the choices someone made before, not the ones made
  now, and an appearance drawn by another program for different options would be kept over a change of them.
- **pdf-lib's provider at fill time.** The fill runs in the MuPDF host on MuPDF's document; a second library opened on
  the session's bytes for one field is a second writer of one appearance (B3).
