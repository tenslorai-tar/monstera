---
id: pdf-table-from-csv
title: Make a PDF table from a CSV file
summary: Turn a CSV spreadsheet file into a PDF with a table.
keywords: [csv, spreadsheet, table, comma separated, convert csv, data to pdf]
commands: [document.new-from-csv]
contexts: [dialog.markdown-import-problem, tools]
---
A CSV file is a simple spreadsheet saved as text. Monstera can lay it out as a table in a new PDF.

## Steps

1. In the rail, choose **Tools**, then **From CSV…** in the **Create** group (**New PDF table from CSV…**).
2. Pick the .csv file, then choose where to save the PDF. It opens in a new tab.

![A PDF table made from a CSV file, with its bold first row](screenshot:pdf-table-from-csv-1)

## Good to know

- The first row is shown in bold as the heading.
- The file must be UTF-8 text, up to 1 MB.
- Each column is as wide as what it holds needs. A table too wide for the page turns the page sideways and sets its text smaller, and one wider still continues on further pages, the first column repeated on each so every row is still named.
- A quote out of place, or a character the standard fonts cannot draw, stops the import; the message names the line.

<!--
Screenshots to capture:
1. pdf-table-from-csv-1 — The PDF produced from a 4-column CSV. Frame the first page's table.
-->
