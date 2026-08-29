// @ts-check
/**
 * Whether an artefact a proof is about to read was built from the source it
 * claims to be about.
 *
 * ## Why this is a module and not a function in the proof that needed it first
 *
 * A proof that spawns Electron and reads the shipped bundle has no way to tell
 * "the shell behaves like this" from "the shell behaved like this at the last
 * build" — every case passes about whatever `dist/` happens to hold. The guard
 * that separates those two is one rule, and B3a says a rule with more than one
 * caller lives in one place: the second proof to spawn the shell would otherwise
 * write a second opinion about what *stale* means, agreeing with the first most
 * of the time. That is this repository's most expensive recurring shape, and
 * three of its instances were parsers.
 *
 * The rule itself has already been measured twice and both readings are encoded
 * in {@link newestMtime} rather than in prose someone re-derives.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The newest mtime at `path`, walking it if it is a directory.
 *
 * `dist` and `node_modules` are skipped: the first is the artefact side of the
 * comparison and would make every tree newer than its own output, and the
 * second is not source.
 *
 * @param {string} path
 * @returns {number}
 */
export function newestMtime(path) {
  const entry = statSync(path);
  if (!entry.isDirectory()) return entry.mtimeMs;

  // FILES ONLY — a directory's own mtime is not seeded here, and it is a second
  // route to the same false alarm rather than the same one. A directory's
  // timestamp moves when a file is CREATED IN or REMOVED FROM it, so a new test
  // bumps the tree even with the test itself excluded below; editing one does
  // not. Measured 2026-08-29 by restoring the seed: `touch` on an existing test
  // passes, and creating `__scratch_probe.test.ts` stops the proof dead.
  let newest = 0;
  for (const name of readdirSync(path)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    // A TEST IS NOT AN INPUT TO THE BUNDLE, and including one makes this guard
    // fire for an edit that cannot change the artefact. Measured 2026-08-29 by
    // disabling this line: build, `touch renderPage.test.ts`, and the proof
    // stops dead on a build that is current. A guard that cries wolf is one
    // somebody turns off, which would cost the real staleness it was added for.
    if (/\.test\.tsx?$/u.test(name)) continue;
    const at = newestMtime(join(path, name));
    if (at > newest) newest = at;
  }

  // AN EMPTY WALK IS A BROKEN LOOKUP, NOT A FRESH BUILD (finding KKKKK-2).
  //
  // `statSync` above is loud about a path that does not exist. What is silent is
  // a directory that EXISTS and yields nothing — every entry skipped as
  // `node_modules`, `dist`, `.git` or a test, or simply empty. This used to
  // return 0, and 0 never exceeds an artefact's timestamp, so the pair passed.
  // The reassuring answer here is *the build is current*, and an exclusion list
  // that grew until it swallowed a whole tree would produce it on every run
  // while the guard reported nothing wrong.
  //
  // Latent when it was found — `packages/ui/src` holds plenty of ordinary files
  // — and closed anyway, because the skip list is the thing that gets widened
  // and this is the check two proofs now trust before reading a bundle.
  if (newest === 0) {
    throw new Error(
      `${path} contains no file this walk can date. Everything under it was skipped as ` +
        `node_modules, dist, .git or a test, or the directory is empty.\n` +
        `That is a broken lookup, not a current build: a walk returning nothing compares as ` +
        `"not newer than the artefact", so the freshness check would pass without having ` +
        `looked at anything. Point it at a directory that holds source, or narrow the skip ` +
        `list back.`,
    );
  }
  return newest;
}

