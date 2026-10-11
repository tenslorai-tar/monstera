# ADR-0226 — A form is filled under any picking tool, and designed in a mode of its own

- **Status:** Accepted
- **Date:** 2026-10-10
- **Amends:** [ADR-0168](0168-a-field-is-filled-where-it-is-on-its-page.md) Decision 1 (*the form layer sits under the
  drawing overlay*), [ADR-0193](0193-a-field-that-exists-is-changed-copied-and-ordered-by-three-commands-written-by-pdf-lib-with-formats-and-calculations-as-data.md)
  Decision 10 (*the field list is not widened*) and Decision 8 (*a copy goes onto other pages*), and the matrix row
  *Form fields: create*, which gains three kinds. The writer of every concern is unchanged: fill, delete and flatten
  are MuPDF's; create, properties, copies and order are pdf-lib's.
- **Decided by:** the owner's forms rebuild of 2026-10-10 (the requirements list, rows A1 to A8, and the answers to
  questions K1, K3, K5, K6 and K7), and the owner's answer of the same day: *a click on a form field fills it even while
  the comment Select tool is on, unless the click lands on a comment.*

## Context

The owner used 0.1.12.0 on their own form and could not fill it. Every forms test was green, and the forms code had not
changed since that build. The mechanism is in the layer order ADR-0168 Decision 1 chose: the form layer sits under the
drawing overlay, and the overlay is mounted whenever any tool is on. The comment Select tool is on Home's quick tools and
on the floating strip, nothing turns it off when a form opens, and while it is on every press on a field selects nothing.
The Hand tool's stylesheet takes the pointer from everything on a page. So filling worked only when no tool at all was
on, which is the one state the tests set up.

The rest of the rebuild needs facts the field list does not carry (whether a field is required, its length limit, comb,
format, whether a list takes several values), a list box that takes several values needs a fill that can say so, a
calculation has to be worked out while a person fills, and designing fields needs a place where a press moves a field
instead of filling it.

## Is this the right question

*How does a press reach a field under the Select tool?* The premise is that one layer must always be above the other.
It need not: which of the two takes a press depends on what is under the pointer, and the tool is the thing that knows
whether it picks or draws. So the question becomes *which tools pick*, and that is a property of the tool, registered
with it.

## Decision

1. **A tool may declare that a press on a field fills it** (`UiTool.fillsFields`). The comment Select tool declares it.
   While such a tool is on, the form layer is mounted above the drawing surface, and each field takes the press only on
   the part of it no comment covers: the comments are subtracted from the field as rectangles, and the pieces left are
   the field's press area (`fieldPressArea`). A clip with one hole per comment is rejected because two overlapping
   comments fill their overlap again under either fill rule. A drawing tool does not declare it and keeps every press.
2. **The Hand tool fills too.** A press that starts on a field fills it; a drag that starts anywhere else moves the
   pages.
3. **The caret opens where the field was pressed**, measured from the press against the text shown, and the field's
   other keys are a text box's: Tab and Shift+Tab move to the next and previous field that can be filled, in the walk's
   order across pages, Enter fills a one-line field, Escape keeps the field as it was.
4. **The field list carries what filling needs, and only bounded scalars** (amends ADR-0193 Decision 10, whose reason was
   a tooltip per field and still holds for it): `required`, `maxLength`, `comb`, `password`, `multiSelect`, `editable`
   (a dropdown that takes typing), `calculated` and `format`, the parsed format of `fieldActions.ts` or `null`. The
   tooltip stays in `document.formFieldProperties`.
5. **A list box that takes several values is filled by a list** (`set: 'choices'`), written by MuPDF as the field's
   `/V` array and `/I` indices on the dictionary that holds `/T`, with its appearance regenerated. Measured 2026-10-10:
   written on the widget of a field pdf-lib made, the array is not where readers look; written on the field, pdf-lib reads
   both values back.
6. **A fill works out the form's calculations in the same command.** After the value lands, every calculation this
   application can read (`AFSimple_Calculate`, ADR-0193 Decision 6) is evaluated in the form's calculation order (`/CO`)
   and each result is written by MuPDF as that field's value. So a fill and the totals it changes are one undo step. A
   calculation written by another program is a script, is never run, and its field keeps its value (invariant 24).
