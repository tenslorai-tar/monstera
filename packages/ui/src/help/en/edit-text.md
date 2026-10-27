---
id: edit-text
title: Edit text on the page
summary: Change the words already on a page where they are, add new words to the page, and format them.
keywords: [edit text, change text, correct typo, rewrite, modify pdf text, in place editing, reflow, unpack, add text, font, format text, text box]
commands: [text.edit]
contexts: [edit]
---
Edit text lets you change the words already on a page, in place, keeping their font, size and colour where the font allows. **Add text** puts new words into the page itself.

## Change words on the page

1. In the rail, choose **Edit**, then **Edit text** in the **Text** group (its full name is **Edit text on the page**), or press **Ctrl+Shift+T**.
2. Every block of text you can edit is outlined. Click a block to select it, then click inside it again where you want the cursor.
3. Type your changes. A line that gets longer than its block wraps, and the block grows downwards.
4. Press **Esc** or click away to finish. The change is written into the page, and one **Ctrl+Z** puts the whole block back.

![A page in Edit text mode with blocks outlined and one open for editing](screenshot:edit-text-1)

## Add new words

1. In the **Text** group of **Edit**, choose **Add text**.
2. Click the page where the new words should go and type. The new words start in the size, colour, weight and kind of the text nearest to where you clicked; on a page with no text they start in 12 point black.
3. Press **Esc** or click away to add them. A box with nothing typed in it adds nothing.

It is one box at a time, and then you are back in Edit text, where the new block can be moved, resized, turned or formatted like any other.

## Format text

While a block is open, the **Properties** tab shows two sections for it. They change the words you have selected, or the paragraph the cursor is in.

- **Text**, in this order: the font and the size on one row; **Bold**, **Italic**, **Underline**, **Strikethrough**, **Superscript** and **Subscript**; the text colour; a **Highlight** colour behind the words; alignment (left, centre, right or **Justify**) with bullets, numbering and indent; then **Line spacing**, the space after the paragraph and **Character spacing in points**. A text box, typed text and a callout show the same section.
- **Box**: **Remove this text** takes the block off the page.

Choosing something there keeps the block open, so you can go on typing; click the page away from the block, or press **Esc**, when you are done. **Ctrl+B**, **Ctrl+I** and **Ctrl+U** work while you type.

Character spacing is typed in points and can open the letters up or close them together by up to about an eighth of the text size either way, and a larger number is held to that. Wider than that, search and copy would read a space between every letter, so the spacing stops there. Hebrew, Arabic and other right-to-left words are never spaced out, because a gap would break the joins between their letters.

The keys work as in a word processor: **Ctrl+B**, **Ctrl+I** and **Ctrl+U** for bold, italic and underline, **Ctrl+L**, **Ctrl+E**, **Ctrl+R** and **Ctrl+J** to align left, centre, right and justified, and **Ctrl+Shift** with the greater-than or less-than key to make the text a size bigger or smaller. Bold, italic and underline switch off again when every selected word already has them. **Tab** types a tab: the words after it move to the next tab stop, every half inch from the left edge of the block, and the tab is kept in the text, so copying or searching the page finds it and editing the block again shows it where you typed it. In a form, **Tab** still moves to the next field.

## Choose a font

The font field opens one list, the same wherever you choose a font in Monstera. Type in **Search fonts** to narrow it. Each name is shown in its own typeface where this computer can draw it.

- **In this document**: the fonts the file already uses, on every page and in its form fields. One that is not on this computer is drawn in a font that looks like it.
- **Recent**: the fonts you chose since Monstera started.
- **On this computer**: the fonts installed on this computer.
- **Included with Monstera**: fonts that come with Monstera. Some have the same letter widths as a common font, so searching for that font finds them too: **Search fonts** with “Calibri” also finds Carlito. Where this computer has Calibri itself, Calibri is used.
- **Built into PDF**: Helvetica, Times and Courier, which every PDF reader has.

In **Edit text** the list is grouped for the words you are changing:

- **In this document**: the fonts the file already uses.
- **Closest matches**: the fonts nearest to the page's own font for these words, with the one Monstera chose marked.
- **All fonts**: every font you can use, installed, included with Monstera or built into PDF.
- **As on the page**: puts the selected words back in the font the page has them in.

A text box, typed text, a stamp and a callout keep the groups above.

The list shows only fonts that can be used in a PDF. A font on this computer whose licence does not allow it to be put inside a PDF is not listed. If the list of this computer's fonts cannot be read, the list says so and still offers the fonts built into PDF.

## Text box or Add text: which do I need?

