# ADR-0279 — Saved conversations are kept without caps, each in its own file, and History reads one log

- **Status:** Proposed — revised by *The owner's answers, 2026-10-31* at the end, which replaces Decisions 1, 2, 5 and
  6 with one history file per PDF; awaiting the owner's approval of that section and its wording. Nothing in it is built.
- **Date:** 2026-10-31
- **Decided by:** the owner's decisions of 2026-10-31 (a to i below), as the local agent was asked to design and measure
  them; the shape and its measurements are the local agent's.
- **Supersedes:** [ADR-0093](0093-chat-history-is-off-by-default-encrypted-in-main-and-keyed-by-the-file.md)
  Decision 1 (off by default), Decision 2's one file `chat-history.json`, Decision 3 (keyed by a digest of the path) and
  Decision 5's 200-file bound; [ADR-0277](0277-the-assistants-limits-are-said-and-an-answer-is-never-cut-in-silence.md)
  Decision 6's twenty conversations per file and its *file-full* refusal. Each gets a dated correction naming this one.
- **Amends:** `docs/ARCHITECTURE.md` §8's chat history store, when built.

## Context

Every conversation for every document is in one file, `chat-history.json` (`apps/desktop/src/chatHistory.ts`). Each
conversation is its own ciphertext, but a save reads, parses and rewrites the whole file, and opening a PDF reads the
whole file to find that document's last conversation. That growth is the only reason for the two caps: twenty
conversations per document (a twenty-first is refused) and 200 documents (past it, the least recently saved document's
conversations are dropped in silence). A document is keyed by a digest of its path, so a moved or renamed file loses
its conversations and a different document later saved at the same place inherits them.

## The owner's decisions (2026-10-31)

- **a.** No cap on documents or on conversations per document. Nothing a person saved is dropped in silence.
- **b.** Conversations stay on this computer, locked to the Windows account, and never travel with the file.
- **c.** Conversations follow the DOCUMENT, not its path. How a document is recognised is the owner's choice, below.
- **d.** A document that is deleted takes its conversations with it, checked from time to time, and only when its drive
  can be reached.
- **e.** Opening a PDF loads no history: the assistant starts empty, and older conversations are seen in History.
- **f.** After an answer, the app saves that one conversation without loading the history.
- **g.** History keeps *Delete* for one conversation and gains *Clear all*, both asking first.
- **h.** Chat history is ON by default, with a one-time note in the assistant (kept on this computer, encrypted, can be
  turned off in Settings); anyone who switched it off stays off.
- **i.** Everything 1.1.2610.0 saved moves into the new shape once, losing nothing; a conversation that does not decrypt
  is never counted or shown.

## Measurements (2026-10-31, this machine, Windows 11; `_review/historyMeasure.mjs`, `envelopeMeasure.mjs`, `logMeasure.mjs`)

Today's figures are the shipped `createChatHistory` with the real `safeStorage` (Windows DPAPI), run inside the pinned
Electron. Made-up conversations; *short* is four questions, *long* is 32 questions with every answer at 65,536
characters. Each figure is the median of five.

| | today (one file) | suggested shape |
|---|---|---|
| opening a PDF, history read, 1 / 200 / 10,000 documents | 0 / 0.22 / 10.97 MB; 0.7 / 3.0 / 284 ms | **0 bytes, nothing read** |
| one save, 1 / 200 / 10,000 documents (short saved) | 17 / 19 / 396 ms | 13 / 12 / 12 ms |
| one save, same, a long conversation saved | 59 / 58 / 851 ms | 32 / 32 / 35 ms |
| one save, 20 long conversations on the document | 789 ms (a 53 MB file) | 40 ms |
| one save, 200 / 1,000 conversations on the document | over a cap | 10 / 33 ms |
| History, 20 conversations, long | 575 ms, main heap +256 MB | see below |

**History is where the shape had to change, and the measurement is what changed it.** A card per conversation (one
small encrypted file each) took 175 ms for 200 conversations and 0.7–1.1 s for 1,000; one encrypted index per document
took 3 ms for 200 conversations on ONE document, but 233 ms for 200 documents and 1 s for 1,000. Neither meets *within
100 ms at 200*. The cost is the FILE: with no Windows decryption at all (AES under one key), 200 files took 348 ms and
10,000 took 34 s — about 1.7 ms to open each file here, scanner included. So History must read ONE file.

**One append-only log meets it:** one sealed record per save, History reads the log and keeps the newest record per
conversation. Measured with AES-256-GCM per record: History 69 ms at 1,000 records, 650 ms at 10,000, 4.6 s at
100,000 (so about 14 ms at 200); one append 1.6 ms at any size. Past a few thousand conversations History lists the
newest first and reads further on scroll.

