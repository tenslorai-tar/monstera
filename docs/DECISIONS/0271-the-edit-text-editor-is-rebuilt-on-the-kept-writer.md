# ADR-0271 — The Edit text editor is rebuilt on the kept writer

- **Status:** Accepted
- **Date:** 2026-10-26
- **Supersedes:** [ADR-0249](0249-a-paragraph-that-grows-pushes-the-text-below-it-down.md) — a paragraph that grows no
  longer pushes the text below it; it overlaps. The editor parts of
  [ADR-0175](0175-the-typing-box-draws-a-run-in-its-own-font-rebuilt-in-the-host.md),
  [ADR-0179](0179-a-paragraph-is-the-editors-unit-and-a-reflow-keeps-each-word-in-its-own-style.md),
  [ADR-0180](0180-formatting-is-marks-over-a-blocks-words-and-a-block-is-moved-resized-and-added-by-its-own-commands.md) and
  [ADR-0238](0238-a-run-whose-program-is-not-an-sfnt-is-drawn-in-a-font-built-from-its-drawn-glyphs.md) where they describe the editor this
  replaces; each gets a dated correction naming this ADR when its code is removed.
- **Decided by:** the owner, 2026-10-26: the design below, approved, with the owner's decisions in its last section, which
  override anything earlier in it. Edit text is *"the least impressive of all the tools"*, and it is the first thing a
  person tries in a PDF editor: a Store reviewer, a friend, every new user.

## The problem, in one sentence

The writer underneath Edit text has been rebuilt and made strict, and the editor on top of it — what the person sees and
touches — was designed for the old writer and patched many times since; the owner's choice is a full rebuild of the
editor, the old editor removed completely, and the writer kept and simplified.

## 0. Why

**The promises, in the owner's words, which every decision below serves:**

1. *"monstera should not be rejecting edits ... write the new text ... move on, no rejections."*
2. *"look at the fonts of the previous words in the line ... select a font that is the closest match ... If the document
   has a type 3 font that is drawn, or a difficult font style or system, monstera should not start drawing its own font
   to match it ... use normal font that closely matches ... and move on."*
3. Touch nothing else on the page.
4. *"The app must feel smooth."* The owner judges by feel, on a 2012 two-core laptop.

## 1. Scope

**Rebuilt now (before launch):**

- **The Edit text editor**, which covers opening a block, typing, selecting, formatting, adding a new text block (Add
  text inside Edit text) and finishing.
- **Its Properties controls** for text: font, size, colour, bold, italic, underline, strike, raise and lower, alignment,
  line spacing, paragraph spacing and character spacing.
- **The joint between the editor and the writer:** the handover and the redraw after a write.

**Kept, and changed only where this ADR says:**

- **The writer:** the operator writer (`operatorEdit.ts` and its modules), the page reading, the font chain with Unifont,
  the engine hosts and the corpus count.
- **Find & replace, spelling and translation** keep calling the writer directly (they have no editor), so they gain from
  every writer change.

**Designed for, moved later (after launch):** Text box, Typewriter and callouts move onto the same editor kit, so every
text tool types and formats the same way. The kit's API must allow it from day one: no Edit-text-only assumptions in the
kit's core.

