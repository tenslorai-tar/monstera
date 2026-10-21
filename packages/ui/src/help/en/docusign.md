---
id: docusign
title: Send a document for signing with DocuSign
summary: Send the document to DocuSign so it emails your signers, then save the signed copy back.
keywords: [docusign, e-signature, send for signature, signers, envelope, signed copy, esign]
commands: [document.docusign-send, document.docusign-retrieve]
contexts: [dialog.docusign-send, dialog.docusign-notice, protect]
outside: [Apps and Keys, integration key, Authorization Code Grant]
---
If you use DocuSign, Monstera can send the open document to it. DocuSign emails each signer, and once everyone has signed you can save the signed copy.

## Before you start

Monstera needs an integration key from your DocuSign account. You make it once:

1. In DocuSign, open **Apps and Keys** and add an app. DocuSign gives it an **integration key**.
2. For how the app signs in, choose **Authorization Code Grant**. When DocuSign asks whether your app can keep a secret key, answer no: Monstera signs in with PKCE, so no secret key is needed.
3. Add these three redirect URIs, exactly as written. Monstera signs in on whichever of them is free on your computer, and DocuSign refuses a sign-in on an address it was not given.
   - `http://127.0.0.1:8791/docusign`
   - `http://127.0.0.1:8792/docusign`
   - `http://127.0.0.1:8793/docusign`
4. Copy the integration key. In Monstera, open **Settings**, choose the **Integrations** page, and paste it into **DocuSign integration key**.
5. In **DocuSign environment**, choose **Developer demo** for a DocuSign developer account, or **Production** for a paid account.

## Steps

1. Check that your integration key is in **Settings**, on the **Integrations** page (see "Before you start").
2. In the rail, choose **Protect**, then **Send to DocuSign** in the **Signatures** group.
3. Type the **Email subject**, and each signer's **Signer name** and **Signer email** (**Add signer** for more).
4. Choose **Send**. Sign in to DocuSign in your web browser when asked.
5. When everyone has signed, choose **Save signed copy from DocuSign** and choose where to save it.

![The Send to DocuSign window with a subject and one signer](screenshot:docusign-1)

## Good to know

- Sending uploads the document to DocuSign. You need your own DocuSign account; DocuSign's own terms apply.
- The DocuSign buttons appear only once an integration key is stored.
- If DocuSign shows an error about the redirect URI when you sign in, check that all three addresses above are added to the app, with nothing changed.
- A key made in a developer account works with **Developer demo**. To use it with **Production**, DocuSign must first approve it through its go-live review.
- If DocuSign has not finished yet, Monstera tells you its status instead of saving.
- A signed copy can be saved only for a document sent since Monstera was started.

<!--
Screenshots to capture:
1. docusign-1 — dialog.docusign-send with a subject and one signer. Frame the dialog.
-->
