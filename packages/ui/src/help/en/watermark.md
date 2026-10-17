---
id: watermark
title: Add a watermark
summary: Write faint, angled text such as DRAFT or CONFIDENTIAL across pages.
keywords: [watermark, draft, confidential, stamp text, background text, diagonal text]
commands: [document.watermark-pages, document.edit-watermark, document.remove-watermark]
contexts: [dialog.watermark-pages, organize]
---
A watermark is text drawn across the page, such as DRAFT, usually faint and at an angle.

## Steps

1. In the rail, choose **Organize**, then **Watermark…** in the **Marks** group.
2. Type the **Text**.
3. Set **Opacity (%)**, **Angle (degrees)** and **Size (points)**, or leave them empty for the defaults. Choose a **Font**: Helvetica, Times or Courier, which every PDF reader has, or any font on this computer.
4. Choose a **Colour**. **Standard colour** is grey.
5. Choose **This page** or **All pages**, then **Add watermark**.

![The Watermark window with Text, Opacity, Angle and Size](screenshot:watermark-1)

## Change or remove a watermark

1. In **Organize**, open **Edit marks** in the **Marks** group.
2. Choose **Edit watermark…** to open the same window with the watermark's settings filled in. Change what you want, then choose **Apply changes**. The change is made on every page that has the watermark.
3. Or choose **Remove watermark** to take it off every page. Everything else on the page stays as it was.

Both still work after the file is saved and opened again, and each is one step for **Undo**.

## Good to know

- A font from this computer is saved inside the PDF, only the letters you used, so the watermark looks the same wherever the file is opened.
- A watermark another program added is changed or removed too when it was saved as a separate mark. One written into the page itself is left, and Monstera says so.
- A mark added by an earlier version of Monstera cannot be changed or removed, because it cannot be told apart safely from the page. Monstera says so and leaves it.
- A page that shows nothing, because its visible area lies outside the page, is left as it is. Every other page gets the watermark, and Monstera names the pages it left.
- Undo with **Ctrl+Z**.

<!--
Screenshots to capture:
1. watermark-1 — dialog.watermark-pages with "DRAFT", 20%, 45°, 72. Frame the dialog; optional second shot of a page after applying.
-->
