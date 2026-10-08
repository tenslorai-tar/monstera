---
id: export-to-powerpoint
title: Export to PowerPoint
summary: Save pages as slides in a PowerPoint file, with text you can edit or an exact picture of each page.
keywords: [powerpoint, pptx, slides, presentation, export to powerpoint, convert, editable, scanned]
commands: [document.export-powerpoint]
contexts: [home, tools, dialog.export-powerpoint, dialog.powerpoint-outcome]
---
Export to PowerPoint makes a presentation with one slide per page, of every page or of the pages you choose. You decide whether the slides hold text you can edit, or an exact picture of each page.

## Steps

1. In the rail, choose **Home**, then **Export** in the **Export** group, and **Export to PowerPoint…**. It is also in **Tools** › **Convert** and in the **Tools** menu.
2. In **Pages**, keep **Every page**, or choose **Select pages** and type them, for example 1-3, 5.
3. In **What should the slides hold?**, choose one:
   - **Editable**: words, pictures and simple shapes become real slide objects you can change
   - **Exact look**: each page is one picture, so the slide looks exactly like the page
4. Choose **Choose where to save…** and save the file. **Cancel** closes the window and saves nothing.

![The Home section's Export menu with Export to PowerPoint after Word and Excel](screenshot:export-to-powerpoint-1)

## What Editable does

- Each paragraph of the page is one text box, with the page's font, size, colour, bold and italic. Lines you can see on the page stay on separate lines, so nothing moves when the file opens.
- Text that reads from right to left stays that way.
- Each picture is a picture on the slide, where it is on the page.
- Rectangles, lines and curves are shapes you can recolour and move.
- Anything PowerPoint cannot draw the same way, such as a shaded or cut off drawing, is placed as a picture of itself. Nothing on the page is left out.
- PowerPoint draws text with the fonts on the computer that opens the file. If a font is missing, PowerPoint picks a close one, so a line can look a little different from the page.

## Scanned pages

A scanned page is a picture with no text in it. With **Editable**, the words on it are read first. The slide keeps the scan as its picture and lays the words over it, so you can edit them. An edit leaves the old word showing underneath, because it is part of the scan.

Those words are also added to your document, as they are when you make pages searchable. **Undo** takes them out, one page at a time. Reading scanned pages needs a text recognition language on this computer. Without one, a scanned page is saved as a picture and the window after the save says so.

## When a page is saved as a picture

A page that cannot be written as editable slide objects is saved as one picture, as **Exact look** would, and the window after the save lists those pages by number. This happens to a page of pictures with no text, a page with text set at an angle, and a page the program cannot read. The other pages stay editable.

## Good to know

- The slide size follows the first page you export. Later pages are made smaller to fit, without being stretched.
- The choice is not remembered, so the window starts on **Editable** each time.
- The document itself is not changed, unless scanned pages are read first.

<!--
Screenshots to capture:
1. export-to-powerpoint-1 — Home › Export's menu open, Export to PowerPoint… focused after Excel. Frame the menu.
Owed (not referenced above, so no asset is missing): dialog.export-powerpoint with Editable selected, and dialog.powerpoint-outcome in its "fell-back" gallery state.
-->
