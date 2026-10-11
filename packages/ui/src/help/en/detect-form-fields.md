---
id: detect-form-fields
title: Find fields on a flat form
summary: Let Monstera suggest where the blanks are on a printed-style form, and turn the ones you keep into fields.
keywords: [detect fields, auto detect, flat form, make fillable, find blanks, form recognition]
commands: [document.find-flat-fields]
contexts: [dialog.flat-fields, forms]
---
Some forms are just printed lines and boxes with no fillable fields. Monstera can suggest where the places to write are on a page.

## Steps

1. Go to the page.
2. In the rail, choose **Forms**, then **Detect…** in the **Manage** group (**Find fields on this page…**).
3. The **Fields this page could have** window says how many places it found and lists them, and each one is marked on the page. Untick anything that is not really a place to write.
4. To look at every page instead of this one, choose **Find on all pages**.
5. Choose **Add … fields** to add them, or close the window to add nothing. The button says how many fields it will make.

![The Fields this page could have window with suggestions ticked](screenshot:detect-form-fields-1)

## Good to know

- Monstera looks for empty ruled lines, boxes, small squares and small circles with words next to them. An empty table cell looks the same as a box, so check the list.
- Monstera suggests only places to write. It does not suggest a place that already has a field, and the window says how many fields the document has and how many places it left out for that reason.
- A line or a wide box becomes a text field, a small square a tick box and a small circle a radio button. The circles in one row are one group of choices. Draw dropdowns and lists with the **Fields** tools.
- Nothing is added until you choose **Add … fields**, and one Undo with **Ctrl+Z** takes back everything it added.

<!--
Screenshots to capture:
1. detect-form-fields-1 — A flat form page; dialog.flat-fields with four suggestions, one unticked. Frame the dialog.
-->
