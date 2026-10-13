---
id: export-as-pdfa
title: Save an archival copy (PDF/A)
summary: Save a copy of the document in the PDF/A format used for long-term archiving.
keywords: [pdf/a, pdfa, pdf/a-2b, pdf/a-1b, pdf/a-3b, archive, archival, long term, compliance, iso 19005, preservation]
commands: [document.export-pdfa]
contexts: [dialog.pdfa-level, dialog.pdfa-removals, tools]
---
PDF/A is a kind of PDF meant to look the same for decades. Some archives and courts ask for it. Monstera saves a PDF/A copy and tells you what had to be left out.

## Steps

1. In the rail, choose **Tools**, then **PDF/A…** in the **Convert** group.
2. Choose the level. **PDF/A-2b** is the usual choice; pick **PDF/A-1b** or **PDF/A-3b** only if the place you send it asks for one.
3. Choose where to save the copy. Monstera says **Saved as PDF/A-2b.** (or the level you chose).
4. If anything had to be left out, the **Saved as PDF/A** window lists it by kind and page.

![The Saved as PDF/A window listing what was left out](screenshot:export-as-pdfa-1)

## Good to know

- Comments are kept with their text. Their pop-up windows are not, because PDF/A copies cannot link them; a PDF reader opens its own.
- Marks hidden from view, sounds, videos and 3D models are left out, and each is named.
- The copy does not keep tags that help screen readers follow the document. If your document had them, Monstera says so.
- If a document cannot be converted, no file is written; **Save a copy…** still works.
- If this copy of Monstera cannot make PDF/A files, it says so before asking where to save.
- The open document is not changed, unless scanned pages are recognised first; see "Recognise scanned pages when exporting".

<!--
Screenshots to capture:
1. export-as-pdfa-1 — Export a tagged document with a note on page 1; frame dialog.pdfa-removals showing the pop-up line and the tags notice.
-->
