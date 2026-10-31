# ADR-0279 — Saved conversations are kept without caps, each in its own file, and History reads one log

- **Status:** Proposed — awaiting the owner's approval and the two choices below (recognition, and a document that
  cannot be found). Nothing in it is built.
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
