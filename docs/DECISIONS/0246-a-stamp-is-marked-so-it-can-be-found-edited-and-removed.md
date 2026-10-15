# ADR-0246 — A stamp is marked, so it can be found, edited and removed

- **Status:** Accepted
- **Date:** 2026-10-15
- **Amends:** [ADR-0235](0235-stamps-are-drawn-by-the-mupdf-writer-in-the-text-boxes-faces.md) Decision 3 (what the
  appended stream holds) and its watermark's one colour.
- **Decided by:** the owner's cloud run 4 addendum, C4: *"Watermarks, headers/footers and Bates numbers can be edited
  and removed after they are added."* The marking convention, the Edit and Remove commands, the colour and the rule for
  older files are the owner's; the shapes below are this run's, on the owner's instruction to take the file's
  recommendation and record it.

## Where it stood

`PageStamps` (ADR-0235) draws each stamp as one content stream appended to the page, its own content bracketed first.
Nothing in that stream says what it is. So after Add, only Undo in the same session reaches it: it cannot be changed,
it cannot be removed once the file is saved, and a watermark is always grey. Headers and footers and Bates numbers are
drawn by the same class and are in the same position.

## Decision

1. **Two marks on every stream a stamp appends.** Its drawing is wrapped in the PDF world's own convention, a marked
   content artifact `/Artifact <</Type /Pagination /Subtype /S>> BDC … EMC`, where `S` is `/Watermark`, `/Header` or
   `/Footer` by the edge a header or footer item sits on, and `/Bates` for a Bates number (PDF 2.0's subtype). And the
   stream's dictionary carries Monstera's record, `/MonsteraMark << /Kind /Watermark|/HeaderFooter|/Bates /Settings
   (…) >>`, the settings of the command that drew it as JSON, its pages left out.
2. **One read, `document.pageMarks`,** answers for each kind: the pages its marks are on (a page set), the settings of
   the marks Monstera wrote (or none), how many pages carry another tool's marks of that kind, and how many carry a
   stamp an older Monstera wrote. It is a MuPDF read through the engine host, `document.fonts`' path.
3. **Edit is the add command with `replace: true`.** Before drawing, every removable stream of that kind is taken off
   every page; then the stamp is drawn on the pages named, which the dialog takes from the read. One command, so one
   undo, which stays a checkpoint (ADR-0235 Decision 4).
4. **Remove is one command, `removePageMarks`,** naming the kind. It takes every removable stream of that kind off every
   page and touches nothing else: the bracket around the page's own content stays, so the page draws exactly as it did
   before the stamp; the faces and graphics states the stamp added stay in the page's resources, unused, because a name
   is harmless and taking one out is a second edit with no reader to gain.
5. **Removable means a whole appended stream, and nothing less.** A stream is removable when it carries the record, or
   when its whole content is one artifact of that kind (another tool following the convention). A marked sequence inside
   a stream that holds anything else is counted and never cut out: removing page content that might not be a watermark is
   the one failure this must not have.
6. **A stamp an older Monstera wrote carries no record.** It is recognised by its fonts, which `PageStamps` always named
   `MonsteraStamp…`, and only counted: whether it is a watermark, a header or a Bates number cannot be told safely from
   its content, so Edit and Remove leave it and say so in words.
7. **A colour for the watermark and for headers and footers.** Each command gains `colour` (red, green and blue from 0
   to 1). Left out, a watermark is the grey it always was and a header or footer the black. Bates numbers keep black;
   the owner asked for the two.

## Rejected

- **A watermark annotation (`/Subtype /Watermark`).** Every reader shows and prints it differently, and an annotation
  is not page content; the owner's request is about the stamp the page already has.
- **Settings stored in the document catalogue.** A record away from the drawing it describes drifts from it the first
  time another tool moves a page; the stream that draws a stamp is the one place that cannot.
- **Cutting a marked sequence out of the page's own content.** It is what removing another tool's inline watermark
  would take, and it cannot be done without editing content the person did not ask to touch.