- **Add text** makes words that are part of the page, like the page's own text. Use it to fill in a gap, add a line to a letter or correct a document before you send it.
- **Text box** makes a comment: a box with a border that sits on top of the page. **Typewriter** is the same without a box, and **Callout** adds a line pointing at what it is about. Comments can be hidden, listed in the **Comments** panel and removed without touching the page.

**Text box** and **Typewriter** are in both the **Edit** tab and the **Comment** tab, so you find them in either; **Callout** and **Note** are in the **Comment** tab. See "Add a text box" and "Format text in a text box".

## Good to know

- The first click on a block selects it: a frame with handles appears around it, and you can move it, change its width, format the whole block or remove it, with no cursor in the words yet. A second click inside it puts the cursor exactly where you clicked, and **Enter** puts it at the end of the words. A double-click on a block does both at once.
- A paragraph is edited as a paragraph. A line that wraps at the edge of the block is part of the same paragraph, so the words flow as you type, and only the lines from your change onward are set again; the lines above and below stay as they were. A new paragraph starts only where you press **Enter**.
- Each word keeps its own look. A bold word that moves to the next line is still bold, and a word you type takes the look of the word you typed it into. A centred or right-aligned paragraph stays that way, and so does an indented first line.
- The squares just outside the open block are controls, and they never cover your words. Drag a side to change the width of the text (it wraps again at the new width), a corner to make it bigger or smaller, the grip at the top to move it, and the round handle to its right to turn it. Whatever you do to the block is shown at once and written together with your words when you finish, as one change, so one **Ctrl+Z** puts it all back. You can do the same from the keyboard: **Alt** with an arrow moves the block a point (hold **Shift** for ten), **Alt** with the plus or minus key scales it, **Alt** with the left or right square bracket key changes its width, and **Alt** with the comma or full stop key turns it.
- A block you turn is saved as text set at an angle, and text set at an angle is not offered for editing, so turn a block last. A page that draws its text in the kind of font described below is moved, resized, turned and added to the same way, and its blocks can be joined and split. A line you did not change is carried to its new place exactly as it was.
- A bullet or number is written into the text as its first characters, so it is kept when the file is opened elsewhere. Turning the list off takes those characters away again.
- Click another block while one is open and Monstera writes the open block first, then selects the one you clicked, so nothing you typed is lost. While the first is being written its words stay on screen and cannot be typed into. If the write is refused, your words stay in the box with the reason, and the block you clicked does not open over them.
- Right-click in the words for a menu. Over a word that is spelled wrongly it offers the likeliest corrections (choose one to replace the word) and Add “word” to the dictionary; below those are **Cut**, **Copy**, **Paste** and **Select all**. Cut and Copy are available when something is selected. Your own dictionary is the one **Spell check** uses, and if it is full the menu says so beside the words.
- The same menu has **Join with the text above**, **Join with the text below** and **Split the text before this paragraph**, offered where they apply and while the open block has nothing unwritten (press **Esc** first to write what you typed). A join makes the two blocks one paragraph, keeping the look of each word, and the text that was below moves up to follow the first. Words in a font Monstera can't set text in take the font of the text above, and Monstera tells you when that happens. A split makes the paragraph the pointer is in, and those after it, a block of its own, moved down by a line so the two stay apart. It is offered only where that still leaves a line of space above the text below, so the text below never moves and the new block never runs into it. Each is one change and one **Ctrl+Z**.
- A line you change keeps its letter and word spacing; a colour printed in CMYK or a spot colour becomes the same colour in RGB, and a tagged page keeps its tags, though some tag details (a box, a list of values) are left out.
- A single word wider than the block is broken between letters at the block's edge, so it never runs across what sits beside it.
- Where the page behind the block is shaded, the box you type in is shaded to match rather than a flat patch. Where two blocks overlap, a click chooses the smaller one.
- While you type, the words you have not changed are shown in the font the page draws them in. A word you type is shown in the font Monstera will set it in when you finish, and where there is none yet, in a similar font of the same kind.
- If the page's font cannot show a word you type, that whole word is set in another copy of the same font already on the page where one can show it, and otherwise in the closest font Monstera brings with it or one installed on this computer whose licence allows editing. The rest of the line keeps the page's font.
- If none of those fonts can show a character, it is drawn as a small empty box (□) and your change is still made. The text keeps the real character, so copying or searching finds it, and Monstera tells you which characters are shown as boxes and on which page.
- When a change cannot be made, your words stay in the box with the reason under them. Where different words could go through, change them and finish again; otherwise the box says to press **Esc** to put the text back.
- Some pages, often ones printed from a web browser, draw their text in a kind of font that is drawn from shapes stored in the page. On those pages you can change the words too. The words already there keep their own look; a word you type, replace or correct is set in the ordinary font that matches the page's most closely — the same font elsewhere in the document, one installed on this computer, or one Monstera brings with it — so on a close look it may differ slightly from the words around it. Monstera never draws letters of its own to imitate the page's.
- If one page’s text cannot be read, that page says so and Edit text stays on for the other pages. The mode ends only on a computer with no editing engine at all, or when the document can no longer be worked on.
- A change is never refused because of a font: words the page's own font cannot draw are set in the closest font Monstera has. On the rare page where a change cannot be made without disturbing other text on it, you are told "Monstera couldn’t make this change without disturbing other text on the page, so nothing was changed", and the page stays as it was.
- Deleting every word of a block removes the block from the page.
- Text that was pasted into the page as a single block is outlined and edited like any other, in place. Only the words you change are rewritten; where that block is drawn in more than one place, only the one you edited changes. **Ctrl+Z** puts it back as it was.
- A scanned page is a picture, so it has no text to edit until its words are read. When Edit text finds a page with no text it offers to recognise the page, which runs **Make scanned pages searchable** for that page. Once the words are read you edit them like any other: each line you change is drawn on the page whole, the words you kept as well as the ones you typed, over a patch that covers the picture’s old words on that line. The patch reaches as far as the old ink does, including a letter’s tail that runs past the edge of the box the recogniser drew, and it is the paper’s own colour at each place, so a page that shades from light to dark is covered with that shading and not one flat colour. The lines you did not change are left as the picture. The picture itself is never altered, so nothing is lost, and **Ctrl+Z** puts the page back. Text that is read but sits over no picture stays invisible when edited, as it was.
- Text that the page turns, slants or mirrors, and text that runs up or down the page, cannot be edited in place. When a page has any, Edit text says which kind it found, in one sentence for each, so you know which text is not yours to edit and why.
- Hebrew, Arabic and other right-to-left text is edited as you read it. Type the words in the order you would say them: each paragraph runs the way its own letters run, and Monstera writes the line in the order the page draws it, with brackets turned to face the words they hold and Arabic letters joined into their connected shapes, so the line looks right on the page and reads back as you typed it. A line that mixes Latin and Hebrew, or Latin and Arabic, is set in one font where one font has all its letters, which means its Latin words take that font and not the page’s own. A line whose letters no single font has is written in more than one font, and it still reads as one line: its words stay in the order you typed and editing one word moves nothing else. A lam followed by an alef is drawn as the single combined letter. One thing is not drawn as a specialist typesetter would: a mark above or below an Arabic letter sits where its own glyph puts it, which can differ slightly from where the font's positioning rules would put it.
- A page with a very large amount of text may have more than can be outlined at once. Monstera then says "This page has more text than can be outlined at once; some of it is not outlined." The blocks that are outlined can still be edited.
- If your words run past the edge of the page, nothing is lost: the change is made with every word, and the editor opens again over the block with "This text no longer fits on the page" above it, so you can shorten what you wrote. Words past the edge are kept in the file but cannot be seen on the page, found by search or printed until they fit. When you close the editor, the block keeps a solid outline and the same sentence.
- Only the block you edit changes. Everything else on the page, its other text, pictures and drawings, is left exactly as it was.
- A paragraph that grows grows downwards and may overlap the text below it. Nothing below is moved, and nothing moves up when a paragraph gets shorter. The frame shows how far the block now reaches, so if the overlap is not what you want, make the block wider, move it, or shorten the text; **Ctrl+Z** puts the paragraph back.
- A justified paragraph widens the spaces of each wrapped line so it reaches the right edge; its last line is not stretched. A line with very few spaces is widened only so far, because a very wide space reads as the end of a line to search and copy, so such a line can stop a little short of the edge.
- Strikethrough, underline and highlight are drawn on the page as lines and colour behind the words, which is how every PDF program draws them. Once the block is written they belong to the page: if you open the block again later and move or retype those words, the line or colour stays where it was drawn, and taking the formatting off does not remove it. Check the page after editing such words a second time, and use **Ctrl+Z** to put the earlier change back if needed.
- To change a word everywhere in the document, see "Find and replace text".

<!--
Screenshots to capture:
1. edit-text-1 — Edit section, Edit text mode on a page with several paragraphs, one block open with the caret in it and the Properties tab showing Text and Box. Frame the page area and the panel.
-->
