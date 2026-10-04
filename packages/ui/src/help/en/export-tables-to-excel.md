---
id: export-tables-to-excel
title: Export tables to Excel
summary: Find the tables in a document, check and correct them, and save them to an Excel workbook.
keywords: [excel, xlsx, tables, spreadsheet, export tables, pdf to excel, cells, azure, claude, scanned table]
commands: [document.export-excel]
contexts: [dialog.export-excel, dialog.service-refused, home]
---
Export tables to Excel reads the tables in your document, lets you check and correct every cell, and saves them to a workbook with their fonts, borders, shading and number formats.

## Steps

1. In the rail, choose **Home**, then **Export** in the **Export** group, and **Export tables to Excel…**.
2. If you have added an Azure or Claude key, choose in **Read the tables with**: **This PDF's own text**, **Azure Document Intelligence** or **Claude**. Without a key, the window uses the PDF's own text and says how to add a key.
3. With **This PDF's own text**, the window shows the tables on the page you are reading. Use **Previous page** and **Next page** to look through the others, and click any cell to correct it.
4. In **Where the tables go**, choose **A sheet for each page that has tables** or **Every table on one sheet**.
5. Choose **Choose where to save…** and save the workbook.

![The Export tables to Excel window showing a table's cells, the page buttons and the two choices](screenshot:export-tables-to-excel-1)

## Good to know

- **This PDF's own text** works on tables with ruled lines best; a table without lines may be split at its gaps.
- For scanned tables, recognise the text first (Tools › OCR), or use Azure Document Intelligence or Claude. Those send your pages to that service, which the window says before anything is sent. You need your own key, and the service bills you directly. See "Get and add keys for AI and online reading services".
- Cells found by Azure or Claude are written without fonts, borders or shading.
- If the document has no tables, Monstera says so before asking where to save.
- If the document changes while you are checking the tables, nothing is written; export again.
- Very long cells are shown read-only and exported as found.

<!--
Screenshots to capture:
1. export-tables-to-excel-1 — dialog.export-excel on a page with a ruled 3×3 table, one cell being edited. Frame the dialog.
-->
