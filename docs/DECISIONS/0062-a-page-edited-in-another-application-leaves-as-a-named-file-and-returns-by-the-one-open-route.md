# 0062 — A page edited in another application leaves as a named file and returns by the one open route

Accepted 2026-09-13.

## Context

D9's *Edit page in external app & reimport*. The law has only the catalog line. The row
needs four things this build has never done:

1. write a page where another program can reach it;
2. start the operating system's handler for that file;
3. notice when that program saves it;
4. put the saved page back.

**Nothing registers them.**

- The bridge is one `invoke` function, and its declaration says *keep this to one
  function*, so nothing pushes from `main` to the renderer.
- No channel waits on `main`, and no timeout exists anywhere in the boundary.
- Nothing in the tree watches a file.
- The one route by which `main` hands something to the operating system is
  `openInBrowser`, which refuses every scheme but `https:` *"so a mistake here cannot hand
  the operating system a `file:` or a custom scheme"*. This row would hand it a file on
  purpose.

So B4 applies.

**Invariant 23 was read and does not forbid it.** It governs MuPDF's writer dispatch —
`fz_new_document_writer` choosing native code from an extension. The handler the
operating system picks for a file this application wrote is a different dispatch. Its
hazard is the same shape, though, which is why Decision 2 pins the extension.

## What was measured and read, 2026-09-13

**`fs.watch` on Windows**, by a probe in a fresh temporary directory, under Node 24.12.0
and again under the pinned Electron 43.4.1 binary's Node 24.18.1. Every row was identical
under both.

| save pattern | watching the file | watching its directory |
|---|---|---|
| written in place | `change`, twice | `change`, twice |
| written to a temp, renamed over it | `rename`, twice | the temp's name and the file's, five events |
| deleted, then recreated | `rename` ×2, `change` ×2 | three events |
| two temp-and-rename saves in a row | all four `rename`s, one watcher | every temp name and the file's, ten events |

What the table establishes:

- **A file watcher survives replacement by rename.** The two-renames row delivered every
  event to one watcher, so an editor that saves through a temporary file does not silence
  it.
- **A directory watcher does not block a rename into its directory.** Every rename
  succeeded. `CLAUDE.md`'s note about a watcher blocking rename concerns the watched
  directory itself.
- **An event is a hint, never an edit.** Every event arrives twice, and a directory watcher
  also reports an editor's temporary names.

**Read:**

- Electron 43.4.1's `shell.openPath(path)` — *"Open the given file in the desktop's
  default manner"* — resolves with an error message, or an empty string on success.
- No file-type association or protocol registration is declared anywhere in the
  repository.
- ADR-0040 Decision 2: *"There is no transient, hidden open"* — a second document is one
  the person has open as a tab.

## Decision

### 1. The page leaves by extract, to a file the person names

`document.extract`'s route, for one page: `main` runs the save dialog, suggesting the
document's name with the page number, and writes the page there. **The file is the
person's**: it lives where they chose, and this application never deletes it.

- **Rejected: a directory this application owns.** It would put the person's work
  somewhere they did not choose, and the cleanup would delete a file another program may
  still hold open and unsaved.

### 2. The operating system's handler opens only a `.pdf` this application just wrote

`openExternalEditor(path)` in `entry.ts` beside `openInBrowser`, and it is `openInBrowser`'s
shape.

- **Its only caller** passes the destination Decision 1 just wrote.
- **A path not ending `.pdf`** (case-insensitively) is refused before `shell.openPath` is
  called. A save dialog lets a person type `page.exe`, and an extension chooses which
  program the operating system runs.
- **A non-empty error string** from `shell.openPath` is answered as `launch-failed`, never
  thrown away.

### 3. An edit is a changed digest after a quiet period, not an event

For each edit, `main` watches the file's **directory**, filtered to the file's name, which
is robust to every save pattern measured. Events only schedule a look:

- after one second with no further event, `main` reads the file and hashes it with SHA-256;
- **an edit is a digest different from the last one `main` wrote or accepted.**

The duplicates, the temporary names and a save that rewrites identical bytes therefore
change nothing. At most one edit is watched per document, and starting another ends the
first.

- **Rejected:**
  - acting on an event;
  - `fs.watchFile`'s interval polling, which wakes when nothing happens;
  - watching the file itself, which has no advantage over its directory in the table and
    would need re-establishing if a save pattern replaced the path in a way not measured
    here.

### 4. The renderer learns of an edit by a BOUNDED wait, on the one bridge function

`document.awaitExternalEdit({ docId })` answers:

- `changed` when Decision 3 finds an edit;
- `unchanged` after 30 seconds with none, and the renderer asks again;
- `ended` when the document closed or has no edit.

No `invoke` is left pending past that bound. How a pending one behaves across a window
reload is not measured, and the design does not rest on it. The bridge keeps its one
function.

- **Rejected:**
  - a push channel on the bridge, which would be a second transport, and its declaration
    says one;
  - a status channel polled every few seconds, which is the same wait with more calls;
  - an unbounded wait.

### 5. The page comes back through the one open route, and never by surprise

