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
2. Under **What is in this document?**, choose **Typed text** if the words are already in the PDF. For pages that are pictures, choose **Printed scan, read on this computer**, or, if you have added an Azure or Claude key, **Handwritten or scanned, read by Azure** or **by Claude**. Without a reader set up, the window uses the PDF's own text and says how to add one.
3. With **Typed text**, the window shows the tables on the page you are reading. Use **Previous page** and **Next page** to look through the others, and click any cell to correct it.
4. In **Pages**, keep **Every page**, or choose **Select pages** and type the pages whose tables you want, for example 1-3, 5. You can still look at any page while you check.
5. In **Where the tables go**, choose **A sheet for each page that has tables** or **Every table on one sheet**.
6. Choose **Choose where to save…** and save the workbook.

![The Export tables to Excel window showing a table's cells, the page buttons and the two choices](screenshot:export-tables-to-excel-1)

## Good to know

- **Typed text** works on tables with ruled lines best; a table without lines may be split at its gaps.
- With Azure or Claude, only the pages you chose are sent, and the window says how many before anything is sent. The bar at the bottom shows how many pages have been read, and **Cancel** there stops after the page in hand and writes no file.
- **Printed scan, read on this computer** reads the pages you chose first, with nothing leaving your computer, then finds the tables in what it read. The words are also kept, unseen, in your document so it can be searched, and **Undo** (**Ctrl+Z**) takes out all the pages of one reading together. Cancel in the bar stops, and no file is written.
- For handwritten tables, use Azure or Claude. Those send your pages to that service, which the window says before anything is sent. You need your own key, and the service bills you directly. See "Get and add keys for AI and online reading services".
- Cells found by Azure or Claude are written without fonts, borders or shading.
- If the document has no tables, Monstera says so before asking where to save.
- If the document changes while you are checking the tables, nothing is written; export again.
- Very long cells are shown read-only and exported as found.

<!--
Screenshots to capture:
1. export-tables-to-excel-1 — dialog.export-excel on a page with a ruled 3×3 table, one cell being edited. Frame the dialog.
-->
