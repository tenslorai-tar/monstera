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
- The replacement uses the page's own font where it can. A word that font cannot show is set in another copy of the same font already on the page where one can show it, and otherwise in the closest font Monstera brings with it or one installed on this computer whose licence allows editing. The rest of the line keeps the page's font.
- If none of those fonts can show a character, it is drawn as a small empty box (□) and the change is still made. The text keeps the real character, so copying or searching finds it, and Monstera tells you which characters are shown as boxes and on which pages.
- Leave **Replace with** empty to delete the word. Where more text follows it on the same line in a separate piece, nothing is changed, for the reason above.
- If nothing Monstera can replace matches, you are told "Nothing was changed", and no step is added to **Undo**.

<!--
Screenshots to capture:
1. find-and-replace-1 — Search tab with find text "Colour" and Replace with "Color". Frame the Replace with field and Replace everywhere button.
-->
