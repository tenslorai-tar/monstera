---
id: translate-a-page
title: Translate a page
summary: Translate the text on a page with your AI provider and write the translation back in place.
keywords: [translate, translation, language, french, german, spanish, ai translate, convert language]
commands: [edit.translate-page]
contexts: [dialog.translate-page, edit]
---
Translate sends the text you choose to the AI provider you have set up. A page's translation is put back into the page where the original text was.

## Steps

1. Go to the page, or select some words on it.
2. In the rail, choose **Edit**, then **Translate** in the **Language** group (**Translate this page…**).
3. Under **Translate**, choose **This page**, **Selected text**, **Whole document** or **Pages**. For **Pages**, type the pages, like **1-3, 5**.
4. In **Translate into**, choose a language.
5. In **Using**, choose the provider. The window says that the text will be sent to it.
6. Choose **Translate**.

![The Translate window with Translate into and Using](screenshot:translate-a-page-1)

## Good to know

- You need a key for an AI provider first. If none is set up, the window says so. See "Get and add keys for AI and online reading services". The provider bills you directly.
- **Whole document** and **Pages** translate one page after another. The status bar shows the progress and a **Cancel**. Pages already translated stay translated.
- **Selected text** is available when words are selected. The paragraph that holds your selected words is translated and written into the page, and **Undo** (**Ctrl+Z**) puts it back. If no paragraph on the page holds the selected words, such as a selection that runs across paragraphs, the translation is copied instead so you can paste it where you want it.
- Only languages written in the Latin alphabet are offered.
- Where the page's font lacks a letter, that text is set in a standard font. Text may be made smaller to fit its space.
- Pages printed from a web browser, whose text is drawn from shapes stored in the page, are translated too. Each block is made smaller where the translation is longer, no smaller than about six tenths of its size, and a block that still does not fit at that size runs on past its space.
- **Undo** (**Ctrl+Z**) puts the original text back. Translating several pages at once is one step, so a single Undo takes back every page of that run, and **Redo** (**Ctrl+Y**) puts them all back together. If you change something else while a run is still going, the pages after that are their own steps.

<!--
Screenshots to capture:
1. translate-a-page-1 — dialog.translate-page with French and Anthropic chosen. Frame the dialog.
-->
