// @ts-check
/**
 * Proves the renderer is served the Content-Security-Policy this repository
 * declares, and that Chromium is ENFORCING it.
 *
 * ## Two claims, split so a provisioning failure costs the cheap half nothing
 *
 * **(i) The directive list is well-formed** — decidable from the string, so it
 * runs everywhere and is in the roster below.
 *
 * **(ii) Electron serves that list, and the renderer obeys it** — needs the
 * process. `docs/FEATURES.md` requires the policy "read back from the running
 * renderer … never read from the source that sets it", plus a control asserting
 * a policy the renderer does not have.
 *
 * When the runtime is absent, (ii) prints **UNVERIFIABLE and never passes.**
 * That wording is not decoration: the roster's own skip line reads "nothing to
 * check", which would be a false statement here — there is plenty to check and
 * this machine cannot look. *Could not look* is not *looked and found nothing*,
 * and every unverifiable line reads as rigour unless it says which one it is.
 *
 * ## Item 2a, stated where it happens rather than left for an audit
 *
 * This proof is a strengthening where the runtime is provisioned and a **new
 * "could not look"** everywhere else. Before it existed, the CSP was asserted
 * from a constant and that assertion ran unconditionally; now the meaningful
 * half has a provisioning condition. That is the same trade invariant 25's
 * symbols made when they moved from witnesses to a derivation, and it is worth
 * the exchange — but it is an exchange.
 *
 * ## Delivered is not enforced
 *
 * A malformed directive list is dropped by Chromium's parser, and a policy it
 * refuses to parse looks identical to one it is enforcing when all you compare
 * is the header string. So the harness also asks the renderer to *do* two
 * forbidden things — reach the network under `connect-src 'none'`, and compile a
 * function without `unsafe-eval` — and reports whether they were blocked.
 *
 * Usage: node scripts/proofs/rendererPolicy.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARNESS = join(REPO_ROOT, 'apps', 'desktop', 'dist', 'cspHarnessMain.js');
const MARKER = 'MONSTERA_CSP_READBACK ';

/** A policy the renderer demonstrably does not have, for the control. */
const A_POLICY_WE_DO_NOT_SERVE = "default-src *; script-src 'unsafe-eval'";

const ELECTRON_BINARY = electronBinaryPath(REPO_ROOT);
const RUNTIME_PRESENT = existsSync(ELECTRON_BINARY) && existsSync(HARNESS);

/** @type {string[]} */
const failures = [];

/**
 * TWO WORLDS, TWO COUNTS, and the conditional is the honest form here.
 *
 * A single count would have to be the smaller one — which would let the three
 * runtime cases be deleted without a sound where the runtime exists — or the
 * larger one, which would fail every run that cannot look. Declaring per world
 * keeps a deleted case loud in both, and the branch that produces the smaller
 * number is the branch that also prints UNVERIFIABLE, so nobody can read `2
 * cases passed` as coverage.
 */
