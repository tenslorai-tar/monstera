# ADR-0291 — A certified document is locked to what its certifier allowed, and changed only as a copy

- **Status:** Accepted in principle: the owner's decision of 2026-11-06 (Group 5). The design below is this branch's,
  for the owner's review at merge; the choices the owner may overturn are listed at the end.
- **Date:** 2026-11-12
- **Decided by:** the owner, 2026-11-06: *"Today Monstera writes a signer's change setting (/DocMDP) and appears not to
  read it. On a document certified 'no changes', a rectangle is drawn and saved with no question, and Work on a copy
  keeps /DocMDP, /Perms and the signature."* Then, per level: no changes allowed locks the original, says why and
  offers Work on a copy, with *Change this document* removed; form filling and signing only allows those and locks the
  rest, with the same way out; form filling, signing and comments likewise; an ordinary signature keeps today's
  behaviour. The copy is a new, uncertified document and says so; the original stays as the signer sealed it. A notice
  at open says who certified it. An option saves the signed version as a copy, proven first. And a report on what happens
  today when the appended-save check refuses a signed document's save, with the way forward proposed before it is built.
- **Builds on:** [ADR-0149](0149-a-signature-is-appended-and-an-edit-that-breaks-one-is-asked-first.md) Decisions 3 to 6
  (the question asked in the lane before the bus runs, the one dispatcher, Work on a copy) and its addition of
  2026-10-03 (Cancel keeps what was typed; a copy written and not opened is said).
- **Amends:** ADR-0149 Decision 4, for a certified document only: its dialog offers no *Change this document*.

## The problem, in one sentence

`signaturePlaceholder.ts` writes `/Perms /DocMDP` and a `/Reference` whose `/TransformParams /P` is the certifier's
level, and nothing in the repository reads either, so the only question a signed document is ever asked is ADR-0149's
*will this break a signature*, which a rectangle on a document certified *no changes* answers *no*.

## What was read and measured, 2026-11-12

- **No reader.** `grep -rniE "docmdp|Perms|\bmdp|FieldMDP|certif(y|ied|ication)"` over `packages/` and `apps/`, tests,
  `dist` and `node_modules` excluded: the writer, the contract's `certify` field, its pass-through and the Sign dialog's
  menu. `signatureRead.ts` reads `/ByteRange`, `/Contents`, `/Name`, `/Reason` and `/Location`.
- **Why a rectangle is not asked.** `breaksSignatures` (`signatureKeeping.ts`) answers by writer and purpose; a
  rectangle is MuPDF's and ordinary, and a signed document's save appends, so neither question fires.
- **Why the copy is still certified.** `editCopyHandler` writes the file's bytes to the chosen place, opens them and
  applies the edit; nothing touches `/Perms`.
- **Cutting a file back to what a signature signed keeps it valid** (`signedVersion.test.ts`, the measurement the owner
  asked for first). A signature's `/ByteRange` ends at `b + c`, and a file signed and then appended to holds the signed
  file as its first `b + c` bytes. Cut there: one signature then an edit gives the signed file byte for byte, read
  `coversDocument` and `coversWholeFile` both true; two signatures give each signer's file, the first alone in the first;
  a file whose appended tail is overwritten with 40 bytes of rubbish gives the signed file back; a certified file keeps
  `/Perms` and `/P 1`. Control: one byte short, no signature verifies over the whole file.

## Decision

1. **One reader of a certification**, in the kernel beside `signatureRead.ts`, run in the MuPDF host: the catalogue's
   `/Perms /DocMDP` names a signature dictionary; its `/Reference` entry whose `/TransformMethod` is `/DocMDP` holds
   `/TransformParams /P`, read as `1`, `2` or `3`, and `2` where `/P` is absent (ISO 32000-1 §12.8.2.2.2). Any other
   value, or a `/Perms` naming nothing, reads as `no-changes`, the strictest, because a certifier's word that cannot be
   read is not a licence. The answer is `{ level, signer }` or `null`, with the level in the contract's existing
   `certify` names and the signer as `readSignatures` names it. The lock does not depend on the certifying signature
   still verifying: the level is what the certifier declared, and whether the file has changed since is Check
   signatures' question.
