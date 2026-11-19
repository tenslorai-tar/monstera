# ADR-0298 — A smaller copy may be asked for by size: the lightest step that fits, never refused

- **Status:** Accepted
- **Date:** 2026-11-19
- **Decided by:** the owner, 2026-11-15 (the pending list's item 20, from a user's message: *"in compression it
  compresses automatically but I need custom size compression"*), with the design written there.
- **Builds on:** [ADR-0087](0087-optimize-is-mupdfs-native-image-rewriter-in-the-compose-host.md): the rewrite, where it
  runs, and its rule that a copy which is not smaller is never saved, all unchanged.
- **Not an amendment:** the command, its dialog, its two channels and the compose host's `engine/optimize` stay; the
  channels take one more kind of choice and answer which step they measured.

## Context

*Save a smaller copy…* offers High, Medium and Low, three fixed settings of MuPDF's image rewriter (ADR-0087's table:
JPEG quality 85, 70, 50; pictures above 300, 225, 150 dpi brought to 200, 150, 100). A person who must send a file under
a limit — a form that takes 2 MB, a mailbox that takes 10 — has to guess which setting gets there and try each.

## Decision 1 — a fourth choice, "A size I choose", with a box for the size in KB or MB

The same window, the same Check the size and Save buttons. The size is what the person types, in kilobytes or
megabytes, read as 1024 and 1024² bytes, the units the window already shows sizes in.

## Decision 2 — main tries a LADDER from lightest to strongest and keeps the first step that fits

`OPTIMIZE_LADDER` in `packages/contract/src/schemas.ts` holds five steps: High, a step halfway to Medium, Medium, a
step halfway to Low, and Low. Each named setting IS a step of it, so the three choices and the fourth are one table, not
two. Main rewrites at each step in order, reads the copy's size, discards it, and stops at the first that fits: the
lightest that fits keeps pictures as sharp as the size allows. The search is a pure function (`stepThatFits`, in the
kernel), so it is proven without an engine.

Linear rather than halving: a halving search needs the size to fall with every step, which a rewriter that keeps a new
stream only when smaller makes nearly true and not true by rule, and five steps cost at most five rewrites (ADR-0087:
at most 2.5 s each on the corpus). The status bar's task says it is working, as it does for one setting today.

## Decision 3 — never refused: where nothing fits, the smallest copy is offered and the window says so

Low is the floor, today's lowest setting, so pictures never become unreadable. Where even it is over the size, the
window shows the smallest the file can go and that pictures are at their lowest, and offers to save it anyway. Where
that copy is not smaller than the document, ADR-0087's rule answers as it does now: nothing is saved.

## Decision 4 — the measurement names its step, and the save writes exactly that step

`document.optimizeMeasure` answers the step it found with the sizes; `document.optimize` takes a step, never a size, so
the copy written is the copy measured, not a second search that could land elsewhere. The version check stays.

## Decision 5 — the last size typed is remembered

A remembered setting (`saving.smaller-copy-size`, in bytes), never a row in Settings: state kept for the person, as a panel's width is.

## Rejected

- **Turning image quality into a continuous search** (a quality and a DPI per try): many more rewrites for a size
  difference the five steps already bracket, and settings no named choice can be compared with.
- **Font subsetting below the floor:** the shim withholds it for the unfixed memory-safety advisory (the register), so a
  text-heavy file often meets the floor. That is the stated limit, not a defect.
- **Refusing a size the file cannot reach:** the owner's principle, a person is never refused because of their document.
