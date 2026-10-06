# ADR-0151 — Every full save collects, and a deleted page takes its fields with it

- **Status:** Accepted
- **Date:** 2026-10-03
- **Decided by:** the owner, in the 0.1.10.0 addition to the cloud-4 list, item 12a: *"fill a form, delete the page
  that holds its fields, save. The window shows no fields, but the saved file still holds every answer, readable by
  any other PDF reader. Deleting a page must remove its widgets, prune the field tree (the way deleteFormFields prunes
  it) and collect the orphans in the save."*
- **Amends:** [ADR-0045](0045-a-removals-garbage-collection-belongs-to-the-command.md), whose rejected alternative
  *Garbage-collect every save* this adopts, on a measurement that alternative did not have; and `docs/ARCHITECTURE.md`
  §2's and §4's sentences that map `'ordinary'` to *"an empty option string"*.
- **Keeps:** [ADR-0139](0139-a-removals-save-deletes-the-backups-monstera-made.md) unchanged. A page delete is not a
  removal and its save still keeps a backup.

## The problem, measured

Measured 2026-10-03 against MuPDF 1.28.0, with `@cantoo/pdf-lib` reading the bytes back by walking every indirect
object rather than the catalog. The fixture is two pages with one filled text field on page 2.

| what ran | field in the form | widget objects | objects holding the answer | page objects |
|---|---|---|---|---|
| nothing | yes | 1 | 1 | 2 |
| delete page 2, plain save | **yes** | 1 | 1 | 2 |
| delete page 2, collecting save | **yes** | 1 | 1 | 2 |
| widgets out, tree pruned, delete page 2, plain save | no | **1** | **1** | **2** |
| widgets out, tree pruned, delete page 2, collecting save | no | 0 | 0 | 1 |
| `deleteFormFields`, plain save | no | **1** | **1** | 2 |

Three mechanisms, and the owner's sentence names all three:

1. **A page delete rewrites `/Kids` and nothing else.** `/AcroForm /Fields` still names the deleted page's widgets, so
   the field is in the form, and each widget's `/P` names the page, so the page is reachable too. Collecting alone
   removes nothing, because none of it is unreferenced.
2. **Nothing prunes the tree after a page delete**, because no widget left it. `pruneEmptyFields` prunes a field whose
   `/Kids` is present and empty, and a page delete empties none.
3. **A plain MuPDF save writes every object in the cross-reference table**, reachable or not. Once (1) and (2) are
   done the widget, its answer and the whole deleted page are orphans, and a plain save still writes all of them. That
   is wider than forms: **a deleted page's own content has been in every file saved after deleting it**, and
   `deleteFormFields` and every other command that unlinks an object leave that object in the file the same way.

## The decision

1. **A page delete removes the widgets on the pages it deletes and prunes the field tree, in the same apply.** It uses
   the calls `deleteFormFields` uses, `deleteAnnotation` on each widget and then `pruneEmptyFields`, so there is one
   statement of how a field leaves a document (B3a).
2. **Every full save of a MuPDF session collects unreferenced objects.** The `'ordinary'` purpose maps to MuPDF's
   `garbage` option, as `'removal'` already did. This is the one place a save's terms are decided (`saveTermsOf`), and
   every byte-emitting path reaches it: the save's flush, save-a-copy, extract, export and the checkpoint all serialise
   the MuPDF session (`composition.ts`' `currentBytes`).
3. **The purpose axis keeps its two members and its other meanings.** `'removal'` still forbids an incremental save,
   so no prior revision is kept, and still makes the document's next save keep no backup (ADR-0139). A page delete
   stays `'ordinary'`: the person is editing, not asserting that the content must not survive on their own disk, and
   the backup beside the file is the copy that recovers a wrong delete.

## Why ADR-0045's objection no longer holds

ADR-0045 rejected collecting every save on two grounds.

- *"`foreignAnnotations.test.ts` pins the exact set of entries a plain save re-encodes … A collecting save is a
  different write path and that set is not known to be the same one."* It is now known. The same fixture saved
  through a collecting session reads back identical to a plain save, entry for entry: the same two re-encodings
  (`/Contents`' balanced parentheses and `/NM`'s ASCII hex) and nothing else. That file's cases now run on the
  collecting path, because it is the only path.
- *ADR-0008's "never a default, never a setting".* This adds neither. The purpose still chooses the save's mode. What
  changes is that the ordinary mode no longer writes objects the document does not contain.

The cost was the other unknown. On a 400-page, 1.07 MB document carrying 400 deliberately unreferenced images, three
runs each: plain 21.7, 25.1 and 44.7 ms; collecting 19.5, 24.4 and 39.9 ms. The output was 1,033,802 bytes plain and
819,310 collecting, the difference being the orphans the plain save wrote.

## What is left, stated

- **A signed document's ordinary save appends** (ADR-0008 rule 2, ADR-0149), and an appended save keeps the earlier
  revision whole by construction. A page deleted from a signed document is therefore still in that earlier revision.
  Collecting cannot change that without breaking the signature, and making a page delete break signatures is a
  separate decision. It is stated here so nobody reads *every full save collects* as *every save forgets*.
- **Objects that were already unreferenced when the file was opened are dropped by the first save.** No reader can
  reach them, so nothing a person sees changes, and the file gets smaller. It is stated because it is a byte change to
  a file Monstera did not write, and *preserve, never drop* is about what a document contains, which these are not.
- **New files built from a subset of pages** (extract, split, edit a page in another app) are 12b's and are not
  settled here.

## Rejected alternatives

- **Declare a page delete `'removal'`.** The smallest diff on the existing axis, and it fixes the bytes. It also makes
  the next save keep no backup and delete the older copies Monstera made (ADR-0139), for the most ordinary edit there
  is. A wrong delete would then have no copy to recover from.
- **A third purpose that collects but keeps backups.** It fixes page deletes and leaves every other unlinking command
  where it is, each waiting to be found and reclassified. The class is *a plain save writes what the document no
  longer contains*, and that is one option string, not a list of commands.
- **Delete the orphaned objects by number in the apply.** That is deciding reachability by hand, which is the garbage
  collector's job done a second time (B3a), and it misses what the page shared with nothing else.
- **Prune the tree and do nothing else.** The measurement's fourth row: the field leaves the form and the answer stays
  in the file.

## Correction, 2026-10-04

Mechanism 3 says that once the widgets are out and the tree is pruned, *"the widget, its answer and the whole deleted
page are orphans"*. That is true only when nothing else names the page. Measured the next day: each of twenty-two kinds
of reference, among them an outline entry, a link, a named destination, `/OpenAction`, a structure element, a thread
bead and a reply's `/IRT`, keeps the deleted page and its text through the collecting save; and a field listed in
`/AcroForm /CO` keeps its answer after this ADR's pruning. [ADR-0155](0155-a-page-that-leaves-takes-every-reference-to-it.md) completes decision 1 for
every kind and corrects the pruning.