When the renderer has `changed`, the person is asked. On yes,
`document.reimportExternalEdit({ docId })`:

1. opens the edited file through `openPath` as a **visible tab** (ADR-0040 Decision 2), and
   waits for its sessions;
2. applies the existing **`replacePage`** at the page's index;
3. records the file's digest as accepted.

The tab stays open for the person, as ADR-0060's append leaves its composed document.

**Refused as `document-changed`** when the target document's version moved since the page
was sent out: a page inserted or moved in the meantime would make the index name a
different page, and replacing it would destroy the wrong one.

**The returned file is §1.1**: whoever edited it controls it, and it is parsed only in the
contained host, by the one open route.

- **Rejected:**
  - reimporting automatically on every change, which would replace a page while the person
    is still mid-edit and after partial saves;
  - a hidden open of the edited file, which ADR-0040 Decision 2 refuses by name.

### 6. The watch ends with the document

Closing the target document, or quitting, stops its watch. The file stays where the person
put it.

## Stated limits and triggers

- **The self-loop.** If this application becomes the registered handler for PDF,
  Decision 2 opens the page in this application itself. No association is declared today;
  **Stage 10's packaging row owes the check** the day one is.
- **The one-second quiet period and the 30-second wait are policy, not measurements.**
- **An editor that holds the file locked while it saves** makes the digest read fail. That
  is answered as no edit yet, and the next event looks again.

## Consequences

- `ARCHITECTURE.md` §8 gains the external-applications bullet, and the amendment log a row.
- The threat model gains §1.11, and §2's row for `main` gains the operating system's
  handler for a PDF it just wrote.
- The feature commit owes: `entry.ts`' launcher, the watch, the three channels, the
  command, and the pair of tests — with the watch driven by a real directory, a real file
  and every save pattern in the table above.

## Correction, 2026-09-14 — the version check is the bus's, so `replacePage` names a version

Decision 5 says a reimport is refused as `document-changed` when the target document's
version moved since the page was sent out. **It did not say where that comparison happens,
and the only place it can happen correctly is inside the command.**

### Why a check outside the command is not the check

`main` could compare the version it recorded at send-out with the document's version, and
then dispatch `replacePage`. Between the comparison and the apply, another command can land
in the document's lane: a page inserted, deleted or moved. The index then names a different
page, and the replace destroys it — the outcome Decision 5 exists to refuse. A
check-then-act across the lane is a race, however short.

`DocumentService` has no `versionOf`, **deliberately**: `documentService.ts` records that the
accessor existed and was removed, because anything that reads a version after an await and
stamps it onto a result is stale by construction — this race, in general form.
`run(docId, work)` gives the work a `DocumentContext.version`, *"the version the document is
at now"*, read inside the lane.

The bus already makes the comparison atomic. `execute`'s first line is `#refuseIfStale`,
inside the lane, before the capture and the apply. It refuses by the command's **declared**
`targets` and by the version the contract's `targetVersionOf` reads from the payload, and it
throws `StaleTargetError`. Nine kinds take that route today: the annotation, form-field and
text-object commands.

### What changes, and why it is B4

`replacePage` declares `targets: 'none'`, with the reason *"nothing in its payload points into
an answer this document gave"*. That sentence is false about `at`. A page index is a position
in the page tree **read at a version**, and it is the one kind of answer a replace can destroy
the wrong thing through.

1. **`CommandTargets` gains `'page'`**: the payload's page index points into the page tree
   read at the version it carries. It is a fourth member, not a widening of one of the three,
   for the reason `commandDeclarations.test.ts` gives about the others: a page index, an
   annotation index, a widget index and a PDFium page-object index are four index spaces.
2. **`replacePageSchema` gains `version: docVersionSchema`**, `targetVersionOf` answers it, and
   the contract gains `NamesAPage` (`'replacePage'`), joined to both lines of that test's tie.
3. **`replacePage` declares `targets: 'page'`.**

This changes an existing command's payload, and `replacePage` is renderable, so it is an
amendment rather than a registration: its own commit, before the feature.

### Who sends which version

- **The replace-page control** sends `context.version`. The page it replaces is `context.page`,
  read from the tab the person is looking at, at that version.
- **The reimport** sends the version `main` recorded when the page was sent out. The bus
  refuses a moved document with `StaleTargetError`, and the reimport channel answers that as
  `document-changed`. Nothing else compares anything.

### A sentence the renderer owes

`document.execute` already answers `StaleTargetError` as `stale-target`, and the command
problem dialog says *"That list was out of date … The list has been refreshed — have another
look"*. That sentence was written for the annotation and field lists. A refused page replace
has no list, so the feature commit owes the dialog a sentence that fits a page.

### Rejected

- **Comparing versions in `main` before dispatch.** The race above.
- **Holding the lane across the compare and the dispatch by hand.** That is a second
  implementation of `#refuseIfStale` in a handler — B3a's second opinion about staleness — and
  it is the one a later reimport path would forget.
- **A new `reimportPage` command.** It would do exactly what `replacePage` does, with a version.
  Two commands for one tree operation is what the page-tree row's single writer exists to
  prevent.
