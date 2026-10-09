# ADR-0223 — Comment imports place every valid record and report every shortfall

- **Status:** Accepted, specified before implementation.
- **Date:** 2026-10-09
- **Supersedes:** ADR-0077 Decision 4's whole-file refusal and its rejected
  alternative of importing well-formed records from a partly malformed file.
- **Amends:** no architecture seam. The planner registers a query in the
  existing validated host contract; the mutation remains `importAnnotations`.
- **Context:** the owner's Codex run 1 requires comments that can be placed to
  survive an invalid comment or a page absent from the destination document.

## Decision

One planner reads the three interchange formats and validates each record with
the existing annotation schema. It separates valid records from skipped ones,
preserving the file's record numbers. It then checks destination pages. Both
the query that reports what the import will do and the command that performs
it call this planner; neither re-derives validation or page membership.

The planner executes in the MuPDF host, where FDF is parsed. A new
`engine/annotation-import-plan` query takes the file through the existing
session asset route. Main sends no document bytes to the renderer. Its report
names the number imported, each skipped record's number and page where known,
and its specific reason: missing page, unsupported kind, or invalid entry.
The invalid entry is named from a closed vocabulary, never a native diagnostic.
The bounded report names up to 100 skips and counts the remainder explicitly,
as the existing form-import report does.

An unreadable container is distinguished from a readable file holding no
comments. A readable file whose comments were all skipped still answers its
report and does not record an empty mutation. A partly usable file imports its
valid comments in one undoable command. Strict XML security and the closed
annotation dictionary remain unchanged.

## Rejected alternatives

- Refuse the file over one comment: loses every usable comment and contradicts
  the owner's instruction.
- Skip silently: makes success conceal missing comments.
- Parse or validate again in main or the UI: creates a second format reader
  and puts hostile FDF parsing outside containment.
- Copy arbitrary annotation dictionaries: admits actions and appearances the
  interchange intentionally excludes under invariant 24.

## Consequences

The renderer receives a structured report, with its words supplied by i18n.
The planner adds one query, following the form-data planner's asset lifetime.
The apply still validates through the same planner, so another caller cannot
bypass the rule. Syntax corruption that prevents reading the container remains
a file-level refusal; a malformed record never refuses its valid siblings.
