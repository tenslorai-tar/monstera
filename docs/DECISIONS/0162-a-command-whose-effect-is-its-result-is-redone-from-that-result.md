# ADR-0162 — A command whose effect is its result is redone from that result, and the log keeps no credential

- **Status:** Accepted
- **Date:** 2026-10-04
- **Amends:** §3a's `Reproducibility` axis, which offered a non-reproducible command one replay, `stored-effect`; §4's
  terminal log entry ([ADR-0037](0037-checkpoint-restore-and-the-replay-that-is-not-needed.md),
  [ADR-0051](0051-a-pre-read-may-be-parameterised-and-a-stored-effect-replays-it.md) Decision 2), which kept every
  command whole; `CommandBus.redo`.
- **Found by:** CR-SEC-19 (the PKCS#12 bytes and passphrase are retained in the undo log) and CR-DOC-12 (redo of
  Sign re-signs), one root.
- **Relates:** `signDocumentSchema`'s comment, *"main holds it for the length of one call, nothing records it"*,
  which this makes true.

## Context

§4 already says what a non-reproducible command does: it *"records its effect rather than its intent, and replay
re-applies that stored effect verbatim"*, and it names signing as the first example. The code met that for
`ocrPage`, whose effect is the recognition its pre-read answered (ADR-0051). It did not meet it for `signDocument`,
the only other command declaring `stored-effect`: signing reads nothing, so the entry's stored effect is `undefined`,
and `redo` re-ran the command. Read on 2026-10-04 in `commandBus.ts`: `spec.replay === 'stored-effect' ? entry.read :
…`, then `writer.apply({ command: entry.command, … })`. So a redo signed again, at a new time and with a new
signature, which is a document different from the one undone; and to be able to, the entry kept the command whole,
the private key's bytes and the passphrase included, for as long as the entry lived.

## Decision 1 — a third replay mode, `stored-result`

`Reproducibility`'s non-reproducible arm becomes two:

| `replay` | the effect | redo |
|---|---|---|
| `stored-effect` | the pre-read value the apply was handed (ADR-0051) | re-applies the command with that value |
| `stored-result` | the image the apply produced | installs that image |

`signDocument` declares `stored-result`. `ocrPage` keeps `stored-effect`. A signature is over an exact byte range of
the file it is in, so the image it produced is the only effect a redo can re-apply without signing again.

## Decision 2 — the terminal entry carries the result, and for such an entry only the command's KIND

A terminal entry is one of two shapes, told apart by `result`:

- `result: null`, the command whole, as before;
- `result: Checkpoint`, the image after the apply, and `command: { kind }` with nothing else.

The second shape is what makes the credential unrecordable rather than discarded: there is no field to put the
P12 or the passphrase in, and a redo or a replay that tried to re-run such an entry does not compile, because it has
no command to hand an apply. Both shapes are `kind: 'terminal'`, so `retainedBytes`, `checkpointPaths` and `trimTo`
still classify on two states, and each counts the result file beside the checkpoint: the log retains both, and both
are a whole document on disk.

## Decision 3 — the result is a copy of the file the install used, and redo installs it the same way

The bus stores the result after `#install`, from the file the install put in place: for a hosted-image writer, the
held file; for a byte-image one, its image. Redo installs the result exactly as `#install` installs a hosted image:
the session rebuilt from the file and main's image replaced from it. Nothing re-serialises the signed document, so the
redone file is the signed file, byte for byte. A `stored-result` command on a live-session writer has no such file
and is refused as a declaration defect.

## Rejected

- **Dropping the credential from the command after apply, keeping the shape.** A command with an empty P12 is a value
  the type says is a signing request; the next reader of `entry.command.bytes` gets a valid-looking nothing.
- **Moving the credential out of the command into `ApplyRequest`.** Fifty-seven construction sites for one command, and
  the credential would still have to come back for a redo, which is the defect.
- **Making redo of a signature refuse, or dropping the redo entry.** It loses a state the person could return to; the
  owner's rule is preserve, never drop.
- **Re-serialising the session as the result**, or refreshing the image from the session after a redo. MuPDF writes the
  document out again, and a rewritten file is not the file the signature covers.
- **A third log-entry kind**, ADR-0051's own rejection: `retainedBytes` and `trimTo` would have a state they do not know
  about (DDD-1).

## Cost

One more whole-document file per signature entry, on disk, counted against §9.17's retention like a checkpoint. Signing
is rare and the entry is trimmed like any other.
