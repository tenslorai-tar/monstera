# ADR-0011 — When the native engine is upgraded, and when it is not

- **Status:** Accepted
- **Date:** 2026-08-17
- **Amends:** nothing. Establishes a policy that did not exist.
- **Context:** [ADR-0010](0010-native-mupdf-through-an-ffi-shim.md) pins MuPDF at
  1.28.0. This ADR governs when that pin moves.

## Decision

**Stay on MuPDF 1.28.0 now.** Take the current patch release at each **stage
boundary**, where the engine is revalidated anyway. **Never upgrade mid-stage
without a security reason established from upstream commit history.**

## Why not upgrade now

The upgrade was proposed to fix CVE-2026-7233 (out-of-bounds read reached from
`fz_subset_cff_for_gids`). Investigating from upstream history rather than the
CVE's version string showed the premise was false:

- The bounds-check fixes the CVE concerns — Bugs 709364 and 709365, and the
  `pdf-image.c` checked-arithmetic fix for CVE-2026-3308 — landed on 2026-05-13
  and 2026-06-01, **before 1.28.0 shipped on 2026-06-26**. They are present in
  the source we build: `subset-cff.c:299` and `:315`, and `pdf-image.c:197`.
  Verified further by executing the disclosed trigger against the built engine —
  see `scripts/security/cffOobProof.mjs`.
- `subset-cff.c` is **byte-identical** between 1.28.0 and 1.28.2 (diffed
  locally). The only new CFF fix, Bug 709567 ("potential memory overwrite in
  CFF2 subsetting", 2026-08-07), is in **no released version** — it postdates
  1.28.2 by four days and exists only on master.

So there is no security reason to move, and 1.28.2 changes nothing in the
attack-surface file that matters here. What it does change is ~5 weeks of general
fixes plus one save-path object-lifetime fix in `pdf-subset.c`. Worth taking, but
not worth a mid-stage revalidation.

## Why a cadence rather than "latest always" or "pin forever"

- **"Latest always"** reopens every measurement on someone else's release
  schedule. ADR-0010's numbers, the PE hardening verdict, and the advisory
  triage are all version-specific; chasing every patch means re-running them
  continuously.
- **"Pin forever"** ships a parser that ages out of support while the world
  keeps finding bugs in it.
- **Stage boundaries** are where revalidation already happens: the trajectory
  gate re-measures, the proofs re-run. Folding the engine bump into that moment
  makes the upgrade nearly free, because the work it triggers is work already
  scheduled.

## The security exception, and how it is judged

A mid-stage upgrade is permitted, and required, when an advisory is shown to
affect the pinned version **by upstream commit history** — the actual fixing
commit, and whether it is in the pinned source tree — not by a CVE's version
range or a distribution's package mapping. A CVE's "up to X" is the upper bound
known at report time, not a statement that release X is affected; CVE-2026-7233
is precisely that case.

## Re-triage cost is smaller than it looks

The objection to a cadence is that every bump invalidates 57 advisory verdicts.
It does not, because the verdicts are **monotonic moving forward**: a fix present
in version N is present in every N+k, so a NOT-AFFECTED verdict established
against 1.28.0 cannot become AFFECTED in 1.28.2. Only two classes need
rechecking on an upgrade:

- entries currently **AFFECTED or UNRESOLVED**, which an upgrade might close;
- advisories **published since** the last triage.

`scripts/security/engineAdvisories.mjs` records a version with each baseline and
fails when the pinned version moves, so the re-triage is prompted rather than
forgotten — but its scope is those two small sets, not all 57.

## Rejected alternatives

- **Vendor a private patch of Bug 709567 onto 1.28.0.** Rejected: carrying a
  local patch to a statically linked upstream library is a maintenance burden and
  a divergence from a reproducible pinned source. The bug is CFF2 subsetting,
  which this application does not yet perform (font subsetting is opt-in and no
  feature calls it), so the exposure is nil until a subsetting feature exists.
  Tracked in the advisory register instead.

## Consequences

- The advisory register (`docs/security/engine-advisories.json`) now also tracks
  upstream **commits and bug reports** that no release contains, because for this
  upstream a memory-safety fix with no CVE and no release is the normal case, not
  the exception. Bug 709567 is its first such entry.
- Stage exit checklists gain one line: "take the current MuPDF patch release, or
  record why not."
