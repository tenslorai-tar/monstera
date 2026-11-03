# ADR-0285 — An MSIX is packed only from a build a full walk passed, and the pack checks the bytes

- **Status:** Accepted
- **Date:** 2026-11-02
- **Decided by:** the owner, 2026-11-02, for this build and every build after it: *"This app is now in the store, I
  cannot afford to release broken tools that were already working, so anytime the agent is running to build an msix, a
  FULL APP WALK must be done to ensure everything still works."* And: the pack refuses to run unless a walk record
  exists for the exact sha being packed, naming the command count and every row's result; a record cannot be written by
  hand to pass.
- **Amends:** `scripts/release/packageMsix.mjs` (ADR-0123), which gains one refusal before it stages anything.

## The problem, in one sentence

Nothing between a commit and a Store package asked whether the tools still work in the running app: CI runs the cases,
and every rule about walking first was a rule somebody had to remember at the moment of packing.

## What was measured

- **The build is reproducible, so the walked build and the packed build can be compared by their bytes.** The pack
  builds again from clean before it stages (`packageMsix.mjs`: `npm run clean --workspaces`, then `npm run build`), so
  it never ships the very `dist/` a walk ran on. Two clean builds of one commit on 2026-11-03, compared file by file
  with `walkRecord.mjs --list`: **0 of 8,267 files differ.** A third reading, of a build made before an edit to
  `dialogSamples.ts` and hashed after it, differed, which is the binding doing its job: that build was not the commit's.
- **The command rows can be derived.** `docs/manual-test-checklist.md` is generated from the command registry and held
  equal to it by `App.test.tsx`; it names every command by its id, 282 at the merges of 2026-11-02.

## Decisions

1. **A walk record is written by the walk, never by a person.** `scripts/release/walkRecord.mjs` is the only writer
   (B3). It runs only on a clean tree at `HEAD`, after `refuseStaleBuild` has said the built app is this tree's, and it
   takes each row's result from the walk reports `liveWalk.mjs` wrote during the walk, never from its arguments.
2. **A report says which build it walked.** `startWalk` records, in every `report.json`, the commit it ran at, whether
   the tree was clean, and the SHA-256 of the built app's files that ship: `apps/desktop/dist/` and every workspace
   package's `dist/` that the stage copies. A walk run from a dirty tree, or from an app root other than this checkout,
   produces reports the record refuses.
3. **The record is bound to the bytes, and the pack checks the bytes.** The record holds the commit, the build digest
   its reports agree on, and each row. Before staging, `packageMsix.mjs` refuses unless a record exists for the commit
   it packs, every row is passed or *not walked* with a stated reason, and the digest of the build it is about to stage
   equals the record's. So what is packed is what was walked: a record copied to another commit fails on the commit,
   and one copied onto a rebuilt or changed tree fails on the digest.
4. **The rows are the registry's, derived, never listed by hand.** There is one row per command id in
   `docs/manual-test-checklist.md`, which the command registry generates, and the record carries the count. A walk step
   says which commands it walked (`covers`), and one that could not walk a command says so and why (`notWalked`); a row
   passes when every step that covers it passed, fails when any failed, and is *not walked* only with a step's stated
   reason. A row nothing reached is refused. A list kept here would agree with any omission (CLAUDE.md, item 4c: the
   failure feared makes the set SMALLER, so the count comes from the registry). Dialogs and settings are walked through
   the commands that open them, and the walk prints their registries' counts beside it.
5. **Where the record lives:** `.cache/walk-records/<commit>.json`, untracked, on the machine that walked and packs.
6. **A row a fix can reach is walked again.** A commit after the walk changes the commit and the digest, so the record
   no longer matches and the pack refuses; the walk's affected rows are walked on the new commit and a new record is
   written.

## What a hand-written record would need, and why that is enough

Nothing on one machine is unforgeable by someone who can write any file and run any command. What the binding does is
make the wrong path the hard one rather than the easy one: a record that passes must name this commit, carry the digest
of the exact build being packed, which only exists once that build does, and point at walk reports whose own digests
it carries. Writing one by hand means reproducing all of that deliberately; doing so by accident, or by habit, cannot
happen. The decision's control cases are the refusals: no record, a failed row, an unknown commit, and a digest that
differs.

## Rejected

- **A signed record** (an HMAC or a signature over the record): the key would live on the same machine as the writer,
  so it adds a step without adding a party, and a key in the repository is a secret in a public repository (B10).
- **The record in git:** committing it changes the commit it describes.
- **Counting walk steps instead of registry rows:** a walk's steps are whatever the walk's author wrote; a command no
  step reaches would be absent from the count and the record would agree with it.
