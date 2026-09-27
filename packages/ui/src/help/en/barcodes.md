---
id: barcodes
title: Add and read barcodes and QR codes
summary: Place a QR code or other barcode on a page, or read the barcodes already on a page.
keywords: [barcode, qr code, qr, data matrix, aztec, pdf417, code 128, ean-13, scan code, read barcode]
commands: [organize.barcode, document.read-barcodes]
contexts: [dialog.place-barcode, dialog.page-barcodes, organize]
---
Monstera can draw a barcode or QR code onto a page, and read the barcodes on the page you are looking at.

## Steps

To add a barcode:

1. In the rail, choose **Organize**. In the **Marks** group, choose **More**, then **Barcode** (**Add a barcode**).
2. Drag a box on the page where it should go.
3. Type the **Text or link**, pick a **Barcode type** (**QR Code**, **Data Matrix**, **Aztec**, **PDF417**, **Code 128** or EAN-13, for a number of up to 13 digits), and choose **Add to the page**.

To read barcodes:

1. Go to the page.
2. In the **Marks** group, choose **More**, then **Read barcodes**. The window lists each barcode's **Type** and **What it says**.

![The Add a barcode window with Text or link and Barcode type](screenshot:barcodes-1)

## Good to know

- If a barcode type cannot hold your text, the window stays open so you can change the text or type.
- EAN-13 takes up to 13 digits; a shorter number gets leading zeros.
- A link in a barcode that is read is shown, never opened.
- A placed barcode can be moved, resized or deleted like an image. Undo with **Ctrl+Z**.

<!--
Screenshots to capture:
1. barcodes-1 — dialog.place-barcode after dragging a box, text "https://example.com", QR Code. Frame the dialog.
-->