2. **What a command changes is declared once, on every command.** A fourth axis of `CommandDeclaration`:
   `changes: 'form-fill' | 'signature' | 'comment' | 'document'`, total over the command union, so a command added
   tomorrow is a compile error until it says. It is not derivable: ADR-0149 could derive *breaks a signature* from writer
   and purpose, but filling a field and redefining one share both. The table of what each level allows is one constant:
   `no-changes` allows nothing; `form-fill` allows `form-fill` and `signature`; `form-fill-and-annotate` adds `comment`;
   `document` is never allowed. A document with no certification allows everything, which is today's behaviour.
3. **It is asked where ADR-0149 asks**, inside the document's lane before the bus runs, and BEFORE ADR-0149's question:
   main asks the session for its certification, and a command its level does not allow answers `certified`
   `{ level, signer }` with nothing changed. `breakSignatures: true` does not pass it; agreement is ADR-0149's answer to
   a warning, and this is not a warning.
4. **The one dispatcher asks the person**, in ADR-0149's dialog with the certified variant: it says who certified the
   document and what they allow, and offers *Work on a copy* and *Cancel*. *Change this document* is not offered. The
   setting *Warn before a change breaks a signature* does not remove this question, because it governs a warning.
   Cancel keeps what was typed, as ADR-0149's addition has it.
5. **The copy is uncertified, and says so.** After the copy is written and opened, and before the edit is applied, a
   removal command takes out the catalogue's `/Perms` and the certifying signature's `/DocMDP` reference; a removal
   saves whole with no prior revisions (ADR-0008), so no earlier revision of the copy still carries them. The signature
   field itself stays (preserve, never drop) and reads as not covering the copy, which is true. A notice on the copy's
   tab says it is not certified and the original, certified by the signer, is unchanged.
6. **A notice at open says who certified it**, once per open, as a toast beside the open's own checks
   (`sayWhenUnwritable` in `App.tsx`), so no new screen: *Certified by {signer}*, and what may be changed.
7. **Save the signed version as a copy.** Check signatures offers, for each signature whose cut verifies over the whole
   cut, *Save this signed version…*: main cuts the bytes it opened at that signature's `/ByteRange` end, reads the cut
   with the same reader, and writes it through Save a copy's picker only when the cut verifies. A cut that does not is
   not offered.