**The deletion check** over 10,000 documents (each one's last place, its drive asked once, then the file): 12.6 s in
all, of which asking the disk 4.9 s — about 1.3 ms a document. Never in one pass: see Decision 6.

## Decision

1. **A conversation is its own file.** `history/<document>/<conversation>.turns`, written beside and renamed over by the
   writer settings already use (`replaceWithRetry`). A save writes that one file and appends one record to the log; it
   reads nothing else (f). Measured 10–40 ms whatever else is saved.
2. **History reads one log**, `history/history.log`: per save a record with the conversation's key, its document, name,
   time, message count and first question; *Delete* and *Clear all* append a removal (g). History reads the log once
   and lists newest first. The log is compacted, rewritten with only its live records, when superseded records outnumber
   live ones, in the background; a crash mid-compaction leaves the old log, renamed over only when whole.
3. **Opening a PDF reads nothing** (e). The assistant starts empty; a conversation is read when History opens it.
4. **Sealed under one data key.** A random 256-bit key, itself protected by `safeStorage` (the Windows account) and kept
   beside the history; every file and every log record is sealed with AES-256-GCM under it (b). Per-record DPAPI would
   cost about 1 ms a record (measured above); one unwrap at the first History or save costs one. A torn last record
   fails its tag and is skipped. A record or file that does not open is never shown or counted (i, item 48).
5. **Recognising a document** — THE OWNER'S CHOICE, the trade-offs measured or read:

   | key | follows | loses it | measured / read |
   |---|---|---|---|
   | **A. the PDF's own permanent id** (`/ID`, first string) | moves, renames, copies, edits by tools that keep it | a PDF with no `/ID`; a template whose copies share one | Monstera's full and appended saves keep it (`_review/pdfIdProbe.mjs`); Monstera adds none to a PDF without one |
   | **B. the file's on-disk identity** (volume and file index, `documentIdentity.ts`) | a rename or move on one drive | a copy, a move between drives, any save that writes a new file and renames it | Monstera saves that way (`savePipeline.ts`), so it would re-link on its own saves; other editors' saves would lose it |
   | **C. a fingerprint of the bytes** | a move or rename with no change | any edit, anywhere | Monstera can re-link on its own saves |

   **The local agent's recommendation: A, with B where a PDF has no `/ID`**, and in both cases the person's own saves in
   Monstera re-link the conversations. A copy of a document on this computer then shares its conversations with the
   original (the same document to the reader), and a different document at the same place never inherits them.
6. **The deletion check (d).** Each document's last known place is kept in its folder, sealed. The check runs only while
   the app is idle, a few documents at a time (about 1.3 ms each, measured), at most once a day over the whole set. A
   document's drive or share is asked once per pass; when it cannot be reached, everything on it is kept. **A moved
   document looks deleted to this check**, because its old place is empty — so the OWNER'S CHOICE: (i) delete only
   after the document has been missing for a set time (proposed: 30 days) on a reachable drive, re-linked if it is
   opened from its new place before then; or (ii) never delete automatically, and mark it *not found* in History for the
   person to remove.
7. **On by default (h)**, with the note shown once. A person who turned it off, recorded in their settings, stays off.
8. **The move from 1.1.2610.0 (i)**, once, at the first start: each entry of `chat-history.json` becomes its own file and
   record, keyed as Decision 5 chooses (its path digest is all the old store kept, so a document is re-linked the first
   time it is opened); the old file is renamed `chat-history.migrated.json` only after every entry is written and read
   back, and removed a version later.

## Rejected

- **Keeping one file and raising the caps.** A save already takes 851 ms at 10,000 documents and a History 575 ms with
  256 MB of heap for twenty long conversations; both grow with everything saved.
- **A card file per conversation, or an index per document, for History.** Measured above: one file opened per
  conversation or per document misses 100 ms at 200, because each file costs about 1.7 ms to open here.
- **A database (SQLite).** One more native dependency and a second store format to keep; the log meets the targets with
  the file system the app already uses.
- **Storing anything inside the PDF to recognise it.** It would change a person's file to keep a list they did not ask
  for, and decision b says nothing travels with the file.

## The owner's answers, 2026-10-31

Relayed by the reviewer the same day, with a correction of its own: *one small encrypted file per conversation, in a
folder per document* was the reviewer's suggestion, not the owner's decision. **The owner's design is ONE HISTORY FILE
PER PDF**, holding all of that PDF's conversations. The sections above answered the question they were given; this
section answers the owner's. It **replaces Decision 1** (a conversation is its own file), **Decision 2** (History reads
one log), **Decision 5** (how a document is recognised) **and Decision 6** (the deletion check). Decisions 3, 4, 7 and 8
stand. The title above names the replaced shape and is kept, as an ADR's text is.

