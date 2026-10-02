---
id: cloud-storage
title: Open and save PDFs in OneDrive or Google Drive
summary: Sign in to OneDrive or Google Drive, open a PDF from it, and save your changes back.
keywords: [cloud, onedrive, google drive, drive, upload, save back, sync, online storage, sign in]
commands: [cloud.storage, cloud.save-back]
contexts: [dialog.cloud-storage, dialog.cloud-outcome, dialog.cloud-view-only, start-screen]
---
Monstera can open PDFs from OneDrive and Google Drive, upload the open document, and save your changes back to the cloud copy.

## Steps

1. Open the **File** menu at the top of the window and choose **Cloud storage…**.
2. Under the provider's name, choose **Sign in**. Your web browser opens so you can sign in there.
3. Choose **Show my PDFs**, then **Open** beside a file. It downloads and opens in a tab.
4. Under Google Drive you can also choose **Choose a file…**: your browser shows Google's own file chooser, and the PDF you pick opens in a tab. It signs you in if you are not signed in yet.
5. To put the open document in the cloud, choose **Upload this document**.
6. After making changes, open the **File** menu and choose **Save back to cloud**. A message says **Saved to cloud storage**.

![The Cloud storage window showing OneDrive signed in and a list of PDFs](screenshot:cloud-storage-1)

## Good to know

- Each provider shows **Signed in**, **Not signed in**, or **Not available in this build** beside its name. **Sign out** is at the end of a signed-in provider's row.
- **Show my PDFs** lists only the Google Drive files Monstera put there, or that you chose before. To open any other PDF in your Google Drive, use **Choose a file…** under Google Drive. Monstera can then see that one file and no others.
- If the file changed in the cloud since you opened it, Monstera does not overwrite it. Your changes are saved on this computer.

## Files shared with you as view-only

Someone may share a file with you so that you can read it but not change it. When you open such a file, Monstera says **Shared with you as view-only** straight away, before you edit.

- You can still edit the file in Monstera. Your changes are saved on this computer.
- **Save back to cloud** cannot change the original, because the owner did not allow it. Monstera does not ask you to sign in again, because signing in would not change that.
- Choose the button that saves a copy to your own Google Drive or OneDrive, to put your version in your own storage. After that, **Save back to cloud** sends your changes to your copy. The original stays as it is.
- If the provider refuses a change without saying so first, Monstera explains it the same way and offers the same copy.
- Every cloud problem is written to the diagnostics log, with the provider's own reason, in case you need to report it. The log is in the **Help** menu, as **Reveal diagnostics log**.
- **Save back to cloud** works only for a document opened from, or uploaded to, cloud storage.
- **Sign out** signs out on this computer only; nothing in your cloud storage changes.

<!--
Screenshots to capture:
1. cloud-storage-1 — dialog.cloud-storage with OneDrive signed in and Show my PDFs listing two files. Frame the dialog.
-->
