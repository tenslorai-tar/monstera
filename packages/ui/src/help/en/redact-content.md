---
id: redact-content
title: Redact (permanently remove) content
summary: Mark text or areas for redaction, check the marks, then remove what is under them for good.
keywords: [redact, redaction, black out, remove sensitive, censor, hide text permanently, privacy, burn in]
commands: [annotate.redact-text, annotate.redact, text.redact, document.apply-redactions]
contexts: [dialog.apply-redactions, protect, comment]
---
Redaction removes content from the document itself, not just covers it. It happens in two steps: first you mark what should go, then you apply the redactions.

## Steps

1. Mark what to remove:
   - In the rail, choose **Comment**, then **Redact text** in the **Redact** group (**Mark text for redaction**), and drag across the words, as you would to highlight them; or
   - In the rail, choose **Comment**, then **Redact area** in the **Redact** group (**Mark an area for redaction**), and drag a box over each area, such as a picture or a signature; or
   - select text with **Select text**, right-click, and choose **Mark for redaction**; or
   - mark every match of a word, see "Find and redact words".
2. Check the marks. Each is shown hatched, with the label **Marked for redaction**, and the words under it still show between the lines. Delete any you did not mean with **Select annotations** or **Erase annotation**.
3. In the rail, choose **Protect**, then **Apply redactions** in the **Redact** group.
4. In the **Apply redactions** window choose:
   - **Apply to**: **Page …** or **Every page**;
   - **Leave behind**: **A filled box** or **Nothing**;
   - **Images under a mark**: **Blank only the covered part** or **Remove the whole image**;
   - whether to **Keep the document's title** (off by default).
5. Choose **Apply redactions**, then save.

![The Apply redactions window with its choices and warning](screenshot:redact-content-1)

## Good to know

- Nothing is removed until you choose **Apply redactions**. Marks alone remove nothing. An applied redaction is a solid box, so a page never shows a mark and a finished redaction the same way.
- If you save, close, export, print or send a document that still has marks, Monstera asks whether to apply them first. **Apply** removes what every mark covers, on every page, with a filled box, and then goes on; the middle button, such as **Save without applying**, goes on and keeps the marks as marks; **Cancel** does neither.
- Applying removes the text, pictures and drawings under the marks, plus any comments and form fields there. The document's bookmarks, author, subject and other properties are removed too. A bookmark's name can itself spell what you are redacting, so they are always removed. Links within the document keep working, but the hidden names they jump to are replaced with plain ones, for the same reason.
- A title can itself contain what you are redacting, which is why keeping it is off by default.
- The only way back is **Undo**, while the document is still open.
- Saving after a redaction keeps no backup copy, because a backup of the previous file would still hold what you removed. The same save permanently deletes the older backups Monstera made of the file and Monstera's own undo copies of the document, and the message after saving says so. They do not go to the Recycle Bin, and Undo can no longer go back past this point. A file beside the document that is named like a backup but that Monstera did not make is never deleted. Monstera names it in **Some older copies were kept**, so you can delete it yourself.
- **Apply redactions** asks first. If you turn off **Confirm before redacting** in **Settings**, **Saving** page, it removes marked content on the current page straight away, with a filled box, and removes the title and bookmarks too.

<!--
Screenshots to capture:
1. redact-content-1 — A page with two redaction marks; dialog.apply-redactions with Every page, A filled box, Blank only the covered part. Frame the dialog.
-->
