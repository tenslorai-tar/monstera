# ADR-0197 — A contents page is written from the list the person reviewed

- **Status:** Accepted
- **Date:** 2026-10-08
- **Amends:** the 2026-09-05 extension of [ADR-0040](0040-a-command-names-a-second-document-by-docid.md) as
  `generateTocSchema` states it — *the command carries an index and nothing else; the entries are read in the document's lane
  at apply time*. That stands for a command that carries no entries. This adds the other case.
- **Found by:** the owner's review, 2026-10-07 — *the contents command takes the bookmarks and inserts the page at once; show
  a dialog first where the person can rename, reorder, indent or outdent, delete and add entries, then Insert or Cancel.*

## Context

`generateToc` carried one index. `main` read the outline inside the document's lane immediately before writing, so the page
could not be out of step with the document it described, and the payload stayed the size of one number whatever the outline
was (invariant 11, which names a payload that scales with a document as the wrong shape). That reasoning was sound for a
command whose entries are the document's. The owner's request makes them **the person's**: a title renamed, a row moved, an
entry added by hand have no source in the document to be re-read, so they have to travel.

## Decisions

1. **`generateToc` may carry `entries`** — title, page and depth, the shape `outlineEntrySchema` already says — bounded at
   `MAX_TOC_ENTRIES` (300) rows of at most `MAX_TOC_TITLE_CHARACTERS` (100) characters, **which is what the writer's channel
   frame holds at its worst** (`hostRoutes.test.ts` reads it from the schema; 4,096 rows of 512 were first written and
   failed that proof, as the pre-read's 3,600-bookmark outline had failed the frame before). A contents page prints a title
   on one line, which fits about eighty characters, so the title bound loses nothing a page could show. Absent, the command
   is exactly what it was, and the outline read is its source. Present, they are the table's rows **in the order given**,
   and the outline read is not consulted for them: the apply uses `command.entries ?? outline`.
   **An outline past either bound is not refused.** The review says it is more than can be edited here, lists nothing, and
   *Insert* answers no rows, so the page is written from the bookmarks as they are — a long manual still gets its contents.
2. **Pages are zero-based in the document as it stands**, as the outline's are, so `shownPageNumber`'s shift for the pages the
   table itself inserts is unchanged and applies to a typed row exactly as to a read one. The renderer converts the number a
   person types once, through `pageNumbering.ts`.
3. **Staleness is the dialog's, not the bus's.** The rows were composed against a version, and a page deleted since would make
   a typed number wrong while looking right (the 2026-09-05 reason for not carrying entries). The dialog is modal, so the
   document cannot change under it; the command reads `context.version` before it opens and refuses to write if the
   document's version at *Insert* is another — saying so — rather than add a version to `targetVersionOf`'s kinds for one
   command that a modal window already protects. If that ever stops being true, the kind joins `NamesAPage`.
4. **A document with no outline is not refused.** The review opens with no rows and says there are no bookmarks, and the
   person may add entries: *a user is never refused because of their document*. The refusal dialog remains for a request that
   reaches the command with nothing to write.
5. **One undoable step, as before:** the insert is one `generateToc` whatever the rows, and the byte-image checkpoint is the
   undo.

## Rejected alternatives

- **Sending only the edits (a diff against the outline).** Keeps the payload small and brings back the staleness it was
  meant to avoid: a diff names rows by position in a list that may have moved.
- **A second command kind for *a reviewed contents page*.** One operation declared twice, two writers to keep in step
  (B3a); the table's layout is one function over rows.
- **Adding `generateToc` to the version-naming kinds.** The bus's check would be correct and would cost a `targets` entry, a
  version field on a command that mostly has none and the anchor tests, to guard a window a modal dialog does not have.

## Consequences

- `generateTocSchema` gains one optional field; no existing payload changes meaning.
- `applyGenerateToc` takes its rows from the command when it carries them. Its empty-outline refusal now applies to *no rows
  at all*, whichever way they arrived.
