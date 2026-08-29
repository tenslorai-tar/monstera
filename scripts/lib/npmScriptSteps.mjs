// @ts-check
/**
 * What an npm script actually RUNS, as a list of node invocations (finding C2).
 *
 * ## The hole this closes
 *
 * `checkLocal.mjs` spawns `process.execPath` directly rather than `npm run`,
 * and that is measured rather than preferred: on Windows a timeout applied to a
 * shell kills the shell and leaves the real node process running, which turned
 * three genuine timeouts into twenty-three failures. So it refused anything
 * whose command did not begin with `node`, and reported the refusal.
 *
 * The refusal was honest and the consequence was not visible from inside it:
 * `typecheck`, `lint` and `build` are the four words in that list, and `test`
 * is not in the roster at all — so **the local gate ran no compiler, no linter
 * and no unit test**. Measured 2026-08-29 the hard way: `npx tsc -b` is half of
 * `npm run typecheck`, the other half caught nothing locally, and the board went
 * red on the half nobody was running.
 *
 * ## Derived, never listed
 *
 * A table mapping `typecheck` to two `tsc` invocations would be a second
 * opinion about a command `package.json` owns (B3a), and it would drift the day
 * somebody edits that line — silently, and in the direction where the local gate
 * checks less than it says. So this parses the command instead: a chain split on
 * `&&`, each step resolved to a JavaScript file node can run.
 *
 * Three step shapes are understood and nothing else is guessed at:
 *
 *   - `node scripts/x.mjs …` — already a node invocation.
 *   - `npm run <name>` — recursed into, because a script that calls a script is
 *     how `build` is written.
 *   - `<bin> …` where `<bin>` is a package's declared executable — resolved
 *     through `node_modules`, which is the authority for what a bin name means.
 *
 * A step this cannot resolve is **returned as unresolved rather than dropped**.
 * A resolver that silently skipped what it did not understand would make the
 * gate's coverage a number nobody could check, which is the shape the `notNode`
 * report already exists to prevent one level up.
 *
 * ## Why not just run it through a shell
 *
 * Because of the measurement at the top. The whole reason this file exists is
 * that a shell between the harness and the process breaks the timeout on
 * Windows, and a gate that reports twenty spurious failures is a gate someone
 * turns off.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One resolved step: the JavaScript file to run and the arguments after it.
 *
 * @typedef {{ js: string, args: string[], from: string }} Step
 */

/**
 * A step that could not be resolved, and what it was.
 *
 * @typedef {{ command: string, why: string }} Unresolved
 */

/**
 * Maps an executable name to the JavaScript file that implements it.
 *
 * Read from each package's own `bin` field rather than from `node_modules/.bin`,
 * whose entries are platform shims — a `.cmd` on Windows and a shell script
 * elsewhere — so reading those would mean parsing a generated wrapper and
 * getting a different answer per platform. The `bin` field is what generated
 * both, and it is one answer everywhere.
 *
 * @param {string} root
 * @param {Record<string, string>} dependencies every dependency name to consider
 * @returns {Map<string, string>} bin name to absolute JavaScript path
 */
export function binaryMap(root, dependencies) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const name of Object.keys(dependencies)) {
    /** @type {{ bin?: string | Record<string, string> }} */
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'));
    } catch {
      // A dependency that is not installed is not an error here: this runs on
      // machines mid-install, and a missing package shows up as an unresolved
      // step with the command in it rather than as a crash with no context.
      continue;
    }
    const bin = manifest.bin;
    if (typeof bin === 'string') {
      map.set(name, join(root, 'node_modules', name, bin));
    } else if (bin !== undefined) {
      for (const [binName, path] of Object.entries(bin)) {
        map.set(binName, join(root, 'node_modules', name, path));
      }
    }
  }
  return map;
}

/**
 * Splits a shell command on `&&`, keeping the order.
 *
 * @param {string} command
 * @returns {string[]}
 */
function chain(command) {
  return command
    .split('&&')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * Resolves one npm script to the node invocations it performs.
 *
 * @param {string} name the script's name in `package.json`
 * @param {{
 *   root: string,
 *   scripts: Record<string, string>,
 *   bins: Map<string, string>,
 *   seen?: Set<string>,
 * }} context
 * @returns {{ steps: Step[], unresolved: Unresolved[] }}
 */
export function resolveScript(name, context) {
  const seen = context.seen ?? new Set();
  /** @type {Step[]} */
  const steps = [];
  /** @type {Unresolved[]} */
  const unresolved = [];

  if (seen.has(name)) {
    // A script that runs itself, directly or through another. Reported rather
    // than followed: the alternative is a stack overflow whose message names
    // neither script.
    unresolved.push({ command: name, why: 'the script chain is circular' });
    return { steps, unresolved };
  }
  seen.add(name);

  const command = context.scripts[name];
  if (command === undefined) {
    unresolved.push({ command: name, why: 'no such script in package.json' });
    return { steps, unresolved };
  }

  for (const part of chain(command)) {
    const tokens = part.split(/\s+/u).filter((/** @type {string} */ token) => token !== '');
    const head = tokens[0];
    if (head === undefined) continue;

    if (head === 'node') {
      const js = tokens[1];
      if (js === undefined) {
        unresolved.push({ command: part, why: 'node with no script' });
        continue;
      }
      steps.push({ js: join(context.root, js), args: tokens.slice(2), from: name });
      continue;
    }

    if (head === 'npm' && tokens[1] === 'run') {
      const inner = tokens[2];
      if (inner === undefined) {
        unresolved.push({ command: part, why: 'npm run with no script name' });
        continue;
      }
      const nested = resolveScript(inner, { ...context, seen });
      steps.push(...nested.steps);
      unresolved.push(...nested.unresolved);
      continue;
    }

    const js = context.bins.get(head);
    if (js === undefined) {
      unresolved.push({ command: part, why: `"${head}" is not a declared executable` });
      continue;
    }
    steps.push({ js, args: tokens.slice(1), from: name });
  }

  return { steps, unresolved };
}
