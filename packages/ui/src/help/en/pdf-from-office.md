---
id: pdf-from-office
title: Make a PDF from a Word, Excel or PowerPoint file
summary: Turn a .docx, .xlsx or .pptx file into a new PDF.
keywords: [word, excel, powerpoint, docx, xlsx, pptx, office, convert to pdf, document to pdf, spreadsheet to pdf, slides to pdf]
commands: [document.new-from-office]
contexts: [dialog.markdown-import-problem, tools]
---
Monstera can turn a Word document, an Excel workbook or a PowerPoint deck into a new PDF, without Microsoft Office installed.

## Steps

1. In the rail, choose **Tools**, then **From Office…** in the **Create** group (**New PDF from Word, Excel or PowerPoint…**).
2. Pick the .docx, .xlsx or .pptx file.
3. Choose where to save the PDF. It opens in a new tab.

![A PDF made from a Word document, open in a new tab](screenshot:pdf-from-office-1)

## Good to know

- The file can be up to 100 MB.
- The older formats (.doc, .xls, .ppt) and OpenDocument files are not supported.
- Monstera uses the fonts it carries with it. Text in a font it does not have is shown in the closest one it has, so line breaks can differ from the original.
- An Excel workbook arrives with every sheet that is not hidden, in the order of its tabs, each laid out with its own page settings and print area. Hidden sheets are left out, as Excel leaves them out when it prints.
- A very long sheet is converted in parts and joined, so every row arrives. If some rows still cannot be converted, the PDF opens and a message lists each sheet and the rows that are not in it, and says how many more there are when the list is long.
- The conversion runs in a separate, locked-down process that cannot reach the internet or the rest of your files. Your file never leaves your computer.
- If the file is damaged, or is not the kind of file its name says, nothing is saved and Monstera tells you.

<!--
Screenshots to capture:
1. pdf-from-office-1 — The PDF produced from a one-page Word document with a heading and a paragraph. Frame the first page.
-->
