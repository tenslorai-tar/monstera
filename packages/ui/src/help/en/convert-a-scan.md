---
id: convert-a-scan
title: Convert a scan
summary: Turn a scanned or handwritten document into a searchable PDF, a Word file or an Excel workbook.
keywords: [scan, scanned, handwriting, handwritten, convert, searchable, word, excel, ocr, photo, digital]
commands: [document.convert-scan]
contexts: [dialog.convert-scan, tools]
---
A scan is a picture of a page, so its words cannot be searched, selected or edited. **Convert scan** says what a scan can become and takes you to the command that does it.

## Steps

1. In the rail, choose **Tools**, then **Convert scan** in the **OCR** group.
2. Choose what you want:
   - **Make it searchable** keeps every page looking the same and adds hidden words behind the picture, so you can search and copy them.
   - **Save as Word** writes the document's words as a Word file you can edit. It works from the words in the PDF, so make it searchable first.
   - **Save as Excel** writes the tables as an Excel workbook, each cell in its own box. A reading service such as Claude or Azure can read handwritten tables from the page pictures.
3. The command you chose opens, and asks for anything it needs, such as the pages or the reading service.

![The Convert a scan window with its three choices](screenshot:convert-a-scan-1)

## Good to know

- Nothing is sent anywhere by this window. A page picture leaves this computer only when you choose a reading service such as Claude or Azure in the next step, and that step says so first.
- A photograph with only a few hidden words on it, such as after reading one box, is still offered for reading, because its words cover very little of it. Reading the whole page again replaces the hidden words Monstera added earlier with the new reading, so a search finds each word once. Words the document had before are kept, and reading a box adds to the page.
- Handwriting is read by Claude or Azure only. See "Read handwriting with Azure or Claude" and "Export tables to Excel".

<!--
Screenshots to capture:
1. convert-a-scan-1 — Tools section, dialog.convert-scan opened from the OCR group. Frame the dialog.
-->
