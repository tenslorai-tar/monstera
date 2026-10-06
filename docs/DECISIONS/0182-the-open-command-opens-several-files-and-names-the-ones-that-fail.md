# ADR-0182 — The Open command opens several files, and names the ones that fail

- **Status:** Accepted
- **Date:** 2026-10-06
- **Supersedes:** nothing. It adds a channel beside `document.open`, whose *"takes NO parameters, and that is its
  invariant"* stands, and it changes the *answer* of `document.openWaiting` (Decision 3).
- **Found by:** the owner's list of 2026-10-06 — *"Today Monstera opens one PDF at a time."*

## Context

Three routes reach a document from outside the page, and they differed in how many files they could carry:

| route | how many files | what said which one failed |
|---|---|---|
| the Open dialog (`document.open`) | **one** — `openFile` with no multiple selection | nothing: `absent` and `denied` carry no name |
| a drop on the window (`document.openDropped`) | any number, one call each | nothing, and only the **last** problem was kept |
| a launch (Open with, a file association) — `document.openWaiting` | up to `MAX_LAUNCH_DOCUMENTS`, from `second-instance` into the running window | nothing |

Read 2026-10-06 in `apps/desktop/src/main.ts` and `contractHandlers.ts`: a second launch already hands its paths to the
one running window, so *"into the running window, not a second instance"* needed no new mechanism. What was missing was
the dialog's multiple selection and, for all three, **saying which file failed**. The page's single `openProblem` slot
held whichever failure arrived last, and the next file's `onOpened` cleared it (so the person is never told about an
open they have since replaced) — together, five files with two failures told them about at most one, and not which.

## Decisions

1. **A new channel, `document.openSeveral`, for the Open command; `document.open` stays.** It asks nothing (`{}`, strict),
   exactly as `document.open` does: main picks, mints a `FileHandle` per file and opens each through the one `openPath`.
   It answers `{ opened: [{ name, outcome }] }`, an empty list for a dismissed dialog. `document.open` stays for the
   callers that need exactly one file — a second document for a merge, a half of side by side, the start screen's
   feature shortcuts — because a surface that took three there would be offering a shape nothing there can use.
   `documentPicker.ts` gains `createDocumentsPicker`, the same dialog with `multiSelections`; `contractHandlers.ts` takes
   it as an **optional** `pickDocuments`, and a harness without one is offered its one-file picker as a list of at most
   one (`severalPickerOf`), the single place the two shapes meet.
2. **Every outcome carries the file's NAME, never its path.** `absent`, `busy`, `denied` and `at-capacity` have no
   document to take a name from, and the renderer holds no path to derive one from (L2), so main states it: the
   basename, cut to `MAX_DOCUMENT_NAME_LENGTH`. A drop already has the name — it is the `File`'s.
3. **`document.openWaiting` answers the same named entries.** It is the third route and the only reason the shape could
   not stay as it was: a launch that names five files, one of them moved, must say which. Its input is unchanged.
4. **A failure never stops the files after it, and the failures are said TOGETHER, once, after the last file.** Each file
   settles as a single open does — a document that opened is shown, an already-open one is brought forward — and the
   problems are collected and handed to `onProblem` as a list. Saying each as it happens would have the next file's
   `onOpened` clear it. The start screen's line and the dialog over a document render the one list
   (`OpenProblemLines`): a lone problem with no name is the sentence alone; anything else is each file by name and then
   what happened to it.
5. **The files stay in the order the dialog, the drop or the launch listed them, opened one at a time.** Each open takes
   the byte ceiling the next is measured against, so a parallel open would let the order of finishing decide which file
   is refused for room.

## Rejected alternatives

- **A `several` flag on `document.open`.** It would answer two shapes from one id, and its schema's strictness — that the
  renderer can express no file — is the property the channel is kept for. A second id is one line in the registry; a
  discriminated answer would put a branch in every caller that wants one file.
- **Changing `PickDocument` to return a list.** Fifty-odd call sites in tests and harnesses each answer one path, and
  each would have become a list of one. The optional second picker leaves them as they are and says so in one function.
- **Saying problems as they happen.** See Decision 4: the last one would be the only one the person ever saw.
- **Reporting by position (*the second file*).** The person chose the files by name and sees names in the tabs; a
  position means counting the dialog's order back.
- **Raising `MAX_LAUNCH_DOCUMENTS`.** Explorer launches a process per file past a small selection and each arrives as
  its own `second-instance`, so the bound is on one launch's list and the others still queue behind it.

## Consequences

- `docs/FEATURES.md`'s open row gains the multiple selection and the names.
- The wired pair: `contractHandlers.test.ts` (every path minted and opened, one outcome each, the second file absent and
  the third still opened — the control is `opened` having three calls), and `App.test.tsx` (the dialog's list becomes
  tabs; a drop with a failure in the middle; the failures named, each with its own sentence).
- A harness that supplies only `pickDocument` still works; the shipped build supplies `pickDocuments`.
