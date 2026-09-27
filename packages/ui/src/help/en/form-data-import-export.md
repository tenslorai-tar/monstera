---
id: form-data-import-export
title: Export or import form data
summary: Save the values in a form to a JSON, XFDF or FDF file, or fill a form from one.
keywords: [form data, export data, import data, json, xfdf, fdf, save answers, fill from file, data exchange]
commands: [document.export-form-data-json, document.export-form-data-xfdf, document.export-form-data-fdf, document.import-form-data-json, document.import-form-data-xfdf, document.import-form-data-fdf]
contexts: [dialog.import-form-data-problem, forms]
---
You can save just the answers in a form to a small file, and fill a matching form from such a file.

## Steps

To export:

1. In the rail, choose **Forms**, then **Export** in the **Data** group.
2. Choose **Export JSON…**, **Export XFDF…** or **Export FDF…**, and choose where to save.

To import:

1. Choose **Import** in the **Data** group.
2. Choose **Import JSON…**, **Import XFDF…** or **Import FDF…**, and pick the file.

![The Data group's Export menu with the three formats](screenshot:form-data-import-export-1)

## Good to know

- An import fills fields by name and ignores names this form does not have.
- If any value cannot go into its field, nothing is changed and Monstera says why.
- A list field holding several choices cannot be imported.
- If a value holds a character XFDF cannot store, export as FDF or JSON instead.
- Undo an import with **Ctrl+Z**.

<!--
Screenshots to capture:
1. form-data-import-export-1 — Forms section, Data › Export menu open. Frame the menu.
-->
