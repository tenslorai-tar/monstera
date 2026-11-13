# ADR-0295 — The certification line projects the commands placed on it

- **Status:** Accepted
- **Date:** 2026-11-14
- **Decided by:** the repository's own rule, applied as its precedents applied it (§7, B4; the owner's standing
  instruction of 2026-11-13 to decide what the repo answers and record it). No new decision of the owner's.
- **Amends:** `docs/ARCHITECTURE.md` §7 (`Placement` gains `certification-line`, and the list of surfaces derived from
  placements names it).
- **Relates:** [ADR-0291](0291-a-certified-document-is-locked-to-what-its-certifier-allowed-and-worked-on-as-a-copy.md)
  (the line itself, its amendment of 2026-11-12), [ADR-0102](0102-a-selection-survives-a-command-that-keeps-the-walk.md)
  (the Properties tab's foot, the same gap closed the same way), [ADR-0095](0095-the-title-bar-projects-the-applications-own-commands.md)
  and [ADR-0098](0098-a-ribbon-placement-may-be-secondary-and-the-rail-has-a-foot.md).

## The gap

ADR-0291's amendment put a line at the top of a certified document, and of its copy, with *Check signatures* on it.
The line was built in `CertificationLine.tsx` and `App` hands it the command by **looking up one id**,
`registry.get(CHECK_SIGNATURES_COMMAND_ID)`. That is a surface naming the commands it draws, which §7 calls the second
wiring place: *"A hand-maintained layout file for any of them is the second wiring place this registry exists to
forbid."* Found by the stage audit of `75a59036..658e14df` (HHHHHHHHH-21), as a surface CLAUDE.md's projection list did
not name. The list was right not to name it; the surface was not a projection.

ADR-0102 met the same shape for *Reply* and *Delete* at the Properties tab's foot, and rejected *footer buttons named
by id*. This is that rejection, applied to the line.

## Decision

1. **`certification-line` is a placement surface**, `{ surface: 'certification-line'; order: number }`. A command placed
   there is drawn on the line, in `order`, while its `when` holds, as the rail's foot and the Properties foot are drawn.
2. **`certificationLineModel(registry, context)`** projects it, beside `railModel` and `propertiesModel`. `App` draws
   what it answers and names no command.
3. **`document.check-signatures` carries the placement.** It is still placed in Protect › Signatures; the line is a
   second place for the same command, as Highlight has three.

## Rejected

- **Naming the line in the projection list as it was.** A list that called it derived while it looked up an id would
  be the digest stating a mechanism that does not exist, the shape CLAUDE.md records twice.
- **Recording it as the line's own control**, as the open text editor's context menu is (ADR-0180's correction). That
  exception holds because its first section is not commands. Everything the line offers is a command.
- **A `checked`-style flag on the command** saying it belongs on the line: a fact about one surface written on the
  command, which `placements` already says.
