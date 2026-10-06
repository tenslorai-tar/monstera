---
id: detect-form-fields
title: Find fields on a flat form
summary: Let Monstera suggest where the blanks are on a printed-style form, and turn the ones you keep into text fields.
keywords: [detect fields, auto detect, flat form, make fillable, find blanks, form recognition]
commands: [document.find-flat-fields]
contexts: [dialog.flat-fields, forms]
---
Some forms are just printed lines and boxes with no fillable fields. Monstera can suggest where the places to write are on a page.

## Steps

1. Go to the page.
2. In the rail, choose **Forms**, then **Detect…** in the **Manage** group (**Find fields on this page…**).
3. The **Fields this page could have** window lists what it found. Untick anything that is not really a place to write.
4. Choose **Create … fields**. The button says how many fields it will make.

![The Fields this page could have window with suggestions ticked](screenshot:detect-form-fields-1)

## Good to know

- Monstera looks for empty ruled lines and boxes with a label next to them. An empty table cell looks the same, so check the list.
- Every suggestion becomes a text field. Draw tick boxes, dropdowns and lists with the **Fields** tools.
- One page at a time. Undo with **Ctrl+Z**.

<!--
Screenshots to capture:
1. detect-form-fields-1 — A flat form page; dialog.flat-fields with four suggestions, one unticked. Frame the dialog.
-->
