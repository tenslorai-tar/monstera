---
id: docusign
title: Send a document for signing with DocuSign
summary: Send the document to DocuSign so it emails your signers, then save the signed copy back.
keywords: [docusign, e-signature, send for signature, signers, envelope, signed copy, esign]
commands: [document.docusign-send, document.docusign-retrieve]
contexts: [dialog.docusign-send, dialog.docusign-notice, protect]
---
If you use DocuSign, Monstera can send the open document to it. DocuSign emails each signer, and once everyone has signed you can save the signed copy.

## Steps

1. Add your DocuSign integration key: open **Settings**, choose the **Integrations** page, and fill in **DocuSign integration key** and **DocuSign environment**.
2. In the rail, choose **Protect**, then **Send to DocuSign** in the **Signatures** group.
3. Type the **Email subject**, and each signer's **Signer name** and **Signer email** (**Add signer** for more).
4. Choose **Send**. Sign in to DocuSign in your web browser when asked.
5. When everyone has signed, choose **Save signed copy from DocuSign** and choose where to save it.

![The Send to DocuSign window with a subject and one signer](screenshot:docusign-1)

## Good to know

- Sending uploads the document to DocuSign. You need your own DocuSign account; DocuSign's own terms apply.
- The DocuSign buttons appear only once an integration key is stored.
- If DocuSign has not finished yet, Monstera tells you its status instead of saving.
- A signed copy can be saved only for a document sent since Monstera was started.

<!--
Screenshots to capture:
1. docusign-1 — dialog.docusign-send with a subject and one signer. Frame the dialog.
-->
