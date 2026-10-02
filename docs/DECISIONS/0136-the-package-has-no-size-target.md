# ADR-0136 — The package has no size target; the packager reports its size and nothing else

- **Status:** Accepted
- **Date:** 2026-10-02
- **Supersedes:** `BUILD-PROMPT.md`:806-811, *"Target installer: **< 150 MB** — validated with arithmetic at the Stage 0
  packaging skeleton … and resized only via ADR."*
- **Decided by:** the owner, on 2026-10-01: the MSIX's size is accepted and growth is fine. Relayed as the owner's
  decision by the reviewing seat on 2026-10-02, with the instruction to withdraw the target where it is declared.
- **Relates:** [ADR-0123](0123-the-msix-is-assembled-here-and-packed-by-the-sdks-makeappx.md) (the packager, whose
  "Not decided here" carried the target), [ADR-0052](0052-a-second-recogniser-arrives-on-demand-and-reads-a-region.md)
  (which counted against it).

## Context

The founding record set the installer under 150 MB and said the figure moves only by ADR. Every package built has
been more than twice that, and the packager has said so on every build: 352.3 MB for 0.1.0.0 (2026-09-29) and
362,516,791 bytes for 0.1.8.0 (2026-10-02), each followed by *against the 150 MB target: OVER*. ADR-0123 named where
it goes — the Electron runtime's executable is 101 MB of it compressed and ONLYOFFICE's converter 79 MB — and left
what to remove, if anything, to the owner. The owner has answered: nothing; the size is accepted and may grow.

## Decision

1. **There is no package size target.** The clause above is superseded, not resized: no other figure replaces it.
2. **The packager reports the package's size and nothing else** — the bytes and the megabytes, with no comparison and
   no verdict. The size is still worth seeing on every build, so the line stays; a line that judged it against a
   number nobody holds would be the founding record's own *budget nobody computed*, pointing the other way.
3. **Earlier choices that cited the target are not reopened by this.** The fast OCR models (`tessdata.mjs`) and the
   glyphless-font graft (`ocrTextLayer.ts`) each named it among their reasons; each also stands on figures of its own,
   and whether either should now change is a separate question, not one this decision answers.

## Rejected

- **A new, larger figure.** It would be a number the owner did not set, and a check against it would fire, or stay
  quiet, for reasons nobody chose.
- **Silencing the verdict and keeping the constant.** A target that nothing reads is still a target a reader finds in
  the code and takes as live.
- **Removing the size line.** The size is the one fact about a package nobody can read off the code, and a build that
  stopped printing it would make growth invisible rather than accepted.
