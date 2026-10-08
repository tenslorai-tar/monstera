---
id: barcodes
title: Add and read barcodes and QR codes
summary: Place a QR code or other barcode on a page, or read the barcodes already on a page.
keywords: [barcode, qr code, qr, data matrix, aztec, pdf417, code 128, ean-13, scan code, read barcode]
commands: [organize.barcode, document.read-barcodes]
contexts: [dialog.place-barcode, dialog.page-barcodes, edit, tools]
---
Monstera can draw a barcode or QR code onto a page, and read the barcodes on the page you are looking at.

## Steps

To add a barcode:

1. In the rail, choose **Edit**, then **Add a barcode** in the **Text** group, beside **Text box** and **Image**. In a narrower window it is under the group's **More**.
2. Drag a box on the page where it should go.
3. Type the **Text or link**, pick a **Barcode type** (**QR Code**, **Data Matrix**, **Aztec**, **PDF417**, **Code 128** or EAN-13, for a number of up to 13 digits), and choose **Add to the page**.

To read barcodes:

1. Go to the page.
2. In the rail, choose **Tools**, then **Read barcodes** in the **OCR** group (under the group's **More** in a narrower window). The window lists each barcode's **Type** (like **QR code** or **Code 128**) and **What it says**, with what it is above it: a **Web link**, **Phone number**, **Email address**, **Contact card** or **Text**. A contact card is shown as name, title, company, phone, email and address lines. Choose **Show on the page** on a row to mark where that barcode is on the page, and **Save the contact** on a contact card to keep it as a `.vcf` file your address book can open. Choose **Copy** on a row, or **Copy all**. Choose **Read barcodes on all pages** to list the barcodes of every page, each with its page number.

![The Add a barcode window with Text or link and Barcode type](screenshot:barcodes-1)

## Good to know

- If a barcode type cannot hold your text, the window stays open so you can change the text or type.
- EAN-13 takes up to 13 digits; a shorter number gets leading zeros.
- A link in a barcode that is read is shown, and opened only when you choose the link button on its row.
- The mark on the page goes away when you close the list. A contact is saved exactly as the barcode says it, with every field it holds, even ones the list does not show. A short contact format that is not a full card is shown as text and is not saved as a contact.
- A placed barcode can be moved, resized or deleted like an image. Undo with **Ctrl+Z**.

<!--
Screenshots to capture:
1. barcodes-1 — dialog.place-barcode after dragging a box, text "https://example.com", QR Code. Frame the dialog.
-->
