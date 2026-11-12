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
