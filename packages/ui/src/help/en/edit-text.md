---
id: edit-text
title: Edit text on the page
summary: Click a block of text on the page and change the words where they are.
keywords: [edit text, change text, correct typo, rewrite, modify pdf text, in place editing, reflow, unpack]
commands: [text.edit]
contexts: [edit]
---
Edit text lets you change the words already on a page, in place, keeping their font, size and colour where the font allows.

## Steps

1. In the rail, choose **Edit**, then **Edit text** in the **Text** group (its full name is **Edit text on the page**).
2. Every block of text you can edit is outlined. Click the block you want.
3. Type your changes. If a line gets longer than its block, it wraps onto a new line and the text below moves down.
4. Press **Esc** or click away to finish. The change is written into the page.

![A page in Edit text mode with blocks outlined and one open for editing](screenshot:edit-text-1)

## Good to know

- Undo with **Ctrl+Z** puts the text back as it was.
- While you type, the words are shown in the page's own font wherever the document carries that font and Monstera can confirm its letters are the ones on the page. Otherwise they are shown in a similar font of the same kind, and the page itself still gets its own font when you finish.
- If the page's font cannot show a word you type, that word is set in another copy of the same font already on the page where one can show it, and otherwise in the closest font Monstera brings with it or one installed on this computer whose licence allows editing. The rest of the line keeps the page's font.
- If none of those fonts can show a character, it is drawn as a small empty box (□) and your change is still made. The text keeps the real character, so copying or searching finds it, and Monstera tells you which characters are shown as boxes and on which page.
- When a change cannot be made, your words stay in the box with the reason under them. Change the words and finish again, or press **Esc** to put the text back.
- Some pages, often ones printed from a web browser, draw their text in a kind of font that is drawn from shapes stored in the page. On those pages you can change the words using the letters the page already holds. A word that needs a letter the page has no shape for is not written yet: your words stay in the box and you are told which letters are missing.
- Some pages use a font Monstera cannot rewrite yet. On those pages you are told "This page uses a font Monstera can’t rewrite yet, so nothing was changed", and the page stays as it was.
- Deleting every word of a block removes the block from the page.
- If some text was pasted into the page as a single block, Monstera says so and offers **Unpack it so it can be edited**.
- Text set at an angle cannot be edited in place.
- If your words run past the edge of the page, nothing is lost: the change is made with every word, and the editor opens again over the block with "This text no longer fits on the page" above it, so you can shorten what you wrote. Words past the edge are kept in the file but cannot be seen on the page, found by search or printed until they fit. When you close the editor, the block keeps a solid outline and the same sentence.
- Text that grows can overlap what is below it; check the page afterwards. Justified text loses its even edges when edited.
- To change a word everywhere in the document, see "Find and replace text".

<!--
Screenshots to capture:
1. edit-text-1 — Edit section, Edit text mode on a page with several paragraphs, one block open with the caret in it. Frame the page area.
-->
