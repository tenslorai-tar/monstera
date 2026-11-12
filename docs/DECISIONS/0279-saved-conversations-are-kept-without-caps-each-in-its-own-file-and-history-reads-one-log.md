# ADR-0279 — Saved conversations are kept without caps, each in its own file, and History reads one log

- **Status:** Accepted 2026-11-01 — as revised by *The owner's answers, 2026-10-31*, which replaces Decisions 1, 2, 5
  and 6 with one history file per PDF, and with the one wording change in *The owner's approval, 2026-11-01* at the
  end. Not built yet; until it is, ADR-0093 and ADR-0277 Decision 6 describe what ships.
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
   conversations, 237 to 297 ms for 20 long ones (a 40 MB file) and 3.1 to 3.9 s for 200 long ones (400 MB). So the conversation
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
`safeStorage`, and the guard with the shipped engine and `atomicWrite`. Medians of five, warm. Three runs were made;
where they differ the range is given, and the one reading no other run came near is named in its own row. The figures in *Measurements* above were read with instruments under `_review/`, which
are not public, and nothing this section decides rests on them.

| | today (one file, the control) | one file per PDF | target |
|---|---|---|---|
| opening a PDF, history read | 0 / 0.22 / 10.97 MB with 1 / 200 / 10,000 PDFs saved (0.6 to 0.8 / 3.3 to 3.4 / 243 to 275 ms) | **0 bytes** | 0 |
| a save after an answer, 20 / 200 / 1,000 conversations on the PDF | 16 to 18 ms (short) and 637 to 745 ms (long) at 20; over the cap past it | **1.4 to 7.2 ms**, short or long | < 100 ms, flat |
| the same, 200 long conversations (a 400 MB file), the third run only | — | **225 ms**, the same code that took 2.6 and 2.8 ms there in the other runs and 2.4 ms on a 2 GB file in the same run; not explained, and a reason to measure it again where it ships | |
| a whole long conversation saved at once (only at the move from 1.1.2610.0) | — | 20 to 94 ms; 23 to 345 ms on a 2 GB file | |
| a save with 1 / 200 / 10,000 other PDFs' files | 45 to 52 / 55 / 407 to 412 ms | **24 to 26 / 23 to 38 / 24 to 34 ms** | no change |
| History, 20 / 200 / 1,000 conversations | 2 ms short, 324 to 437 ms long, at 20 | **5 to 11 / 22 to 38 / 92 to 322 ms** | < 100 ms at 200 |
| Delete one, 20 / 200 / 1,000 short; 20 / 200 long | — | 9 to 44 / 23 to 52 / 81 to 120 ms; 237 to 297 ms / 3.1 to 3.9 s | off the disk at once |
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

## The owner's approval, 2026-11-01

The owner approved this ADR as revised by *The owner's answers, 2026-10-31*, with one change of wording. `HISTORY_BOUNDS`
is:

> *Conversations about this file, kept on this computer. If the file is moved, renamed or deleted, they are removed
> about a day after Monstera notices.*

The owner's reason: the 24-hour removal (Decision 6 of that section) runs only while Monstera is open and idle, and the
24 hours run from the first check that finds the PDF missing, so *removed within a day* was not true — a PDF moved while
Monstera is closed is not noticed until it next runs. This replaces the *proposed* cell of the wording table's
`HISTORY_BOUNDS` row and the words *removes them within a day* in *Owed when it is built*: the help page,
`packages/ui/src/help/en/ai-assistant.md`, uses the same sentence. Every other proposed string stands as the table gives
it. Nothing is built yet.

## Correction, 2026-11-12 — two gaps the build found, and the history-off line, answered by the owner

Asked by the cloud agent building this ADR before any code, because each is a choice the text above does not make.

1. **A different PDF at a place that already has a history file.** Decision 1 of *The owner's answers* names the file
   by the place alone, and Decision 5 says a PDF found there with a different guard (another `/ID`, or a PDF with no
   `/ID` that another program changed) is a different document that must not see the old conversations, the old ones
   counting as not found. Neither said where the new PDF's own conversations go. **The owner's answer:** one file per
   place still, holding one SECTION per guard. A new guard starts a new section; Monstera's own save of the same PDF
   appends a guard to the section it continues (Decision 5), so it is not a new one. **History shows the section whose
   guard matches the PDF now at that place**, not simply the newest, so a PDF that comes back within the 24 hours gets
   its conversations back (Decision 6). Any other section is removed 24 hours after the first check that finds its PDF
   gone, by the same rewrite Delete one uses (Decision 7), and the file is deleted when no section is left.
