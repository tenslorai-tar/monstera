---
id: password-and-permissions
title: Set a password and permissions
summary: Lock a document with a password, choose what readers may do, or remove the protection.
keywords: [password, encrypt, encryption, protect, aes-256, permissions, restrict printing, restrict copying, remove password, unlock, security]
commands: [document.protect, start.encrypt-sign]
contexts: [dialog.protect-document, protect]
---
You can require a password to open a document, set a separate password for changing its permissions, and choose what readers are allowed to do. You can also remove protection.

## Steps

1. In the rail, choose **Protect**, then **Permissions…** in the **Encryption** group (**Password and permissions**).
2. In **Encryption**, choose **AES-256 (recommended)**. Older choices are there for very old readers.
3. Type a **Password to open (optional)** and/or a **Password to change permissions (optional)**. You need at least one.
4. Under **Allow without the permissions password**, untick anything readers should not do, such as **Print** or **Copy text and images**.
5. Choose **Protect document**, then **save** the document. Protection is applied when you save.

To remove protection: open the window, choose **None — remove the password** in **Encryption**, choose **Remove protection**, then save.

![The Password and permissions window with AES-256, the two password fields and the permission ticks](screenshot:password-and-permissions-1)

## Good to know

- Keep your passwords safe. Monstera does not keep them and cannot recover them.
- Permissions are honoured by PDF readers that choose to honour them; they are not enforced by the file itself.
- Undoing a second protection change on an already-protected document may be refused, because it would need the earlier password.

<!--
Screenshots to capture:
1. password-and-permissions-1 — dialog.protect-document with AES-256, an open password typed (masked), Print ticked, Copy unticked. Frame the dialog.
-->
