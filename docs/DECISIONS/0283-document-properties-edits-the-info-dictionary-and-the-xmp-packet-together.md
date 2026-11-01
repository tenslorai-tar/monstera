# ADR-0283 — Document properties edits the Info dictionary and the XMP packet together

- **Status:** Proposed 2026-11-01, and built on that design: the owner asked for the feature, and it needs no
  architecture change beyond registering into existing seams.
- **Date:** 2026-11-01
- **Requested by:** a user, relayed by the owner: *view and edit a file's properties.*
- **Relates:** ARCHITECTURE §3's writer-of-record matrix (metadata is MuPDF's), §4's save modes (a metadata scrub is a
  removal), [ADR-0045](0045-a-removals-garbage-collection-belongs-to-the-command.md).

## The problem, in one sentence

Monstera shows nothing of a document's own information (title, author, dates, producer), cannot change it, and its
Properties tab is about a selected annotation, field or link; Sanitize does not touch document information either.

## Two copies of the same facts

A PDF can state its title, author, subject, keywords and dates in two places: the trailer's **Info dictionary**
(ISO 32000-1 §14.3.3) and the catalogue's **XMP metadata stream** (§14.3.2), where they are `dc:title`, `dc:creator`,
`dc:description`, `pdf:Keywords`, `xmp:CreateDate` and `xmp:ModifyDate`. Readers differ in which they show, so writing
one and leaving the other is how a document comes to show its old title in someone else's reader. MuPDF's
`setMetaData` writes the Info dictionary only.

## Decisions

1. **One window, registered:** `document.properties`, *Document properties…*, on the File menu (the menu bar's File
   group), through the one `<Dialog>`. Every string an i18n key.
2. **Editable:** Title, Author, Subject, Keywords, and the PDF's own Created and Modified dates. **Read only:** the
   creating program and the producer, the PDF version, the page count and the first page's size, the file's size, the
   fonts (the existing `document.fonts` read, B3a), and the security (whether it needs a password and how it is
   encrypted, MuPDF's own report).
3. **The dates are the PDF's own and the window says so**: *These are the dates written inside the PDF. The file's
   dates in Windows are not changed.* Windows' file dates are never touched; nothing here names a path.
4. **One command, `setDocumentInformation`, MuPDF's (§3)**, carrying all six values; an empty text or an absent date
   removes that entry. It writes, in one apply:
   - **the Info dictionary**, always, made where the document has none, each value as a PDF text string and each date
     as a PDF date (`D:YYYYMMDDHHmmSS+HH'mm'`);
   - **the XMP packet where the document has one**: the six properties are removed wherever they stand, as elements or
     as attributes, under whatever prefixes the packet binds to their namespaces, and set again in one
     `rdf:Description` of their own inside the packet's `rdf:RDF`; every other property is kept byte for byte.
   - **Where only XMP exists**, both are written, so the Info dictionary is made and agrees. **Where only Info exists,
     no packet is made**: there is then no second copy to show a stale value, and a packet made from nothing would be
     the one thing in the file nobody put there. **Where neither exists**, the Info dictionary is made.
   - A packet with no `rdf:RDF` to write into is not XMP a reader can use; it is replaced by a minimal packet holding
     the six values, which is said in the code and the case.
5. **Undo is a checkpoint**, Sanitize's route: the prior state is an XMP packet of the document's size, and a log
   entry carrying it would be unbounded. One undo restores both copies. It survives save and reopen as any MuPDF write.
6. **What is shown** where both exist and disagree is the XMP value, then the Info value: XMP is what ISO 32000-2
   keeps, and after one edit through this window the two agree.
7. **Sanitize gains *Remove document information*** (`document-information`), a fifth part beside the four, ticked or
   not as they are: it deletes the Info dictionary and the catalogue's metadata stream, in Sanitize's removal save,
   so neither is recoverable from an earlier revision.

## Proof

Each editable field written, saved, reopened and read back by **pdf-lib** for the Info dictionary and by an
independent XML parser for the packet, the two agreeing; undo restores the old values. Controls: a document with XMP
only, one with Info only, one with neither, and a packet carrying a property this command does not own, which must be
kept.

## Rejected

- **Writing the Info dictionary alone**, MuPDF's `setMetaData`: the XMP copy then shows the old value elsewhere.
- **Always making a packet**: adds a structure nobody put there to a document that had none, and changes nothing a
  reader shows.
- **A whole XML parser in the kernel**: the edit touches six properties; a parse and re-serialise would rewrite every
  other property's bytes, which *preserve, never drop* rules out.
- **An invertible capture of the packet**: unbounded in the log, for the cost a checkpoint already pays.
