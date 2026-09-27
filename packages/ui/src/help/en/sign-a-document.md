---
id: sign-a-document
title: Sign a document digitally
summary: Sign with your certificate file (.p12 or .pfx), optionally certifying it and adding a timestamp.
keywords: [digital signature, sign, certificate, p12, pfx, certify, timestamp, esign, signing, pkcs7]
commands: [document.sign-document]
contexts: [dialog.sign-document, dialog.sign-problem, protect]
---
A digital signature proves who signed a document and shows whether it has changed since. You need a certificate file (.p12 or .pfx) from your organisation or a certificate provider.

## Steps

1. In the rail, choose **Protect**, then **Sign document** in the **Signatures** group.
2. Fill in **Certificate password (leave empty if it has none)**, and if you like the optional **Signed by (optional)**, **Reason (optional)**, **Location (optional)** and **Contact (optional)** fields.
3. In **This signature says**, choose **I approve this document**, or, if you are the author, one of the three choices that begin "I am the author", which also say what may still change.
4. In **Timestamp**, choose **No timestamp**, **DigiCert**, **GlobalSign** or **Sectigo**.
5. Choose **Choose certificate and sign**, and pick your certificate file.

![The Sign document window with This signature says and Timestamp](screenshot:sign-a-document-1)

## Good to know

- Your certificate never leaves this computer, and its password is not kept.
- A timestamp proves when you signed. Only a fingerprint of the signature is sent to the timestamp service, never the document. These services are reached without encryption, so someone watching the network could see that a timestamp was requested.
- If the timestamp service cannot be reached or refuses, the document is not signed; try another service or sign without one.
- This signature is invisible on the page. To show one, see "Add a visible signature".
- Sign last: changes made after signing show up as changes when the signature is checked.

<!--
Screenshots to capture:
1. sign-a-document-1 — dialog.sign-document with Reason filled, "I approve this document", Timestamp DigiCert. Frame the dialog.
-->
