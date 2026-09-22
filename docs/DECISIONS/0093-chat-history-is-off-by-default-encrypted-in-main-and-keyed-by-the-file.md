# ADR-0093 — Chat history is off by default, encrypted in `main`, and keyed by the file

- **Status:** Accepted
- **Date:** 2026-09-22
- **Decided by:** the owner's specification of 2026-09-15, restated 2026-09-22: *"chats not saved by
  default; saving is a setting, stored encrypted like keys, with 'Clear chat history' in Settings →
  Privacy."*
- **Amends:** `docs/ARCHITECTURE.md` §8 (a new cross-cutting store) and the amendment log.
- **Relates:** [ADR-0083](0083-the-contextual-panel-holds-tabs-and-the-assistant-is-one.md) Decision 4
  (one conversation per document, dropped with it), [ADR-0056](0056-the-settings-dialog-derives-a-control-from-a-schema-and-a-secret-is-write-only.md)
  and `secretStore.ts` (the OS credential store), invariant L2 (the renderer holds no path).

## Context

A conversation lives in its document's store in the renderer and is dropped when the document closes
(ADR-0083). Saving it needs three things no seam provides: a place that survives a restart, a key that
finds *this file's* conversation again, and encryption. The renderer can supply none of them — it has
no filesystem, holds no path (L2), and cannot reach the OS credential store.

## Decision

1. **Off by default.** A setting, `ai.save-history`, `false` unless a person turns it on.
2. **`main` owns the store**, a file `chat-history.json` beside `secrets.json` in the user-data
   directory. Each conversation is encrypted with the same `SecretCipher` the keys use (Electron's
   `safeStorage`), so a copied file is unreadable on another account or machine. Where the cipher is
   unavailable nothing is saved and the setting says why.
3. **Keyed by the file, never by the document id**: the SHA-256 of the file's full path, lower-cased
   on Windows, computed in `main`. A `DocId` lasts one session; a digest finds the same file next time
   and names no path in the store's plaintext. A renamed or moved file starts a new conversation.
4. **Three channels, all by `DocId`**: `ai.history.load` answers the saved turns for an open document,
   `ai.history.save` replaces them, `ai.history.clear` removes every saved conversation. **`main`
   checks the setting on every save** and refuses when it is off, so a renderer that asked anyway
   stores nothing.
5. **Bounded**: a conversation is the contract's own `MAX_CHAT_TURNS` of `MAX_CHAT_TEXT`; at most 200
   files are kept and the least recently saved is dropped first. What is saved is each turn's role,
   text and what it sent — never a reply target or a document version, which belong to one session.
6. **Clear chat history** is a button in Settings › Privacy. Turning the setting off stops saving and
   says that saved chats stay until cleared.

## Rejected

- **Saving in the renderer's storage** (`localStorage`, IndexedDB): unencrypted, and keyed by
  something the renderer can name, which is not the file.
- **Keying by `DocId`**: it does not survive the session, so nothing would ever be found again.
- **The path in plain text as the key**: it would put a list of the person's files in a file whose
  point is privacy.
- **One encrypted blob for all history**: every save would rewrite every conversation, and a
  corrupted file would lose all of them at once.

## Correction, 2026-09-22 — the key is the kernel's canonical path, with no case fold

Decision 3 said the key is a digest of the path *lower-cased on Windows*. That was a second opinion
about a question the kernel already answers: `documentIdentity.ts` decides which string is this file
— `realpath.native`'s canonical path — and records why **every** case fold is wrong for some class of
characters. The key is `DocumentService.historyKeyOf`: a SHA-256 of the record's
`openedIdentity.canonicalPath`, exactly as that module produces it. Found while building, before any
conversation was saved under the other rule.
