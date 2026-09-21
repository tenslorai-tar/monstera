# ADR-0077 — Annotations are exchanged as their dictionary entries, in user space

- **Status:** Accepted
- **Date:** 2026-09-17
- **Amends:** nothing. §3's *Annotations (all types), appearance streams* row already names MuPDF
  as the writer; this records how a file's annotations reach it and how a document's leave it.
- **Relates:** [ADR-0046](0046-a-strict-xfdf-reader-rather-than-an-xml-parser.md) (the strict
  XFDF reader, which gains an `<annots>` walk),
  [ADR-0044](0044-an-image-reaches-the-engine-the-way-the-document-does.md) (a picked file's bytes
  travel the granted directory), [ADR-0037](0037-checkpoint-restore-and-the-replay-that-is-not-needed.md)
  (undo by checkpoint restore).
- **Context:** D8's *annotation import / export* (`BUILD-PROMPT.md`:490), in the three formats form
  data already exchanges: JSON, XFDF and FDF.

## The question

What is an annotation, as a file carries it? Two shapes already existed in this build and both
were measured wrong for the job.

## Measured, 2026-09-17 (probe, MuPDF 1.28.0)

1. **An authoring draft is not a record.** `annotationDraftSchema` describes a drag: a highlight
   draft is two points from which MuPDF finds the selected text, so a highlight read back into one
   has already lost the quadrilaterals it is drawn from.
2. **MuPDF's getters answer the displayed page frame.** A square whose `/Rect` is `[100 100 300 200]`
   reads back from `getRect` as `[101 593 299 691]` — flipped, and inset by the border. Exchanging
   those numbers would need the page transform in both directions and the border arithmetic.
3. **The dictionary entries are user space, which is what XFDF and FDF carry.** Entries written
   raw onto a new annotation render on an upright and a rotated page alike (1,783 pixels of ink
   each), and MuPDF's save writes the appearance stream from them — for a red square of width 7:
   `7 w`, `1 0 0 RG`, the box inset by half the width. `update()` draws it before the save;
   without it the save still did.
4. **MuPDF holds a real as a C `float`.** `0.2` written and read back is `0.20000000298023224`, so
   a number read from the engine is given at seven significant digits, a float's precision.

## Decision

1. **The record is a closed set of dictionary entries**: page, subtype, `/Rect`, `/C`, `/IC`,
   `/CA`, the border width, `/Contents`, `/T`, `/Subj`, `/M`, `/QuadPoints`, `/InkList`,
   `/Vertices`, `/L`, `/LE`, a note's `/Name` and a free-text `/DA` of one font, one size and one
   colour. **Never a copied dictionary**: an action, a JavaScript entry or an appearance stream from
   a stranger's file would be content this build runs or draws (invariant 24). One zod schema
   checks every record whichever format it came from, and requires the geometry each subtype is
   drawn from.
2. **Fourteen subtypes are exchanged** — every markup this build lists. A link, a file attachment,
   a sound or a widget is not a comment and is left out of an export and skipped in an import.
3. **Export reads in the engine host**, `engine/exportAnnotations`, and writes into the granted
   directory — `engine/exportFormData`'s route, because the walk is MuPDF's and the panel's
   annotation list is bounded and carries a kind and a box, not entries. An annotation a document
   holds whose optional entries the schema refuses loses those entries, not the annotation.
4. **Import is a command, `importAnnotations`**, applied in the host with the file's bytes as its
   asset. Every record is parsed and every page checked before the first annotation is created, so
   a file that cannot be imported whole adds nothing. A file carrying nothing exchanged refuses —
   the wrong file, most likely. Each annotation is created by MuPDF for its subtype, given its
   entries raw, marked as this build's, and updated. Undo is the checkpoint.
5. **The XFDF reader gains an `<annots>` walk** under ADR-0046's rules: `<!DOCTYPE` refused,
   depth bounded, and inside an annotation only `<contents>`, `<inklist>` and
   `<defaultappearance>` read; a `<popup>`, rich text or a base64 appearance is walked past. A
   geometry attribute past its bound is refused rather than cut to a number that still parses.
6. **The escapers both formats share move to `interchangeEncoding.ts`**, so XFDF and FDF are spelt
   by one module whether form data or annotations are being written.

## Rejected

- **Drafts as the record** — lossy for every text markup (measurement 1).
- **Getters and setters with the page transform** — two conversions and a border inset to get
  back to the numbers the dictionary already holds (measurement 2).
- **Copying dictionaries whole**, in FDF especially where it is the format's natural shape —
  invariant 24.
- **Importing the well-formed records of a partly malformed file** — a report nobody reads of the
  ones left out; `importFormData` refuses the same way.

## Consequences

- XFDF carries colour as `#RRGGBB`, so a CMYK colour is converted on the way out; JSON and FDF
  carry the components exactly.
- A free-text annotation's rich text and an image stamp's picture are not exchanged.
- The engine host gains a seventeenth MuPDF read; §3's host paragraph counts it.

## Correction, 2026-09-21 — the first files from another program

Decisions 1 and 5 were written against files this build and a second library wrote. PDF-XChange
Editor 10.7.5's exports (JOURNAL, 2026-09-21) showed three of their clauses narrower than the format:

- **Decision 1's `/DA` "of one font, one size and one colour"** was a pattern of MuPDF's own
  output. The format fixes no order and allows text-state operators; a colour-first `/DA` refused a
  whole file. The record now takes one `Tf`, at most one fill and one stroke colour and one of each
  text-state operator, in any order, written back canonically — every other operator still refused.
- **Decision 5's "rich text … is walked past"** dropped a note's whole text when, as PDF-XChange
  and Acrobat do, the file carries only `<contents-richtext>`. Its words are now read, with no
  markup interpreted; formatting is still not exchanged.
- **An absent `/C` is kept absent** for the subtypes whose `/C` is a stroke, where it had taken
  MuPDF's red.

Blend modes are not exchanged: MuPDF's annotation API has none, so an imported mark is Normal.
