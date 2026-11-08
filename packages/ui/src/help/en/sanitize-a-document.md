---
id: sanitize-a-document
title: Sanitize a document
summary: Remove scripts, attached files, actions that send or fetch data and document information, and flatten fields and comments.
keywords: [sanitize, clean, remove javascript, remove attachments, security, strip, flatten comments, safe pdf, document information, document info, metadata, properties, remove title, remove author]
commands: [document.sanitize]
contexts: [dialog.sanitize-document, protect]
---
Before sharing a document, you can remove hidden parts that could run or send things.

## Steps

1. In the rail, choose **Protect**, then **Sanitize document** in the **Encryption** group.
2. Under **Remove from this document:**, keep ticked what should go:
   - **Embedded JavaScript and automatic actions**
   - **Attached files**
   - **Actions that submit or fetch data**
   - **Form fields and comments, flattened into the page**
   - **Document information: title, author, subject, keywords, dates and the programs that made it**
3. Choose **Sanitize**, then save.

![The Sanitize document window with its five choices ticked](screenshot:sanitize-a-document-1)

## Good to know

- Everything is ticked to begin with; untick what you want to keep.
- Ordinary links to web pages and to other pages are kept.
- Flattening keeps what fields and comments show, but they can no longer be edited.
- Document information is everything "See and change a document's properties" can change, plus the programs that made the document. All of it is removed, so if you want a document to keep a title or an author, untick this choice.
- Saving after sanitizing keeps no backup copy, because a backup would still hold what you removed. The same save permanently deletes the older copies Monstera made of the file; see "Redact (permanently remove) content".

<!--
Screenshots to capture:
1. sanitize-a-document-1 — dialog.sanitize-document with all five ticked. Frame the dialog.
-->
