---
id: accessibility-check
title: Run an accessibility check
summary: Run the automatic PDF/UA accessibility checks and see the checks only a person can make.
keywords: [accessibility, pdf/ua, a11y, screen reader, alt text, tagged, compliance, check document]
commands: [document.accessibility-check]
contexts: [dialog.accessibility-check, review]
---
The accessibility check runs the parts of the PDF/UA accessibility standard that a computer can decide from the file, and lists the checks that need a person.

## Steps

1. In the rail, choose **Review**, then **Accessibility check** in the **Accessibility** group.
2. Under **Automatic checks**, each rule shows **Passed**, **Failed**, **Does not apply** or **Could not be decided**, with the pages involved. Failures come first.
3. Under **Checks for a person**, work through each item yourself, such as whether the reading order makes sense and whether alternative text describes each figure.

![The Accessibility check window with Automatic checks and Checks for a person](screenshot:accessibility-check-1)

## Good to know

- Passing the automatic checks does not show that a document is accessible. The checks for a person matter as much.
- Some deeper checks on the page content are not made.
- The document is not changed.

<!--
Screenshots to capture:
1. accessibility-check-1 — An untagged document; dialog.accessibility-check. Frame the dialog.
-->
