---
id: pdf-from-images
title: Make a PDF from pictures
summary: Combine JPEG and PNG pictures into a new PDF, one picture per page.
keywords: [images to pdf, pictures to pdf, jpg to pdf, png to pdf, photos, combine images, scans to pdf]
commands: [document.new-from-images]
contexts: [dialog.markdown-import-problem, tools]
---
Pick several pictures and Monstera makes a PDF with one picture on each page.

## Steps

1. In the rail, choose **Tools**, then **From images** in the **Create** group. In a narrower window it is under the group's **More**, as **New PDF from images…**.
2. Pick the JPEG or PNG files.
3. Choose where to save the PDF. It opens in a new tab.

![The Create group with From images](screenshot:pdf-from-images-1)

## Good to know

- Pages are in file-name order, with numbers compared as numbers, so "scan 2" comes before "scan 10".
- Each page is the size of its picture; very large pictures are scaled down.
- Up to 500 pictures at once. A picture larger than 256 MB is refused with a message naming the file.
- Up to 1024 MB of pictures together. A larger set is refused before anything is imported, and the message gives the set's size, the limit, and how many groups to split the pictures into, each made into its own PDF.

<!--
Screenshots to capture:
1. pdf-from-images-1 — Tools section, Create group. Frame the group.
-->
