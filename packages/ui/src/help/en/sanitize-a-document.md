---
id: sanitize-a-document
title: Sanitize a document
summary: Remove scripts, attached files, actions that send or fetch data, and optionally flatten fields and comments.
keywords: [sanitize, clean, remove javascript, remove attachments, security, strip, flatten comments, safe pdf]
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
3. Choose **Sanitize**, then save.

![The Sanitize document window with its four choices ticked](screenshot:sanitize-a-document-1)

## Good to know

- Everything is ticked to begin with; untick what you want to keep.
- Ordinary links to web pages and to other pages are kept.
- Flattening keeps what fields and comments show, but they can no longer be edited.
- Saving after sanitizing keeps no backup copy, because a backup would still hold what you removed. The same save permanently deletes the older copies Monstera made of the file; see "Redact (permanently remove) content".

<!--
Screenshots to capture:
1. sanitize-a-document-1 — dialog.sanitize-document with all four ticked. Frame the dialog.
-->
