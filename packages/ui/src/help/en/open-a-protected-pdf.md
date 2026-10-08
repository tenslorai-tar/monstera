---
id: open-a-protected-pdf
title: Open a password-protected PDF
summary: When a PDF needs a password, Monstera asks for it before showing the document.
keywords: [password, locked, encrypted, protected, unlock, secure pdf, open password]
commands: [document.open]
contexts: [dialog.document-password]
---
Some PDFs are locked with a password. Monstera recognises them when you open them and asks for the password.

## Steps

1. Open the PDF as usual.
2. In the **This document is protected** window, type the password in **Password**.
3. Choose **Open document**.

![The This document is protected window with the Password field and the Open document button](screenshot:open-a-protected-pdf-1)

## Good to know

- If the password is wrong, Monstera says so and lets you try again.
- Monstera holds the password only while the document is open, so your changes are saved still protected. It forgets the password when you close the document, and never puts it in your Recent list.
- To add or remove a password on a document, see "Set a password and permissions".

<!--
Screenshots to capture:
1. open-a-protected-pdf-1 — dialog.document-password after opening an AES-256 protected test PDF. Frame the whole dialog.
-->
