---
id: find-and-replace
title: Find and replace text
summary: Replace a word or phrase everywhere in the document from the Search tab.
keywords: [replace, find and replace, replace all, change word, substitute, rename throughout]
commands: [document.find]
contexts: [panel.search]
---
Replace everywhere changes every occurrence of a word or phrase in the document's text, on every page.

## Steps

1. Press **Ctrl+F** to open the **Search** tab.
2. Type the text to find, and set **Match case**, **Whole word** or **Regular expression** if you need them.
3. Type the new text in **Replace with**.
4. Choose **Replace everywhere**.

![The Search tab with Replace with filled in and the Replace everywhere button](screenshot:find-and-replace-1)

## Good to know

- This changes every page, including ones you are not looking at. Use **Undo** (**Ctrl+Z**) to put it all back.
- Some PDFs draw a single word in separate pieces. Those words are left as they were; change them with "Edit text on the page".
- If the new words are a different width and more text follows them on the same line in a separate piece, nothing is changed, because that text would have to move. Your words stay in the boxes; change that line with "Edit text on the page".
- The replacement uses the page's own font where it can.
- Leave **Replace with** empty to delete the word wherever it appears.
- If nothing Monstera can replace matches, you are told "Nothing was changed", and no step is added to **Undo**.

<!--
Screenshots to capture:
1. find-and-replace-1 — Search tab with find text "Colour" and Replace with "Color". Frame the Replace with field and Replace everywhere button.
-->
