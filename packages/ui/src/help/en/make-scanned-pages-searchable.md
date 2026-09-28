---
id: make-scanned-pages-searchable
title: Make scanned pages searchable (OCR)
summary: Recognise the text in scanned pages so you can search, select and copy it.
keywords: [ocr, scan, scanned, recognise text, recognize, text recognition, searchable pdf, image to text, tesseract, languages]
commands: [document.ocr, start.ocr]
contexts: [dialog.ocr, dialog.ocr-outcome, tools]
---
A scanned page is only a picture, so its words cannot be searched or selected. Text recognition (OCR) reads the words and adds an invisible layer of text in exactly the right places. The page looks the same, but now you can search, select and copy.

## Steps

1. In the rail, choose **Tools**, then **OCR pages** in the **OCR** group (its full name is **Make scanned pages searchable**).
2. In **Languages of the text (up to three)**, tick the language. If a page mixes languages, tick each of them; they are read together.
3. Choose **This page** or **All pages**, then **Recognise**.
4. Progress shows in the status bar. When it finishes, the **Recognition** window says how many pages were read.

![The Recognise text window with its languages and This page / All pages](screenshot:make-scanned-pages-searchable-1)

## Good to know

- Recognition runs on this computer. Nothing is sent anywhere.
- Only pages that are pictures are read. Pages that already have text are left alone, and the result says so.
- A page that is a picture shows **This page is a picture, so there is no text to select or search.**
- If you stop it early, the pages already done keep their text.
- Each page can be undone with **Ctrl+Z**.
- The window opens with the languages set in **Settings**, **OCR** page, **Recognition languages**. Choosing others in the window changes that run only.- If the window says no recognition models are installed, text recognition is not available in this copy of Monstera.
- Handwriting is not read this way. See "Read handwriting with Azure or Claude".

<!--
Screenshots to capture:
1. make-scanned-pages-searchable-1 — A scanned 3-page document, Tools section, dialog.ocr with English and All pages. Frame the dialog.
-->
