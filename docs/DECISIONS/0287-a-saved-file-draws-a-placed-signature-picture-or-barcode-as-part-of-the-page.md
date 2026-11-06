# ADR-0287 — A saved file draws a placed signature, picture or barcode as part of the page

- **Status:** Accepted
- **Date:** 2026-11-06
- **Decided by:** the owner, 2026-11-06: *in a saved file, plain signatures (typed, drawn and picture), pictures from
  Place image, and barcodes are part of the page.* While the document is open each can still be moved, resized and
  undone; in the saved file the page's own content draws it and no stamp layer remains for it; after reopening it is
  part of the page; a file Monstera saved earlier with one of these as a layer gets the same treatment when saved again.
- **Amends:** [ADR-0133](0133-a-signatures-mark-is-drawn-once-for-both-writers.md) Decision 2 (a plain signature is
  a `/Stamp` in the SESSION, and no longer in the file a person keeps), and the save seam: `SerialiseOptions`, the
  host's `engine/serialise` and `engine/extract` requests, and `main`'s staging gain one field each, `marks`.
- **Found by:** the owner's phone. PDF apps there draw no annotation layer at all: a Monstera signature, the same
  layer rewritten without its extra form and with a compressed picture, a highlight, and another editor's comment marks
  all showed nothing, while the same signature drawn by the page's own content showed.

## The problem, in one sentence

Some PDF readers draw only the page's content, so a mark that lives in an annotation's appearance is invisible in them,
however that appearance is written.

## Decisions

1. **One module engraves, at the moment a file a person keeps is written** (`packages/kernel/src/engraveOnSave.ts`).
   For each page, each annotation the rule in decision 2 names is drawn by the page: the page's `/Contents` becomes
   `[q, the page's own streams, Q and one q cm Do Q per mark]`, the mark's own appearance form is named in a fresh
   `/Resources` dictionary for that page (a shallow copy of the one it read, inherited or shared), and the annotation
   leaves `/Annots`. The `cm` is the format's own appearance mapping (ISO 32000-1 §12.5.5): the form's `/BBox` through
   its `/Matrix`, fitted to `/Rect`, so a turned page and a CropBox off zero draw it where the layer drew it. The
   leading `q` and the `Q` before the marks undo whatever state the page's content leaves behind. No stream the page
   already had is edited, so a stream or a resource dictionary shared with another page is unchanged there.
