---
id: recognise-scanned-pages-when-exporting
title: Recognise scanned pages when exporting
summary: Have text, Word and PDF/A exports read scanned pages first, so the exported file carries their words.
keywords: [ocr on export, auto ocr, recognise when exporting, scanned export, export scanned text, searchable pdf/a]
commands: [app.settings]
contexts: [dialog.settings]
---
A scanned page is a picture, so an export of the document's text has nothing to write for it. Turn this on and Monstera recognises the scanned pages first, then exports.

## Steps

1. Open **Settings** (in the rail, choose **Settings**).
2. Choose the **OCR** page.
3. Turn on **Recognise scanned pages when exporting**.

![The OCR page of Settings with Recognise scanned pages when exporting turned on](screenshot:recognise-scanned-pages-when-exporting-1)

## Good to know

- It applies to **Export text…**, **Export text with layout…**, **Export to Word…** and **Export as PDF/A…**. Pictures of pages (PowerPoint, page images) and Excel tables are exported as before.
- It is off unless you turn it on, because the recognised text is also added to your open document. Each page can be undone with **Ctrl+Z**.
- Pages that already have text are left alone. Progress shows in the status bar, and you can stop it; if you do, no file is written.
- The languages used are the ones in **Recognition languages** on the same page.
- When pages were recognised, the **Recognition** window says how many.

<!--
Screenshots to capture:
1. recognise-scanned-pages-when-exporting-1 — Settings, OCR page, the switch on. Frame the page.
-->
