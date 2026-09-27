---
id: export-as-pdfa
title: Save an archival copy (PDF/A)
summary: Save a copy of the document in the PDF/A format used for long-term archiving.
keywords: [pdf/a, pdfa, archive, archival, long term, compliance, iso 19005, preservation]
commands: [document.export-pdfa]
contexts: [dialog.pdfa-removals, tools]
---
PDF/A is a kind of PDF meant to look the same for decades. Some archives and courts ask for it. Monstera saves a PDF/A copy and tells you what had to be left out.

## Steps

1. In the rail, choose **Tools**, then **PDF/A…** in the **Convert** group.
2. Choose where to save the copy.
3. If anything was left out to meet the standard, the **Saved as PDF/A** window lists it, in the converter's own words.

![The Saved as PDF/A window listing what was left out](screenshot:export-as-pdfa-1)

## Good to know

- The copy does not keep tags that help screen readers follow the document. If your document had them, Monstera says so.
- If a document cannot be converted, no file is written; **Save a copy…** still works.
- If this copy of Monstera cannot make PDF/A files, it says so before asking where to save.
- The open document is not changed.

<!--
Screenshots to capture:
1. export-as-pdfa-1 — Export a tagged document with a transparent drawing; frame dialog.pdfa-removals showing its list and the tags notice.
-->
