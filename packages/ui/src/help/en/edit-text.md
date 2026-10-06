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

1. In the rail, choose **Edit**, then **Edit text** in the **Text** group (its full name is **Edit text on the page**), or press **Ctrl+Shift+T**.
2. Every block of text you can edit is outlined. Click the block you want, and the cursor opens where you clicked.
3. Type your changes. If a line gets longer than its block, it wraps onto a new line and the text below moves down.
4. Press **Esc** or click away to finish. The change is written into the page.

![A page in Edit text mode with blocks outlined and one open for editing](screenshot:edit-text-1)

## Good to know

- Undo with **Ctrl+Z** puts the text back as it was.
- A paragraph is edited as a paragraph. A line that wraps at the edge of the block is part of the same paragraph, so the words flow as you type, and only the lines from your change onward are set again; the lines above and below stay as they were. A new paragraph starts only where you press **Enter**.
- Each word keeps its own look. A bold word that moves to the next line is still bold, and a word you type takes the look of the word you typed it into. A centred or right-aligned paragraph stays that way, and so does an indented first line.
- While a block is open, a bar above it formats the words you have selected: font, size, colour, bold, italic, underline, superscript and subscript, alignment, bullets and numbering, indent and line spacing. The same buttons are in the **Edit** rail. **Ctrl+B**, **Ctrl+I** and **Ctrl+U** work as in a word processor. Bold, italic and underline switch off again when every selected word already has them. Alignment, indent, spacing and lists apply to the paragraphs the selection touches. Press **Tab** to move to the next tab stop.
- The squares around the open block are controls. Drag a side to change the width of the text (it wraps again at the new width), a corner to make it bigger or smaller, the grip at the top to move it, and the round handle to its right to turn it. Whatever you do to the block is shown at once and written together with your words when you finish, as one change, so one **Ctrl+Z** puts it all back. You can do the same from the keyboard: **Alt** with an arrow moves the block a point (hold **Shift** for ten), **Alt** with **+** or **-** scales it, **Alt** with **[** or **]** changes its width, and **Alt** with **,** or **.** turns it. **Remove this text** in the bar above the block takes the block off the page.
- A block you turn is saved as text set at an angle, and text set at an angle is not offered for editing, so turn a block last. A page that draws its text in the kind of font described below cannot yet be moved, resized, turned or added to, and says so.
- A bullet or number is written into the text as its first characters, so it is kept when the file is opened elsewhere. Turning the list off takes those characters away again.
- Click another block while one is open and Monstera writes the open block first, then opens the one you clicked, so nothing you typed is lost. While the first is being written its words stay on screen and cannot be typed into. If the write is refused, your words stay in the box with the reason, and the block you clicked does not open over them.
- To add text where there is none, choose **Add text** next to **Edit text** in the **Text** group, then click the page where the new words should go and type. The box is as wide as the page’s margin allows and is set in 12 point Helvetica, which the bar above it changes. Press **Esc** or click away to add it; a box with nothing in it adds nothing. It is one box at a time, and then you are back in Edit text, where the new block can be moved, resized or turned like any other.
- Right-click in the words for a menu. Over a word that is spelled wrongly it offers the likeliest corrections (choose one to replace the word) and **Add “word” to the dictionary**; below those are **Cut**, **Copy**, **Paste** and **Select all**. Cut and Copy are available when something is selected. Your own dictionary is the one **Spell check** uses, and if it is full the menu says so beside the words.
- The same menu has **Join with the text above**, **Join with the text below** and **Split the text before this paragraph**, offered where they apply and while the open block has nothing unwritten (press **Esc** first to write what you typed). A join makes the two blocks one paragraph, keeping the look of each word, and the text that was below moves up to follow the first. A split makes the paragraph the pointer is in, and those after it, a block of its own, moved down by a line so the two stay apart. Each is one change and one **Ctrl+Z**. A split moves text, so on a page that draws its text in the kind of font described below it is refused, says so, and changes nothing.
- A single word wider than the block is broken between letters at the block's edge, so it never runs across what sits beside it.
- Where the page behind the block is shaded, the box you type in is shaded to match rather than a flat patch. Where two blocks overlap, a click chooses the smaller one.
- While you type, the words are shown in the page's own font wherever the document carries that font and Monstera can confirm its letters are the ones on the page. Otherwise they are shown in a similar font of the same kind, and the page itself still gets its own font when you finish.
- If the page's font cannot show a word you type, that word is set in another copy of the same font already on the page where one can show it, and otherwise in the closest font Monstera brings with it or one installed on this computer whose licence allows editing. The rest of the line keeps the page's font.
- If none of those fonts can show a character, it is drawn as a small empty box (□) and your change is still made. The text keeps the real character, so copying or searching finds it, and Monstera tells you which characters are shown as boxes and on which page.
- When a change cannot be made, your words stay in the box with the reason under them. Change the words and finish again, or press **Esc** to put the text back.
- Some pages, often ones printed from a web browser, draw their text in a kind of font that is drawn from shapes stored in the page. On those pages you can change the words too. Words made of letters the page already holds keep its own look; a word that needs a letter the page has no shape for is set in the closest font Monstera brings with it or one installed on this computer, and a character no font has is drawn as a box, as on any other page.
- If one page’s text cannot be read, that page says so and Edit text stays on for the other pages. Only a computer with no editing engine at all ends the mode.
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
