# 0055 — A password crosses into the host, and unlocking is an open

Accepted 2026-09-12.

## Context

Stage 7's first feature row is *open encrypted PDFs, automatic password prompt*.
`docs/ARCHITECTURE.md` §3's matrix already names MuPDF the writer of record for
encryption, so the engine is not in question. What is in question is a shape the
law has no sentence for: **a user's secret has to reach a process this
application contains precisely because it is assumed hostile** (invariant 25),
and the renderer has to be told a document is locked without being told anything
else about it.

One measurement decides most of the design, and it is not in any declaration.

## The measurement — authentication is destructive

Measured 2026-09-12 (`.probe/encryptedOrder.mjs`, `.probe/encryptedMechanism.mjs`;
JOURNAL that date). `Document.needsPassword()` is `fz_needs_password`, which is
`pdf_needs_password`, which is **not a flag read**:

```c
if (pdf_authenticate_password(ctx, doc, ""))
	return 0;
return 1;
```

and `pdf_authenticate_password` clears `doc->crypt->access` and re-derives the
file key from the password it was handed. So **any failed attempt destroys the
key a successful one established.** On an `aes-256` document authenticated with
the correct user password, a single `needsPassword()` afterwards takes page 0
from 24 structured-text blocks to **0**, with MuPDF printing *ignoring zlib
error: incorrect header check* — the streams are being inflated without being
decrypted. The same page rasters at 9,109 bytes of PNG before and **2,056**
after: blank. It is not confined to the text layer.

MuPDF's own source names the mechanism, in the one branch where it can
compensate: after a failed *owner* attempt on a document whose *user* password
succeeded, it re-authenticates the user password because *"the failed attempt to
authenticate the owner password will have invalidated the stored keys"*. A
wholly failed attempt has nothing to restore to.

Three predictions were written down before they were run, chosen to separate
this mechanism from *some call invalidates a cache*, and all three held: a wrong
password by hand breaks it identically; authenticating again repairs it; and
`hasPermission` does not break it.

## Decisions

### 1. `needsPassword` is barred from this codebase

Not discouraged — barred, and by shape rather than by memory. The obvious
surface writes itself: *prompt until the document stops needing a password*.
That loop never terminates (the call re-runs the empty password every turn and
that attempt fails) **and** it destroys the key on the first turn, so the second
password a user types is checked against a document the first check already
broke.

`monstera/no-needs-password` reports the member name anywhere under `packages/`
and `apps/`, with the unlocking module itself exempt — and that module does not
call it either, because the question it answers is *did this password work*,
which only `authenticatePassword` can answer.

### 2. Unlocking is an OPEN, never a call on an open document

One password attempt per `openDocument`. A failed attempt leaves a document
whose key is wrong and which reads as structurally fine, so the illegal state is
*a session that was authenticated against and lost* — and a protocol that
re-opens from the bytes for every attempt cannot represent it (B5). The host
holds no locked session between attempts.

The rejected alternative is an `engine/authenticate` channel on a session the
host already holds. It is one fewer parse per attempt and it makes the broken
state reachable from the wire: any caller that sends two attempts leaves the
host holding a document that decrypts to garbage, and nothing in the answer
distinguishes that from a document that is genuinely empty.

### 3. The password crosses into the engine host

`engine/open` carries an optional `password`. It has to: MuPDF is in the host by
invariant 25 and `main` never parses a document, so authentication cannot happen
anywhere else.

**This grants the host nothing it does not already have.** A host that has
opened an unlocked document holds the plaintext; a host that has opened a locked
one and been given the password holds the same plaintext one call later. The
password is a key to bytes the host is being handed either way. What the
containment is for is the parse, and that is unchanged.

Two consequences are written into the code rather than left implied:

- **The password is never logged, never in a diagnostic, never in an incident.**
  `engine/open`'s failure path names the outcome and not the input, and the
  contract's own redaction list carries the field.
- **It does not survive the call.** Main does not keep it, the record does not
  hold it, and a recycle — invariant 22's drop-and-rebuild — therefore cannot
  re-open a locked document. `recycle` refuses on a document that was unlocked,
  stating that rather than silently producing an unreadable session.

### 4. The renderer learns that a document is locked and nothing else

`document.open` gains a `needs-password` outcome carrying a **pending-open
token** and the file's name. The token is minted by main, stands for bytes main
is already holding, and dereferences to nothing a renderer can name — the same
property `FileHandle` has and for the same reason (invariant L2). The renderer
prompts and calls `document.unlock` with the token and the password.

`wrong-password` is an **outcome** of that channel and not a failure code: a
person mistyping a password is not a defect, and an incident id in front of them
would be absurd. The pending open survives a wrong password so they can try
again, and is dropped on `cancelled`, on success, and on a ceiling the service
would cross.

### 5. What the answer says about WHICH password was accepted

`authenticatePassword` returns a bitfield — `0` wrong, `2` user, `4` owner —
and the unlock outcome carries which one it was. The permission rows later in
this stage turn entirely on that distinction, and a boolean here would be a
second opinion about a question the engine already answers precisely (B3a),
arriving a week before the rows that need it.

## Rejected alternatives

- **Decrypt in `main` and hand the host plaintext.** It puts a PDF parse in the
  process invariant 25 exists to keep parses out of, to avoid sending a password
  to a process that is about to hold the plaintext regardless.
- **A `locked` document record the service holds, with commands refused until
  unlocked.** Every command handler would grow a check, which is a runtime guard
  where a type will do: an unlocked document is simply the only kind that gets a
  `DocId`.
- **Prompting in `main` with a native dialog.** §6 and B9 put every dialog in
  the renderer through the one `<Dialog>` primitive; a second dialog surface for
  one row is the second wiring place the registries exist to forbid.
- **Caching the password to make `recycle` work on a locked document.** It keeps
  a user's secret in main's memory for the life of the document to serve a
  capability §2 offers and nothing calls. Refusing is the honest answer and it
  is one sentence.