8. **The refused appended save is reported here, not changed here** (the owner's last point). The way forward is
   proposed below and waits for the owner.

## Today, when the appended-save check refuses a signed document's save (read from the code, not run)

`rebasedOn` (`mupdfWriter.ts`, ADR-0008's correction of 2026-11-06) reopens every appended save and throws a plain
`Error` when the file's own chain reads a different page count or cannot be opened again with its pages. A signed
document's every save appends, so it is the route this check guards. The error is none of `saveHandler`'s matched
classes, so it becomes `internal`, and the person reads *"Monstera just encountered an error, your file is not
changed."* with an incident number. The session keeps its previous document, so the next Save fails the same way, and
autosave fails without a word. That is a person refused because of their document.

**Proposed, not built:** the save answers a named outcome instead of `internal`, and the renderer asks once: *This
document's changes cannot be added after its signature without damaging the file.* Offered: *Save a copy* (a whole save
to a new file, the original untouched), *Save anyway* (a whole save that breaks the signature, ADR-0149's existing
question with this reason; not offered on a certified document, by Decision 4), and *Cancel*. Decision 7 gives the
person the signed version back in either case.

## Rejected

- **Reading the level from the certifying signature only when it verifies.** A certifier's declaration does not lapse
  because the file was changed by another tool; whether it was is Check signatures' answer.
- **Deriving what a command changes from its writer, purpose or walk.** Filling and redefining a field share all three.
- **Letting *Edit this document* through on a certified document after a second, sterner question.** The owner's
  decision removes it; the copy is the way out, so no person is refused.
- **Keeping the certification on the copy.** A copy with the certifier's lock on it and an edit the certifier did not
  allow is a document that claims a seal it broke.
- **Removing the signature from the copy.** Preserve, never drop: the field stays and reads honestly.

## Open questions for the owner

1. Decision 1 locks a document whose certifying signature no longer verifies. The alternative is to lock only a
   verifying one.
2. Decision 2's classification puts a placed plain signature (a stamp) and Place image under `comment`, so a document
   certified *form filling and signing* refuses them; signing with a certificate is `signature`.
3. Signing an already signed document with a certification breaks ISO's *one certification, and it is the first
   signature* (§12.8.2.2.1). The Sign dialog offers it today. Should *This signature says* offer certifying only on an
   unsigned document?
4. The proposal for the refused appended save above.

## Addition, 2026-11-12 — Decision 6's toast cannot carry it, found while building

Decision 6 said the notice at open is a toast, and Decision 5 that a notice on the copy's tab says it is not certified.
A toast cannot do either. `ShowToast` takes a message key and no values, so it cannot name the certifier; it leaves
after four seconds (`TOAST_LIFETIME`); and `toasts.ts` says a toast reports an action the person just took, which an
open is not. So neither notice is built, and the surface is the owner's to choose:

1. a window at open, as a read-only file already has (`sayWhenUnwritable`), naming the certifier and what may change;
2. a line that stays while the document is open, which is a new surface;
3. a toast without the name, with a *Check signatures* action that names it.

Until then the certified window says, at the moment the copy is chosen, that the copy is a new document and no longer
carries the certification. Decisions 1 to 5 are built; Decision 7 is next.

## Amendment only

Nothing is built on this in the commit that records it. `signedVersion.test.ts`, the measurement above, lands with it
as its evidence; it tests the format and the existing reader, and changes no code.

## Amendment, 2026-11-12 — the owner's answers, and the line that replaces Decision 6's toast

The owner answered the open questions and the surface above the same day. Recorded before anything is built on it (B4).

**Question 1: kept as built.** A document stays locked when its certifying signature no longer verifies; Work on a copy
is the way out. Decision 1 already says so; `certification.test.ts` holds it from now with a case.

**Question 2: kept as built.** A placed signature and Place image count as comments, because on a signed document they
stay layers (ADR-0287 Decision 5). `commandDeclarations.ts` already classes `placeImage`, `placeSignatureMark` and
`placeSignaturePicture` as `comment`. A barcode is placed through `placeImage`, so it is a comment too.

**Question 3: certify only an unsigned document** (ISO 32000-1 §12.8.2.2.1: a certification is the first signature).
Where the document already holds a signature, the Sign dialog does not offer *This signature says* and says why in one
line. The dialog is the choice, not the enforcement: `signDocument` in the kernel refuses a certification on a document
that holds a signature, so no other route can write one.

**Question 4: the refused appended save is built as proposed**, and its cause is found: which documents make `rebasedOn`
refuse, and whether the file was already damaged or Monstera's appended save writes it wrongly, reported with a real
case. A cause that is ours is fixed at the root.

**Decision 6 is replaced: a line that stays while the document is open.** The owner chose the second surface: it names
the certifier and what may change, with a *Check signatures* button, and the copy says it is not certified by the same
line (which replaces Decision 5's notice on the copy's tab).

- **Read at open, through a new read of the lane's own reader.** `document.certification` answers
  `{ certification: { level, signer } | null, signed: boolean }` from the session, by the reader Decision 1 built
  (`signatureFacts`, the host's `engine/signatures-kept`), so the line and the lock cannot disagree about a document
  (B3a). `signed` is whether any signature is held, which question 3's dialog asks at the moment Sign opens.
- **Held in the document's store** (state is per document), set when the document is shown and again after it is
  signed. The copy's store is marked by the Work on a copy route with the original's signer, which is the one place
  that knows the copy is one.
- **Drawn at the top of the document's own layer** (`DocumentLayer`, ADR-0129), a row that does not grow above the
  page area. Behind, the layer is hidden with everything in it, so the line is always about the document on show and a
  tab switch shows the other document's line, or none. The grid's rows are unchanged.
- **Its button runs the registered *Check signatures* command** with the document's context, never a second way to
  check (no second wiring place).
- **Not dismissed.** It stays while the document is open, as the owner asked; it is one line, `role="status"`, read
  once when it appears.

Rejected: **a grid row of the surface's own** (`'notice notice'`): it moves every screen's rows and is drawn with no
document, where the line has nothing to say. **Reading the certification in the renderer from the bytes**: the renderer
holds no document bytes but ranges, and a second reader is a second opinion (B3a). **Folding it into
`document.signatures`**: that read verifies every signature over the whole file, which an open should not pay for.

## Correction, 2026-11-12 — question 3's refusal is the lane's, not the kernel's signer

The amendment above says `signDocument` *in the kernel* refuses a certification on a signed document. The signer
prepares its placeholder in pdf-lib over the image, so a check there would be a second reading of *does this document
hold a signature*, beside `signatureFacts`, which the lane already reads for every command (B3a). The refusal is made in
the document's lane instead, from that one read and beside the certification check, before the bus: `signDocument` with
`certify` on a document holding a signature answers `already-signed`, one of `SIGN_REFUSALS`, so the channel and the
sign problem dialog take it from the one list.

## Addition, 2026-11-12 — question 4's cause, found, and it was ours

**Which documents made `rebasedOn` refuse: a signed document protected by a user password whose page tree sits in an
encrypted object stream.** Measured with qpdf (`--encrypt u o 256 -- --object-streams=generate`, the shape many
producers write) and with a file built byte by byte to the same shape (`lockedPageTreeFixture.ts`, RC4 revision 2):
every appended save was refused, three in three, as *"its own chain reads 0 pages"*.

**The file was not damaged, and MuPDF's append was not wrong.** The check read the file it had just written without the
password, on the stated ground that *a page tree's dictionaries are not encrypted*. Inside an object stream they are,
and `mupdfOpen.ts` already said so: two opinions about one fact (B3a). With the password the same file reads every page,
and its appended revision is whole. Fixed at the root: `pagesWithoutRepair` in `mupdfOpen.ts` is the one reading (the
password's one attempt, none of the rebuild), and `rebasedOn` reads through it with the session's password. Shapes that
were measured and never refused: a signed file with trailing bytes after its end, object streams without a password,
and protection without object streams.

**The refused save is built as proposed, for what is left**: no known file reaches it now. The save answers
`append-refused`, and the window offers *Save a copy…* (written whole; a certified document's copy uncertified, for
Decision 5's reason), *Save anyway* (written whole, breaking the signatures, on an uncertified document only) and
Cancel. A copy made for a change that breaks signatures is written whole from the start, so it cannot be refused.
Not built: an export or a print of a signed document still appends when it serialises, so a refusal there would read as
the failure it did before; none is known to reach it.

## Correction, 2026-11-13 — Decision 7 as built is not Decision 7 as written (HHHHHHHHH-12)

Decision 7 offers *Save this signed version…* only for a signature whose cut verifies, cut from the bytes main opened.
The build, read from the code on 2026-11-13, differs in both:

- **Where it is offered.** `SignaturesBody.tsx` offers it for every signature that does not cover the whole document and
  file. Whether its cut verifies is asked only when it is pressed; a cut that does not answers `not-found`, and the window
  says *"This signature’s signed version could not be found in the file as it is saved, so nothing was written."*
- **What is cut.** `saveSignedVersion` cuts the file on disk, not the session's bytes. Its comment gives the reason: a file
  damaged after it was signed is repaired on open, and a repaired document saves whole, so the session no longer holds
  the signed bytes as its first ones; the file does.

Since 806f7513 the bytes written are held to the digest of the cut that was checked, so a save while the picker is up
answers `not-found` with nothing written (HHHHHHHHH-5). Whether the offer should wait on a check of each cut, as written,
at the cost of one host open per such signature each time Check signatures opens, is the owner's to decide; until then
this correction is what is true.