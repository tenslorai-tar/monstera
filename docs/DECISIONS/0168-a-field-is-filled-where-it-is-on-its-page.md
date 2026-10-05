# ADR-0168 — A field is filled where it is on its page, by the application's own controls, through the panel's rules

- **Status:** Accepted
- **Date:** 2026-10-05
- **Amends:** `docs/ARCHITECTURE.md` §3.2's *"PDF.js is never a source of truth. It renders. The renderer's annotation
  and form models come from the kernel via the view model"*, by naming how a field is filled on its page and that
  PDF.js's own form layer is not how. Keeps `document.formFields`, `fillFormField` and its undo, the Forms panel, and
  ADR-0167's link layer beneath it.
- **Decided by:** the owner's list for 0.1.10.0, item 14h: *"CLICK A FORM FIELD ON THE PAGE TO FILL IT (F1): text,
  tick box, radio, dropdown, list box. Forms panel stays."*

## Context

A form is filled only from the Forms panel. Its rows are the document's fields with a control each, a fill is
`fillFormField` named by page, walk index and the version the list was read at, and the kernel refuses what the
document forbids. On the page a field is the appearance PDF.js draws into the canvas, and pressing it does nothing.

Two facts decide the shape:

- **The drawn appearance is the document's.** Measured 2026-10-05 on a pdf-lib form: after a fill, the bytes `main`
  serves carry a regenerated appearance (the text field's stream draws *Grace Hopper*, the tick box's `/AS` is `Yes`,
  the dropdown's stream draws *Ms*). So a fill on the page shows on the page when it redraws, with nothing drawn by
  the renderer.
- **The panel already decides what may be filled and how,** and one of those rules was wrong until the commit before
  this one: a one-line input stripped a value's line breaks and the blur wrote them away. A second set of controls
  that decided for itself would be a second opinion about the same field (B3a), and the next fix would land in one.

## Decision

1. **A form layer over each visible page** puts a control over the rectangle of each field that can be filled, read
   from `document.formFields` at the version on show and placed through the page's transform, as the annotation and
   link layers are. It sits above the text and link layers and below the drawing overlay: a drawing tool holds the
   page, and with none on, a press on a field fills it.
2. **What can be filled, and how, is one function with two callers.** `fieldFill` answers, for one listed field, what a
   person may do with it: type into it (on one line, or with line breaks), set it on or off, choose one of its options,
   or nothing, with the reason. The panel and the page both render from that answer, so a read-only field, a signature,
   a push button, a value listed as a slice, and a choice holding several values are refused by both or neither.
3. **At rest the page shows the document's own appearance**, and the layer draws nothing over it but an edge on hover
   and on focus. A tick box or a radio is filled by the press. A text field opens its editor over the field at the
   press: a box on the paper sized to the field, holding the value, committed by leaving it or by Enter on one line,
   kept as it was by Escape, and measured against what it showed so a press that edits nothing sends nothing. A
   dropdown or a list box opens its options at the field, and choosing one fills it.
4. **A field nobody can fill here has no control on the page.** The Forms panel says why; a control that renders and
   does nothing is the defect the wired-tools rule names.
5. **Each control is named by the field's own name and kind**, the panel's accessible name, and the layer's controls
   follow the page's walk order, so the keyboard reaches a form's fields as the document lists them.

## Rejected

- **PDF.js's form layer** (`AnnotationMode.ENABLE_FORMS`). It draws its own controls from the widgets and keeps what is
  typed in its `annotationStorage`, a second store of values the document does not hold, which is §3.2's rule broken
  by a flag.
- **Inputs drawn over every field at all times.** The value would be drawn twice, by the appearance and by the input,
  in different fonts and places, and a value typed and not yet committed would look filled.
- **A click that opens the Forms panel at the field's row.** The owner asked for filling on the page; the panel stays
  beside it.
- **Controls of the page's own that decide what can be filled.** They would agree with the panel until a document
  disagreed, as the line-break defect did with the document.
