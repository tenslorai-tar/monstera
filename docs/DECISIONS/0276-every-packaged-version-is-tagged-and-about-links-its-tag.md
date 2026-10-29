# ADR-0276 — Every packaged version is tagged, and About links that tag

- **Status:** Accepted
- **Date:** 2026-10-29
- **Decided by:** the owner, 2026-10-29, before the Store launch of 1.1.2610.0: the exact source of a released version
  (the AGPL's corresponding source) is a tag; *make it a mechanism, not a one-off*: every packaged version gets its tag
  as part of the pack step, and About's *Source code* and licence links point at the running version's tag rather than
  at `main`.
- **Amends:** [ADR-0123](0123-the-msix-is-assembled-here-and-packed-by-the-sdks-makeappx.md) (the pack step gains a
  tag), and `apps/desktop/src/webPages.ts`' *source* and *licences* addresses, whose comment gave this to the packaging
  row.

## Context

About's *Source code* opened the repository and its licence link opened `main`'s `NOTICE`. Neither is the source of
the build a person is running: `main` moves on the day after a release, and by the next week the link shows code that
build never contained. The AGPL's offer is of the *corresponding* source.

`docs/packaged-versions.json` already records the commit every package was packed from, so the exact source exists.
Nothing named it: no tag was ever made, and `webPages.ts` said so — *no commit or tag is baked into a build yet*.

## Decision 1 — one rule names a version's tag

`releaseTag(version)` in `packages/contract` is the only spelling: a package version, four numeric parts with the
fourth 0 (the form `refuseVersion` admits and the Store requires), is tagged `v` + that version, so 1.1.2610.0 is
`v1.1.2610.0`. Any other version, a development build's, has no tag and the function answers `null`. The pack step and
About both call it (B3a), so the tag the pack writes and the tag About opens cannot be spelt two ways.

## Decision 2 — the pack step tags the commit it packed, and refuses a version whose tag means another commit

Before building, the pack refuses when the version's tag already exists at a commit other than `HEAD`: both flavours of
one version share a tag, so packing the second flavour from a different commit would leave one name for two sources.
After the package's identity is read back and the version recorded, the pack makes the annotated tag at the packed
commit if it does not exist, and pushes it to `origin`. A push that fails fails the pack, naming the command that
finishes it: a built package whose source is not published is the gap this decision closes.

## Decision 3 — About opens the running version's tag

`source` is `https://github.com/tenslorai-tar/monstera/tree/<tag>` and `licences` is `…/blob/<tag>/NOTICE`, from
`app.getVersion()`, which in a package is the packed version (`packageMsix.mjs` writes it). A development build has no
tag and opens the repository and `main`'s `NOTICE`, as before. Versions packed before this decision carry the old
links; only 1.1.2610.0 among them was released, and its tag is made by hand once, at the commit
`docs/packaged-versions.json` records for it.

## Decision 4 — a GitHub release is made by hand, for a Store release only

Every pack is tagged, test flavour included, since a test build is a build someone runs. A **release** on GitHub is
made by hand when a version is published in the Store: short plain notes, the Store link, and no attachment, because
the repository never carries a binary (B8) and the Store is the only channel (ADR-0018).

## Rejected

- **Tagging by hand at each release.** That is what was owed and never done; 1.1.2610.0 passed certification with no
  tag. A step a person must remember is the habit this project replaces with mechanisms.
- **Tagging in CI when `docs/packaged-versions.json` changes.** Both workflows are `contents: read` and use no secrets;
  giving one write access for this would widen every run of it, including a pull request's.
- **A commit sha in About instead of a tag.** It needs nothing pushed beyond the commit, but a commit on a work branch
  that is later deleted is no longer guaranteed to be served, and a tag keeps it reachable. A tag is also what a reader
  recognises as a release.
- **Baking the commit into the build.** The version is already baked and already maps to one commit through the
  record; a second baked value is a second opinion about the same fact.
