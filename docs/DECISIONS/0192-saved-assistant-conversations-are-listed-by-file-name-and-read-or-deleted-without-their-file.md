# ADR-0192 — Saved assistant conversations are listed by file name, and read or deleted without their file

- **Status:** Accepted
- **Date:** 2026-10-07
- **Amends:** [ADR-0093](0093-chat-history-is-off-by-default-encrypted-in-main-and-keyed-by-the-file.md) Decision 4 (its
  three channels) and Decision 2's entry (what is inside a conversation's ciphertext). Its other decisions — off by default,
  encrypted in `main`, keyed by a digest of the file's canonical path, bounded at 200 files, cleared from Settings › Privacy —
  stand.
- **Found by:** the owner's order of 2026-10-07 — *a History button at the top of the Assistant lists saved conversations,
  with open and delete; today a conversation only comes back when its file is reopened.*

## Context

A saved conversation is found again by the digest of its file's path, and only a document that is open can name that digest
(`DocumentService.historyKeyOf`). So the only way back to a conversation is to open its file, and a person who remembers
*the chat about the lease* and not the file's name has no way to look. The store holds turns and nothing else: no file name,
no date, so even a list of what is kept could not say what any of it is.

## Decisions

1. **A conversation's ciphertext carries the file's name and when it was saved.** An entry is `{ name, savedAt, turns }`,
   written by the save that already runs (`main` reads the name from the open document, `commands.nameOf`; the clock is
   `main`'s). An entry written before this — a bare array of turns — still reads: it has no name and no date, and is listed as
   an earlier conversation with the first question it holds. Nothing is rewritten at once.
2. **Three channels, none of which names a path.** `ai.history.list` answers every saved conversation, newest saved first:
   its `key` (the digest, opaque to the renderer), the file's name or `null`, when it was saved or `null`, how many turns it
   has, and the first question as a short preview. `ai.history.read` answers one conversation's name and turns by `key`;
   `ai.history.remove` deletes one. The key was already the store's address and reveals nothing the digest did not.
3. **Open shows the conversation; it does not open the file.** The store keeps no path (L2, ADR-0093) and the renderer can
   name none, so a conversation is read where it is — in the Assistant panel, read-only, with a way back to the list — and a
   conversation whose file has moved or gone is still there, which is the point of a History. Reopening the file still brings
   its own conversation back as it did.
4. **The list and the delete do not wait on the setting.** *Save chat history* decides whether conversations are SAVED;
   what has been saved stays readable and removable while it is off, as *Clear chat history* already clears while it is off.
   A machine with no credential store lists nothing and says so.
5. **Delete asks first**, in the row, as removing a stored key does (the same two-step: the button, then *Remove it* or
   *Keep it*), because a deleted conversation cannot be got back.

## Rejected alternatives

- **Opening the file from the History.** It needs the path in the store, and a list of a person's files is exactly what
  Decision 3 of ADR-0093 refused to put in plain text; in the ciphertext it would still be a capability `main` mints from a
  stored path, a second route to opening a file that no ADR has weighed.
- **A second store for the list's metadata.** A plaintext index of names and dates is the list of files the digest exists to
  avoid; the metadata belongs inside the ciphertext it describes.
- **Decrypting every conversation on every list.** At most 200 entries of at most `MAX_CHAT_TURNS` turns, once per opening
  of the History: bounded, and nothing is held between asks.

## Consequences

- `chatHistory.ts` gains `list`, `read` and `remove` and writes the entry as above; the contract gains the three channels.
  The wired pair: `chatHistory.test.ts` (an old entry and a new one both list and read; a conversation that will not decrypt
  is skipped and not fatal; `remove` removes one and leaves the others) and `AssistantPanel.test.tsx` (the History button
  lists, Open shows read-only, Delete asks, then removes), each with the control named in its case.
- The screens that change: the Assistant panel's top, and its History view.
