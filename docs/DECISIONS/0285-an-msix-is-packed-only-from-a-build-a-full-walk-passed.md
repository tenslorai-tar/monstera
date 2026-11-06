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

## Correction, 2026-11-03: a row's evidence is the BUILD it was walked on, not the commit

**Decision 6 and the code disagreed** (the reviewer, 2026-11-03). Decision 6 says the rows a fix can reach are walked
again; `reportsOf` took only reports of the commit being recorded, so every commit threw every earlier pass away,
including a commit that changes only a walk program or a document and leaves every built file as it was. The full walk
then has to run again for a change that cannot have reached any row.

The bytes were always the binding (Decision 3); the commit was standing in for them. So:

1. **A report counts when its build is the build being recorded**: clean, and its digest equal to this checkout's, at
   whatever commit it was walked. A commit that changes no built file keeps every row. Each row names the commit and the
   digest it was walked on, and the pack refuses a row walked on any digest but the one it stages.
2. **A row takes the NEWEST report that walked it.** Every report counted toward every row before, which was harmless
   while one commit's reports were one run; across commits an older run's failure would outweigh a newer pass, and a
   later run of a few steps would replace a full run's rows.
3. **A report counts only while its walk's program is unchanged.** Each report carries the SHA-256 of its walk's
   program: its script and every script it takes by a relative import, read through those imports. A change to any of
   them changes the program's digest, and that walk's rows are walked again.

**What is not done, and why.** Decision 6's *the rows a fix can reach*, for a commit that changes the build, is not
derived: a command's behaviour is its `run`, which closes over the whole composition, and nothing here can say which
commands a change to the built app reaches. A list of reached rows written by a person agrees with any omission
(`CLAUDE.md` item 4c: the failure feared makes the set smaller). So a commit that changes the digest walks every row,
which is the owner's rule as first written. Equally, a change to one step of a walk program walks that walk's every row,
since the shared part and one step's part are one file.

Controls (`proof:walkrecord`): a row walked on another digest is refused; a row walked at an earlier commit on the same
digest is accepted; a row whose walk program has changed is refused; a newer pass outweighs an older failure of the same
row, and a newer failure an older pass.

## Correction, 2026-11-04: a change to one step of a walk re-walks that step, derived from the program

**The last sentence above is withdrawn** (the reviewer, 2026-11-04). Every fix to `everyToolWalk.mjs` re-walked all 285
rows, about 1½ hours, including fixes that sit inside one step's own entry and cannot alter how any other row is read:
`a66aae9e`'s search word for Mark matches, or the panel shown before Pages. Which rows a walk change reaches is now
**derived from the program, never written by a person**, since a label someone writes agrees with any mistake.

1. **A walk's per-step code is what it declares per step, and everything else is shared.** A table of per-command
   entries is declared through `stepTable(name, { '<command id>': entry, … })` (`scripts/research/walkSteps.mjs`). The
   record parses the walk program (its script and every script it takes by a relative import, as before) and takes
   each such entry, with its own comment, as the code of the step whose command it names. Everything outside those
   entries is **shared**: the known start, closing tabs, answering questions and pickers, reading toasts, settling, the
   fingerprint, every helper an entry calls, an entry added by a spread or a computed key, and any table not declared
   this way. **So a helper used by two steps is shared**, and nothing is ever neither.
2. **What makes the split sound and not claimed: a step table answers only its own row.** `stepTable` returns a guard
   that, while a row is walked, answers a read of that row's command id and throws on any other: another command's
   entry, a listing of the table's keys, a read outside any row. An entry therefore cannot change how another row is
   walked, and every full walk proves it, because a table read across rows fails the walk the moment it happens rather
   than passing on an entry the record attributed to someone else.
3. **A report carries the digests of the program it walked**: the shared code's, and each step's (its entries across
   every table, an absent entry being a value of its own). `liveWalk.mjs` reads them as the walk starts, by the same
   function the record uses.
4. **A row keeps an earlier pass only when the app's build digest, the shared digest and its own step's digest are all
   unchanged.** Any change to the shared code, or to the built app, walks every row again, as before. A row covered by a
   step that covers several commands keeps it only while every one of their digests is unchanged.

Controls (`proof:walkrecord`): a step whose own entry changed is refused until it is walked again; a step whose entries
did not change keeps its pass when another step's did; a change to the shared code refuses every kept row; a change to a
helper two entries call refuses both, as shared code; and a step table read for another row's command throws.

## Correction, 2026-11-06: the correction above is not built, and a narrower walk cannot clear a full walk's failure

**The correction of 2026-11-04 states as present what is only owed (the stage audit's EEEEEEEEE-1).** Only the guard exists
(`walkSteps.mjs`, whose header says so): no walk declares a `stepTable`, the record does not parse one, reports carry no
per-step digest, and of the controls it lists only the last exists. What decides today is the second of this record's
rules: a report counts while the build's digest and the whole walk program's digest are unchanged. Reading it as built
would be reading a rule that protects nothing.

**A row used to take the newest report across every walk, so a narrower walk's pass replaced a full walk's failure** on the
same build (the stage audit's EEEEEEEEE-3), and `newFeaturesWalk`'s rows cover `text.edit`, `document.sanitize` and the fits.
That narrowed the owner's *a full walk of every tool* without anyone deciding it.

**The owner's ruling, 2026-11-06:** a full walk's failure stands until that same step passes again in the full walk on that
build. A narrower walk's pass cannot replace it. It does not mean walking every row again after every failure: the full
walk's `--only` runs what a fix reaches, and a report from it is the full walk's, by its program.

So `rowsFrom` asks one thing more. **The full walk is `every-tool`, by the name its program gives its reports.** Where the
newest report covering a row failed it, the row is failed, as before. Where it passed, the row is failed all the same if the
newest `every-tool` report covering that row failed it, and the row names that report. A newer `every-tool` pass clears it,
and a failure on another build is no report of this one. Reasons a narrower walk gives for not walking a row cannot clear
it either. Refusal and control: `proof:walkrecord`.
