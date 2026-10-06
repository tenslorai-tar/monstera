---
id: accessibility-check
title: Run an accessibility check
summary: Check whether a document works for people who use a screen reader, see what to fix, and see each problem on the page.
keywords: [accessibility, pdf/ua, a11y, screen reader, alt text, tagged, compliance, check document]
commands: [document.accessibility-check]
contexts: [review]
---
The accessibility check looks at the parts of the PDF/UA accessibility standard that a computer can decide from the file. It lists what needs fixing in plain words, and shows where each problem is on the page.

## Steps

1. In the rail, choose **Review**, then **Accessibility check** in the **Accessibility** group. The **Accessibility** tab opens in the panel on the right and checks the document.
2. Under **Needs fixing**, each problem says what it means and what to do about it, for example that a link has no description, so a screen reader cannot say where it goes.
3. Choose a page button under a problem, such as "Page 3". The page scrolls to it and the place is marked. Choose **Clear the mark on the page** when you are done.
4. Under **Needs a person to check**, look at each item yourself: Monstera cannot tell whether it is a problem.
5. Under **Checks for a person**, work through each item, such as whether the reading order makes sense and whether each picture's description says what it shows.

![The Accessibility tab beside the page, listing what needs fixing](screenshot:accessibility-check-1)

## Good to know

- A problem about the whole file, such as missing document information, says so and has no page to point to.
- Where Monstera cannot make the repair, the line says to fix it in the program that made the file, then export the PDF again.
- Passing the automatic checks does not show that a document is accessible. The checks for a person matter as much.
- If the document changes after a check, the tab says the result is older. Choose **Check again**.
- The document is not changed.

<!--
Screenshots to capture:
1. accessibility-check-1 — An untagged document; the Accessibility tab after Accessibility check. Frame the panel.
-->
