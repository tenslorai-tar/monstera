---
id: change-form-fields
title: Change a form field
summary: Rename, restyle, format, calculate, align, copy and set the tab order of the fields you have drawn.
keywords: [field properties, rename field, tooltip, required, read only, default value, font, border, fill, number format, date format, calculation, align fields, same size, copy field, tab order]
commands: [forms.arrange.align-left, forms.arrange.same-size, forms.copy-to-pages, document.tab-order]
contexts: [dialog.field-copy, dialog.tab-order, forms]
---
Every field has properties you can change after it is drawn: its name, what it looks like and how it behaves.

## Steps

1. In the rail, choose **Forms**, then open the **Fields** list and click a field. It is outlined on the page.
   - Press **Ctrl** and click to add another field, or **Shift** and click to take a run of fields. **Esc**, or a click on empty page, selects nothing.
2. Open the **Properties** tab. It shows the first field you selected, and every change you make applies to all the fields selected.
3. Change what you need. Each box takes effect when you leave it, and each change is one step you can undo.

## What you can change

- **Name** (one field at a time), **Tooltip**, **Required** and **Read only**. A dot in a name makes a group, so renaming "a.b" to "c.b" moves the field under the group "c", which is made if the form has none. A group left empty is taken away, and a calculation Monstera wrote that adds the field up follows its new name. A name another field already has, or runs through, is said in the name box and not sent.
- **Default value** for a text field, dropdown or list box.
- **Font**, **Size (0 is automatic)**, **Border colour**, **Border width** and **Fill colour**. Choose **None** to take a colour away.
- **Several lines** for a text field.
- **Choices** for a dropdown, a list box or a radio group, one on each line. For a radio group these are the values of its options in the order they sit.
- **Stored values** for a dropdown or a list box, when the document keeps something other than the text people read. Each line belongs to the choice on the same line above, and a line left empty keeps the choice itself. Changing a choice's text keeps what is stored for it.
- **Format**: a number (decimal places, separators, negative numbers and a currency sign), a percentage, a date or a time.
- **Calculation**: the sum, product, average, smallest or largest of other fields you name, and where it falls in the calculation order.

## Line up and copy

- With two or more fields selected, the foot of the **Properties** tab offers **Align left edges**, **Align right edges**, **Align tops**, **Align bottoms**, **Centre across the first field** and **Centre down the first field**, and also **Same width as the first field**, **Same height as the first field** and **Same size as the first field**. Fields already where you ask are left alone.
- With one field selected, **Copy to other pages…** puts a copy at the same place on the pages you type. On a page of another size the place is the same fraction of the page, and the copy is kept inside it. Each copy is a new field with its own name and starts empty. A radio option and a signature cannot be copied alone.
- In the **Forms** section, **Tab order…** chooses how the Tab key moves through the form: across each row, down each column, or in the order the document was made. It is set on every page.

## Good to know

- Formats and calculations are written the way other PDF programs write them, so they work there too. Monstera works them out itself and never runs a script from a document. A script it did not write is kept as it is and the pane says so.
- A name another field holds is said in the name box and not sent.
- Fields in an encrypted document cannot be changed, and Monstera says so.
- Undo any of it with **Ctrl+Z**.
