---
id: check-signatures
title: Check a document's signatures
summary: See who signed, when their certificate was valid, and whether the document has changed since.
keywords: [verify signature, check signature, validate, signed, tampered, certificate validity]
commands: [document.check-signatures]
contexts: [dialog.signatures, protect]
---
Check signatures looks at each signature in the document and tells you whether the signed content is unchanged.

## Steps

1. In the rail, choose **Protect**, then **Check signatures** in the **Signatures** group.
2. The **Signatures** window lists each signature with its signer and the certificate's validity dates, and says one of:
   - **Unchanged since it was signed**
   - **The document has changed since this signature was made**
   - **Intact, but something was added to the document afterwards that this signature does not cover**

![The Signatures window showing one intact signature](screenshot:check-signatures-1)

## Good to know

- These checks compare the signature with the content it covers. They do not tell you whether the signer's certificate is one you should trust.
- A signature Monstera cannot read is reported as unreadable, which is not the same as invalid.
- If there is no signature, the window says **This document is not signed.**

<!--
Screenshots to capture:
1. check-signatures-1 — A signed document; dialog.signatures showing one signature "Unchanged since it was signed". Frame the dialog.
-->
