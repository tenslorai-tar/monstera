---
id: headers-and-footers
title: Add headers and footers
summary: Add text at the top or bottom of pages, including page numbers.
keywords: [header, footer, page numbers, page x of y, running head, top of page, bottom of page]
commands: [document.header-footer, document.edit-header-footer, document.remove-header-footer]
contexts: [dialog.header-footer, organize]
---
Headers and footers put text at the top and bottom of pages, on the left, in the centre or on the right. They can include the page number.

## Steps

1. In the rail, choose **Organize**, then **Headers…** in the **Marks** group (**Headers and footers…**).
2. Under **Header** and **Footer**, type text in any of **Left**, **Centre** and **Right**. Type `{n}` for the page number and `{N}` for the number of pages, for example `Page {n} of {N}`.
3. Choose a **Font** (Helvetica, Times or Courier, which every PDF reader has, or any font on this computer, which is saved inside the PDF), and set **Size (points)** and **Margin (points)** if you want.
4. Choose a **Colour**. **Standard colour** is black.
5. Choose **This page** or **All pages**, then **Add**.

![The Headers and footers window with a footer reading Page {n} of {N}](screenshot:headers-and-footers-1)

## Change or remove headers and footers

1. In **Organize**, open **Edit marks** in the **Marks** group.
2. Choose **Edit headers and footers…** to open the same window with their settings filled in. Change what you want, then choose **Apply changes**. The change is made on every page that has them.
3. Or choose **Remove headers and footers** to take them off every page. Everything else on the page stays as it was.

Both still work after the file is saved and opened again, and each is one step for **Undo**.

## Good to know

- `{N}` is the number of pages in the whole document.
- Headers and footers added by an earlier version of Monstera cannot be changed or removed. Monstera says so and leaves them.
- Undo with **Ctrl+Z**.

<!--
Screenshots to capture:
1. headers-and-footers-1 — dialog.header-footer with Footer Centre "Page {n} of {N}". Frame the dialog.
-->