2. **History moved from 1.1.2610.0 whose PDF is never opened again.** The old store kept only a digest of each place,
   so a moved entry has no place to check until its PDF is opened. **The owner's answer:** keep it. It stays sealed, gets
   its guard and its place the next time its PDF is opened, and the 24-hour check does not look at it until then.
   *Clear chat history* in Settings still removes it.
3. **The history-off line in the assistant pane** (*History is off, so New chat clears this conversation*, the owner's
   decision of 2026-10-31, ADR-0277's correction of that day) **is removed, and nothing is shown in its place** (the
   owner, 2026-11-12): with history on by default, anyone who has it off turned it off themselves. History's own empty
   line for saving off, *Save chat history is off, so nothing is kept for this file. Turn it on in Settings › AI.*,
   stays as the wording table gives it.

## Correction, 2026-11-12 (later) — a data key this account cannot unwrap, answered by the owner's reviewer

Decision 8 of *The owner's answers* seals everything under one data key wrapped by `safeStorage`. A key can be stored
that this Windows account cannot unwrap: after an administrator resets the account's password, or with the history
folder restored from another computer. The build kept that key and never replaced it, since a new key written over it
would make every conversation sealed under it unreadable for good. That is right, and the reviewer's note of 2026-11-12
keeps it. What it left was a person whose every save is refused with nothing said.

1. **The key is kept and never replaced** (unchanged). `historyStore.ts`' `keyFor` answers no key rather than writing one
   where a key file exists and does not unwrap.
2. **The store names this state**: `locked()` is true where the cipher works, a key file exists and it does not unwrap,
   and a save then throws `HistoryLockedError`, not the generic refusal a machine with no working cipher gets. The two are
   different facts about the person's situation and are said differently.
3. **The assistant says it once, plainly**, the first time a save is refused for this reason in a session, and not at
   every answer after it. The wording proposed, sent to the owner before it ships:

   > *Chat history cannot be saved on this computer, because the history saved here cannot be opened by this Windows
   > account. To start again, choose Clear chat history in Settings › Privacy.*

4. **Settings' *Clear chat history* removes the unreadable files AND the key**, asking first as Decision 3 already says.
   It removes the key on every clear, locked or not: once every file is gone nothing is sealed under it, and keeping it
   would leave a locked store locked. The next save makes a new key.

The case is `historyStore.test.ts`' *history LOCKED to another account*: a key made by one account, a store under
another refuses a save as locked, the key file is unchanged byte for byte, and after *Clear chat history* the key is
gone and a save is read back whole. Its control asserts that a store with no key yet, and one whose cipher is off, are
not locked and are not refused as locked. Reverting the refusal turns the first case red (measured, 2026-11-12).

### What the wiring found, 2026-11-12

Recorded by the cloud agent that wired the store, each a choice the text above does not make. None is final until the
owner has read it.

5. **A PDF that needs a password to open.** Decision 6 removes a section whose PDF *cannot be found or read*. The check
   reads a closed PDF's `/ID` by opening a copy with no password, which a PDF with an open password refuses, so as written
   the check would remove the history of a password PDF standing at its place a day after the first pass that looked.
   **Built conservatively, and asked of the owner:** the host's `locked` answer counts as present, so nothing is removed;
   a different password PDF put at the same place keeps the old section on disk, unshown, until the owner decides.
   `historyCheck.test.ts`' *a PDF that needs a password* holds it, with an unreadable file removed as its control.
6. **A conversation 1.1.2610.0 saved before times were kept** has no time to be headed by, so `HISTORY_UNNAMED`
   (*Earlier conversation*) heads that one alone, where the wording table removed it.
7. **History reads every page.** A list answer carries `HISTORY_PAGE` (200) conversations, and History asks for the next
   until `main` answers none, so every conversation is listed with no control to reach the rest and no new string.
8. **Decision h is not built yet:** *Save chat history* still defaults to off. On by default needs the one-time note,
   whose wording the text above does not give and which needs a place to remember that it was shown. Both are asked of
   the owner rather than written here.
