---
id: reading-order
title: See a page's reading order and tags
summary: Show the tagged structure of the page you are on, as screen readers would follow it.
keywords: [reading order, tags, tagged pdf, structure, accessibility, screen reader, headings]
commands: [document.inspect-page-structure]
contexts: [dialog.pageStructure, review]
---
Accessible PDFs carry tags that tell screen readers what each part of a page is (a heading, a paragraph, a table) and in what order to read it. This shows the tags on one page.

## Steps

1. Go to the page.
2. In the rail, choose **Review**, then **Reading order** in the **Accessibility** group.
3. The **Reading order and tags** window lists each tag in the document's order, indented to show nesting, with how many lines it holds. It also counts lines outside every tag and the images on the page.

![The Reading order and tags window](screenshot:reading-order-1)

## Good to know

- One page at a time.
- A page with no tags says **This page has no tags.**
- It does not say whether the tag order matches the order on the page; check that by reading.

<!--
Screenshots to capture:
1. reading-order-1 — A tagged report page; dialog.pageStructure. Frame the dialog.
-->
