# ADR-0224 — Protection undo restores the whole protection record

- **Status:** Accepted
- **Date:** 2026-10-10
- **Amends:** ADR-0171 Decision 8's prior and ADR-0220's protection record.

## Context

The current native app kept the original user password, owner password and
permissions after protection changes were undone, saved and reopened. The
reported loss of the saved-file password did not reproduce in this run.

A direct kernel control did find an incomplete inverse. A second protect's
capture keeps only the first protect's writer options. Undo restores those
options with `userPassword: undefined`, discarding the opening key that was
known. The saved bytes remain locked, but `protectedWritingOf().plain()` then
tries an empty password and refuses the next pdf-lib command. The refusal was
measured before changing the protection code, after independently checking
that both original passwords and the permission integer were still correct.

## Decision

The protected prior carries both `passwordTerms` and the optional known
`userPassword`. Capture copies the existing record and inverse restores both
parts, without parsing a password out of an option string. The host's strict
prior schema bounds the opening key by `DOCUMENT_PASSWORD_MAX_CHARS`.

Both fields are credentials under the existing name rule. They cross the host
transport in its frame, remain in the bus's held table beside the log entry,
and never enter a transport file, persisted log or renderer answer. No new
credential list or password holder is introduced.

A prior without writer terms still follows ADR-0171: an unprotected document
is restored unprotected; a document carrying its own encryption uses its
encrypted checkpoint, preserving the owner password that was never known.

## Rejected alternatives

- Restore the writer options alone: preserves the file's lock but loses known
  state required by the next command.
- Parse the opening password from the options: creates another reader for
  MuPDF's option grammar beside the existing structured record.
- Reopen or refuse after every undo: makes a person recover state the kernel
  already had.
- Store the key in a file or the log: violates ADR-0171's credential lifetime.

## Consequences and proof

The prior gains one bounded optional field, and its transport proof must show
that field arrives whole while remaining absent from files. The kernel proof
applies, inverts, serialises and reads each protection change with a separate
WASM reader. It checks both passwords, permissions, page count and original
text, then inserts a page through the actual pdf-lib command and writes it
protected again. Addition is checked against the original plain document.
The native app's successful save/reopen cases remain a separate observation;
this decision does not claim that their saved-file protection was broken.
