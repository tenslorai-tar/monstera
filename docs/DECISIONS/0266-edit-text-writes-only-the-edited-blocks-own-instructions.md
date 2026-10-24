# ADR-0266 — Edit text writes only the edited block's own instructions: the operator writer is its default

- **Status:** Accepted
- **Date:** 2026-10-24
- **Amends:** [ADR-0176](0176-a-page-holding-type-3-text-is-edited-in-its-own-content-stream-by-mupdf.md) Decision 1
  (a page goes to the operator writer only when its own content shows Type 3 text) and Decision 6's MuPDF reading (the
  edited words must appear unbroken in MuPDF's reading of the page); `docs/ARCHITECTURE.md` §3's in-place editing row,
  whose rule *"A page whose own content shows Type 3 text is written by MuPDF, not PDFium"* becomes *every page is,
  except one whose text is packed inside a form*.
- **Relates:** [ADR-0169](0169-a-pdfium-rewrite-is-saved-only-when-it-reads-back-as-edited.md) (PDFium's read-back,
  unchanged), [ADR-0232](0232-packed-text-is-unpacked-by-the-edit-that-changes-it.md) (packed text, the one case left to
  PDFium), [ADR-0264](0264-edit-object-returns-and-an-edit-changes-only-the-bytes-of-the-object-it-names.md) (Edit
  object's text blocks already take this writer), [ADR-0149](0149-a-signature-is-appended-and-an-edit-that-breaks-one-is-asked-first.md)
  (a signed document).
- **Decided by:** the owner, 2026-10-24, item 3 as updated: *"an Edit text change touches ONLY the text the person
  edited … it never re-encodes, re-generates or re-fonts any other text on the page … Make the operator writer … the
  DEFAULT route for every Edit text change … Keep PDFium's page rewrite only for something the operator writer truly
  cannot do, and then never if it would change other text."*

## Is this the right question

The owner's first wording was *use the operator writer where PDFium's rewrite would be refused*. That keeps the page
rewrite as the default and makes every edit pay for a refusal before it is written, and the refusal is not the defect:
PDFium's read-back refuses correctly. The defect is that a one-paragraph edit asks PDFium to write every object of the
page again, which nobody asked for. So the question is not *when to fall back* but *which writer an edit is*, and the
answer is the writer whose unit is the edit.

## What was measured

**The brochure (corpus document 4, 48 pages).** Every block of every page, its first word replaced, routed as today:
231 of 464 edits refused at PDFium's read-back with *a text object the edit did not write was saved reading
differently*, every one on a page PDFium writes (scratch probe over the built kernel, 2026-10-24, this machine). On page
9, the page in the owner's video:

- the page shows its body text in two different font objects, both `Type0` / `Identity-H` / `CIDFontType2` subsets
  named `AAAAAA+Inter-Regular` (one selected once, the other 46 times);
- after an edit of one block, PDFium's saved page selects **one** of them for all 1,569 Inter text objects, and the other
  is gone from the page's resources. The two subsets number their glyphs differently, so 1,310 characters the person did
  not touch read back as nothing (1,355 Inter characters before, 45 after);
- with **no** edit, the same `FPDFPage_GenerateContent` changes nothing: no object is dirty, so no stream is written.

PDFium's source (`core/fpdfapi/edit/cpdf_pagecontentgenerator.cpp`, main, read 2026-10-24) says why:
`GenerateModifiedStreams` writes again every object of a stream that holds a dirty object, and `ProcessText` names a
font's resource by `FontsMapSearch` over the font's base name and type, so the first font of a name met stands for every
font of that name. This is the mechanism ARCHITECTURE §3 already records for the fonts PDFium loads (*"PDFium writes
fonts of one name as one page resource"*), arriving through the document's own fonts, where no tag of ours can make the
names differ. An exporter that subsets a face per use (this one does on every page that refused) meets it on every page.

**The operator writer on the same document**, every block of the first six pages: 67 of 83 written against 23 of 83
through PDFium, the rest refused for reasons of its own, below.

**The link markers (corpus document 2, 5 pages, owner's item 4).** Its pages show Type 3 text, so they are already the
operator writer's. 12 of 108 edits were refused at MuPDF's reading with *does not hold N edited block(s)*, and they are
two shapes: the block ends in small raised references (7.9 pt on a 10.5 pt line), which MuPDF reads as a line of their
own, elsewhere in its reading, so the block's words are not one unbroken string there (93 of 96 characters matched); and
a glyph PDFium reads as a character MuPDF cannot name and reads as U+FFFD. In both the content was written as planned
and the check was what refused.

## Decisions

1. **Every Edit text change is written by the operator writer** (`editTextOperators`, the MuPDF splice of ADR-0176):
   words replaced, added or removed, bold, italic, underline, strike, highlight, font, size, colour, rise, alignment,
   indents and spacing, a block placed, an added box, and a block that grows pushing the blocks below it, which move by
   their position alone (ADR-0249; a pushed block whose words would have to be set again is refused, never set again).
   It changes only the edited block's own instructions; every other byte of the page is copied. Each word is set in the
   run's own font where that font carries it, else a sibling of the same face on the page, else the closest bundled or
   installed face (ADR-0176 Decision 5, ADR-0177), so a font is never a reason to refuse.
2. **PDFium's page rewrite (`editTextBlock`) is kept for one case: a page whose text is packed inside a form** and that
   shows no Type 3 text. The operator writer edits the page's own content stream, and those characters are not in it;
   ADR-0232's edit moves them onto the page and writes them, which only PDFium does. Its read-back (ADR-0169) is
   unchanged, so such an edit is still never saved when it would change other text: it is refused, and the page is left
   as it was.
3. **The rule is one function, `textRewriteOf`, in the contract**, taking what the two engines read (whether the page's
   own content shows Type 3 text, MuPDF's `engine/page-rewrite`; how many characters no object holds, PDFium's plain
   read), and `readsUnpacked` follows from its answer. `main` calls it where it reads a page for the editor; nothing else
   decides a route (B3a).
4. **The operator writer's MuPDF reading is read by place.** For each line the edit set, the characters MuPDF reads whose
   origins lie on that line — within half the line's pitch of its baseline, across its width — are taken in order along
   the line, and the line's words must be among them unbroken. A character MuPDF reads as U+FFFD stands for any one
   character: it is MuPDF saying it cannot name the glyph, not a glyph missing. Nothing else about the check changes, and
   its structural half (every operator outside the edit byte-identical) is untouched.
5. **A refusal of the operator writer is not sent on to PDFium.** It is said in the owner's one line and the page is
   left as it was. A route that tried PDFium after it would make the page rewrite reachable again for exactly the pages it
   breaks, and would write twice.

## Consequences

- An edit no longer needs ADR-0126's inline-image keeper, which ran in the compose host before every PDFium write: an
  operator edit copies the page's other bytes, inline images among them. The keeper stays for Decision 2's pages.
- A signed document: the operator writer saves incrementally, so ADR-0149's question (asked before an edit that would
  write the document whole) is no longer asked for a text edit; the signatures stay valid over the bytes they signed and
  a viewer reports a change after signing. Decision 2's pages still ask.
- Undo is unchanged: both writers' edits are undone by the bus's checkpoint.
- What still needs PDFium in Edit text: Decision 2's packed pages, and nothing else. Edit text's reads (the runs, their
  styles and fonts, the font a typing box draws in) stay PDFium's; only the write moves.

## Rejected

- **Falling back to PDFium where the operator writer refuses** (the owner's first wording): Decision 5.
- **Renaming a page's same-named subsets before a PDFium write**: it rewrites fonts of text nobody edited, which is the
  defect under another name, and an edit would still write the whole page.
- **Patching PDFium's `FontsMapSearch` to key on the font object**: a fork of the engine for one symptom of a writer whose
  unit is wrong; the next document finds the next thing the page rewrite re-derives.
- **Keeping PDFium as the default and the read-back as the guard**: correct, and refuses every edit of the brochure.

## Correction, 2026-10-24, before the code — Decision 4 checks the lines the edit set, not the block by place

**Decision 4 answered the wrong question.** It was written from the refused edits alone. Read against the page before
any edit (scratch probe, document 2, page 2, blocks 2, 8 and 10): MuPDF's reading of the UNEDITED page already fails to
hold the line that ends in raised markers unbroken — block 8's first line is held, its second is not. So the check was
refusing on lines the edit never wrote. The operator writer leaves such a line alone, or carries it as its own operators,
and the structural read-back already holds those bytes: every operator outside the edit byte for byte, and every inserted
operator, carried ones included, read through its font's ToUnicode as the words drawn.

**So Decision 4 is now:** MuPDF's reading must hold, unbroken and white space aside, each line whose words the edit SET
(`OperatorEdit.checked`), each line on its own; a line left where it was or carried is not asked of it. A character
MuPDF reads as U+FFFD stands for any one character, as decided. Reading by place was not built: it would compare
positions this writer already fixed itself, and it is a second opinion about lines MuPDF reads as the page did.

**And Decision 1's line that a wrap pushes down is now carried, not set again.** Before this change such a line was
set again from its words in its run's own state, which is a re-encoding the owner's rule excludes (*"only their
positions change, never their text or fonts"*). It is now carried as its operators were, by the same replay a placed
block's lines take (ADR-0188), and set from its words only where it cannot be carried. A case with a kerned line below a
wrap holds its kerning in the carried operator, and goes red with the replay restricted to placed blocks again.
