---
id: change-form-fields
title: Change a form field
summary: Rename, restyle, format, calculate, align, copy and set the tab order of the fields you have drawn.
keywords: [field properties, rename field, tooltip, required, read only, default value, font, border, border style, check style, validate, fill, number format, date format, calculation, align fields, same size, copy field, tab order]
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
- **Font**, **Size (0 is automatic)**, **Text colour**, **Border colour**, **Border width** and **Fill colour**. Choose **None** to take a border or fill colour away.
- A text field or a dropdown can use any font in the list, from this computer, from Monstera or already in the document: Monstera draws what the field shows in it, and it stays in that font when the field is filled, printed or flattened. Another app that redraws the field while someone types in it uses Helvetica, Times or Courier, whichever is closest. A list box, a tick box and a radio button use Helvetica, Times or Courier.
- **Border style** for a text field, a dropdown, a tick box or a radio button: solid, dashed, bevelled, inset or underline. A list box and a button keep a solid border.
- **Check style** for a tick box or a radio button: a check, a circle, a cross, a diamond, a square or a star. It applies to every option of a radio group.
- **Validate** for a text field: the least and the most number it takes. Leave one empty for no limit on that side. When someone fills the field with a number outside it, Monstera says so and keeps what they typed.
- **Several lines**, **Check spelling** for a text field; **Allow typing** for a dropdown; **Allow several** for a list box.
- **Choices** for a dropdown, a list box or a radio group, one row each. **Add a choice** adds one, **Sort A to Z** sorts them, and each row has buttons to move it up or down and to remove it. For a radio group these are the values of its options in the order they sit.
- Beside each choice of a dropdown or a list box, what the document stores for it, when that is something other than the text people read. Leave it empty to keep the choice itself. Changing a choice's text keeps what is stored for it.
- **Format**: a number (decimal places, separators, negative numbers and a currency sign), a percentage, a date or a time.
- **Calculation**: the sum, product, average, smallest or largest of other fields you name, and where it falls in the calculation order.

## Line up and copy

- With two or more fields selected, the foot of the **Properties** tab offers **Align left edges**, **Align right edges**, **Align tops**, **Align bottoms**, **Centre across the first field** and **Centre down the first field**, and also **Same width as the first field**, **Same height as the first field** and **Same size as the first field**. Fields already where you ask are left alone.
- With one field selected, **Copy to other pages…** puts a copy at the same place on the pages you type. On a page of another size the place is the same fraction of the page, and the copy is kept inside it. Each copy is a new field with its own name and starts empty. A radio option and a signature cannot be copied alone.
- In the **Forms** section, **Tab order…** chooses how the Tab key moves through the form: across each row, down each column, or in the order the document was made, on every page. Or choose **In the order I click**: each field shows its number, click the fields one after another, and choose **Set this order**. Click a field again to take it out, or press **Esc** to stop without changing anything.

## Good to know

- Formats and calculations are written the way other PDF programs write them, so they work there too. Monstera works them out itself and never runs a script from a document. A script it did not write is kept as it is and the pane says so.
- A name another field holds is said in the name box and not sent.
- Fields in an encrypted document cannot be changed, and Monstera says so.
- Undo any of it with **Ctrl+Z**.
