---
id: cloud-storage
title: Open and save PDFs in OneDrive or Google Drive
summary: Sign in to OneDrive or Google Drive, open a PDF from it, and save your changes back.
keywords: [cloud, onedrive, google drive, drive, upload, save back, sync, online storage, sign in]
commands: [cloud.storage, cloud.save-back]
contexts: [dialog.cloud-storage, dialog.cloud-outcome, start-screen]
---
Monstera can open PDFs from OneDrive and Google Drive, upload the open document, and save your changes back to the cloud copy.

## Steps

1. Open the **File** menu at the top of the window and choose **Cloud storage…**.
2. Beside the provider, choose **Sign in**. Your web browser opens so you can sign in there.
3. Choose **Show my PDFs**, then **Open** beside a file. It downloads and opens in a tab.
4. For Google Drive you can also choose **Choose a file in Google Drive…**: your browser shows Google's own file chooser, and the PDF you pick opens in a tab. It signs you in if you are not signed in yet.
5. To put the open document in the cloud, choose **Upload this document**.
6. After making changes, open the **File** menu and choose **Save back to cloud**. A message says **Saved to cloud storage**.

![The Cloud storage window showing OneDrive signed in and a list of PDFs](screenshot:cloud-storage-1)

## Good to know

- Each provider shows **Signed in**, **Not signed in**, or **Not available in this build**.
- **Show my PDFs** lists only the Google Drive files Monstera put there, or that you chose before. To open any other PDF in your Google Drive, use **Choose a file in Google Drive…**. Monstera can then see that one file and no others.
- If the file changed in the cloud since you opened it, Monstera does not overwrite it. Your changes are saved on this computer.
- **Save back to cloud** works only for a document opened from, or uploaded to, cloud storage.
- **Sign out** signs out on this computer only; nothing in your cloud storage changes.

<!--
Screenshots to capture:
1. cloud-storage-1 — dialog.cloud-storage with OneDrive signed in and Show my PDFs listing two files. Frame the dialog.
-->