### Decisions

1. **One history file per PDF**, `history/<place>.mhist`, named by the digest of the PDF's place (today's key). Inside,
   records appended one after another, each `[type][conversation id][length][sealed payload]`: a GUARD (how the PDF is
   recognised), a CARD per save (name, time, message count, first question) and the TURNS added since that
   conversation's last save. The type and the random conversation id are in the clear so a reader steps over what it
   does not need; everything a person wrote is sealed. A save appends; it reads nothing and rewrites nothing. A torn last
   record fails its length or its tag and ends the read, losing nothing before it.
2. **History shows only the open PDF's conversations.** It opens that PDF's file, if there is one, reads its cards and
   steps over the turns; with no file it shows an empty list. No other file is read.
3. **Two Clear alls, each asking first, and Delete for one, asking first.** History's *Clear all* removes the open PDF's
   file; Settings › Privacy's *Clear chat history* removes every file. The wording proposed for the owner is below.
4. **A PDF is found by its place.** A moved or renamed PDF loses its conversations; so does a deleted one (Decision 6).
5. **The guard (the owner's choice): the PDF's own permanent ID**, the first string of its trailer `/ID`, is recorded in
   the file. A PDF found at that place with a different ID is a different document: it does not see the old
   conversations, and the old file counts as not found (Decision 6). **A PDF with no `/ID`**: the guard records its size
   and last-write time as Monstera last saw them, and **Monstera's own save appends a new guard** for the bytes it wrote,
   since a save writes a new file and renames it over the old (`savePipeline.ts`), so the on-disk file identity is not
   used. Measured: a PDF with an `/ID` is recognised after Monstera's save with no re-link (the save keeps the first
   string); one with no `/ID` is not, and is once the save appends its guard; a different PDF put at the same place is
   recognised in neither case. **What this costs, stated:** a PDF with no `/ID` that another program edits is a different
   document to the guard, so its conversations count as not found. Reading a changed PDF's `/ID` is a parse, so it is
   done by the contained engine host, the one place a document is parsed (invariant 25), and only when the size or
   write time changed since the guard was recorded.
6. **A history file whose PDF cannot be found or read is deleted after 24 hours** — the owner's decision, replacing
   *keep everything when the drive cannot be reached*: an unplugged USB stick or an offline network drive counts as not
   found. Never at the first miss: the 24 hours run from the first check that finds it missing, kept in one sealed
   ledger; a PDF back at its place with the same ID before then resets the clock. **When it runs:** only while the
   person is not working — no input for 30 seconds and no document opening — in batches of 50 files, about 115 ms a
   batch at the measured 2.3 ms a file, so a pass over 10,000 files is about 23 s of idle time spread over minutes, at
   most once a day. It never runs while a PDF opens, so it never slows one. Removal is by Decision 7's route.
7. **Delete really deletes** (the reviewer's fix). Delete one rewrites the PDF's file without that conversation's
   records, beside it and renamed over it, at the confirm; Clear all and the 24-hour removal delete the file. A removed
   conversation's record is then in no file under the history folder (measured below, with a control that a kept
   conversation IS found by the same search). **Its cost is the file's size**: 9 to 120 ms for 20 to 1,000 short
   conversations, 237 ms for 20 long ones (a 40 MB file) and 3.1 s for 200 long ones (400 MB). So the conversation
   leaves History at the confirm and the rewrite runs off the main thread; its words are off the disk when the rewrite
   lands, seconds at the largest file measured.
8. **Unchanged:** no caps; local only and sealed to the Windows account (one data key, wrapped by `safeStorage` once a
   session), never travelling with the file; opening a PDF reads no history and the assistant starts empty; history on
   by default with the first-time note, and anyone who switched it off stays off; 1.1.2610.0's history moved over once,
   losing nothing — today's store is keyed by place, so each entry becomes its PDF's file, its guard recorded at the PDF's
   next open.

### Measurements (2026-10-31, the development machine, Windows 11)

Read with `scripts/research/historyPerPdf.mjs`, which anyone can run: the shape in `historyPerPdfStore.mjs` (a prototype
no shipped code imports), today's store in `historyTodayControl.mjs` run inside the pinned Electron main with the real
`safeStorage`, and the guard with the shipped engine and `atomicWrite`. Medians of five, warm. Two runs were made; where
they differ the range is given. The figures in *Measurements* above were read with instruments under `_review/`, which
are not public, and nothing this section decides rests on them.