7. **Designing is a mode in the one tool slot**, as Edit text and Edit object are: *Edit fields*. In it every field is a
   box with its name; a press selects, a drag moves, eight handles resize, arrow keys nudge by one point (Shift: ten),
   Delete removes, Ctrl+C and Ctrl+V copy and paste, Ctrl+D duplicates, a drag on empty paper selects several. Every
   one of these is an existing command: a move, a resize and an align are `editFormFields` with a `rect`, a delete is
   `deleteFormFields`. Choosing any field tool enters the mode; Escape or *Edit fields* again returns to filling.
8. **A copy may land on its own page** (amends ADR-0193 Decision 8): `duplicateFormField` takes, instead of a page set,
   one place on one page, which is how a paste and a duplicate are written. It is still a new field with a unique name.
9. **A press places a field; a drag sizes it.** A click places the kind's default size at the press (text 180 by 20
   points, tick box and radio 12 by 12, dropdown 150 by 20, list 150 by 60, button 80 by 24, signature 180 by 40, date
   100 by 20), and a drag smaller than the kind's minimum gets the minimum. The new field is selected in *Edit fields*
   with its properties open, and the tool is put down unless a double click kept it.
10. **A new field is named by its kind**, *Text1*, *Check Box1*, *Group1*, *Dropdown1*, *List1*, *Button1*,
    *Signature1*, *Date1*, the first number the form does not hold (`nextFieldName`, in `shared`, beside the clash rule
    it takes). There is no name box and no dialog; the name is changed in the Properties panel.
11. **A radio is one press per option.** The first starts a group, *Group1*, with option *Choice1*; each next press
    joins the group with the next option until Escape or another tool.
12. **The writer draws the agreed default look** (the owner's K5): a 1 point dark border on every new field, and a white
    fill on a tick box and a radio. A new tick box and a new radio are off.
13. **`createFormField` makes three more kinds:** a push button, a signature field (`/FT /Sig`, built from the
    dictionary because pdf-lib has no factory for one) and a date field (a text field carrying a date format, written
    by `fieldActions.ts`).
14. **Detect reads the current page, and its preview offers *All pages*** (the owner's K7). Accepting the proposals of
    every page is one decision, so it is one `createFormField`: a placement may name its own page, and one that names
    none goes on the command's. This amends `createFormField`'s *"a per-field page would be a different feature nobody
    asked for"*; K7 asks for it. A detected small circle is a radio, and the circles of one row are one group named by
    the words left of the first.
15. **A tab order is the order of a page's widgets in its `/Annots`** (amends ADR-0193's tab order, the owner's H1).
    `setTabOrder` puts the widgets in that order as well as setting `/Tabs`: by rows (top to bottom, then left to
    right), by columns, or in an order a person gave by clicking the fields one after another. The Tab key on the page
    follows the widget walk, which is `/Annots`' order, and so does every reader that ignores `/Tabs`; a `/Tabs` alone
    changed only the readers that read it, and this application's Tab was not one of them. A given order is the fields
    of one page, named by their handles; the fields not named follow them in the order they had.

## Rejected alternatives

- **The form layer always above the drawing surface.** Every drawing tool would lose every press that landed on a
  field, so a person could not draw a comment over a form.
- **The Select tool hit-testing fields itself.** It would be a second opinion about what can be filled, which is
  `fieldFill`'s (ADR-0168 Decision 2).
- **A clip with a hole per comment.** Two overlapping comments fill their overlap again, under `evenodd` and `nonzero`
  alike.
- **Reading the format and the flags per field on demand.** A field's rules are needed at the press, before any read
  could answer; a read per press would make the caret wait on the host.
- **Running a document's own calculation scripts.** Invariant 24.
- **A name box beside a new field, or a dialog.** The owner's K1.
- **One create per page when Detect runs on all pages.** Undo would take back one page of a decision made once.
- **Tab following `/Tabs` by sorting at the press.** Two orders would then exist, ours and the file's, and a reader
  that ignores `/Tabs` would still walk the old one.
- **A new command for a given order.** It is the same concern on the same writer; `setTabOrder` takes the order as
  one of its values.
