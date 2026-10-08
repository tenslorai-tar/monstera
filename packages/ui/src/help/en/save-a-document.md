---
id: save-a-document
title: Save your changes
summary: Save writes your changes back to the file you opened.
keywords: [save, ctrl+s, store, write, keep changes, unsaved, dot, backup, restore, previous version, earlier version, bak]
commands: [document.save, document.restore-version]
contexts: [home, dialog.save-problem, dialog.kept-backups, dialog.restore-version]
---
Your changes stay in Monstera until you save. Saving writes them into the file you opened.

## Steps

1. In the rail, choose **Home**, then **Save** in the **File** group. Or press **Ctrl+S**.
2. A short message says **Saved**, and the status bar shows **Saved just now**.

![The Home section's File group with the Save button, and the status bar showing Saved just now](screenshot:save-a-document-1)

## Good to know

- Shortcut: **Ctrl+S**.
- A dot on a document's tab, and a dot (●) in the window title, mean it has unsaved changes. The status bar shows **Unsaved changes**.
- If the file cannot be saved (for example it is open in another program, it was replaced on disk, or it is gone), Monstera tells you why. Your changes stay open and nothing is lost. Try **Save a copy…** to write them somewhere else.
- To keep the original file unchanged, use "Save a copy" instead.
- Each save keeps the version it replaces in Monstera's own folder, and writes nothing beside your file. To go back to an earlier version, choose **File**, then **Restore a previous version…**, pick the one saved at the date and time you want and choose **Restore as a copy…**. It is saved as a copy where you choose and opens as its own tab, and your document is not changed. To keep more earlier versions (up to 10), open **Settings**, choose **Saving** and pick a number under **Backup copies to keep**. To delete them all, open **Settings**, choose **Privacy** and choose **Clear backups**.
- Older Monstera builds kept backups beside the file, named like `report.pdf.bak`. Monstera moves the ones it made into its own folder when you open the file. Any file named like a backup that Monstera did not make is left exactly where it is.
- A save after a redaction, Sanitize or flattening a form keeps no backup, since the backup would hold what was removed. It also permanently deletes the older backups Monstera made of the file and its undo copies, and the message after saving says so. After that, undo cannot go back past the save. A file beside it that is named like a backup but that Monstera did not make is never deleted: Monstera names it in **Some older copies were kept**, so you can decide.
- Saving can happen on a timer if you turn on autosave. See "Save automatically".
- Saving a digitally signed document keeps its signatures: your changes are added after them. A few changes need the whole file rewritten, such as a redaction, flattening a form, a new password or an edit to the text, and those break the signatures. Monstera asks before it makes one, in **This change will break signatures**: choose **Work on a copy** to make the change on a copy saved where you choose, which leaves the signed document exactly as it is, or **Change this document**. Close the window to leave the document unchanged. Autosave never breaks a signature; such a save waits for you. To stop being asked, turn off **Warn before a change breaks a signature** in **Settings**, on the **Saving** page.

<!--
Screenshots to capture:
1. save-a-document-1 — Home section, a document with an unsaved change (dot on tab). Frame the File group's Save button; second capture after saving showing the status bar "Saved just now".
-->
