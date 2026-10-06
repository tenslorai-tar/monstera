---
id: pdf-from-markdown
title: Make a PDF from a Markdown file
summary: Turn a Markdown (.md) text file into a new PDF, or add it as pages to the open document.
keywords: [markdown, md, text to pdf, create pdf, convert markdown, append pages, notes to pdf]
commands: [document.new-from-markdown, document.append-markdown]
contexts: [dialog.markdown-import-problem, dialog.boxed-characters, tools]
---
Markdown is a simple way of writing formatted text in a plain text file. Monstera can turn one into a PDF.

## Steps

To make a new PDF:

1. In the rail, choose **Tools**, then **From Markdown…** in the **Create** group (**New PDF from Markdown…**).
2. Pick the .md file, then choose where to save the PDF. It opens in a new tab.

To add the pages to the open document:

1. Choose **Append Markdown…** (**Add pages from Markdown…**) in the **Create** group.
2. Pick the file and choose where to save the new pages' PDF. It opens in a tab and its pages are added to the end of your document.

![The Create group in Tools with From Markdown… and Append Markdown…](screenshot:pdf-from-markdown-1)

## Good to know

- Every page is US Letter size.
- The file must be UTF-8 text, up to 4 MB.
- Text in any language is kept. Greek, Cyrillic, Hebrew and Arabic come with Monstera, and a paragraph in Hebrew or Arabic reads right to left from the right margin. Thai, Chinese and Japanese lines break between words.
- Text is set in the fonts Monstera carries, and a script they do not cover, such as Chinese or Japanese, in a font installed on this computer whose licence allows it. A character no font here can draw is shown as a box. Once the PDF opens, Monstera lists each one with its line and column in your file. The box copies as the character you wrote.
- A table too wide for the page turns its pages sideways and sets its text smaller, and one wider still continues on further pages, its first column repeated on each.

<!--
Screenshots to capture:
1. pdf-from-markdown-1 — Tools section, Create group. Frame the group with the From Markdown… tooltip.
-->
