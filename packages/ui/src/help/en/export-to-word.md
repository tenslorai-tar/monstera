---
id: export-to-word
title: Export to Word
summary: Save the document as a Word file that flows like a normal document, keeps the page layout, or holds just the words.
keywords: [word, docx, export to word, convert to word, pdf to word, editable document]
commands: [document.export-word]
contexts: [dialog.export-word, home]
---
Export to Word turns the document's text and pictures into a Word (.docx) file you can edit.

## Steps

1. In the rail, choose **Home**, then **Export** in the **Export** group, and **Export to Word…**.
2. Under **What is in this document?**, choose **Typed text** if the words are already in the PDF, or **Handwritten or scanned** if the pages are pictures.
3. In **Pages**, keep **Every page**, or choose **Select pages** and type them, for example 1-3, 5.
4. For typed text, in **What to keep**, choose one:
   - **Editable text**: text and its fonts, flowing like a normal document
   - **Page layout**: each line where it sits on the page
   - **Words only**: just the words, with no pictures and no layout
5. Choose **Choose where to save…** and save the file. **Cancel** closes the window and saves nothing.

![The Export to Word window with Pages and the three What to keep choices](screenshot:export-to-word-1)

## Handwritten or scanned documents

Choose **Handwritten or scanned** and then **Read the pages with**: **This computer** for printed text (nothing leaves your computer), or **Claude** or **Azure** to read handwriting too. A reader is offered only when it is set up: Claude and Azure need a key in Settings.

Monstera reads the pages you chose, one after another, with the progress in the bar at the bottom. **Cancel** there stops, and no Word file is written. Then you choose where to save, and the file holds the words only.

- Claude and Azure get a picture of each page you chose. The window says how many pages are sent before you choose, and a page you did not choose is not sent.
- The words read are also kept, unseen, in your document, so you can search it. **Undo** (**Ctrl+Z**) takes out all the pages of one reading together.
- A page that already has real text is left as it is and not read again.
- Tables come out as text in Word. To get them in cells, use "Export tables to Excel".

## Good to know

- Pictures come with the text in two of the three choices. With **Editable text**, each picture sits between the paragraphs it sits between on the page, made smaller if it is wider than the page's text. With **Page layout**, each picture is placed where it is on the page, behind the text. **Words only** has no pictures.
- A picture comes out as it looks on the page: turned if the page shows it turned, and see-through where it is see-through.
- Scanned pages have no text until it is recognised; see "Make scanned pages searchable", or "Recognise scanned pages when exporting" to have exports do it first.
- The document itself is not changed, unless scanned pages are recognised first.

<!--
Screenshots to capture:
1. export-to-word-1 — dialog.export-word with the first option selected. Frame the dialog.
-->
