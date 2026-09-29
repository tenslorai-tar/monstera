---
id: components
title: Check Monstera's components
summary: See the tools Monstera uses to read, convert and recognise documents, and check that their files are intact.
keywords: [components, pdfium, ghostscript, poppler, onlyoffice, ocr, tesseract, verify, repair, integrity, files]
commands: [app.components]
contexts: [dialog.components, tools]
outside: [Windows Settings, Apps, Installed apps]
---
Monstera uses a few tools of its own to read, convert and recognise documents. The **Components** window lists them, shows their versions, and can check that their files have not changed since Monstera was installed.

## Steps

1. In the **Help** menu, choose **Components**. Or in the rail, choose **Tools**, then **Components** in the **Application** group.
2. Read each component's **Version** and **State**.
3. To check every file, choose **Verify files**. Monstera compares each file with the list it was built with.

![The Components window](screenshot:components-1)

## Good to know

- Every component is installed with Monstera. Nothing is downloaded, and nothing needs to be added later.
- **Installed** means every file is there. **Verified** means every file was checked and matches.
- **Changed** means a file is missing, has different contents, or an unexpected file sits beside one. Repair or reinstall Monstera from **Windows Settings**, **Apps**, **Installed apps**.
- **Not in this build** means this copy of Monstera was made without that component. The features that need it are not offered.

<!--
Screenshots to capture:
1. components-1 — dialog.components after Verify files in a Store build. Frame the dialog.
-->
