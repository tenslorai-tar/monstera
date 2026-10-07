---
id: reading-order
title: See a page's reading order
summary: List the items on the page you are on in the order a screen reader reads them, and see each one on the page.
keywords: [reading order, tags, tagged pdf, structure, accessibility, screen reader, headings]
commands: [document.inspect-page-structure]
contexts: [review]
---
Accessible PDFs carry tags that tell screen readers what each part of a page is, such as a heading, a paragraph or a table, and in what order to read it. This shows them for the page you are on.

## Steps

1. Go to the page.
2. In the rail, choose **Review**, then **Reading order** in the **Accessibility** group. The **Accessibility** panel opens on the left, on **Reading order**. Choose the cross at its top, or any of the panel's tabs, to close it.
3. The panel lists each item in the order a screen reader reads it, with plain names such as Heading 1, Paragraph or List label, indented to show nesting, and how many lines of text each holds.
4. Choose an item. The page marks the text it covers. Choose **Clear the mark on the page** to remove the mark.
5. Turn to another page and the list follows you.

![The Accessibility panel on Reading order, with one item marked on the page](screenshot:reading-order-1)

## Good to know

- An item with no text, such as a picture, is listed but has nothing to mark.
- A page with no tags says so: a screen reader has no reading order to follow there.
- Text that is in no tag is counted, because a screen reader may skip it.
- It does not say whether the order matches the order on the page; check that by reading.

<!--
Screenshots to capture:
1. reading-order-1 — A tagged report page; the Accessibility panel on the left on Reading order with one item chosen. Frame the panel and the page.
-->
