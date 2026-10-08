---
id: form-data-import-export
title: Export or import form data
summary: Save the values in a form to a JSON, XFDF or FDF file, or fill a form from one.
keywords: [form data, export data, import data, json, xfdf, fdf, save answers, fill from file, data exchange]
commands: [document.export-form-data-json, document.export-form-data-xfdf, document.export-form-data-fdf, document.import-form-data-json, document.import-form-data-xfdf, document.import-form-data-fdf]
contexts: [dialog.import-form-data-problem, dialog.import-form-data-result, forms]
---
You can save just the answers in a form to a small file, and fill a matching form from such a file.

## Steps

To export:

1. In the rail, choose **Forms**, then **Export** in the **Data** group.
2. Choose **Export form data as JSON…**, **Export form data as XFDF…** or **Export form data as FDF…**, and choose where to save.

To import:

1. Choose **Import** in the **Data** group.
2. Choose **Import form data from JSON…**, **Import form data from XFDF…** or **Import form data from FDF…**, and pick the file.

![The Data group's Export menu with the three formats](screenshot:form-data-import-export-1)

## Good to know

- An import fills every field it can, by name. A file Monstera exported itself fills straight back in with nothing left over.
- When a file does not fit the form field for field, Monstera fills what it can and then lists each field it left alone, with the reason: the form has no field with that name, the field is locked and the file holds a different value, the value is not one of the field's choices, the file gives several values to a field that takes one, or the field cannot take a value.
- A value the file shares with a locked field is not a problem: if the locked field already holds it, it is not listed.
- If none of the names in the file is in this form, it is the wrong file: Monstera says so and changes nothing.
- A file that is not form data in the format you chose cannot be read, and nothing is changed.
- A list field holding several choices takes only one value from a file.
- If a value holds a character XFDF cannot store, export as FDF or JSON instead.
- Undo an import with **Ctrl+Z**.

<!--
Screenshots to capture:
1. form-data-import-export-1 — Forms section, Data › Export menu open. Frame the menu.
-->