| | today (one file, the control) | one file per PDF | target |
|---|---|---|---|
| opening a PDF, history read | 0 / 0.22 / 10.97 MB with 1 / 200 / 10,000 PDFs saved (0.6 to 0.8 / 3.3 to 3.4 / 243 to 275 ms) | **0 bytes** | 0 |
| a save after an answer, 20 / 200 / 1,000 conversations on the PDF | 16 to 18 ms (short) and 637 to 643 ms (long) at 20; over the cap past it | **1.4 to 3.8 ms**, short or long | < 100 ms, flat |
| a whole long conversation saved at once (only at the move from 1.1.2610.0) | — | 20 to 87 ms; 23 to 345 ms on a 2 GB file | |
| a save with 1 / 200 / 10,000 other PDFs' files | 45 to 52 / 55 / 407 to 412 ms | **24 to 26 / 23 to 38 / 32 to 34 ms** | no change |
| History, 20 / 200 / 1,000 conversations | 2 ms short, 324 to 437 ms long, at 20 | **5 to 11 / 22 to 38 / 92 to 322 ms** | < 100 ms at 200 |
| Delete one, 20 / 200 / 1,000 short; 20 / 200 long | — | 9 to 44 / 23 to 29 / 81 to 120 ms; 237 ms / 3.1 s | off the disk at once |
| the 24-hour check, 10,000 files | — | 22.6 to 23.3 s, 2.3 ms a file | never while working |
| one data key wrapped and unwrapped by `safeStorage` | — | 0.2 to 9 ms, once a session | |

### The wording proposed for the owner

Every History string tied to the cross-document list changes; the rest stay.

| string | today | proposed |
|---|---|---|
| `HISTORY_BOUNDS` (the note over the list) | *Each file keeps up to … the file saved longest ago is removed with its conversations.* | *Conversations about this file, kept on this computer. If the file is moved, renamed or deleted, they are removed within a day.* |
| `HISTORY_SHOWN` | *This is a saved conversation, shown to read. It does not open the file.* | *A saved conversation about this file, shown to read.* |
| `HISTORY_OPEN` | *Open {name}* | *Open the conversation saved {time}* (shown: *Open*) |
| `HISTORY_DELETE` | *Delete {name}* | *Delete the conversation saved {time}* (shown: *Delete*) |
| `HISTORY_EMPTY` | *No conversations are saved. Turn on Save chat history in Settings › AI to keep them.* | *No conversations are saved for this file.* — and with saving off: *Save chat history is off, so nothing is kept for this file. Turn it on in Settings › AI.* |
| `HISTORY_FAILED` | *The saved conversations could not be read.* | *The saved conversations for this file could not be read.* |
| `HISTORY_UNNAMED` | *Earlier conversation* | removed: every entry is this file's, so an entry is headed by its time |
| new: History's *Clear all* | — | button *Clear all*; asks *Clear all conversations for this file? Every saved conversation about {name} is removed from this computer. This cannot be undone.* — *Clear all* / *Keep them* |
| new: Settings' question | (cleared at once, no question) | *Clear chat history? Every saved conversation, for every file, is removed from this computer. This cannot be undone.* — *Clear chat history* / *Keep them* |
| `SETTINGS_ACTION_CLEAR_HISTORY_DESCRIPTION` | *Removes every saved conversation from this computer.* | *Removes every saved conversation, for every file, from this computer.* |

`HISTORY_DELETE_ASK` (*Delete this conversation?*), its two buttons, `HISTORY_MESSAGES`, `HISTORY_READ_ONLY`,
`HISTORY_GONE`, `HISTORY_LOADING` and the two Back labels stay.

### Rejected, with the owner's reason

- **The shared log, and History across every document** (Decision 2 above). The owner: History is per document. It also
  read every PDF's conversations to show one PDF's.
- **A file per conversation in a folder per document** (Decision 1 above). The owner's design is one file per PDF; a
  folder of files would also be opened one file at a time, which is what made History slow.
- **The file's on-disk identity as the guard.** Monstera's own save writes a new file and renames it over the old, so it
  changes on every save; it would only work re-linked on every save, and it is not the document's own.

### Owed when it is built (not built now)

- `packages/ui/src/help/en/ai-assistant.md` says: conversations are saved, on by default, on this computer, encrypted;
  they belong to the file where it is, and moving, renaming or deleting the file removes them within a day; and how to
  turn saving off and clear them.
- The site's privacy page changes in the same release (the site agent's task).
