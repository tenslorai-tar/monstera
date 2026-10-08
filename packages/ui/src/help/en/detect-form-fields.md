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
3. The **Fields this page could have** window says how many places it found and lists them. Untick anything that is not really a place to write.
4. Choose **Create … fields** to add them, or close the window to add nothing. The button says how many fields it will make.

![The Fields this page could have window with suggestions ticked](screenshot:detect-form-fields-1)

## Good to know

- Monstera looks for empty ruled lines and boxes with a label next to them. An empty table cell looks the same, so check the list.
- Monstera suggests only places to write: empty lines, boxes and table cells beside a label. It does not suggest a place that already has a field, and the window says how many it left out for that reason.
- A line or a wide box becomes a text field, and a small square becomes a tick box. Draw dropdowns, lists and radio buttons with the **Fields** tools.
- Nothing is added until you choose **Create … fields**.
- One page at a time. Undo with **Ctrl+Z**.

<!--
Screenshots to capture:
1. detect-form-fields-1 — A flat form page; dialog.flat-fields with four suggestions, one unticked. Frame the dialog.
-->
