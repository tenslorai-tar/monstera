---
id: other-renderer
title: Fix a page that looks wrong
summary: If a page looks wrong on screen, try drawing pages with Monstera's other renderer.
keywords: [page looks wrong, display problem, blurry, missing content, renderer, pdfium, drawing, rendering]
commands: [app.settings]
contexts: [dialog.settings]
---
Monstera can draw pages in two different ways. If a page looks wrong, switching to the other one may show it correctly.

## Steps

1. Open **Settings** and choose the **Rendering** page.
2. Turn on **Draw pages with the other renderer**.
3. Look at the page again. Turn the setting off to go back.

![The Rendering page of Settings with Draw pages with the other renderer](screenshot:other-renderer-1)

## Good to know

- The other renderer is slower. It is not better in general; it is simply different.
- If a page is too large to draw this way at your zoom, Monstera says so. Zoom out, or turn the setting off.
- If the other renderer cannot draw a page for any reason, Monstera draws it the usual way instead.

<!--
Screenshots to capture:
1. other-renderer-1 — Settings › Rendering page. Frame the page with the setting on.
-->
