---
id: straighten-photographed-pages
title: Crop photographed pages to the paper
summary: Turn a photo of a sheet of paper, taken at an angle, into a flat page that is just the sheet.
keywords: [document scan, photo of paper, perspective, crop to paper, crop photo, edge detection, phone photo]
commands: [document.straighten-scans]
contexts: [dialog.scan-outcome, tools]
---
If a page is a photo of a sheet of paper lying on a desk, Monstera can find the sheet, correct the angle the photo was taken at, and crop the page to just the sheet.

## Steps

1. In the rail, choose **Tools**, then **Crop to paper** in the **OCR** group (its full name is **Crop photographed pages to the paper**).
2. Monstera looks for the sheet on each photographed page, then crops the pages where it found one.
3. The **Crop to paper** window says how many pages were cropped. If no sheet was found, it says so and nothing is changed.

![A photographed page before and after cropping to the paper](screenshot:straighten-photographed-pages-1)

## Good to know

- The sheet must be lighter than what it is lying on.
- The result is greyscale.
- Pages that already have text, and pages made of more than one picture, are left alone.
- Undo with **Ctrl+Z**.
- To turn a slightly tilted scan upright, use **Straighten** instead: see "Straighten crooked scanned pages".

<!--
Screenshots to capture:
1. straighten-photographed-pages-1 — A phone photo of a letter on a dark desk as a PDF page; before and after. Frame the page.
-->
