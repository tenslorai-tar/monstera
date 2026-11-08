---
id: convert-text-to-curves
title: Convert text to curves
summary: Save a copy of a PDF where every letter is drawn as a shape, so it looks and prints the same on any computer.
keywords: [text to curves, curves, outlines, outline text, outlined text, convert fonts, fonts to curves, missing fonts, font substitution, printing, print shop, no fonts]
commands: [document.convert-text-to-curves]
contexts: [dialog.text-to-curves, dialog.curves-result, tools]
---
A PDF's letters are usually drawn from fonts, and a document can look different where a font is missing or replaced. This tool saves a copy where every letter is a fixed shape, which is useful for sending a file to a printer, or anywhere its look must not change. Your document stays as it is.

## Steps

1. In the rail, choose **Tools**, then **Text to curves** in the **Convert** group.
2. Read what the copy will be and what it will lose, then choose **Save a copy…**.
3. Choose a name and a folder. Monstera offers the document's name with "(curves)" added.
4. When the copy is written, Monstera says what it kept. Choose **Open the copy** to see it in a new tab, or **Close**.

## What the copy loses

- Its text: the words can no longer be searched, selected, copied, edited or read aloud. Keep your document if you may need to do any of these.
- Form fields: what they show now becomes part of the page, and they can no longer be filled. Monstera says so before it starts if the document has any.
- Reading order and tags: these are removed too, and Monstera also says so first.

Everything else is kept where it can be. Monstera counts the pages, comments and marks, links, bookmarks, attached files, layers, form fields and tags in your document and in the copy. If a count falls, the window names it, for example "0 of 16 form fields kept".

## Good to know

- The copy may be much larger, because every letter becomes a shape of its own. An eight-page report went from 12 KB to 460 KB.
- The copy keeps the document's title, but its **Created** and **Modified** dates become the moment the copy was made.
- It always converts the whole document. To convert only some pages, extract them first; see "Extract pages to a new PDF".
- You cannot save the copy over the document it came from. Monstera refuses and nothing changes, so choose another name.
- **Fonts** in "See and change a document's properties" reads **None** for the copy.
- If you have unsaved changes, the copy includes them. Your document stays unsaved until you save it.
