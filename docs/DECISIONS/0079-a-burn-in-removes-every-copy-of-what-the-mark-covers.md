# ADR-0079 — A burn-in removes every copy of what the mark covers, and the metadata whole

- **Status:** Accepted
- **Date:** 2026-09-17
- **Amends:** nothing. It widens what `applyRedactions` removes inside the command it already is —
  §4's removal row, [ADR-0008](0008-save-mode-is-determined-by-purpose.md) rule 1 — and adds no
  seam, channel or payload field.
- **Context:** D7's *true redaction* row, and the owner's redaction leak corpus (third reviewing-seat
  block, 2026-09-16): text layer, OCR text, form values under the mark, annotation contents, `/Thumb`,
  XMP and Info metadata, an image under a vector overlay — each read back by an independent reader,
  each with a control.

## Measured, 2026-09-17

`packages/kernel/src/redactionLeaks.test.ts` builds each fixture with pdf-lib, burns in with MuPDF,
and reads the serialised bytes back with pdf-lib, decoding every stream and every string. Each case
has a control through the same pipeline that finds the secret — a mark elsewhere on the page, or a
serialise with no burn-in where no region applies.

| where the secret was | after the burn-in, before this decision |
|---|---|
| page text | removed |
| text in render mode 3 (an OCR layer) | removed |
| an image under a drawn black rectangle | removed (`images: 'pixels'`) |
| a link's `/URI` under the mark | removed — by MuPDF itself |
| a form field's `/V` and appearance under the mark | **left** |
| a comment's `/Contents` under the mark | **left** |
| the page's `/Thumb` | **left** |
| the XMP packet and the Info dictionary | **left** |

## Decision

1. **Every annotation and form widget whose rectangle overlaps a mark is deleted before the
   burn-in**, through MuPDF's `deleteAnnotation`, and the field tree is pruned with the function
   `deleteFormFields` already uses. A widget's field kept its `/V` under an empty `/Kids` until the
   prune; that shape is the one the delete command measured on 2026-09-07.
2. **Links are not removed by this build**, because the engine already removes them: with every
   removal of ours disabled, the link under the mark was gone and the control kept it.
3. **A burned page's `/Thumb` and `/Metadata` are deleted.** A thumbnail is a picture of the page
   as it was; no region of it can be kept honestly.
4. **Any burn-in removes the document's XMP packet and its Info dictionary.** No region maps to
   metadata, and matching the removed text against it would be a search whose silence is the
   reassuring answer: a title that says the same thing in other words passes it.

## What this costs, said plainly

A redacted document loses its title, author, subject and keywords. That is a visible loss on a
document someone meant to share.

## Rejected

- **Scrubbing only the metadata strings that contain the removed text.** A partial match, another
  spelling or another language survives it, and the check would report success.
- **Asking in the confirm dialog whether to keep the metadata.** It is a real option and it is the
  owner's to decide, because it trades a leak for a title; it needs a payload field and a string.
  Until it is decided, removal is the side that cannot leak.
- **Deleting only widgets, not their fields.** Measured: the value stays in the file.

## The question left for the owner

Keep the document's title (or all of its metadata) as an option in the redaction confirm dialog,
off by default? Answering yes is a payload field, a dialog control and a case in the corpus.

## Answered, 2026-09-21 — the TITLE, off by default

The owner's answer: a checkbox in the confirm dialog, off by default, worded so it says a title can
itself contain what was redacted. Built the same day as `applyRedactions.keepTitle`, a checkbox in
`ApplyRedactionsBody`, and three cases in the leak corpus.

**The title alone, not "all of its metadata"** — the question offered both and only one was taken.
Author, subject and keywords are fields a redacted document has no reason to keep, and the whole
point of the loss recorded above is that they are the ones most likely to restate what was removed.
So this is one field rather than a *keep metadata* flag.

**Rebuilt, never pruned.** The kernel reads `/Title`, deletes the Info dictionary as before, and
writes a **fresh** one carrying that single key. Pruning the original would keep every entry this
build has not thought about, and the mutation test says so rather than the paragraph: with the
pruning implementation, `/CreationDate`, `/Creator`, `/ModDate` and `/Producer` all survive a
burn-in. The difference is a filter against an allowlist.

**A document with no title gets no Info at all**, rather than one carrying an empty title.

**What the option gives up is still true and is now a choice somebody makes.** The paragraph above
stands: no region maps to metadata, so nothing checks whether the kept title contains the secret.
The dialog says that in the words a person reads, and the corpus holds a case in each direction —
the title kept and everything else gone, and the box off leaving no title at all, which is what
stops the first from passing for a removal that had quietly stopped running.
