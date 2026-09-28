---
id: save-a-document
title: Save your changes
summary: Save writes your changes back to the file you opened.
keywords: [save, ctrl+s, store, write, keep changes, unsaved, dot]
commands: [document.save]
contexts: [home, dialog.save-problem]
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
- Each save keeps the version it replaces beside the file, named like `report.pdf.bak`. To keep more earlier versions (up to 10), open **Settings**, choose **Saving** and pick a number under **Backup copies to keep**: the newest is `.bak`, then `.bak2` and so on. To go back to an earlier version, rename its copy to end in `.pdf` and open it.
- Saving can happen on a timer if you turn on autosave. See "Save automatically".
- Saving a digitally signed document keeps its signatures: your changes are added after them. A few changes need the whole file rewritten — a redaction, flattening a form, or a new password — and that breaks the signatures. Monstera asks first, in **This save will break signatures**: choose **Save anyway**, or close the window to keep them. Autosave never breaks a signature; such a save waits for you. To stop being asked, turn off **Warn before a save breaks a signature** in **Settings**, on the **Saving** page.

<!--
Screenshots to capture:
1. save-a-document-1 — Home section, a document with an unsaved change (dot on tab). Frame the File group's Save button; second capture after saving showing the status bar "Saved just now".
-->
