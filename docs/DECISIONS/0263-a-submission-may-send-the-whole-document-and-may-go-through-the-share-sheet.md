# ADR-0263 — A submission may send the whole document, streamed, and may go to a mail app through the Share sheet

- **Status:** Accepted
- **Date:** 2026-10-23
- **Amends:** [ADR-0259](0259-a-push-button-runs-an-ordered-list-of-standard-actions-each-by-the-route-that-owns-it.md)
  Decision 6, its rejected alternative *"Attaching the data to an email"*, and its correction of 2026-10-22 item 1
  (*"a submission is sent as FDF, XFDF or HTML form data, not as the whole document"*); `docs/ARCHITECTURE.md` §9's
  network rule, whose guarded POST (ADR-0061, ADR-0259) now takes a body read a part at a time. Keeps ADR-0080's Share
  sheet, ADR-0165's rule that a document is never read into `main` to be sent, and every guard a POST already meets.
- **Decided by:** the owner's brief for cloud run 16 (C2), 2026-10-23: *"Email submission with the data attached"*
  through the Share sheet, and *"Submit the whole PDF"* by *"streaming the saved document into the HTTPS request body,
  through the same guarded POST"*. And the owner's answers to that run's questions, the same day: offer both mail
  routes in the question — *"Share with the file attached"* and *"Open in my mail app"* (the `mailto:` route, its
  2,000-character fallback as now) — with the address shown and a Copy button, as the crash report does, because
  *"many people's mail app is not a Share target (classic Outlook, a webmail)"*; and send the document as it is now,
  unsaved edits included, the bytes Save would write, without saving it.

## Context

ADR-0259 sends FDF, XFDF or HTML form data: to an `https:` address by `postGuarded`, whose body is a `Uint8Array`
in `main`; to a `mailto:` address by handing the mail app a message with the data as its text. It rejected attaching
the data, because nothing this build binds can attach a file to a message in the person's mail app (Simple MAPI's
`MAPISendMail`), and it left the whole document out, because the document is never read into `main` (ADR-0165).

Both have a route already. ADR-0080 offers a document to the Windows Share sheet as a FILE, where the person picks the
mail app; the sheet attaches it and the person addresses and sends the message. And ADR-0165's correction of
2026-10-13 sends a document from a staged file a part at a time (`currentStaged`, `sentFromStaged`), which is what a
cloud upload and *Send to DocuSign* do.

## Decision

1. **The whole document is a submission format.** `SUBMIT_FORMATS` gains `pdf`, `/SubmitForm /Flags` bit 9
   (`SubmitPDF`, ISO 32000-1 table 237), written and read by the one flag table. A whole-document submission names no
   fields: the standard ignores every other flag and the field list when bit 9 is set, so this build writes no
   `/Fields` for it and reads a document's own as naming none. A document's own bit-9 submission now runs.
2. **To an `https:` address the document is streamed.** `main` takes the document as Save would write it now
   (`currentStaged`, in the document's lane, stamping nothing), moves it into a private file (`sentFromStaged`), and
   POSTs it as `application/pdf` through `postGuarded`. **The guarded POST takes a body as a length and a read**
   (`PostBody`, the `PdfSource` shape) and writes it a part at a time, at most `POST_CHUNK_BYTES` (1 MiB) in hand,
   waiting on the socket's drain, so `main` holds one part whatever the document's size. A form's data is the same
   body over bytes in hand. ONE guarded POST for both (B3a): the address check, the pinned lookup, no redirect
   followed, a `2xx` or a refusal. The file is removed when the send ends.
3. **To a `mailto:` address the question offers two routes, and shows the address with Copy.**
   - *Share with the file attached*: `main` offers the data to the Share sheet as one file, named for the document
     and the encoding (`<name> form data.fdf`, `.xfdf`, `.txt` for HTML form data, which is text), or the document
     itself for `pdf` (ADR-0080's own route, the document named as it is). The sheet's title names the document. The
     Share sheet has no recipient to fill in, so the address is not passed; it is on the question, with Copy.
   - *Open in my mail app*: ADR-0259's route as it stands — the data in the message, and past 2,000 characters the
     mail app opens without it and Export form data runs. The whole document never fits in a message, so for `pdf`
     the mail app opens without it and the person is told to attach the document, or to use Share.
   Where this build has no Share sheet (`ShareDestination` is `null`, which is every platform but Windows), the
   question still offers it and the answer says there is none, pointing at *Open in my mail app*: a shipped build is a
   Windows one, where the sheet is always there, and a renderer told in advance would need a capability read for a
   state no person meets.
4. **Monstera never sends mail.** Both routes end in the person's mail app, which holds the message until they send
   it. A share answers that the sheet opened, never that anything was sent.

## Rejected

- **A second, streaming POST beside `postGuarded`.** Two guarded POSTs is how one of them comes to skip a check.
- **Reading the document into `main` to post it.** ADR-0165; a 1.5 GB scan would be refused by the budget.
- **Saving the document first.** The owner's answer: a submission sends what is on screen, and saving is the person's.
- **Passing the address to the Share sheet.** `DataPackage` carries no recipient; text a target may or may not show
  is not an address, and putting it in the file's name or the sheet's title would read as one.
- **Hiding *Share* where there is no sheet.** See Decision 3: an answer that says so is enough for a state only a
  development machine reaches.

## Proof

Kernel: the flag table writes bit 9 for `pdf` and reads it back as `pdf` naming no fields, with MuPDF's object model
as the second reader; CONTROL: bit 9 with another format bit is still kept. The guarded POST: a body of several parts is
written in order, never more than one part in hand, with the declared length; a private address is refused before a
byte is read. `main`: a whole-document submission stages the document and posts it from the file, removes the file,
and closing the question sends nothing; a share offers the encoded data as one file named for the document; CONTROL:
with no Share sheet nothing is offered and the answer says so. Rendered: the question names both mail routes and the
address with Copy, and each route sends the step and the route chosen.

## Correction, 2026-10-23 — renumbered from 0261 at the merge

Written on the cloud branch `work/cloud-16-update` as ADR-0261 (8b205f3a), while the local branch had taken 0261 for
*a page command is shown at once from the pages already drawn* and 0262 after it. A number is final only once it is on
main (the cloud rule 7), so this one became 0263 at the merge, with every citation of it in the code and the documents
swept to the new number; the commits on that branch still say 0261, which is what they said then.