2. **Which marks: Monstera's own, by its private mark, and only these kinds.** An annotation is engraved when it carries
   `/Monstera_Authored true` (ADR-0043's private mark, the one reader of *which annotations are ours*), is a `/Stamp`,
   and is named `Signature` (a plain signature, ADR-0133) or `Image` (Place image, and a barcode, which is placed as a
   picture). The names are the ones those commands have always written, so a file saved earlier is recognised.
   Another producer's stamp carries no such mark and stays a layer, whatever it looks like. The kinds are one table,
   `ENGRAVED_ON_SAVE`, beside the commands that create them, so a later kind (a stamp, typewriter text, a text box)
   joins as a row and never as a second writer.
3. **Engraved for the save, then put back, so the session keeps its layer** (`savedWithoutOutline`'s shape): the
   engraving is made in the live document, the bytes are written, and every page key it changed is restored in a
   `finally`. The objects it added are left unreferenced in memory and the next collecting save drops them. So after a
   save the person can still move, resize and undo the item until the document is closed, and the next save engraves
   it again from the layer, once.
4. **Which bytes win, against §4's save pipeline.** The session, and `main`'s canonical image serialised from it, stay
   the document's truth: they hold the layer. A file a person keeps is a product of that truth, as *Save a copy
   without bookmarks* already is, never a second truth. Nothing is merged back. Two consequences, stated:
   - **A removal's save** (a redaction, Sanitize) renews the session from the file it wrote (`#renewSessions`), so after
     such a save the marks are part of the page in the session too, and no longer move.
   - **The canonical image and the file on disk differ** by exactly the engraving. Nothing compares the two; the save
     stamps the version it wrote.
5. **A signed document's appended save engraves nothing.** Engraving changes page content, and a change to page content
   after a signature is reported by validators even where the bytes it covers are intact; the incremental save exists
   to keep signatures. So where `saveTermsOf` appends, the marks stay layers. A full save of a signed document (a
   removal, a change of protection) breaks the signature already, and is warned about already, and engraves.
6. **Each route chooses, and none defaults** (B5): `marks: 'as-held' | 'engraved'` is a required part of `main`'s
   staging, so a route that writes a file has to say which. The routes are listed below.
7. **A placed picture is compressed** (the owner's report of 2026-11-06): MuPDF writes a PNG it decoded as raw samples,
   with its soft mask raw beside it. Measured 2026-11-06: a 400 × 300 PNG with alpha placed through Place image saved
   360,000 bytes of RGB and 120,000 of mask, unfiltered. The picture and its mask that Place image, a signature picture
   and a barcode add are written with `/FlateDecode` at placement. Pictures already in a document are not touched, and
   no picture's pixel size changes.

## Routes

| route | marks | why |
|---|---|---|
| Save, Autosave | engraved | the file a person keeps |
| Save back to the cloud (both stages) | engraved | the cloud copy must be the file on disk |
| Save a copy, without bookmarks, Work on a copy, Edit a copy, Recognise text's copy | engraved | a file a person keeps |
| Upload a copy, a form's submit (POST), Send to DocuSign | engraved | a file that leaves the application |
| Email / Share | engraved | as above |
| Export PDF/A, Text to curves, Optimize | engraved (their input) | the output is made from the document as saved |
| Extract pages, Split | engraved | a file a person keeps |
| Edit page in another application | as held | the page comes back into this session, where its stamp still is |
| Undo checkpoints, the byte-image refresh, host snapshots, sealing copies on Protect | as held | internal; they rebuild the session |
| Optimize's and Text to curves' size measurements | as held | they measure, and write nothing |
| Restore an earlier version, a backup | unchanged | a copy of a file already written |
| DocuSign's signed copy, a new PDF composed from Markdown, CSV, images, a camera, an Office file, a URL | unchanged | not this session's bytes |
| Print | not a file | pages go to the spooler as pictures, the layer drawn |
| Sign with certificate's visible signature | unchanged, a form field | the owner's phone draws form fields, a certificate signature's visible mark among them (the note of 2026-11-06 below) |

## Rejected

- **MuPDF's `bake`**: all or nothing; it would flatten comments, highlights and form fields with the marks.
- **Rewriting the layer** (no extra form, a compressed picture): measured on the owner's phone, it still shows nothing.
- **Engraving at placement**: the item could not be moved, resized or undone as a mark while the document is open.
- **Engraving on a reopened copy of the bytes**: a second parse and save per save, and an encrypted document's copy
  cannot be reopened without passwords this build may not hold.

## Costs, stated

- After a save, Comments, Select and every list that read these items as annotations no longer see them once the file
  is reopened; they are page content, removed with Redact or Edit, not with Delete.
- A signed document saved by appending keeps them as layers, and the phone fault stays for it.
- Measured cost at save: recorded in the note below.

## Note, 2026-11-06 — as built: the cost, and two things found

**The cost at save**, from `scripts/research/engraveCost.mjs`, this container, MuPDF 1.28.0 native, 2026-11-06, a
2,000-page document (769,105 bytes), the median of 7 saves each, as held against as a file a person keeps:

| state | as held | kept file | extra |
|---|---|---|---|
| no placed mark | 102.9 ms | 109.4 ms | 6.4 ms (the walk of every page's `/Annots`) |
| one picture on page 1 | 69.6 ms | 74.2 ms | 4.6 ms |
| one picture on every page | 205.7 ms | 824.5 ms | 618.8 ms, the file 2,437,796 to 2,545,556 bytes |

An earlier run the same day, before a refactor of how a free name is found, read 11.2, 5.7 and 681.4 ms.

**A kept stamp picture is engraved too.** A picture placed from the Stamp chooser goes through the same `placeImage`
command as Place image and is written the same way, `/Name /Image`, so this rule cannot tell the two apart, in a new
file or in one saved earlier. Separating them needs a field on the command and a new name; it is put to the owner
rather than built, since stamps join this rule in the next update.

**Found, not this ADR's: two appended saves of one session of a signed document.** Measured 2026-11-06 in
`engraveOnSave.test.ts`' signed case, with a picture placed: the first appended save reopens, and a second plain
appended save from the same session gives a file MuPDF cannot open (*cannot find page tree*, after *ignoring xref
section recursion*). It does not involve the marks option, which engraves nothing on an appended save. Reported.

## Note, 2026-11-06 — the owner's rulings on the two findings

- **A picture placed from the Stamp chooser is drawn into the page: accepted.** No field is added to separate it.
  Word stamps (APPROVED, DRAFT and the rest) stay layers until the next update.
- **A hand signature added to a document that already has a certificate signature stays a layer**, as Decision 5 has
  it: accepted.
- **The second appended save is fixed in this release**: ADR-0008's correction of this date has the mechanism and the
  fix (`rebasedOn`).

## Correction, 2026-11-06 — Decision 3 did not hold in the application until the session was synced

*"The person can still move, resize and undo the item until the document is closed"* was false as built, and every
case was green. Run in the application on an unsigned document: after
one Save, a click on a placed picture gave no handles and a drag sent no command. The release build, the control, gave
eight handles and a move.

**The mechanism:** `pdf_write_document` ends with `pdf_sync_open_pages`, which rebuilds every open page's annotation
list from `/Annots`, at the moment engraving has taken the marks out of it. The restore puts `/Annots` back and nothing
syncs again, and `pdf_load_page` answers an open page from its list, so `readAnnotations` found nothing. Read in
1.28.0's `pdf-write.c` and `pdf-page.c`.

**Why the cases passed:** `sessionAfter` read the session by serialising it, and a save reads `/Annots`, which was
right. Nothing read the list the application reads.

**The fix** is MuPDF's own sync, called once the restore is done (`savedEngraved`). The binding has no export for it,
so the generator adds one in the binding's own form (`ADDED`, beside `WITHHELD`, in `mupdfGlue.mjs`). The case is
`engraveOnSave.test.ts`' *still LISTS the picture*, which read 1 before the Save and 0 after it without the fix.

## Note, 2026-11-06 — Sign with certificate's visible signature is not changed, and the phone results

Read on the owner's phone the same day: *cert-01*, a document signed with Sign with certificate as it is written today,
shows the signature, and so does *cert-02*, the same mark drawn into the page and then signed. A filled form shows too.
So these phone apps draw form fields, and a certificate signature's visible mark is a form field's appearance; what
they skip is every other annotation layer. The owner's decision: the visible signature stays as it is written, and
nothing is drawn into the page before signing. Its row is added to the routes table above on the owner's instruction.
No notice goes to users (the owner's decision).

The appended-save fault was also seen in the application after the person's FIRST Save, not their second. Both are
one mechanism: a serialise with no change since the session opened writes nothing, and placing a picture is followed
by main's image refresh, which is the session's first appended write, so the person's Save is its second. ADR-0008's
note of this date has the measurement.