9. **Delete runs on a worker thread**, as Decision 7 says: `historyRewriteWorker.ts` in `packages/nodemode` opens every
   record and writes the kept ones beside the file; `main` appends what was saved meanwhile and renames. The local agent's
   measurement of a large file on Windows decides whether the 3.1 to 3.9 s figure now stays off the main thread.

## The owner's answers to the wiring's findings, 2026-11-12

- **5 (a PDF that needs a password):** kept as built. Its history is never removed while the PDF needs a password.
- **The locked-history line** is approved as written. *Clear chat history* is on Settings › Privacy, as it says:
  `SettingsBody.tsx` draws it on the page whose id is `privacy`, and `SettingsBody.test.tsx` opens that page to press it.
- **8 (decision h): built, on by default, with this note shown once in the AI assistant**, the owner's words: *"Chat
  history is on. Conversations about this file are kept on this computer, encrypted for your Windows account. You can
  turn it off in Settings › AI."* A person who turned it off stays off: persistence sends only the settings a person
  set (`settingsStore.ts`' `exportable`), so a switch nobody touched is unset, takes the new default, and one turned off
  is stored off.

### Where *shown once* is remembered

**In `main`'s history folder, as a file named `note-shown`, written by `main`.** The history store is the one writer of
that folder (B3), and the note is about what it keeps. `ai.history.note` answers `show: true` exactly once, writing the
file in the same call, so two windows cannot both show it. It answers `false` without writing while chat history is off,
while this machine cannot keep it (no secure store) and while it is locked to another account, because the note would
then say something untrue; the note is still owed until it can be true. *Clear chat history* leaves `note-shown` in
place: it removes conversations and their key, and a person who cleared them has read the note.

Rejected: **a setting**. A setting is drawn in the Settings window (`SettingDefinition` has no hidden form) and is
exported and imported with the rest, so a person could see a switch for a note and a settings file could bring it back.
**The renderer's own storage** (a remembered flag in the window): it is per window, and the renderer holds no state of
its own that outlives it.

## Addition, 2026-11-12 — item 9 measured on Windows, and accepted by the owner

The wiring's item 9 asked whether Delete's rewrite stays off the main thread on a large file. Measured by the local
agent on the development machine (Windows 11, 12,170 MiB) before the merge left it, with
`scripts/research/historyDeleteCost.mjs`: the built store, its own worker, files of long conversations made by its own
`save` (32 turns at the answer's bound, about 2 MiB each). The reading is the main thread's worst gap between 5 ms
timer ticks; a planted 500 ms block read 500 ms. Free memory at the start: 4,430 MiB.

| file | rewrite on | Delete | main thread's worst gap |
|---|---|---|---|
| 20 conversations, 40 MiB | worker | 914 ms, then 1,578 ms | 33 ms, then 36 ms |
| 20 conversations, 40 MiB | main thread (control) | 208 ms | 216 ms |
| 200 conversations, 400 MiB | worker | 3,794 ms, then **12,460 ms** | 126 ms, then **433 ms** |
| 200 conversations, 400 MiB | main thread (control) | 3,542 ms | 3,552 ms |

**The rewrite stays off the main thread.** What still holds it is the end of Delete, which this ADR keeps on the main
thread on purpose: a save is a synchronous append, so the tail is appended and the file renamed with nothing between.
A scratch probe timed every synchronous file call `main` made during three Deletes on 400 MiB (its control: the
wrappers saw the store's own `renameSync` and `statSync`): `renameSync` 103, 118 and 106 ms, and in the first run
`existsSync` 231 ms.

**The owner's decision, 2026-11-12: about 0.1 s once, at the end of a Delete on 400 MiB of history, is acceptable,**
and the rename stays where it is.

**What the 100 ms is,** asked by the owner before this is recorded as settled: the rename itself, or Windows freeing the
file it replaces, or a scanner reading it. `scripts/research/renameOverCost.mjs`, two runs of five rounds on 400 MiB
files of random bytes, the order rotated each round (free memory 3,399 to 3,772 MiB throughout):

| the rename | run 1, median | run 2, median |
|---|---|---|
| a new file into a free name | 337 ms | 325 ms |
| a new file over the old file | 515 ms (one of 1,427) | 424 ms |
| the old file aside, then the new one in | 333 ms | 324 ms |
| removing the aside file, alone | 432 ms | 100 ms |
| a new file over a 1 KiB file | 284 ms (two of about 2 ms) | 318 ms |
| a new file into a free name, after 5 s | not run | 2.3 ms (two of 1,442 and 1,553) |

So **most of the cost belongs to the new file, not the old one**: renaming a large file just written costs about
325 ms wherever it goes, and about 2 ms once it has sat for five seconds. Which mechanism that is (a scanner reading
the new file, or its writes being flushed) is not established. **The old file's own share is about 100 ms** (the
difference between the first two rows), and it is the only part the owner's route of renaming the old file aside
first would take away: that route measured 324 ms against 424 ms. The probe's 103 to 118 ms for Delete's own rename is
the size of that share, and why Delete's rename did not also pay the new file's 325 ms here is not established.
No change was made; the route stays available, and it would need start-up to handle a leftover aside file.

**Unexplained, recorded and not chased (the owner, 2026-11-12):** the second worker Delete on 400 MiB, 12,460 ms with a
433 ms gap, in a run that started with 4,430 MiB free; the probe's one `existsSync` of 231 ms, whose free memory was not
recorded; and the two settled renames of 1,442 and 1,553 ms.

## Correction, 2026-11-12 (later) — what the 100 ms is, measured on Delete's own shape

The addition above measured the wrong rename, found in the stage audit of `75a59036..658e14df` (finding HHHHHHHHH-16).
Its instrument wrote the OLD file a moment before replacing it, where Delete replaces a file that has sat since the last
save; it timed a bare `renameSync`, where Delete calls `replaceWithRetry`, which pauses 40 ms after each transient
failure, up to four times; and its control (a 1 KiB rename under 20 ms) showed the clock was quiet, not that it could
read a 100 ms difference. So its *"the old file's own share is about 100 ms"*, and its *"the probe's 103 to 118 ms is
the size of that share"*, were read from a file and a call that are not Delete's. The text above stands as what was
believed then.

**Measured again** with `scripts/research/renameOverCost.mjs` as rewritten: every rename through the built
`replaceWithRetry`, with a `rename` that counts its attempts; the old file left 5,000 ms after it is written; the new
file renamed the moment it is written, as Delete's is. Its resolution control: a 1 KiB replace read 2.2 ms, and the same
with a planted 100 ms read 114.8 ms. Five rounds on 400 MiB files of random bytes, the order rotated; free memory
3,118 MiB at the start and 3,172 to 3,419 MiB after each round.

| the replace | median | each |
|---|---|---|
| a new file over a settled old file (Delete's shape) | 402 ms | 484, 600, 401, 402, 384 |
| a new file into a free name | 331 ms | 331, 2, 329, 333, 335 |
| a settled new file over a settled old file | 104 ms | 1,367, 104, 66, 90, 701 |
| a settled new file into a free name | 2.4 ms | 330, 2.3, 2.4, 2.7, 1.8 |

**No replace was retried**: every one of the twenty made one attempt, so the retry's pauses are none of the cost.
**Replacing the old file costs about 70 to 100 ms** (402 against 331 with a new file just written, 104 against 2.4 with
both settled), and that share is the only part the owner's route of renaming the old file aside first would take away.
**A new file just written costs about 330 ms to rename wherever it goes**, and about 2 ms once it has sat. Delete's own
rename read 103 to 118 ms in the probe, which is the settled-new-over-settled-old row and not Delete's shape; why
Delete's freshly written file reads as settled there is not established. The owner's decision stands: no change is made.

### The first write of a session, which the torn-record fix added (HHHHHHHHH-2, the owner's answer of 2026-11-12)

Decision 1 above says *"a save appends; it reads nothing"*. Since `3cf64def` a write never lands behind a torn record,
so the FIRST write a session makes to a file it did not leave at its present size walks that file's record heads to find
where the last whole one ends, and cuts a torn tail. That first write may be the guard a PDF's open records, so it is on
the open's path. Every later write to that file reads nothing. Read with `scripts/research/historyFirstWriteCost.mjs`,
the built store on files made by its own `save`, each figure one synchronous call on `main`; its control, a planted
100 ms read 102 to 112 ms. Three runs:

| file | first write (the walk) | next write (reads nothing) | first write over a torn tail |
|---|---|---|---|
| 20 conversations, 40 MiB | 10.0; 9.8 and 8.0 settled; 24.4 and 8.6 settled ms | 3.5; 3.0 and 2.7; 3.5 and 3.1 ms | 229, 241, 238 ms |
| 200 conversations, 400 MiB | 654; 20.2 and 20.3 settled; 36.9 and **952** settled ms | **539**; 2.7 and 2.8; 3.4 and **863** ms | 2,578, 2,283, 3,446 ms |

Free memory at the start of the three runs: 3,110, 3,230 and 3,322 MiB; after the 400 MiB file, 2,154, 2,260 and
2,264 MiB. The first run had no settled reading.

**The walk costs about 10 to 40 ms on these files.** A torn tail, which only a crash or a full disk leaves, costs 2.3
to 3.4 s once, on `main`, at the next session's first write to that file: every record is opened to find the last whole
one. That is stated here, not decided; moving that pass off `main` is the owner's to weigh.

**Unexplained, recorded and not chased:** twice in three runs an append to the 400 MiB file that READ NOTHING took
539 and 863 ms, against about 3 ms otherwise, and the first write beside each of them read 654 and 952 ms. So that
cost is the append's, not the walk's. A save to a large file makes the same append, so it is not the torn-record fix's
own cost; it was not measured on the code before that fix.

### The torn tail is cut on the cheap walk (the owner's decision, 2026-11-13)

**The owner's decision: the pass stays on `main`, and is made rare.** Since `3cf64def` every append goes through
`appendTo`, which cuts a torn tail before it writes, so this build can leave a tear only at the end. So the walk now
ends at a torn tail without opening any record before it (`tornTailAt` in `historyRecords.ts`), and the full walk that
opens every record is kept for a chain that breaks anywhere else, which only damage from outside the application or an
earlier build that appended blindly can leave.

**The test as first stated was not sound, and is not what was built.** *The chain runs cleanly and its last head
overruns the end* is also the shape of a tear in the MIDDLE whose head names more bytes than the file has left: cut
there, every whole record after it goes. Measured with that mutation: the middle-tear case listed one conversation of
two, and the walk kept two records of seven. So a tail is cut only where, besides that shape, no record that opens
starts anywhere after it. The search reads only the bytes after the walk's end, so it costs the torn tail's size, not
the file's.

Read with `historyFirstWriteCost.mjs` on the build of this change, free memory 4,585 MiB at the start: a first write over
a torn tail costs **22.8 ms on 40 MiB and 21.5 ms on 400 MiB**, against the **229 to 241 ms and 2,283 to 3,446 ms**
above, which was the full walk. That is the cost of a first write to a whole file (21 to 24 ms on 400 MiB in the same
run). The cases: a torn tail is cut with no whole record before it opened, and the same head in the middle still walks in
full and keeps every record. Mutated: with the tail sent down the full walk, the first fails, having opened all seven
records; with the cut made on the shape alone, the middle cases fail.

### The 539 and 863 ms appends, timed step by step (2026-11-13)

Asked by the owner, since every save to a large file pays an append: is the cost in the open, the write or the close?
`scripts/research/historyAppendCost.mjs` makes a 400 MiB file with the built store's own `save`, then times 20 appends of
a 1 KiB record split into `statSync`, `openSync(path, 'a')`, `writeSync` and `closeSync`, 500 ms apart, and the same
on a 1 KiB file. Its control: a planted 100 ms read 100.4 to 106.1 ms. Three runs, free memory 4,366, 4,603 and
4,614 MiB at the start and about 4,020 MiB at the end:

| step, 400 MiB file | medians over the three runs | worst of 60 |
|---|---|---|
| stat | 0.19 to 0.20 ms | 0.7 ms |
| open | 0.69 to 0.85 ms | **80.0 ms**, once |
| write | 0.20 to 0.25 ms | 0.5 ms |
| close | 0.41 to 0.53 ms | 0.9 ms |

On the 1 KiB file every step's worst was 1.4 ms. A first write over a torn tail and a first write to a whole file, read
in a fourth run of `historyFirstWriteCost.mjs` the same night, were 21 to 24 ms.

**The 539 and 863 ms did not come back in 60 appends**, and the one slow step was an open of 80 ms. **Decided: the
file is not held open for the session.** The measurement does not show a cost that a held handle would remove, and a
held handle would put a new question on Delete's path, which renames another file over this one: whether Windows lets
that rename replace a file this process holds open, which was not measured. What was different about the two slow
readings: free memory then ended at 2,154 to 2,264 MiB, against about 4,020 MiB now. That is recorded as a difference,
not as the cause. They stay unexplained, and the step-by-step instrument is the one to run when one is seen again.
