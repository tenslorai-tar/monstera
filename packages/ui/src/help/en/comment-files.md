---
id: comment-files
title: Export or import comments
summary: Save a document's comments to an XFDF, FDF or JSON file, or add comments from such a file.
keywords: [export comments, import comments, xfdf, fdf, json, share comments, annotations file, review exchange]
commands: [document.export-annotations-xfdf, document.export-annotations-fdf, document.export-annotations-json, document.import-annotations-xfdf, document.import-annotations-fdf, document.import-annotations-json]
contexts: [dialog.import-annotations-problem, dialog.import-annotations-result, review]
---
You can pass comments between people and programs without sending the whole document, as a small comments file.

## Steps

To export:

1. In the rail, choose **Review**. In the **Comment files** group, choose **Export XFDF**, **Export FDF** or **Export JSON**.
2. Choose where to save.

To import:

1. In the **Comment files** group, choose **Import XFDF**, **Import FDF** or **Import JSON**.
2. Pick the file.

![The Comment files group in the Review section](screenshot:comment-files-1)

## Good to know

- Each comment's position, colours, text, author and date travel. Rich text formatting and the pictures in picture stamps do not.
- XFDF stores colours as eight-bit RGB values, so it can round a colour slightly. JSON and FDF keep the original colour values.
- An import adds every comment that can be placed. If a comment names a missing page, an unsupported kind, or an invalid entry, the result lists its number and the reason it was skipped.
- A readable file with no comments says exactly that. A file that cannot be read in the chosen format adds nothing.
- Files from PDF-XChange Editor have been tested; files from other programs may work but are not tested.
- Undo an import with **Ctrl+Z**.

<!--
Screenshots to capture:
1. comment-files-1 — Review section, Comment files group. Frame the group.
-->
