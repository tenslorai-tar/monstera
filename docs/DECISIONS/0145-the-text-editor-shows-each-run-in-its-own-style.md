# ADR-0145 — The text editor shows each run in its own style

- **Status:** Accepted
- **Date:** 2026-10-03
- **Amends:** [ADR-0096](0096-text-is-edited-in-place-on-the-page-in-blocks-that-reflow.md) Decision 1's *"opens an
  editor exactly over the block, in its size, colour and style"*: one style for the block.
- **Decided by:** the owner's list of 2 October, item N4 and its Part A, item 2: *"A block of mixed runs shows each
  run in its own style."*

## The problem, in one sentence

A block crosses to the renderer with ONE style and the editor is a `<textarea>`, which can draw only one, so a line
set as a bold lead word and a regular rest opens all bold or all regular, and a person sees words set differently
from the page they are editing.

## Context

Part A's other items are built without this record, in the commit before it: a block ends at a change of font, size
or colour, so a heading and the list under it are two blocks; a block opens in its first line's longest run's style;
bold and italic come from the embedded font program first. What is left is the case those cannot reach. A list
entry's bold lead word is set apart INSIDE its line, so it is rightly in the same block as the rest of the line — and
the block's one style draws it regular.

The read already knows every run's style: `engine/text-runs` carries it per run, and main's grouping keeps it on each
run until it chooses the block's. The renderer is what cannot hold it, twice over — the channel's runs carry an index
and a text and no style, and a textarea has no way to draw two.

## Measured, 2026-10-03, Chromium 151 (the pinned Playwright build)

An element with `contenteditable="plaintext-only"` and `white-space: pre-wrap`, holding a line as a `div` of two
`span`s in two styles (20 px bold blue, 14 px grey):

- **Typing goes into the run at the caret, in its style**: three characters typed after *words* in the second span
  landed inside that span, and the caret's computed size was 14 px.
- **Enter inserts a line break where it is**, as `\n` inside the span, and `innerText` reads the lines back exactly:
  `Lead wordsXYZ\nnew that follow\nSecond line`.
- **A paste carries no markup**: a clipboard holding `<b style="color:red">PASTED</b>` and `PASTED` inserted the text
  node `PASTED` and nothing else. It lands BETWEEN the spans, so it is drawn in the editor's own style.
- **Undo is the platform's**: Ctrl+Z after the paste restored the text before it.

## Decision

1. **Each run in `document.textBlocks` carries its style**, the same `textBlockStyleSchema` a block carries. The block
   keeps its own style, which is now one of its runs' (its first line's longest): the editor's base, which text that
   belongs to no run — a paste, a line typed below the last — is drawn in.
2. **The editor is a plain-text editable element, not a textarea**: `contenteditable="plaintext-only"`, a `div` per
   line and a `span` per run, each span in its run's size, colour, weight, slant and kind of face. What is edited is
   read as `innerText`, so what crosses back is the same plain text the textarea sent, and nothing about the write
   changes: the kernel diffs each typed line against the block's line by runs (`lineEdit`, ADR-0096 Decision 5), and a
   word typed inside a run is written in that run's own font, which is what the editor now shows it in.
3. **Plain text only** is what keeps the textarea's guarantee: nothing pasted can bring markup in, so there is no
   second model of the text to reconcile with the runs.

### What this costs

Each run gains a style of about 110 bytes serialised. A page answers at most the host's 43,400 runs
(`ENGINE_TEXT_OBJECTS_MAX`), so the worst page's answer grows by under 5 MB across its parts — derived from the bound,
not measured on a page; a real page's runs are tens to hundreds, a few kilobytes.

## Rejected

- **A textarea over a styled copy drawn underneath.** The copy lays each run out at its own size and the textarea lays
  everything out at one, so wherever two sizes differ the caret and the selection are drawn over the wrong glyphs.
- **A rich-text editor.** A second model of the runs, with markup to strip from every paste, for a surface whose job
  is plain words in lines.
- **An editor per run.** A person edits a line's words as one text and types across the boundary between two runs.
- **Keeping one style and choosing it better.** The commit before this one does that, and it is right for every block
  set alike; it cannot be right for a line that is not.
