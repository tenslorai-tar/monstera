# ADR-0193 — A field that exists is changed, copied and ordered by three commands written by pdf-lib, with formats and calculations as data

- **Status:** Accepted
- **Date:** 2026-10-07
- **Amends:** `docs/ARCHITECTURE.md` §3's writer matrix row *Form fields: create* (pdf-lib), which gains the three
  operations on a field that already exists. Fill, delete and flatten stay MuPDF's.
- **Relates:** [ADR-0041](0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md) (a handle is a place in a
  walk at one version), invariant 24 (opening a document runs none of its content).
- **Context:** The owner's Part C, forms rebuild. Every forms tool has to work as PDF-XChange Editor's does, and its
  Properties pane changes a field after it exists: name, tooltip, required, read-only, default value, face and size, border
  and fill, choices, a format, a calculation, and where the field is. The owner also asked for align, same size, duplicating
  a field across pages and a tab order. None of this can be registered into an existing seam: `createFormField` makes a
  field and `fillFormField` sets a value, and nothing changes the dictionary of a field that is already there. Written
  2026-10-07.

## Is this the right question

*Which writer sets a field's properties?* The premise is that one of the two form writers must own the whole of it. They do
not: MuPDF has setters for a value and a handful of flags, and no way to write a border, a fill, a default appearance, a
list of choices or an action. pdf-lib has all of them, is already the writer of *create*, and writes a field's dictionary
directly. So the matrix row is split by the property it writes, and the one place the two meet is a **default** value,
which is `/DV` (pdf-lib's) and never `/V` (MuPDF's, the fill).

A second question hides inside the first: *does a format need a script engine?* A format is `AFNumber_Format(2, 0, 0, 0,
"£", true)` and a calculation is `AFSimple_Calculate("SUM", new Array ("a", "b"))`, which every reader understands because
they are the actions Acrobat itself writes. They are JavaScript to a reader and data to us.

## Decision

1. **Three commands, `editFormFields`, `duplicateFormField` and `setTabOrder`, written by pdf-lib** (`formFieldEdit.ts`),
   registered into the spec tables beside `createFormField` and routed to the same host channel.
2. **`editFormFields` is a list of edits, each a handle and the members it sets.** Every member is optional and one that is
   present is set, so a change is the members it names. One gesture on ten selected fields is one command and one undo step,
   and align and same size are the same command with a `rect` for each.
3. **Many fields with the shared members, or one field with any** (the union `createFormField` has, for its reason). The
   product of 256 edits and the two lists (choices, a calculation's fields) was 260 MB at its worst (measured 2026-10-07,
   `hostRoutes.test.ts`) against an 8 MiB route. The shared shape omits the two lists and bounds a default value at 512
   characters.
4. **A handle is a position and a name** (`targets: 'field'`). The widget is found by its place in the page's widget walk,
   and the field that owns it must still carry the name that was read, so a walk that moved is refused and never edited.
5. **Only what changes how a field looks regenerates its appearance.** A face, a size, a border, a fill, a box, a list of
   choices and multiline regenerate that field's appearance and no other's; a tooltip, a flag, a default and a format leave
   the stream byte for byte. The reader's automatic size (`0`) stays automatic, since pdf-lib writes the size it fitted.
6. **A format and a calculation are DATA, written and read by one module** (`fieldActions.ts`). The writer emits exactly
   the grammar above; the reader is a parser that accepts exactly that grammar and nothing else. A script it does not
   recognise is **kept untouched and reported as a script** (`customFormat`, `customCalculation`), and *none* removes only
   a format or calculation this application wrote. No script is run here or anywhere (invariant 24): a value is formatted
   by this application's own code where the application shows it, and by the reader's own where a reader shows it.
7. **A radio group's choices are its `/Opt`, by position;** a group with none has its widgets' state names renamed, with
   the value and each widget's state moving with them. Two options with one value, and a count that is not the group's,
   are refused.
8. **A copy is a new field.** `duplicateFormField` puts a copy of one field on each named page at the same place, named
   `name_p2` and made unique, starting empty (its default travels). A second widget with the SAME name would be another
   place for the one field and would show one value everywhere. A radio option and a signature are not copied.
9. **An encrypted document is refused in words.** pdf-lib cannot read one and throws, which crosses the engine host's
   boundary as an unexplained failure. The edit reports `encrypted` under its own code, and nothing is written.
10. **The properties are read through MuPDF** (`formFieldRead.ts`, `document.formFieldProperties`), in the shape an edit
    writes them back in, so a value read is one an edit can send. The field list is not widened for it: its answer is
    bounded by the smallest field, and a tooltip per field would put its worst case past the answer ceiling.

## Rejected alternatives

- **A script engine to evaluate formats and calculations.** Invariant 24 forbids running a document's content, and an
  embedded interpreter is the thing the shim is asserted not to link. Rejected.
- **Widening `fillFormField` to carry properties.** A fill is MuPDF's and carries a value; folding dictionary edits into it
  would make two writers answer one command.
- **One command per property.** Eleven commands, eleven undo steps for one gesture on a selection, and the rect of an
  align would need a different command from the colour of a border.
- **Setting `/V` from a default value.** A default is what a field returns to; writing it as the value would fill the
  field, which is the fill's concern and MuPDF's.

## Limits stated now

- A choice field written with `/Opt` pairs (export and display) is read by its export values and written as plain
  strings, so editing its choices drops the display text. The Properties pane sends choices only when a person changes them.
- A rename cannot move a field into another group. A name that would is refused (`name-parent`) rather than made a parent.
- A copy onto a page of another size or turn keeps the rectangle's numbers.

## Correction, 2026-10-07: the three limits above are withdrawn

The owner's principle is *preserve, never drop*, and none of the three could stay as a stated limit.

- **Choices keep both halves.** An edit's and a read's choice is a string where the value and the text shown are the same
  and a pair where they are not, written back as `/Opt` pairs. The Properties pane has a second box, *Stored values*, aligned
  by line with *Choices*. A radio group has no text apart from its value, so a pair for one is refused by name
  (`options-radio-labels`). Found on the way: a FILL stored the text where the file holds the value (`/V` is the export
  value, ISO 32000-1, 12.7.4.4); a fill now stores the value and a value another program stored reads as its text.
- **A rename moves the field.** `a.b` renamed `c.b` is the field under the group `c`, made if there is none; the groups the
  field leaves empty are taken out, what it inherited from them is written onto it first, and a calculation of ours that
  names it follows the new name. `name-parent` now means a name with an empty part. A name another field holds, or runs
  through, is still `name-taken`.
- **A copy lands at the same place.** `fieldPlacement.ts` reads the rectangle as a fraction of the page as seen (crop box,
  turned by `/Rotate`), keeps the size in points, and moves the copy inside the page it lands on.
