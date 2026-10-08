---
id: undo-and-redo
title: Undo and redo changes
summary: Step back through your changes with Undo, and forward again with Redo.
keywords: [undo, redo, ctrl+z, ctrl+y, revert, go back, mistake, history]
commands: [document.undo, document.redo]
contexts: [home, dialog.history-trimmed]
---
Almost every change you make to a document can be undone, one step at a time, until you close it.

## Steps

1. To undo, in the rail choose **Home**, then **Undo** in the **File** group, or press **Ctrl+Z**.
2. To redo what you just undid, choose **Redo**, or press **Ctrl+Y**.

![The Undo and Redo buttons in the Home section's File group](screenshot:undo-and-redo-1)

## Good to know

- Shortcuts: **Ctrl+Z** to undo, **Ctrl+Y** to redo.
- Each document keeps its own undo history. It is lost when you close the document.
- Monstera keeps within a memory limit. If older steps have to be released, a window titled **Older undo steps were released** tells you how many can no longer be undone. Your change was still applied, and more recent steps can still be undone.
- A password change can be undone and redone too: Monstera holds the passwords while the document is open, and forgets them when you close it.

<!--
Screenshots to capture:
1. undo-and-redo-1 — Home section after one change. Frame the File group's Undo and Redo buttons with the Undo tooltip visible.
-->
