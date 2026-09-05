import { ARTEFACT_EDGES } from './buildFreshness.mjs';

/**
 * Which sweep steps have to run before which, because one produces what
 * another reads.
 *
 * ## The sweep sorted by COST and had no idea anything depended on anything
 *
 * `checkLocal.mjs` orders its roster into three cost buckets and then by
 * measured seconds, which is right for what it was for — a run that dies early
 * should die on the cheap steps. It carries no dependency concept at all, so a
 * proof whose subject is an artefact could sort a hundred steps ahead of the
 * step that builds it.
 *
 * Measured, from the run log `2026-09-05T08-20-43-14700-failed.json`:
 *
 * | step | position |
 * |---|---|
 * | `proof:rendererpolicy` | 16 |
 * | `proof:canvaspixels` | 28 |
 * | `typecheck` | 109 |
 * | `build` | 117 |
 *
 * Both of those proofs read `apps/desktop/dist/`, and both ran about ninety
 * steps before the build that writes it. What saves the run today is
 * `refuseStaleBuild`, which makes each of them REFUSE rather than measure a
 * stale artefact — so the failure is loud. That is a guard doing its job, and
 * it is not an ordering: the sweep still spends the run reporting a refusal it
 * could have avoided, and a proof added without that guard would quietly
 * measure last week's bytes.
 *
 * ## The edges are DERIVED, not listed here
 *
 * `ARTEFACT_EDGES` already says which proofs read a source through a build,
 * because a proof declares that pair exactly when its output depends on it —
 * `buildFreshness.mjs` argues that at length, and a second list here would be
 * the third opinion about the same fact (B3a).
 *
 * ## The producer is `build`, and that is one claim rather than a mapping
 *
 * Every edge names its producer as `tsc` or `bundler`, and the manifest's
 * `build` is `npm run typecheck && npm run build:preload && npm run
 * build:renderer` — so it is the one roster step that runs all three. A
 * kind-to-script map would have both kinds pointing at it, which is a table
 * whose two rows are the same answer, and it would be a second opinion about
 * what `build` composes.
 *
 * `typecheck` is deliberately NOT named as a producer even though it emits the
 * `tsc` side: `build` runs it first, so requiring both would order the sweep
 * against a step whose work the other repeats.
 */

/** The manifest step that produces every artefact `ARTEFACT_EDGES` names. */
export const PRODUCING_STEP = 'build';

/**
 * The steps `step` must run after, of those actually selected.
 *
 * Empty for everything that reads no artefact, which is nearly all of them.
 *
 * @param {string} step a roster entry
 * @param {ReadonlySet<string>} selected which steps this run will execute
 * @returns {readonly string[]}
 */
export function stepsBefore(step, selected) {
  if (ARTEFACT_EDGES[step] === undefined) return [];
  if (step === PRODUCING_STEP || !selected.has(PRODUCING_STEP)) return [];
  return [PRODUCING_STEP];
}

/**
 * Reorders `steps` so that nothing runs before what produces what it reads,
 * changing as little else as possible.
 *
 * **Stable**, which is the whole of what makes this safe to bolt onto a cost
 * sort: a step with no dependency keeps its place relative to every other such
 * step, so the cheap-first property survives everywhere the constraint does not
 * bite. A general topological sort would be free to rearrange the rest.
 *
 * A cycle cannot arise from the one edge this declares, and if the edge set
 * ever grows into one, the leftovers are appended in their original order
 * rather than dropped — a step missing from the sweep is a check that silently
 * did not run, which is worse than one that ran too early.
 *
 * @param {readonly string[]} steps in the order the cost sort produced
 * @returns {readonly string[]}
 */
export function orderSteps(steps) {
  const selected = new Set(steps);
  /** @type {string[]} */
  const ordered = [];
  const placed = new Set();
  const remaining = [...steps];

  while (remaining.length > 0) {
    const ready = remaining.findIndex((step) =>
      stepsBefore(step, selected).every((needed) => placed.has(needed)),
    );
    // NOTHING READY MEANS A CYCLE. Append what is left in its own order rather
    // than dropping it: a step missing from the run is a check that silently
    // did not happen.
    if (ready === -1) return [...ordered, ...remaining];
    const [step] = remaining.splice(ready, 1);
    if (step === undefined) break;
    ordered.push(step);
    placed.add(step);
  }
  return ordered;
}
