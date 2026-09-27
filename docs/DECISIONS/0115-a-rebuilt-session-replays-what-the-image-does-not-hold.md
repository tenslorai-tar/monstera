# ADR-0115 — A rebuilt session replays what the canonical image does not hold

- **Status:** Accepted
- **Date:** 2026-09-27
- **Amends:** `docs/ARCHITECTURE.md` invariant 18 clause (ii) and §4's command log. Completes
  [ADR-0037](0037-checkpoint-restore-and-the-replay-that-is-not-needed.md), which chose *forward replay by re-applied
  intent* and left two things open: **the base** a replay starts from, and **when** the supervisor runs it.
- **Decided by:** the owner's 27 September list, item 10: *"ADR-0037 already chose the mechanism … What is missing is
  the BASE (the log position the canonical image includes) and when the supervisor runs the replay. B4 amendment
  first."*
- **Relates:** [ADR-0084](0084-a-command-the-view-model-cannot-express-refreshes-the-image.md) (which commands refresh
  the image), [ADR-0023](0023-how-the-contained-engine-host-is-built.md) Decision 9c (the rebuild after a host death).

## The defect, stated from the code

After an engine host dies, `onEngineHostEnded` opens every document's session again from `main`'s canonical image.
Since ADR-0084 that image is replaced only after an operation on a command declared `'image'`. A `'view-model'` command
(`rotatePages`) and a `'nothing-drawn'` one (`setDocumentProtection`) change the live session and never the image, so a
host death drops every one of them applied since the last refresh — while the log still lists them as applied. Undo
then disagrees with the document, and a document the person protected saves unprotected. Nothing is said.

## Decision 1 — the log records the base, and it can never be ahead of the cursor

`CommandLog` holds **how many of its applied entries the canonical image already includes**. The bus sets it to the
applied count whenever an operation replaced the image — the byte-image install and the `'image'` refresh, on execute,
undo and redo alike, set **after** the log has moved, so the number describes the image and the log together.

In the log, not beside it, because the log's positions move: a retention trim sheds the oldest entries and shifts every
index, and a base kept elsewhere would silently point at a different entry. The trim moves the base with it.

**`base ≤ applied` is kept, not checked**, by the two operations that could break it:

- **An undo that steps below the base refreshes the image.** Undoing a view-model command the image already holds
  would leave an image that includes a change the log no longer applies, and forward replay cannot take a change
  away. So such an undo serialises the session into the image, as an `'image'` command's does, and the base follows.
  It costs one serialise on an undo past the last refresh, which is the rare direction.
- **A trim never sheds an entry the image does not hold.** Such an entry would be gone and its effect with it, since
  neither the image nor the log would carry it. The trim stops at the base instead, which can leave the log over its
  retention target — the same outcome the trim already accepts when nothing document-scaled is left to shed, and a
  question about budget rather than about correctness. Refreshing the image before the shed was the alternative, and
  it would put a whole serialise inside the retention path, which runs after every command.

## Decision 2 — the replay runs inside the document's lane, as the rebuild's second half

`onEngineHostEnded` already rebuilds each document's session inside its lane. The replay runs there, immediately after
the session is held and before the lane takes its next entry: the kernel re-applies each applied entry past the base,
in order, through the entry's own writer — `reapply-intent` re-runs the command, `stored-effect` applies the value the
entry kept, which is ADR-0037's redo rule unchanged. No version moves: the renderer's image is the canonical image and
already matched, and the session now matches the log again.

**Every entry past the base is a live-session entry**, by construction: a byte-image writer's operation replaces the
image and so sets the base. The replay therefore never builds a document image.

## Decision 3 — a replay that fails is clause (i)

If any entry fails to re-apply, the document is **refused rather than closed**: the log is kept, the file on disk is
untouched, the session is released, every further command on it is refused, and the person is told — which document,
that its unsaved changes could not be restored, and that the file on disk is as it was last saved. That is invariant 18
clause (i), whose four verbs already bind a poisoned document; this is one more way to arrive at it.

## Rejected

- **Refresh the image after every command.** The base would always be the cursor and no replay would be needed — and
  every rotation would cost a whole serialise, which ADR-0032 measured at 2.00× against a 1.5× ceiling and rejected.
- **Keep the base beside the log in `DocumentService`.** A retention trim shifts the log's indices; the base would
  point at a different entry after the first trim, and nothing would say so.
- **Replay backwards when the base is ahead of the cursor** (inverting the entries the image holds but the log no longer
  applies). It needs every such entry to be invertible against a session opened from the image, a second replay
  direction to prove, and it exists only because an undo was allowed to leave the image ahead. Refreshing on that undo
  makes the state unrepresentable instead (B5).
- **Replay outside the lane.** A command queued behind the rebuild would then run against a session the replay had not
  finished, which is the interleaving the lane exists to forbid.
