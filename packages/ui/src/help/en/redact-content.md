---
id: redact-content
title: Redact (permanently remove) content
summary: Mark text or areas for redaction, check the marks, then remove what is under them for good.
keywords: [redact, redaction, black out, remove sensitive, censor, hide text permanently, privacy, burn in]
commands: [annotate.redact, text.redact, document.apply-redactions]
contexts: [dialog.apply-redactions, protect, comment]
---
Redaction removes content from the document itself, not just covers it. It happens in two steps: first you mark what should go, then you apply the redactions.

## Steps

1. Mark what to remove:
   - In the rail, choose **Comment**, then **Redact** in the **Redact** group (**Mark for redaction**), and drag a box over each area; or
   - select text with **Select text**, right-click, and choose **Mark for redaction**; or
   - mark every match of a word, see "Find and redact words".
2. Check the marks. They are shown as solid boxes. Delete any you did not mean with **Select annotations** or **Erase annotation**.
3. In the rail, choose **Protect**, then **Apply redactions** in the **Redact** group.
4. In the **Apply redactions** window choose:
   - **Apply to**: **Page …** or **Every page**;
   - **Leave behind**: **A filled box** or **Nothing**;
   - **Images under a mark**: **Blank only the covered part** or **Remove the whole image**;
   - whether to **Keep the document's title** (off by default).
5. Choose **Apply redactions**, then save.

![The Apply redactions window with its choices and warning](screenshot:redact-content-1)

## Good to know

- Nothing is removed until you choose **Apply redactions**. Marks alone remove nothing.
- Applying removes the text, pictures and drawings under the marks, plus any comments and form fields there. The document's author, subject and other properties are removed too.
- A title can itself contain what you are redacting, which is why keeping it is off by default.
- The only way back is **Undo**, while the document is still open.

<!--
Screenshots to capture:
1. redact-content-1 — A page with two redaction marks; dialog.apply-redactions with Every page, A filled box, Blank only the covered part. Frame the dialog.
-->
