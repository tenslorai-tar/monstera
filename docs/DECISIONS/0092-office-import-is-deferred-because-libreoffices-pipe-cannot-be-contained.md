# ADR-0092 — Office import is deferred, because LibreOffice's single-instance pipe cannot exist inside the container

- **Status:** Accepted
- **Date:** 2026-09-22
- **Decided by:** the owner, 2026-09-22 — *drop it for now*.
- **Amends:** `docs/ARCHITECTURE.md` §3's *Office document → PDF* row and the amendment log.
- **Supersedes, for now:** `BUILD-PROMPT.md`:494, D9's *"Office import (LibreOffice)"*, and the
  LibreOffice half of :399 (*"Native binaries (mutool, Ghostscript, LibreOffice, pdfium.dll)"*).
  The founding record is immutable; this is where its clause stops binding.
- **Relates:** [ADR-0063](0063-an-office-file-is-converted-by-a-pinned-libreoffice-in-a-contained-process.md)
  (the converter seam, which stays), [ADR-0022](0022-the-engine-host-is-a-process-we-create.md)
  (the AppContainer), threat model §2 (no document parsing of any kind in `main`).

## Context

D9's Office import converts a `.docx`, `.xlsx` or `.pptx` to PDF with a pinned LibreOffice,
contained the way every other converter here is (ADR-0063). It was built as far as the container
and stopped there, for two measured causes (JOURNAL 2026-09-16, -18, -19, -21):

1. LibreOffice's install-folder check opens the folder's parent with `FindFirstFileW`, which the
   AppContainer refuses (error 5). A grant on that folder clears it — a cost, not a wall.
2. **The wall.** LibreOffice's single-instance check creates a named pipe
   `\\.\pipe\OSL_PIPE_<uid>_…` before it converts anything. Inside an AppContainer the create is
   refused with error 5; outside, the same call succeeds. Windows gives an AppContainer process
   only its own `LOCAL\` pipe namespace, and the name is fixed in LibreOffice's source (`osl`'s
   pipe layer), not taken from any argument, environment variable or profile setting. When the
   create fails, the open finds nothing and the start-up loop retries every 10 ms, for ever.
   **No grant this container can make fixes it**, because a grant widens what a file or object
   ACL allows, and the pipe namespace is not an ACL question.

## Decision

**Office import is deferred.** Nothing ships for it:

- no command, no ribbon or palette placement, no dialog and no string;
- no LibreOffice in the packaged build — `provision:libreoffice` stays a development script that
  packaging does not call, and the container grant for its tree is taken only when a developer
  has provisioned it;
- no LibreOffice entry in `NOTICE`, because nothing of LibreOffice is distributed.

**What stays**, because it is correct and it is what a reopening would build on: ADR-0063's
converter seam and contract, the `containedProgram` generalisation of the contained factory
(program kinds, used today by Poppler), the provisioning and signature-verification code, the
research harness `scripts/research/libreofficeContained.mjs`, and the journal record.

## Rejected

- **Weaker containment for this one converter** — a Low-integrity process without an
  AppContainer, or a job object alone. Rejected under threat model §2: an Office file is
  attacker-supplied input to a very large parser, which is exactly what the container exists for,
  and a converter that parses outside it is the thing §2 forbids with one more step.
- **A custom LibreOffice build** that takes the pipe name from its environment, or skips the
  single-instance check under `--headless`. It would work, and it is too costly now: a
  LibreOffice build is hours per platform, a patch this project would carry against every
  upstream release, and a signing and provenance story for a binary nobody else ships.
- **The machine's own LibreOffice or an online service** were rejected by ADR-0063 and stay
  rejected.

## What would reopen it

Any one of:

1. LibreOffice lets a caller name, or disable, the single-instance pipe (an upstream change);
2. the owner accepts the cost of a patched build;
3. a converter for these formats that runs inside the container as it stands.

Reopening is a new ADR that reverses this one and a FEATURES row moved back out of *deferred*.
