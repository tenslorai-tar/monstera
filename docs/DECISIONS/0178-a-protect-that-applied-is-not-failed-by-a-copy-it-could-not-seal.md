# ADR-0178 — A protect that applied is not failed by a copy it could not seal; the copy is named

- **Status:** Accepted
- **Date:** 2026-10-06
- **Amends:** [ADR-0171](0171-the-password-is-held-in-main-while-the-document-is-open.md) Decision 8 point 4
  (*every copy that is not encrypted is replaced by one encrypted under the new terms*): a copy that **cannot** be
  sealed now — one another program holds, or that cannot be written at this moment — no longer fails the whole protect.
  The protect, already applied in the session and recorded in the log, is reported as applied, and the copies it could
  not seal are named to the person. Amends `docs/ARCHITECTURE.md` §3.2's *a protect leaves no plaintext copy* rule
  (now: no **silently** unprotected copy) and §5's `document.execute` result row (it carries the copies a protect
  could not seal).
- **Relates:** [ADR-0139](0139-a-removals-save-deletes-the-backups-monstera-made.md) and CR-DOC-10 (a copy a save
  could not delete is **owed** and named, retried on request — the same posture this takes for a copy a protect could
  not seal), [ADR-0174](0174-a-pdfium-apply-answers-the-characters-it-drew-as-boxes.md) (the `document.execute` result
  already carries a list the person is owed, empty when there is none).
- **Found by:** R14 — review of the protect outcome. When sealing a copy failed after a protect had applied, the
  person was told the protect **failed**, although it had applied.

## Is this the right question

The question looked like *should a protect succeed with a copy left unsealed?* — and framed that way the answer is
plainly no, since ADR-0171 exists to stop a protected document's plaintext copies lingering. But that is not the
situation the code produced, and the real question is the one the misframing hides.

Read the flow. `execute` runs `#bus.execute`, which applies the protect to the live session and **records the log
entry**, then — still in the lane, after the record — calls `#sealPlaintextCopies` over the host's snapshot, every
checkpoint and every backup. A copy that cannot be opened or written there **throws**, and the throw rejects the whole
command. Nothing rolls the protect back: the session is protected, the entry is recorded, and the next save writes the
document encrypted. So the protect **had applied**. The only thing the throw changed was the report — a partial
failure (one auxiliary copy) delivered to the person as a total one.

And the plaintext copies the throw was supposedly guarding against were left on disk **either way** — the throw does
not delete them. So the pre-ADR state was the worst of both: the document protected, the old copies lingering, and the
person told it all failed, so they neither held the protection as real nor knew a copy was unsealed. The question is
therefore not *succeed or fail* but *how is the residual state reported* — and the only answers that lose no data are
ones where the protect the person asked for is kept.

## Decision

A copy a protect **could not seal** — distinct from one deliberately **left** because it is already encrypted — does
not fail the protect.

1. **The protect is reported as applied.** It was: the session carries the new terms and the log holds the entry. The
   renderer is told *Protection set*, which is now true, and holds the user password as it already did.
2. **Every copy that could not be sealed is named.** `document.execute`'s result carries `unsealedCopies`, the
   basenames of the copies the seal pass could not write — **required and empty** when every copy was sealed or left,
   by `historyDropped`'s and the boxes' reason: the person is owed them, and an optional field is one a renderer
   satisfies by not reading it. When it is non-empty the renderer tells the person these older copies may still hold
   the document as it was before the protect, and how to finish: close any program holding them and protect again,
   which re-runs the seal.
3. **A copy already encrypted, or one the seal pass deliberately leaves, is not named.** `undefined` from a seal is
   *left* (already encrypted, or a protect that removes encryption); a copy that could not be written is a distinct
   `unsealed` outcome. Conflating the two would report a successful skip as a failure, or a failure as a skip — the
   second opinion B3a forbids — so the seal reports three outcomes, not two.

§3.2's *a protect leaves no plaintext copy* becomes **no silently unprotected copy**: a copy a protect could not seal
is named to the person (invariant 18's *never silent*), not left to be discovered. The strictly-silent linger the
throw produced, and the false *failed*, are both gone.

## Rejected

- **Leave it as it was — report the applied protect as failed.** This is the defect: a lie that also leaves the person
  unable to act on the lingering copies.
- **Roll the protect back when a copy cannot be sealed.** This refuses the person the protection they asked for because
  **Monstera's own** backup or checkpoint is momentarily held by another program — the owner's *a user is never
  refused because of their document*, and worse, since the obstacle is not even their document. It also loses no-data
  only in the narrowest sense: the person wanted the document protected and would get it unprotected.
- **Swallow the seal failure silently** (`catch {}`), reporting *Protection set* and saying nothing about the copies.
  This fixes the lie and reintroduces the silent linger — invariant 18's exact target, and Rule 0's banned reflex.
- **Build a seal-debt ledger and a retry dialog now**, paralleling CR-DOC-10's delete-debt `owed` ledger so an
  unsealed copy is retried from a dialog without protecting again. This is the complete version and it is **deferred**:
  the delete-debt `owed` mechanism licenses a *delete* against an unchanged file and cannot be overloaded for a *seal*
  without becoming a second opinion about what a debt is (B3a), so it is a new persisted ledger, a new channel and a
  new dialog — a feature-sized change, not a pre-P2 correction. Naming the copies and *protect again* is the
  loses-no-data floor; the ledger is recorded for the owner as a follow-up.

## Proofs

- A protect over a document with a checkpoint whose seal **throws** reports the protect applied (a version, no
  rejection) and names that checkpoint in `unsealedCopies`. **Control:** the same protect with the seal succeeding
  names nothing — `unsealedCopies` is empty — so a test that passed by never sealing anything would fail.
- The seal pass distinguishes **left** from **unsealed**: a copy that is already encrypted (seal answers `undefined`)
  is not named, while a copy whose seal throws is. **Control:** a pass where the only copy is already encrypted names
  nothing, so a pass that named every non-rewritten copy would fail here.
- The renderer shows the truthful outcome only when a copy went unsealed: a protect with a non-empty `unsealedCopies`
  shows the *some copies could not be encrypted* message naming them; **control:** a protect with none shows
  *Protection set* alone.

## Consequences

- `sealCopy`'s outcome gains a third value — `rewritten` (a length), `left` (`undefined`), `unsealed` — and
  `resealCopies` answers the paths it could not seal alongside the count it rewrote. The authority for *what a copy's
  seal outcome was* stays in one place; the host maps a thrown seal to `unsealed` at the boundary where the throw
  happens.
- `document.execute`'s result is one field wider for every command, carrying `unsealedCopies: []` for all but a
  protect. This is the price of the required-not-optional rule, and it is paid once in the one result builder.
- A protected document can still, after this, have a plaintext copy on disk — but only one Monstera could not write
  at the moment, named to the person, and removed by protecting again once it is free. That residual is what CR-DOC-10
  already accepts for a copy a save could not delete, and this brings the protect into line with it rather than
  inventing a stricter posture the delete path never had.
