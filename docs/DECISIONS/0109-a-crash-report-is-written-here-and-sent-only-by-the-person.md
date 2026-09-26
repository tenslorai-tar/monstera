# ADR-0109 — A crash report is written here, on by default, and sent only by the person

- **Status:** Accepted
- **Date:** 2026-09-26
- **Amends:** `docs/ARCHITECTURE.md` §8 (Observability). **Supersedes** the founding record's C8 clause
  (`BUILD-PROMPT.md`:392-394): *"`crashReporter` opt-in, off by default, consent prompt on first run"*.
- **Decided by:** the project owner, work list of 2026-09-26, item 6 (the *Crash reporter consent* row): reports are
  written locally, on by default, a Privacy setting turns them off, and the next start after a crash offers to send one
  through the Windows Share sheet to report@monsterapdf.com with a Copy button and a warning that a report can contain
  fragments of the open document. **The address is not live**: nothing is ever sent to it by the application or by a
  test, and the hand-off is proven with a stub.
- **Relates:** [ADR-0080](0080-emailing-a-document-is-the-windows-share-sheet-from-main.md) (the Share sheet route),
  [ADR-0022](0022-the-engine-host-is-a-process-we-create.md) (the engine hosts),
  [ADR-0093](0093-chat-history-is-off-by-default-encrypted-in-main-and-keyed-by-the-file.md) (a privacy default).

## Context

The *Crash reporter consent* row was blocked on 2026-09-25 on *nowhere to send a report*: the founding record's
consent prompt existed to guard an **upload**, and this project runs no server. The owner answered by removing the
upload altogether. A report is written on the person's computer, and it leaves only if the person chooses to share it,
through the same Share sheet Email uses, each time.

That changes what needs consent. Writing a file into the application's own data folder is what the diagnostics log
already does, always on (§8). Sending it is the act a person must choose — and under this decision it is chosen per
report, at the moment the person can see what it is and where it would go, which is a stronger consent than one prompt
on first run.

## Decision 1 — Electron's reporter, uploads off, started early, off at the next start when turned off

`crashReporter.start({ uploadToServer: false })` — no `submitURL`, no `extra`, no `globalExtra`, nothing this
application adds to a report. Started in `main` before the first window, after the single-instance lock, so the
renderer is watched and a second launch starts nothing. The setting `privacy.crash-reports` is **on by default**; it
is read at start, and turning it off takes effect **at the next start**, because Electron cannot stop a started
reporter — the setting's text says so. Turning it off also deletes the reports already written.

`setUploadToServer(true)` appears nowhere, and a scan makes it a red build.

## Decision 2 — "a crash happened" is read from the reports folder, not from Electron's upload list

With uploads off, Electron's `getLastCrashReport()` and `getUploadedReports()` return nothing (they list uploaded
reports only), so `main` lists the reports folder itself and offers the newest report not yet offered. The offer is
recorded as made so it is shown once per report.

## Decision 3 — the offer shares through the Share sheet, and shows the address and the risk

At the start after a crash, the recovery offer adds *Send us the crash report?* with three things: **Share…**, which
opens the Windows Share sheet with the report and the diagnostics log attached (ADR-0080's route, widened from one
file to the files of one offer); the address **report@monsterapdf.com** with a **Copy** button, for a person whose mail
app is not a Share target; and the sentence that a report can contain fragments of the documents that were open,
including file names. Dismissing it sends nothing. The application never addresses, composes or sends a message.

## Decision 4 — what is not covered, stated

- The engine hosts are processes this application creates inside an AppContainer (ADR-0022); Crashpad watches the
  processes Electron launches, so a host crash is not expected to produce a report. A host's failure is already
  classified and logged (`engine-host-gone`). Not measured, and stated.
- Windows Error Reporting may still receive a crash through the system handler; that is Windows' channel, governed by
  the person's Windows diagnostic settings, not this application's.

## Rejected

- **Uploading to a service of our own** — no server exists, and building one to receive fragments of people's
  documents is the opposite of this project's promise.
- **Off by default with a first-run prompt** — the founding clause. With nothing uploaded, a first-run prompt asks the
  person to consent to a file on their own disk, and trains them to dismiss a dialog before anything is at stake.
- **Composing an email ourselves** (`mailto:` with an attachment) — `mailto:` cannot carry an attachment, and a
  hand-built message is the application sending mail on the person's behalf.