**Guarded now, so the rebuild cannot hurt them (the owner's concern, 2026-10-26):**

- Text box, Typewriter and callouts keep their own typing box (`InlineWriter`), and it is **not changed** in this rebuild.
- Any module they share with Edit text (the Properties text controls, the font list, the command state) keeps their
  existing tests green.
- They are part of **the hand walk** (create, type, bold on and off, change font, finish, reopen) and **the speed table**
  (their slowness is measured in P1). A speed cause they share with Edit text is fixed for both.

**Not touched:** Edit Object, form fields, stamps, headers, footers, watermarks and Bates.

## 2. What other PDF editors teach us

The widely used desktop editors were read on 2026-10-26, from their public help pages. None is named here.

| What they do | What we take |
|---|---|
| **The text box (block) is the unit.** Editing re-wraps lines inside the box; resizing the box re-wraps without changing the size. | Same. Our block is the unit, and a paragraph inside it is the unit of re-wrap. |
| **Neighbouring boxes are NOT pushed** in the most widely used editor: growth stays in the box, and may overlap what is below. Another offers an explicit "link boxes" or "reflow mode" to flow text across boxes. | **The owner's decision: the same. Nothing is pushed.** In the owner's words, it is *"a reminder for users to know there is a limit to what they can edit. Allowing it to push text down only ends up scattering other text on the page."* ADR-0249's push is retired. |
| **Two clicks** (watched in the owner's video, 2026-10-26): the first click selects the box (a frame, handles, and box-level options); the second places the cursor. | **The owner's decision: the same.** See section 3, Opening. |
| **One default fallback face per script**, changeable in a setting. | We have a full chain. Add a visible setting for the **fallback face** (serif, sans, mono), so a person can choose. |
| **They restrict editing when a font is not installed** (only colour or size, or no edit at all). | We never refuse. That is our advantage, so keep it. |
| **Word-processor selection:** double-click selects a word, triple-click a paragraph, quadruple-click everything on the page. A contextual Format panel appears when text is selected. | Same gestures, and the formatting controls appear only when the editor is open. |
| **Edit text and Edit object are separate tools.** | We already have that. Keep it. |

## 3. The experience (what the person sees). Every line is a test

**Opening: two steps (the owner's decision, from their video of another editor)**

- **In Edit text mode,** every editable block shows a faint outline.
- **First click on a block SELECTS THE BOX:** a frame with handles. No cursor yet.
  - The block's read-on-open starts here, so the fonts and layout are ready before the person types.
  - Box-level actions work on a selected box:
    - drag the frame to **move**;
    - drag a side handle to **change the width**: the text re-wraps inside the new width and the size does not change,
      as in other editors;
    - **Properties** (font, size, colour, bold, italic and so on) apply to **the whole block**;
    - **Delete** removes the block (undoable; it is the existing "Remove this text");
    - **Enter** places the cursor at the end of the text;
    - **Esc** deselects.
- **Second click inside the selected box** places the cursor **exactly at the click**, at the nearest character
  boundary, inside the already-laid-out editor. This also removes the cause of the first-click cursor problem (C1).
- **A double-click on an unselected block** selects the box AND places the cursor at the point, in one gesture, for fast
  users. Once editing, a double-click selects a word and a triple-click a paragraph.
- **Opening changes nothing visible.** Unchanged paragraphs keep the page's own pixels. The editor paints only the
  paragraph being changed, from the first keystroke or format change.

**Typing and selection**

- Keys appear at the caret within the budget (section 4). Arrows, Home and End, Ctrl+arrows, Shift-selection, drag
  selection, Ctrl+A (the block), cut, copy and paste (as plain text into the run's style), Delete and Backspace across
  style boundaries.
- **A plain click never selects page text.** A click outside finishes the edit and leaves no selection (C2's rule).

**Formatting: instant, and both ways**

- Bold, italic, underline, strike, raise and lower, font, size and colour apply **in the editor at once** (inside the
  budget) to the selection, or to the next typed letters when nothing is selected.
- Each toggle shows **on, off or mixed** for the selection, and pressing it toggles both ways.
- The size field shows the size most of the selection or paragraph uses (C3).
- **No engine round trip while editing.** The editor never asks the host to write until the person finishes. It asks
  the host to *read* only when the block opens: the block's text, positions, faces, and the chain's answer for each face
  (section 5).

**The person can choose the font themselves (the owner, 2026-10-26)**

- **If they don't like Monstera's match,** they pick another font and style from the font list in Properties, for the
  selected words or (with the box selected) for the whole block.
- **The list is grouped:**
  - **"In this document":** the document's fonts that can carry new words, with the styles each has;
  - **"Closest matches":** the chain's top 3–5 candidates for this text, with the one Monstera chose marked;
  - **"All fonts":** installed and bundled, searchable.
- **A style choice** (Regular, Bold, Italic, Bold Italic) shows only the styles the chosen family really has. Where a
  style is missing, the nearest one is used, and a small note says which.
- **"As on the page"** returns the selection to Monstera's own choice.
- **The choice sticks** for further typing in that block. What the person chose is exactly what is written; it is never
  "matched" again behind their back.
- **The new fallback-face setting** (owner: yes) sets the default kind of face (serif, sans or mono) used when nothing
  closer exists. It lives in Settings › Editing.

**Fonts in the editor = fonts in the file**

- Every word the person **changes or types** is shown in **the face the writer will write**. The editor receives the
  chain's answer when the block opens, and the writer uses the same answer.
- **Unchanged words in a changed paragraph** look like the page. Use the face the page already loaded (PDF.js font
  faces) where possible, which costs nothing. Otherwise use the chain's face.
  - **Never build a font from glyph drawings.** ADR-0238's path-built fonts are retired, in the editor and anywhere
    else.
  - **If an unchanged word must be shown in a stand-in, the writer re-sets that word's ORIGINAL codes in its own
    font.** So the page after finishing shows the original. This is the one place the preview may differ, and only for
    unchanged words. Measure how often it happens on the corpus, and report it.

**Finishing**

- **A click outside, or Esc,** finishes and **keeps** the changes (the owner's decision). **One write.**
- **What is drawn during and after the write: only the block's area is repainted.**
  - While typing, nothing on the page is redrawn: the editor re-wraps inside the box.
  - After the write, the viewer renders **just the block's rectangle** (plus a small margin) at the new version, into its
    own small canvas: PDF.js renders a page region through a viewport transform and a clipped canvas. The editor stays
    until that small canvas is ready, then the two swap without a flash.
  - **The full page is never redrawn or waited for after an edit.** The full-page canvas is refreshed later, quietly,
    when the page is idle.
- **Undo** after finishing undoes the whole edit in one step. Inside the editor, Ctrl+Z undoes keystroke by keystroke.

**Growth: overlap, never push (the owner's decision)**

- A paragraph re-wraps inside its block's width.
- When the text grows taller, **the block grows downward and may overlap what is below. Nothing else on the page
  moves.**
- The box's outline shows the new extent, so the person sees the overlap and can make the box wider, move it, or shorten
  the text.
- When the text shrinks, nothing below moves up either.
- **ADR-0249's push is retired.** The line-ownership code built 2026-10-26 for it (ADR-0249's correction of that day,
  `pushedShapes.ts`) is no longer needed for growth. It is deleted with the push, unless another caller needs it — the
  import graph decides.

## 4. Speed budgets (the gate; measured on the owner's laptop class, on the window's own clock)

| Action | Budget |
|---|---|
| Click until editable (caret shown, a key would land) | under 300 ms (warm) |
| Keystroke to paint (median / worst of 20) | under 30 / 50 ms |
| Bold, italic, font, size or colour visible in the editor | under 50 ms |
| Finish until the edited area shows the written result, on an ordinary document | under 1 s |
| Finish on a page of drawn (Type 3) fonts | under 1.5 s |
| Ribbon or tab switch, a toggle | under 100 ms |
| Idle on the Edit tab | ~0% CPU, and no memory growth over 5 minutes |

**The comparison base is A = 31f790b4 (1.0.2150.0).** No row may be slower than A, and every row must be inside its
budget. The speed gate runs at every milestone, not only at the end.

## 5. Architecture

**The editor kit (new, in `packages/ui`).** It is one module family, with a single owner per concern (B3):

- **The model:** the block's paragraphs, each made of runs `{text, style}`, where the style holds face, size, colour,
  weight, slant, underline, strike, rise and character spacing. It also holds the paragraph's alignment and spacing, and
  the block's box. It is a plain data structure with unit tests, and **no DOM inside the model**.
- **Layout and paint:** the browser lays out only the **changed** paragraphs, in the faces the model names. Unchanged
  paragraphs are not painted (the page's pixels show through).
- **Input:** keyboard, IME, mouse and clipboard map to model operations. The caret and selection come from the model, and
  are mapped to screen positions after layout settles.
- **Format state:** derived from the model and the selection. It is **subscribed**, never read imperatively in render
  (the C4 lesson, ADR-0258's correction).
- **The kit must be usable later by Text box and Typewriter.** The Edit-text-specific part is only the adapter that reads
  a page block in and hands a command out.

**The handover (the contract), written down once in `packages/contract` (B3a):**

- On finish, the editor emits **the existing `editTextBlock` command shape** (runs, block starts, inserts, marks,
  version), so the writer's input does not change.
- If the rebuild needs a field the shape lacks, it is added by an ADR, with schema and version, in **one** commit that
  both sides take.
- **A joint test** drives editor → command → writer (a real host) → file → reopen → read, so the pair's blind spot
  (CLAUDE.md, the "wired" rule) is closed for every editor gesture.

**The read on open (one call, bounded).** It returns:

- the block's runs and positions;
- for each face: the chain's answer (the face to write new words in), whether the run's own font may carry new words
  (ordinary program and has the letters), and the PDF.js-loaded face name if it has one;
- line ownership (what is drawn on each line).

It is cached per block and version. **No reads during typing.**

**The writer: changes owned by the local agent.** These are the ONLY three:

1. **The owner's font rule as the only rule:** remove every remaining route that writes new words with drawn or built
   glyphs. Write exactly the face the person chose, where they chose one.
2. **No push:** growth stays in the block and may overlap (ADR-0249 retired). Remove the push code, and the line
   ownership built for it, if nothing else uses them.
3. **One write per finish:** no intermediate writes. Measure and remove any per-change write.

**The writer's other behaviour must not change.** The corpus count, the catalogue (section 6) and the joint test prove
it.

**The old editor is DELETED, not kept beside the new one.**

- **Candidates,** to be confirmed by the import graph, not by this list:
  - `TextEditLayer.tsx`, `TextEditorMenu.tsx`, `textEditorControl.ts`, `typingFocus.ts`;
  - the Edit text parts of `textFormatting.ts`, `TextFormatPanel.tsx` and `PropertiesPanel.tsx`;
  - the editor-only display-font route (`runFont*.ts` and `pathFont.ts`, if nothing but the editor or ADR-0238 uses
    them);
  - the page-hold logic that waits for a whole-page redraw;
  - their tests.
- **A check proves nothing imports a removed module,** and the superseded ADRs (0175 where it applies, 0179, 0180 where
  it applies, 0238, 0249 parts) get dated corrections naming this ADR.

## 6. The catalogue of difficult PDFs (the cloud agent builds it, the local agent checks it against the corpus)

- **Generated by scripts at test time,** following the project's fixture rules (no committed binaries unless the file
  guard allows them).
- **Each shape is a separate file,** with a manifest saying what it tests and what the edit must do.
- **At least these shapes:**
  1. a plain paragraph in an embedded TrueType subset;
  2. Type 1 and CFF subsets;
  3. a non-embedded standard font (Times, Helvetica, Courier);
  4. a page of all drawn (Type 3) fonts, as printed from a web browser;
  5. a heading over two or three lines;
  6. a justified paragraph;
  7. raised reference markers `[n]`, and links;
  8. a bulleted list (bullet as a separate text object, as a path, and in the same object);
  9. a numbered list;
  10. a code block in monospace;
  11. underlined, struck and highlighted words;
  12. text inside a form XObject, shared and nested;
  13. text under a clip window (cells, columns);
  14. two columns;
  15. a table with cell text;
  16. right-to-left (Arabic, Hebrew);
  17. CJK;
  18. rotated text (90° and an angle);
  19. text over an image;
  20. tagged (marked content);
  21. a page with a CropBox offset and rotation;
  22. a scanned page after OCR;
  23. a word-processor export with WinAnsi subsets and no ToUnicode;
  24. a document with 500 pages, for speed.
- **For each shape:** select the box; open by a second click mid-word; type at the end; bold on and off; choose a font
  manually; widen the box; grow by a line (it overlaps); shrink; undo. Then check:
  - the expected text in the file;
  - nothing else changed (pixels and objects outside the block are identical; nothing moved);
  - nothing refused, unseen or logged;
  - the speed budgets.
- **The local agent runs the same checks on the corpus** and adds any real-document shape the catalogue lacks.

## 7. Tests that would have caught the last week's problems (the class fixes)

- **The hand walk (rendered, pinned Chromium; and the real app on Windows):** clicks with a small move, real typing speed,
  then format, finish and click away, asserting what the person sees: the caret position, no selection, button states
  without remount, the text in the editor and on the page after finish.
- **The speed gate:** section 4's table, compared with A, at each milestone, on the owner's laptop class.
- **Untouched-area check, including non-text:** everything outside the edited block is identical, pixels and objects
  (the bullet class).
- **No-remount state tests:** every format button's state changes in place (the C4 class).
- **The joint test:** editor → writer → file → reopen (the pair's blind spot).

## 8. Old mistakes, and how this design prevents each

| Mistake (last weeks) | Prevention |
|---|---|
| Two writers with different behaviour | One writer, and the editor emits one command shape |
| An editor designed for an old writer, then patched | A new editor, the old one deleted, and a check that nothing imports it |
| Fonts imitated by building glyphs (slow, complex) | Retired. New words use the chain; unchanged words use the page's own loaded face or the chain |
| Engine round trips during editing | Read once on open, write once on finish |
| Whole-page redraw before the editor lets go | Repaint only the edited area |
| Caret computed before layout settled | Caret from the model, mapped after layout settles |
| Page text selectable under the editor | The editor owns every click while open |
| UI state read imperatively, made stale by the compiler | Format state subscribed (ADR-0258's correction) |
| "A line" meant only its text, so bullets were left behind | Nothing below moves, so nothing can be left behind; the untouched-area check covers objects |
| Instruments blind to UI, speed and non-text | The hand walk, the speed gate, the untouched-area check |
| A big global change near launch | After this rebuild: a freeze, fixes only |
| The owner saw problems only at the end | A test build for the owner at each milestone |
| Items sent outside the agent's file | One file per agent; additions go into the file |
| Site and docs claiming more than the code does | The help, FEATURES and site Edit text text rewritten from the final behaviour |

## 9. Who does what, and in what order

| When | Cloud agent | Local agent |
|---|---|---|
| **Before approval** | Starts the **catalogue** (section 6), which is independent of the design | Finishes the **writer half of L2** (visible-weight matching, bold and regular face choice) and stops the editor half. Pushes L1, the cloud-21 merge and L2-writer, then reads the board. **Measures P1, the A/B speed baseline**, so we know where today's time goes |
| **After approval** | Builds the **editor kit** and the Edit text adapter from the pushed base, with the hand walk and the no-remount tests | Writer changes 1–3, the read-on-open call, the speed instrumentation, and the corpus with the catalogue |
| **Milestone 1** (target +2 days) | Kit with typing, selection and formatting, on fixtures | Joins it, runs the speed gate, and gives the **owner a test build** |
| **Milestone 2** (target +3–4 days) | Finishing, growth, undo, the joint test, and deleting the old editor | Full count (corpus and catalogue), speed table, walks, the owner's test build |
| **Release** | — | Push, main, pack **1.1.2610.0**, start-screen shot. Then the freeze |

## 10. What "done" means

- Every promise in section 0 holds on the corpus and the catalogue: 0 refused, 0 disturbed, 0 unseen and 0 logged.
- The speed table is inside budget and no slower than A.
- The hand walk is green in the real app.
- The old editor is gone.
- The owner has used a test build and says it feels right.

## 11. The owner's decisions (2026-10-26). These override anything above

1. **Growth: OVERLAP, never push.** The block grows downward and may overlap; nothing else moves. ADR-0249's push is
   retired.
2. **Esc:** finishes and keeps the changes.
3. **A fallback-face setting:** yes.
4. **Text box, Typewriter and callouts:** they move onto the new kit **after launch**, but they are **guarded now**
   (section 1: untouched `InlineWriter`, in the hand walk and the speed table).
5. **Version for the release build: 1.1.2610.0.**
6. **Two-step opening:** the first click selects the box; the second places the cursor (section 3).
7. **Manual font and style choice** when the person is not satisfied with the match (section 3).
8. **Repaint only the block's area** after an edit; the full page is never waited for (section 3, Finishing).

## Correction, 2026-10-26 — who does what: the cloud agent owns the writer changes

The owner's decision of 2026-10-26 17:07, given after this ADR was written: **the cloud agent owns the three writer
changes** — the owner's font rule as the only rule, no push, one write per finish — **and the read-on-open call**, as
well as the editor kit, its adapter and the deletion of the old editor. **The local agent does only the work that needs
the Windows machine:** the owner's corpus, the real application, speed on the owner's laptop, packaging, the visual
baselines, merging, and moving `main`.

So section 5's heading *"The writer: changes owned by the local agent"* and the local agent's column of section 9's table
no longer say who does the work. **Section 9's table is superseded** by this paragraph; its order of milestones stands.
What each change is, and the rule that the writer's other behaviour must not change, are unchanged.
