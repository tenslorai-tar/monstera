# ADR-0170 — The lint runs one process per unit, under one heap budget, and reports each unit's peak memory

- **Status:** Accepted
- **Date:** 2026-10-05
- **Decided by:** the owner, 2026-10-05: *"lint each package in its own process, inside the one npm run lint verb, so
  memory is released between packages. Never spell eslint in CI or anywhere else outside that script. Don't raise the
  heap limit as the fix. Add a guard so this can't grow unseen again: CI should report lint's peak memory and fail when
  it passes a budget, with the budget written in one place."*
- **Amends:** nothing in `docs/ARCHITECTURE.md`. It changes what `npm run lint` is: `package.json`'s `lint` script
  stops being the list of ESLint command lines and names the runner, `scripts/lib/lintcheck.mjs`, which becomes the one
  place the invocations are made.

## Measured

`npm run lint` was `eslint .`: one process, type-aware rules over the whole tree through `projectService`, which holds
one TypeScript program per tsconfig, all at once, with `shared` and `contract` loaded into each.

- GitHub's `ubuntu-latest` runner aborted it at V8's heap limit twice in three runs on this branch: about 3.9 GB after
  129 s (run 37267422891, at `361684e2`) and after 163 s (run 37272963909, at `91450ef5`). The run between them passed on
  nearly the same tree.
- The owner's PC, 11.9 GB, whose V8 default heap is about 2 GB, has failed it since 2026-09-13. The answer then was a
  larger heap, so the growth went unwatched for three weeks.
- Read on 2026-10-05 at `91450ef5` on the cloud session machine (4 cores, 15 GB), each target linted alone, peak resident
  from `/proc/<pid>/status` `VmHWM` by a separate process:

| target | peak resident | time |
|---|---|---|
| `packages/ui` | 3,689 MB | 103 s |
| `packages/kernel` | 1,761 MB | 44 s |
| `apps/desktop` | 1,559 MB | 30 s |
| `packages/testing` | 1,128 MB | 19 s |
| `packages/contract` | 743 MB | 12 s |
| `scripts` | 673 MB | 9 s |
| `packages/shared`, `packages/nodemode`, the root's configs | 334, 303, 208 MB | 1 to 4 s |
| **the whole tree, one process** | **6,063 MB** | **235 s** |

What drives `packages/ui`, its largest share, read the same way: without its 224 test files 2,536 MB; with the three
`import-x` rules off (the resolver's `no-cycle` walk) 2,960 MB; with type-aware rules off 1,852 MB. Under a pinned heap,
the reading that decides: all of `ui` fails at 1,536 MB and passes at 2,048 MB (2,169 MB resident, 107 s); its source
and its tests apart each pass at 1,536 MB (1,635 MB resident in 75 s, and 1,610 MB in 52 s).

So the cost is the sum of every program held at once, and no one unit is near any machine's limit.

## Decision

1. **`npm run lint` is the runner**, `node scripts/lib/lintcheck.mjs`, and `check:lint` names the same command so the
   local sweep reaches it. No workflow, hook or script spells an ESLint command line; the runner is where they are made.
2. **One process per unit, one after another.** A unit is a package's SOURCE or a package's TESTS, for every directory
   under `packages/` and `apps/`, derived from the tree so a package added tomorrow is linted without an edit (the
   failure feared makes the set bigger, so the set is derived); then `scripts/`; then **the rest**, the whole tree less
   those, which is what makes the units' union `.` by construction. Memory is released when each process ends. Source
   and tests are two units for every package alike: the split is the measured one, applied as a rule rather than to
   the package that failed.
3. **Every unit runs under one heap budget**, `LINT_HEAP_BUDGET_MB` in `lintcheck.mjs`, 2,048 MB: the default heap of the
   smallest machine this repository is linted on. Below every machine's own default, so it raises nothing; and the same
   on every machine, so a lint that passes in CI passes on the owner's PC. A unit that needs more ends at V8's heap
   limit, and the runner says the unit went over the budget, by name, where a crash said nothing.
4. **Every unit's peak resident memory is reported**, as the child's own `process.resourceUsage().maxRSS`, which the
   operating system keeps and only raises, on every run, beside its time. The growth this ADR exists for is then a
   number in every CI log rather than a crash three weeks late.

## Rejected

- **A larger heap.** The owner's ruling, and the history is the reason: it was the answer on 2026-09-13 and it is how the
  growth went unseen.
- **Pointing the import resolver at each package's own tsconfig.** It saves `no-cycle`'s share in `ui` (about 730 MB),
  inside one process that would still hold every program.
- **Type-unaware rules for test files.** About 1.1 GB of `ui`'s share, and B7's `any` rules are type-aware: a test is
  where an `any` from a mocked boundary is most likely.
- **A budget on resident memory.** Resident memory moves with the machine's free memory and the collector's mood; the
  heap limit is what fails, so the budget is a heap limit and resident memory is what is reported.
- **Running the units in parallel.** It would sum their memory again, which is the defect.

## Consequences

- The whole lint takes about as long as before: the units' times summed to about 225 s against 235 s for one process.
- `ui`'s two units each need between 1.5 and 2 GB of heap today, the least headroom in the tree; the report shows it
  growing, and a unit over the budget is a red lint with its name in it, which is the decision the guard exists to
  force before a machine crashes on it.

## Correction, 2026-10-05: the sixteen units take longer than the packages did

The first consequence above was estimated from the packages linted alone, about 225 s summed. Built, the runner's
sixteen units read on the same machine at `dc5dd9e6`'s tree sum to about 273 s against 235 s for the one process, since
each package's TypeScript program is now built twice, once for its source and once for its tests. About 15% longer,
for a peak of 1,869 MB resident (`packages/ui`'s source) in place of 6,063 MB.