/**
 * Refuses to run against a build older than the source it was made from.
 *
 * ## The one failure a positive control cannot catch
 *
 * A proof that drives the running shell produces the strongest evidence this
 * repository has. It is also evidence about **whatever was built**, and a stale
 * artefact answers every probe confidently and correctly about the previous
 * version. `CLAUDE.md` names this exactly: a stale answer contains the
 * known-present anchor too, so no amount of "locate something you know is there"
 * separates it.
 *
 * The gap is not hypothetical and it has a specific shape. `npm run build` is
 * `typecheck` **plus** `build:preload` **plus** `build:renderer`; `npm run
 * typecheck` alone is what the Commands section shows and what habit reaches
 * for. Editing `preload.ts` and running only `typecheck` leaves `preload.cjs`
 * untouched — the bridge still loads, every case still passes, and they pass
 * about the old preload (finding HH-6).
 *
 * ## Freshness, compared the only way that means anything
 *
 * Source must not be **strictly newer** than the artefact built from it. Ties
 * pass: a build completing inside one filesystem timestamp tick is not evidence
 * of staleness, and a check that fails on granularity is a check someone turns
 * off.
 *
 * A missing artefact is reported as missing rather than as fresh — "could not
 * compare" must not read as "compared and agreed".
 *
 * ## A source may be a DIRECTORY, and the renderer bundle is why
 *
 * `preload.cjs` has one source file. The Vite bundle has a tree — every module
 * reachable from `main.tsx` — so its freshness is decided by the newest file
 * under it, not by one path somebody picked. Naming a single file there would be
 * a guard that passes whenever the edit happened to land in a sibling.
 *
 * ## `expected` is an anchor, and it is per CALL SITE rather than per caller
 *
 * `rendererPolicy.proof.mjs` alone has two, and that is deliberate: its string
 * half runs on every machine and reads `windowPolicy.js` alone, so demanding a
 * preload there would fail every runner that installs nothing. A single count
 * inside this function would therefore be wrong for one of them.
 *
 * The literal exists because the list is **hand-kept and the danger runs toward
 * growth** (rule 4c): the failure is an artefact arriving with nobody adding a
 * row, which is finding GGGGG-1 — two cases began reading the Vite bundle and
 * the list did not follow. A count derived from `pairs.length` agrees with any
 * list, including the one that is missing an entry.
 *
 * @param {string} repoRoot absolute path to the repository root
 * @param {ReadonlyArray<readonly [string, string]>} pairs `[source, artefact]`,
 *   both repo-relative. A directory source is walked; a file source is read.
 * @param {number} expected how many pairs this call site declares.
 * @returns {void}
 */
export function refuseStaleBuild(repoRoot, pairs, expected) {
  if (pairs.length !== expected) {
    throw new Error(
      `refuseStaleBuild received ${String(pairs.length)} pair(s) where the call site declares ` +
        `${String(expected)}. Raise the literal in the same edit that adds a pair; if you are ` +
        `removing one, say why in the commit.`,
    );
  }
  for (const [source, artefact] of pairs) {
    const sourcePath = join(repoRoot, source);
    const artefactPath = join(repoRoot, artefact);
    if (!existsSync(artefactPath)) {
      throw new Error(
        `${artefact} does not exist. Run \`npm run build\` — which is \`typecheck\` plus ` +
          `\`build:preload\` plus \`build:renderer\`, and not \`typecheck\` alone.`,
      );
    }
    const sourceAt = newestMtime(sourcePath);
    const artefactAt = statSync(artefactPath).mtimeMs;
    if (sourceAt > artefactAt) {
      throw new Error(
        `${artefact} is OLDER than ${source}, so this proof would run against a stale build ` +
          `and every case would pass about the previous version of the shell.\n  ` +
          `${source}: ${new Date(sourceAt).toISOString()}\n  ` +
          `${artefact}: ${new Date(artefactAt).toISOString()}\n` +
          `Run \`npm run build\`. \`npm run typecheck\` produces neither the preload bundle nor ` +
          `the renderer bundle, which are two of the pairs this check exists for.\n` +
          `And if \`build\` reports nothing to do for a \`tsc\` pair, the source's timestamp ` +
          `moved without its CONTENT changing — a \`git stash pop\` does exactly that — so the ` +
          `incremental build correctly considers the output current while this check does not: ` +
          `\`npx tsc --build --force\`. The bundled pairs have no such state; esbuild and ` +
          `Vite rebuild them every time.`,
      );
    }
  }
}
