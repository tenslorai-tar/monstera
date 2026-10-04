# ADR-0156 — Spelling is reviewed a word at a time, beside the page

- **Status:** Accepted
- **Date:** 2026-10-04
- **Decided by:** the owner, in the 0.1.10.0 addition to the cloud-4 list, item 16a: *"SPELL CHECK rebuild: word by
  word with word highlighted on page; Ignore, Ignore all, Add to dictionary; Replace (suggestion or typed) and Replace
  all; options include comments, include form fields; replacement through existing text-edit route (signed warning
  applies), says when a word cannot be replaced in place."*
- **Amends:** `checkSpellingCommand`'s shape (a walk that ends in a modal list) and the context panel's two tabs.
- **Keeps:** the checker (`spelling/checker.ts`, built once from the dictionary channel), the personal dictionary
  setting, `wordsOf`'s rule for what a word is, `replaceAllText` and the signed-edit route (ADR-0149), all as they are.

## The problem

Spell check walks the document, then opens a modal list of misspelt words with their first page and suggestions, and
the one thing a person can do from it is add a word to the dictionary. Nothing on the page shows where a word is, and
nothing in the list changes the document. A modal window also cannot be where the work happens: Base UI's modal makes
the page inert, so the page cannot be scrolled or read while the window is open.

## Decision 1 — a third tab of the context panel, Spelling

The review lives in the right-hand context panel as a third tab beside Properties and Assistant. The panel is not
modal, so the page stays readable and scrollable while a person decides, and it is where the eye goes after the word.
The tab setting's enum gains `spelling`; the panel renders the tab it names, rather than choosing between two.

The ribbon's Spell check command opens the panel on this tab and starts a review. It does not open a dialog.

**Rejected: a seventh document panel.** The six document panels are a fixed strip in the rail, sized for the rail's fold
at 150% scaling (19c), and a review is not something a person keeps beside the page list.

**Rejected: a non-modal dialog.** Every dialog here is the one `<Dialog>` primitive, which is modal by contract; a second
kind of window would be a second dialog seam.

## Decision 2 — the review is a queue of occurrences, in reading order

A review walks the pages as the old command did (`document.pageTextLayer`, the version fixed by the first answer) and
keeps each misspelt **occurrence**: page, line, offset and word, from `tokensOf` per line, which segments the same way
`wordsOf` does. With the options on, it also queues the words of comments (`document.annotations`, whole words through
`wordsToEdit` where the walk cut them) and of text form fields (`document.formFields`' values).

The panel shows one occurrence at a time: the word, the sentence it sits in, where it is (page, or comment or field on a
page), the suggestions, and a field for a word of the person's own.

- **Ignore** moves on. **Ignore all** moves on and skips this word for the rest of the review.
- **Add to dictionary** adds the word to the personal dictionary setting and skips it, now and in later reviews.
- **Replace** changes this occurrence to the chosen suggestion or the typed word. **Replace all** changes every
  occurrence of the word, exactly as written, in the places the review covers.

Ignore and Ignore all are the review's own and are not remembered after it ends.

## Decision 3 — the word is highlighted through the text layer, under its own name

The page shows the current word with the CSS Custom Highlight API over the text layer, the mechanism the find bar
uses, under its own highlight name (`monstera-spelling`), and the page list scrolls to its page. The find highlight and
the spelling highlight are two writers of two highlights; neither writes the other's.

## Decision 4 — one occurrence is named by WHERE IT IS on the page, never by its position in a list

The word was found in MuPDF's text; an edit of a page's text is PDFium's. `pdfiumReplaceAll.ts` records why a list
position cannot cross: `proof:lineagreement` scored 52.9% agreement between the two engines' readings of one page, so
*the third occurrence on page 4* names a different word about half the time.

The authority both engines share is the page's own geometry. So **Replace** of page text sends a new PDFium command,
`replaceTextAt { page, find, replace, at }`: `at` is the centre of the word's box in PDF user space, read from
`document.pageWordBoxes` (MuPDF's character quads, ADR-0137) and converted by the page's one `PageTransform`. The kernel
replaces `find`, whole word and exactly as written, in the one PDFium text run whose bounds hold `at`, and only when
that run holds exactly one such match.

**It fails closed.** No run at the point, a run without the word, or a run holding it twice answers a new
`document.execute` refusal, `text-not-in-place`, and nothing changes. The panel says the word cannot be replaced there
and that Edit text can change it. A word split across two text objects is the same refusal: `replaceAllText` already
cannot see it, for the reason its header gives.

It carries no version, for `replaceAllText`'s reason: it is content-addressed, so a document that has moved either
still holds the word at that point or refuses.

**Rejected: an occurrence index.** The 52.9% above.

**Rejected: `editTextBlock` with the block's words spliced.** It rewrites a whole block from `document.textBlocks`, so
the review would have to map a MuPDF line to a PDFium block — the same join by other means.

## Decision 5 — every edit goes through the route that already holds its rules

- Page text: `replaceTextAt` and `replaceAllText` (`wholeWord`, `caseSensitive`) through `applyDocumentCommand`, which
  asks the signed-document question and works on a copy when asked (ADR-0149).
- A comment: `editAnnotationText` with the whole words spliced, at the walk's version.
- A form field: `fillFormField` with the field's value spliced, at the walk's version.

A refusal is said in the panel and the review goes on; it is never a dialog over the work.

After an edit the review takes the version the command answered and re-reads the page it changed, so offsets after the
edited word are read again rather than shifted by arithmetic.

## Consequences

- A review needs PDFium to replace page text; where PDFium is not provisioned, Replace on page text is refused as
  `engine-unavailable` and said, and comments and fields are still replaced.
- The old dialog and its result schema go; the gallery entries for them go with them.
- A word whose PDFium run cannot be found at its point cannot be replaced from the panel, and the panel says so. That
  is the honest boundary of an in-place edit without character geometry from PDFium.