const roster = createRoster(failures, { cases: RUNTIME_PRESENT ? 5 : 2 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/**
 * The declared policy, read from the BUILT shell rather than restated here.
 *
 * @returns {Promise<string>}
 */
async function declaredPolicy() {
  const built = join(REPO_ROOT, 'apps', 'desktop', 'dist', 'windowPolicy.js');
  if (!existsSync(built)) {
    throw new Error(
      `${built} does not exist. This proof compares what the renderer received against what ` +
        `the shell declares, and it reads the declaration from the BUILD — run \`npm run ` +
        `typecheck\` first. Restating the policy here would compare a copy with itself.`,
    );
  }
  const module = await import(`file://${built.replaceAll('\\', '/')}`);
  return module.CONTENT_SECURITY_POLICY;
}

/**
 * Runs the harness under a display, and returns what the renderer saw.
 *
 * `xvfb-run -a` on Linux, because Electron needs an X display there and without
 * one it does not error — it HANGS. A hang reads as a flake and a flake invites
 * a timeout bump, which is the banned reflex arriving with a plausible story.
 * The wrapper is applied here rather than only in the workflow so that running
 * this proof by hand on Linux behaves the same as running it in CI.
 *
 * @param {string} binary
 * @returns {{ delivered: string | null, connectBlocked: boolean, evalBlocked: boolean }}
 */
function readback(binary) {
  const needsDisplay = process.platform === 'linux' && process.env['DISPLAY'] === undefined;
  const [command, args] = needsDisplay
    ? ['xvfb-run', ['-a', binary, HARNESS]]
    : [binary, [HARNESS]];

  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw new Error(`Could not run the harness via ${command}`, { cause: result.error });
  }

  const line = `${result.stdout}`.split(/\r?\n/).find((entry) => entry.startsWith(MARKER));
  if (line === undefined) {
    throw new Error(
      `The harness produced no ${MARKER.trim()} line (exit ${result.status}).\n` +
        `stdout: ${result.stdout.slice(0, 800)}\nstderr: ${result.stderr.slice(0, 800)}`,
    );
  }
  return JSON.parse(line.slice(MARKER.length));
}

try {
  const declared = await declaredPolicy();

  // ---------------------------------------------------------------------------
  // (i) The string. Runs everywhere.
  // ---------------------------------------------------------------------------
  const directives = declared.split(';').map((entry) => entry.trim());
  const names = directives.map((entry) => entry.split(/\s+/u)[0]);

  check(
    'no directive is declared twice',
    new Set(names).size === names.length,
    `${names.join(', ')} — a repeated directive is not an error to Chromium: the FIRST wins ` +
      `and the second is silently ignored, so a policy can be tightened in a way that does ` +
      `nothing and reads as though it did.`,
  );

  check(
    'every directive has at least one source, so none is accidentally empty',
    directives.every((entry) => entry.split(/\s+/u).length >= 2),
    `${directives.join(' | ')} — a directive with no value is dropped by the parser, which ` +
      `means the fallback to default-src applies instead of the restriction that was written.`,
  );

  // ---------------------------------------------------------------------------
  // (ii) The runtime. UNVERIFIABLE rather than passed when it cannot run.
  // ---------------------------------------------------------------------------
  const binary = ELECTRON_BINARY;
  if (!RUNTIME_PRESENT) {
    process.stdout.write(
      `${roster.format('renderer-policy case')}\n` +
        `UNVERIFIABLE — 3 case(s) could not be evaluated on this machine:\n` +
        `  ??  the renderer RECEIVES the declared policy\n` +
        `  ??  CONTROL: a policy the renderer does NOT have is not reported as delivered\n` +
        `  ??  the renderer OBEYS it (connect-src and unsafe-eval)\n\n` +
        `  ${existsSync(binary) ? 'The harness' : 'The Electron runtime'} is missing:\n` +
        `    ${existsSync(binary) ? HARNESS : binary}\n` +
        `  Run \`npm run provision:electron\` and \`npm run typecheck\`.\n\n` +
        `  This is COULD NOT LOOK, not looked-and-found-nothing. These two cases are the only ` +
        `evidence that the policy is enforced rather than merely written down, so a run without ` +
        `them proves less than it appears to — which is why they are not reported as passing ` +
        `and not reported as "nothing to check".\n`,
    );
  } else {
    const seen = readback(binary);

    check(
      'the renderer RECEIVES the policy the shell declares',
      seen.delivered === declared,
      `delivered:\n        ${seen.delivered ?? '(no Content-Security-Policy header at all)'}\n` +
        `      declared:\n        ${declared}\n` +
        `      Read from the response as Chromium received it, never from the constant that ` +
        `sets it — those differ exactly when something between them is broken.`,
    );

    check(
      'CONTROL: a policy the renderer does NOT have is not reported as delivered',
      seen.delivered !== A_POLICY_WE_DO_NOT_SERVE,
      `the read-back matched "${A_POLICY_WE_DO_NOT_SERVE}". The comparison above would then ` +
        `pass for any policy at all, which is the shape where a header nobody serves and a ` +
        `header everybody serves are the same observation.`,
    );

    check(
      'the renderer OBEYS it: no network under connect-src none, no eval',
      seen.connectBlocked && seen.evalBlocked,
      `connectBlocked=${String(seen.connectBlocked)} evalBlocked=${String(seen.evalBlocked)}. ` +
        `A header can arrive and be IGNORED — Chromium drops a directive list it cannot parse, ` +
        `and a dropped policy is indistinguishable from an enforced one if all you compare is ` +
        `the string. This is the set-versus-enforced distinction invariant 25 refuses to elide.`,
    );

    process.stdout.write(
      failures.length > 0
        ? `${failures.length} renderer-policy failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
        : roster.format('renderer-policy case'),
    );
  }
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
if (failures.length > 0) process.exitCode = 1;
