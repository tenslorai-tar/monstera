// @ts-check
/**
 * Proves the renderer is served the Content-Security-Policy this repository
 * declares, and that Chromium is ENFORCING it.
 *
 * ## Two claims, split so a provisioning failure costs the cheap half nothing
 *
 * **(i) The declared list is the one ARCHITECTURE §9.27 pins, and it is
 * well-formed** — decidable from two strings, so it runs everywhere and is in
 * the roster below. The pin is the reason the rest of this file is worth
 * running: without it, the read-back compares the constant against its own
 * delivery, and a policy loosened to `default-src *` passes every case here.
 * The document is the **writer of record** and the constant is derived; the
 * failure message says so, because the tempting repair is the wrong direction.
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
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARNESS = join(REPO_ROOT, 'apps', 'desktop', 'dist', 'rendererHarnessMain.js');
const MARKER = 'MONSTERA_RENDERER_READBACK ';

/** The law. Invariant 27 pins the directive list; the constant is derived. */
const ARCHITECTURE = join(REPO_ROOT, 'docs', 'ARCHITECTURE.md');

/** The info string on the fenced block invariant 27 pins the list in. */
const PIN_FENCE = 'csp';

/** A policy the renderer demonstrably does not have, for the control. */
const A_POLICY_WE_DO_NOT_SERVE = "default-src *; script-src 'unsafe-eval'";

const ELECTRON_BINARY = electronBinaryPath(REPO_ROOT);
const RUNTIME_PRESENT = existsSync(ELECTRON_BINARY) && existsSync(HARNESS);

/** @type {string[]} */
const failures = [];

/**
 * The cases that need a runtime, named ONCE.
 *
 * This list is the count, the UNVERIFIABLE listing, and the thing the runtime
 * branch is checked against. It used to be none of those: the block printed a
 * literal `9 case(s)` and nine hand-written lines beside a roster declared
 * `13 : 4`, so adding a runtime case left the mechanism whose entire job is *not
 * to overstate* naming eight of nine and calling it nine. B3a inside the honesty
 * mechanism, and the reason this is an array (finding HH-4).
 */
const RUNTIME_CASES = [
  'the renderer RECEIVES the policy the shell declares',
  'CONTROL: a policy the renderer does NOT have is not reported as delivered',
  'the renderer OBEYS it: no network under connect-src none, no eval',
  'the React shell MOUNTS under the pinned policy, so script-src self permits the bundle',
  'and its stylesheet arrived, so style-src self permits it too',
  'no Node surface is reachable from page script',
  'CONTROL: the contextBridge key IS reachable, so the probe could look',
  "popups are denied, in the renderer's view and in main's",
  'a permission outside the allowed set is refused',
  'CONTROL: the one permitted permission is GRANTED',
  'navigation off the loaded document is refused, and a permitted one completes',
  'the SHIPPED window subscribes to every failure Electron announces',
  "CONTROL: the shell's sink RECEIVES a real crash, not just a listener count",
  'the window PAINTS the background the shell declares',
  'a preload under these preferences cannot reach Node, which attributes to sandbox alone',
];

/** Cases decidable from strings alone. These run on every machine. */
const STRING_CASES = 4;

/**
 * TWO WORLDS, TWO COUNTS, and the conditional is the honest form here.
 *
 * A single count would have to be the smaller one — which would let every
 * runtime case be deleted without a sound where the runtime exists — or the
 * larger one, which would fail every run that cannot look. Declaring per world
 * keeps a deleted case loud in both, and the branch that produces the smaller
 * number is the branch that also prints UNVERIFIABLE, so nobody can read
 * `4 cases passed` as coverage.
 */
const roster = createRoster(failures, {
  cases: RUNTIME_PRESENT ? STRING_CASES + RUNTIME_CASES.length : STRING_CASES,
});

/**
 * Every label `check` has recorded, in order.
 *
 * Deriving the count from {@link RUNTIME_CASES} fixes the arithmetic and not the
 * NAMES: a list that says nine while the branch below checks nine different
 * things would still print a confident, wrong account of what could not be
 * looked at. So the labels are compared to what actually ran, on every machine
 * that can run them.
 */
/** @type {string[]} */
const recorded = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  recorded.push(label);
  roster.record(mark, label);
}

/**
 * Refuses to run against a build older than the source it was made from.
 *
 * ## The one failure a positive control cannot catch
 *
 * Everything else here asks the running renderer what it does, which is the
 * strongest evidence this repository has. It is also evidence about **whatever
 * was built**, and a stale artefact answers every probe confidently and
 * correctly about the previous version of the shell. `CLAUDE.md` names this
 * exactly: a stale answer contains the known-present anchor too, so no amount of
 * "locate something you know is there" separates it.
 *
 * The gap is not hypothetical and it has a specific shape. `npm run build` is
 * `typecheck` **plus** `build:preload`; `npm run typecheck` alone is what the
 * Commands section shows and what habit reaches for. Editing `preload.ts` and
 * running only `typecheck` leaves `preload.cjs` untouched — the bridge still
 * loads, all thirteen cases still pass, and they pass about the old preload
 * (finding HH-6).
 *
 * ## Freshness, compared the only way that means anything
 *
 * Source must not be **strictly newer** than the artefact built from it. Ties
 * pass: a build completing inside one filesystem timestamp tick is not
 * evidence of staleness, and a check that fails on granularity is a check
 * someone turns off.
 *
 * A missing file is reported as missing rather than as fresh — `statSync` throws
 * and the message says which pair, because "could not compare" must not read as
 * "compared and agreed".
 *
 * @param {[string, string][]} pairs `[source, artefact]`, repo-relative
 */
function refuseStaleBuild(pairs) {
  for (const [source, artefact] of pairs) {
    const sourcePath = join(REPO_ROOT, source);
    const artefactPath = join(REPO_ROOT, artefact);
    if (!existsSync(artefactPath)) {
      throw new Error(
        `${artefact} does not exist. Run \`npm run build\` — which is \`typecheck\` plus ` +
          `\`build:preload\`, and not \`typecheck\` alone.`,
      );
    }
    const sourceAt = statSync(sourcePath).mtimeMs;
    const artefactAt = statSync(artefactPath).mtimeMs;
    if (sourceAt > artefactAt) {
      throw new Error(
        `${artefact} is OLDER than ${source}, so this proof would run against a stale build ` +
          `and every case would pass about the previous version of the shell.\n  ` +
          `${source}: ${new Date(sourceAt).toISOString()}\n  ` +
          `${artefact}: ${new Date(artefactAt).toISOString()}\n` +
          `Run \`npm run build\`. If you ran \`npm run typecheck\`, that does not produce the ` +
          `preload bundle — which is the pair this check exists for.\n` +
          `And if \`build\` reports nothing to do for a \`tsc\` pair, the source's timestamp ` +
          `moved without its CONTENT changing, so the incremental build correctly considers the ` +
          `output current while this check does not: \`npx tsc --build --force\`. The bundled ` +
          `preload has no such state — Vite rebuilds it every time.`,
      );
    }
  }
}

/**
 * What the shell declares, read from the BUILT shell rather than restated here.
 *
 * Restating any of it would compare a copy with itself.
 *
 * @returns {Promise<{ policy: string, background: string }>}
 */
async function declared() {
  const built = join(REPO_ROOT, 'apps', 'desktop', 'dist', 'windowPolicy.js');
  if (!existsSync(built)) {
    throw new Error(
      `${built} does not exist. This proof compares what the renderer received against what ` +
        `the shell declares, and it reads the declaration from the BUILD — run \`npm run ` +
        `build\` first.`,
    );
  }
  const module = await import(`file://${built.replaceAll('\\', '/')}`);
  return { policy: module.CONTENT_SECURITY_POLICY, background: module.WINDOW_BACKGROUND };
}

/**
 * The policy `docs/ARCHITECTURE.md` §9 invariant 27 pins, as a header string.
 *
 * ## This is a SEARCH, so its silence has to be worth something
 *
 * Every way of breaking it produces the same output — a wrong fence name, a
 * renamed section, a block someone reflowed, a parse that ate the file — and
 * that output is "no directives", which compared against a real constant would
 * simply fail. A failure is survivable; the danger is the other direction, where
 * an empty extraction is read as a clean input. **So this throws rather than
 * returning empty**, and the throw names what it could not find. Audit item 4b's
 * corollary: an empty intermediate result is a broken parse, not a clean one.
 *
 * The positive control lives HERE and not only in the proof, because the proof
 * runs in CI and this function gets called by hand on the day someone needs the
 * answer: it must find exactly one block, that block must close, and it must
 * carry at least two directives.
 *
 * ## The unit is a fenced block, not a line window
 *
 * Anchoring on `\`\`\`csp` rather than on prose around it is deliberate. This
 * repository hard-wraps prose, and `withdrawnPhrases.mjs` records the resulting
 * false negative in its own header: a pattern long enough to wrap escapes in
 * silence. A fence is a unit the document actually has, so nothing here depends
 * on where a line happens to break.
 *
 * @param {string} markdown
 * @returns {string}
 */
function pinnedPolicy(markdown) {
  const lines = markdown.split(/\r?\n/);
  const isFence = (/** @type {string} */ line) => line.trim() === `\`\`\`${PIN_FENCE}`;
  const opened = lines.filter(isFence).length;
  const openIndex = lines.findIndex(isFence);

  if (opened !== 1) {
    throw new Error(
      `docs/ARCHITECTURE.md has ${String(opened)} \`\`\`${PIN_FENCE} blocks; invariant 27 ` +
        `is pinned in exactly one. ${
          opened === 0
            ? 'None was found — the fence was renamed, or the invariant was removed. Either is a ' +
              'change to the law and must be made there first.'
            : 'Two blocks are two opinions about one policy (B3a); the extractor refuses to ' +
              'choose between them.'
        }`,
    );
  }

  /** @type {string[]} */
  const directives = [];
  let closed = false;
  for (const raw of lines.slice(openIndex + 1)) {
    const line = raw.trim();
    if (line === '```') {
      closed = true;
      break;
    }
    if (line === '') continue;
    if (line.includes(';')) {
      throw new Error(
        `The pinned block contains a ";" on the line "${line}". The block is one directive per ` +
          `line and this file joins them; a semicolon there means the joined form was pasted in, ` +
          `and the comparison would then be against a double-separated string.`,
      );
    }
    directives.push(line);
  }

  if (!closed) {
    throw new Error(
      `The \`\`\`${PIN_FENCE} block in docs/ARCHITECTURE.md is never closed. Everything after it ` +
        `was read as a directive, which is a broken parse and not a policy.`,
    );
  }
  if (directives.length < 2) {
    throw new Error(
      `The \`\`\`${PIN_FENCE} block yielded ${String(directives.length)} directive(s). The fence ` +
        `was found and its body was not, so this is the shape where a search reports the ` +
        `reassuring answer because it could not look.`,
    );
  }
  return directives.join('; ');
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
 * @returns {{
 *   delivered: string | null,
 *   connectBlocked: boolean,
 *   evalBlocked: boolean,
 *   shell: { mounted: boolean, background: string | null },
 *   nodeSurface: string[],
 *   bridgeExposed: boolean,
 *   preloadError: string | null,
 *   failureListeners: Record<string, number>,
 *   failuresReceived: string[],
 *   crashResolvedBy: 'already' | 'event' | 'bound',
 *   backgroundColor: string,
 *   preloadNodeReach: string,
 *   popupReturnedNull: boolean,
 *   windowCount: number,
 *   permissions: Record<string, string>,
 *   refusedNavigationLoads: number,
 *   permittedNavigationLoads: number,
 *   finalUrl: string,
 * }}
 */
function readback(binary) {
  const needsDisplay = process.platform === 'linux' && process.env['DISPLAY'] === undefined;

  // Resolved by absolute path, and its ABSENCE is reported as itself.
  //
  // Measured: this step failed on ubuntu-latest after ONE SECOND. Nothing that
  // starts Electron and waits for a window fails that fast, so the spawn itself
  // was what failed — and a bare `spawnSync('xvfb-run', …)` reports ENOENT in a
  // way that reads like the harness misbehaving rather than like a missing
  // program. Checking first turns "the read-back failed" into "there is no
  // display server on this machine", which are different problems with
  // different fixes.
  const XVFB = ['/usr/bin/xvfb-run', '/bin/xvfb-run', '/usr/local/bin/xvfb-run'];
  let wrapper;
  if (needsDisplay) {
    wrapper = XVFB.find((path) => existsSync(path));
    if (wrapper === undefined) {
      throw new Error(
        `Electron needs an X display on Linux and no xvfb-run was found. Tried:\n  ` +
          `${XVFB.join('\n  ')}\nInstall it (\`xvfb\` on Debian/Ubuntu) or export DISPLAY. ` +
          `Running without one does not error — it HANGS, which is why this refuses up front ` +
          `rather than discovering it after a two-minute timeout.`,
      );
    }
  }

  const [command, args] =
    wrapper === undefined ? [binary, [HARNESS]] : [wrapper, ['-a', binary, HARNESS]];

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
    // The harness reports its own failures on stderr with a marker, so "it broke
    // and said why" is separated from "it never spoke". Those need different
    // fixes and produce the same missing line.
    //
    // The payload is one line of JSON — a serialised `StructuredError`, cause
    // chain included. It used to be a message on this line and a stack on the
    // lines after it, and this filter kept only the first, so the stack was
    // written and discarded here.
    const spoke = `${result.stderr}`
      .split(/\r?\n/)
      .filter((entry) => entry.startsWith('MONSTERA_RENDERER_HARNESS_FAILED'))
      .join('\n');
    throw new Error(
      `The harness produced no ${MARKER.trim()} line (exit ${String(result.status)}${
        result.signal === null ? '' : `, signal ${result.signal}`
      }).\n` +
        (spoke === ''
          ? `It reported no failure of its own either, so it was killed or never started. ` +
            `A timeout here means the window never finished loading.\n`
          : `${spoke}\n`) +
        `command: ${command} ${args.join(' ')}\n` +
        `stdout: ${result.stdout.slice(0, 1200)}\n` +
        `stderr: ${result.stderr.slice(-2400)}`,
    );
  }
  return JSON.parse(line.slice(MARKER.length));
}

try {
  // The declaration is read from the build in every world, so its freshness is
  // checked in every world.
  refuseStaleBuild([['apps/desktop/src/windowPolicy.ts', 'apps/desktop/dist/windowPolicy.js']]);

  const { policy: declaredPolicy, background: declaredBackground } = await declared();

  // ---------------------------------------------------------------------------
  // (i) The string, and its agreement with the law. Runs everywhere.
  // ---------------------------------------------------------------------------
  const architecture = readFileSync(ARCHITECTURE, 'utf8');
  const pinned = pinnedPolicy(architecture);

  check(
    'the shell declares exactly the policy ARCHITECTURE §9.27 pins',
    pinned === declaredPolicy,
    `pinned in docs/ARCHITECTURE.md §9.27:\n        ${pinned}\n` +
      `      declared by apps/desktop/src/windowPolicy.ts:\n        ${declaredPolicy}\n` +
      `      **The document is the writer of record here** — the opposite direction from the ` +
      `memory budgets, and deliberately so: pinning a CSP is only worth anything if loosening ` +
      `it is a diff in the law that someone has to justify. So the fix for this failure is to ` +
      `amend §9.27 first, per B4, and derive the constant from it — not the reverse.`,
  );

  {
    // CONTROL, and the DIRECTION is what makes it one.
    //
    // The property under test is "these two agree", and agreement is also what
    // absence produces — so a mutation that moves both sides together proves
    // nothing. This one moves the pin ALONE, towards disagreement, in the
    // direction a real drift would take it: a `connect-src` quietly widened
    // from `'none'` to `'self'` is the whole shape this invariant exists to
    // catch.
    //
    // Mutating the real document rather than hand-writing a near-copy, because
    // a hand-written fixture drifts from the block it imitates and then passes
    // for the wrong reason. The replacement is asserted to have CHANGED
    // something: an unmatched pattern would leave the fixture identical to the
    // law, and the case would then assert that the law disagrees with itself —
    // vacuous, and green.
    // Scoped to the block rather than to the whole document: a plain `replace`
    // takes the FIRST occurrence, and §9.27's own prose discusses these
    // directives. That it currently discusses them only *below* the block is
    // true today and is not a property anyone is maintaining — the kind of
    // unstated dependency that turns into a mystery failure a month later.
    // `pinnedPolicy` has already thrown above if the fence is missing, so this
    // index is real.
    const LOOSENED = { from: "connect-src 'none'", to: "connect-src 'self'" };
    const fence = architecture.indexOf(`\`\`\`${PIN_FENCE}`);
    const fixture =
      architecture.slice(0, fence) + architecture.slice(fence).replace(LOOSENED.from, LOOSENED.to);
    if (fixture === architecture) {
      throw new Error(
        `The control could not loosen the pinned block: "${LOOSENED.from}" does not appear in ` +
          `docs/ARCHITECTURE.md. Without a real mutation this case compares the law with ` +
          `itself and passes whatever the comparison does.`,
      );
    }
    check(
      'CONTROL: a pinned list loosened by one source no longer matches the shell',
      pinnedPolicy(fixture) !== declaredPolicy,
      `the extractor returned a policy equal to the shell's after "${LOOSENED.from}" was widened ` +
        `to "${LOOSENED.to}". The agreement case above would then pass for any pinned list at ` +
        `all, which is the shape where a policy nobody pinned and a policy everybody pinned are ` +
        `the same observation.`,
    );
  }

  const directives = declaredPolicy.split(';').map((entry) => entry.trim());
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
        `UNVERIFIABLE — ${String(RUNTIME_CASES.length)} case(s) could not be evaluated on ` +
        `this machine:\n` +
        `${RUNTIME_CASES.map((label) => `  ??  ${label}\n`).join('')}\n` +
        `  ${existsSync(binary) ? 'The harness' : 'The Electron runtime'} is missing:\n` +
        `    ${existsSync(binary) ? HARNESS : binary}\n` +
        `  Run \`npm run provision:electron\` and \`npm run typecheck\`.\n\n` +
        `  This is COULD NOT LOOK, not looked-and-found-nothing. These are the only evidence ` +
        `that ARCHITECTURE §2's renderer hardening is ENFORCED rather than merely configured, ` +
        `so a run without them proves less than it appears to — which is why they are not ` +
        `reported as passing and not reported as "nothing to check".\n`,
    );
  } else {
    // Everything the harness actually executes. `preload.cjs` is the pair that
    // motivated this: it is the only artefact `typecheck` does not produce.
    refuseStaleBuild([
      ['apps/desktop/src/preload.ts', 'apps/desktop/dist/preload.cjs'],
      ['apps/desktop/src/window.ts', 'apps/desktop/dist/window.js'],
      ['apps/desktop/src/rendererHarness.ts', 'apps/desktop/dist/rendererHarness.js'],
      ['apps/desktop/src/rendererHarnessMain.ts', 'apps/desktop/dist/rendererHarnessMain.js'],
    ]);

    const seen = readback(binary);

    check(
      'the renderer RECEIVES the policy the shell declares',
      seen.delivered === declaredPolicy,
      `delivered:\n        ${seen.delivered ?? '(no Content-Security-Policy header at all)'}\n` +
        `      declared:\n        ${declaredPolicy}\n` +
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

    // -------------------------------------------------------------------------
    // The shell, and the two directives that had only ever been delivered.
    // -------------------------------------------------------------------------

    check(
      'the React shell MOUNTS under the pinned policy, so script-src self permits the bundle',
      seen.shell.mounted,
      `the renderer document's root has no mounted surface. \`index.html\` ships one element — ` +
        `\`<div id="root">\` — so this can only be true if the bundle ran, and \`file://\` is an ` +
        `opaque origin where whether \`'self'\` matches is not something to reason about. A ` +
        `blocked bundle and an unbuilt one both leave the root empty; run \`npm run build\` ` +
        `before concluding the policy refused it.`,
    );

    check(
      'and its stylesheet arrived, so style-src self permits it too',
      seen.shell.background !== null && seen.shell.background !== 'rgba(0, 0, 0, 0)',
      `the mounted surface computed \`${String(seen.shell.background)}\`. Read COMPUTED rather ` +
        `than off the \`<link>\`: a refused stylesheet leaves the tag in the DOM exactly where ` +
        `it was, so the element's own resolved colour is the only thing that separates ` +
        `"delivered" from "applied". \`rgba(0, 0, 0, 0)\` is what an element with no stylesheet ` +
        `computes, and it is the value this case exists to reject.`,
    );

    // -------------------------------------------------------------------------
    // The rest of §2's renderer hardening, read back the same way.
    // -------------------------------------------------------------------------

    check(
      'no Node surface is reachable from page script',
      seen.nodeSurface.length === 0,
      `page script can see: ${seen.nodeSurface.join(', ')}. This is the union consequence of ` +
        `sandbox, contextIsolation and nodeIntegration:false, and a single visible name means ` +
        `at least one of the three did not take effect. It cannot say WHICH — the three are ` +
        `entangled in this observation, and the proof states that rather than picking one.`,
    );

    check(
      'CONTROL: the contextBridge key IS reachable, so the probe could look',
      seen.bridgeExposed,
      `the page could not see the bridge key either. An empty Node surface is also what a page ` +
        `that failed to load returns, and what a probe that cannot read globalThis returns — ` +
        `three failures with one reassuring output. Without this line the case above passes on ` +
        `a blank renderer.\n      preload-error: ${seen.preloadError ?? '(none reported)'}\n` +
        `      A preload that fails to load says so ONLY through that event — no stderr, no ` +
        `exception in main, and a window that comes up looking correct. If it names a ` +
        `SyntaxError, the shell is pointing at the ESM artefact \`tsc\` emits instead of the ` +
        `CommonJS bundle from \`node scripts/build/preload.mjs\`. If it reports nothing at all, ` +
        `the preload loaded and did not expose the key.`,
    );

    check(
      "popups are denied, in the renderer's view and in main's",
      seen.popupReturnedNull && seen.windowCount === 1,
      `window.open returned ${seen.popupReturnedNull ? 'null' : 'a window'} and main counts ` +
        `${String(seen.windowCount)} window(s). Both readings are required: a handler that ` +
        `denied the renderer's proxy while Chromium still created a window satisfies the first ` +
        `alone, and the window is the part that matters.`,
    );

    check(
      'a permission outside the allowed set is refused',
      seen.permissions['geolocation'] === 'denied' && seen.permissions['notifications'] === 'denied',
      `geolocation=${seen.permissions['geolocation'] ?? '(absent)'} ` +
        `notifications=${seen.permissions['notifications'] ?? '(absent)'}. Queried through ` +
        `navigator.permissions, which takes the CHECK handler — the synchronous path that is ` +
        `silently missing when only setPermissionRequestHandler is wired, and the reason ` +
        `windowPolicy.ts insists both are installed.`,
    );

    check(
      'CONTROL: the one permitted permission is GRANTED',
      seen.permissions['camera'] === 'granted',
      `camera=${seen.permissions['camera'] ?? '(absent)'}, and Electron maps it to the 'media' ` +
        `permission this app grants. Without this line, a handler that denied everything and a ` +
        `handler that was never installed at all both read as a working deny-all policy — the ` +
        `fixture the defect handles correctly.`,
    );

    check(
      'navigation off the loaded document is refused, and a permitted one completes',
      seen.refusedNavigationLoads === 0 && seen.permittedNavigationLoads === 1,
      `refused attempt produced ${String(seen.refusedNavigationLoads)} load(s), permitted ` +
        `attempt produced ${String(seen.permittedNavigationLoads)}; final URL ${seen.finalUrl}. ` +
        `The URL is deliberately not the discriminator: a refused navigation leaves it ` +
        `unchanged and a permitted navigation to the loaded document leaves it unchanged too, ` +
        `so counting loads is what separates "the guard refused" from "nothing navigates at all".`,
    );

    {
      const listeners = seen.failureListeners;
      const unsubscribed = Object.entries(listeners).filter(([, extra]) => extra < 1);
      check(
        'the SHIPPED window subscribes to every failure Electron announces',
        Object.keys(listeners).length > 0 && unsubscribed.length === 0,
        `listeners on the window createMainWindow returned, MINUS those a bare BrowserWindow ` +
          `already carries: ${JSON.stringify(listeners)}. ` +
          `${
            Object.keys(listeners).length === 0
              ? 'No events were counted at all, which is a broken probe rather than a passing one.'
              : `Not subscribed by the shell: ${unsubscribed.map(([event]) => event).join(', ')}.`
          } The subtraction is load-bearing and was added after the absolute count survived its ` +
          `own mutation: Electron attaches one listener to each of these itself, so "count > 0" ` +
          `is true of a window that subscribed to nothing. A failure channel the runtime ` +
          `announces on and nothing subscribes to is not a channel — the preload proved that by ` +
          `failing in total silence with two proofs passing about it.`,
      );
    }

    check(
      "CONTROL: the shell's sink RECEIVES a real crash, not just a listener count",
      seen.failuresReceived.includes('render-process-gone') && seen.crashResolvedBy === 'event',
      `after forcefullyCrashRenderer the sink held: ` +
        `${seen.failuresReceived.length === 0 ? '(nothing)' : seen.failuresReceived.join(', ')}, ` +
        `and the wait resolved by: ${seen.crashResolvedBy}.\n      ` +
        `THE RESOLUTION IS THE HARNESS-FIX CONTROL. \`event\` can only be produced by a waiter ` +
        `that was installed and then fired; a fixed sleep reaches \`bound\` or returns without ` +
        `one, and \`already\` is unreachable because the waiter is installed before the kill is ` +
        `issued. This asserts what the HARNESS PASSES rather than what the run produces, which is ` +
        `the rule this project wrote after BB-4 — and which was first cited here as the reason no ` +
        `control could exist, when it is the instruction for building one.\n      ` +
        `The count above proves something is attached; it does not prove the sink is reached, ` +
        `and a listener attached to a function that drops its argument produces the same ` +
        `silence one step along. So the renderer is genuinely killed and the sink is read.\n      ` +
        `WHICH OF THE TWO IT IS matters: \`bound\` means the event never arrived at all, and an ` +
        `empty list with \`event\` would mean it arrived carrying nothing. Those ` +
        `were one observation until this case failed on windows-latest and on no other runner — ` +
        `the harness waited a fixed 400 ms after the kill and read a sink that had not been ` +
        `reached YET, which is a working guard reported as a broken one. It now waits for the ` +
        `EVENT; the bound decides nothing while the mechanism works.`,
    );

    check(
      'the window PAINTS the background the shell declares',
      seen.backgroundColor.toLowerCase() === declaredBackground.toLowerCase(),
      `declared ${declaredBackground}, window reports ${seen.backgroundColor}. ` +
        `Electron honours an alpha channel only for a transparent window, and silently drops it ` +
        `otherwise — this constant said "#00000000" for its whole life and the window was opaque ` +
        `black the entire time. A value that has never been true reads exactly like one that is, ` +
        `so it is read back rather than trusted.`,
    );

    check(
      'a preload under these preferences cannot reach Node, which attributes to sandbox alone',
      seen.preloadNodeReach.startsWith('threw:'),
      `a preload built from the same RENDERER_WEB_PREFERENCES reported: ` +
        `"${seen.preloadNodeReach}".\n` +
        `      THIS IS THE ONLY CASE HERE THAT ATTRIBUTES. The page-side node-surface case is ` +
        `the union consequence of sandbox, contextIsolation and nodeIntegration and cannot name ` +
        `one of them; a preload can, because nodeIntegration governs the PAGE and ` +
        `contextIsolation governs which world globals land in — neither decides what a preload ` +
        `may require.\n      Measured against the pinned Electron before this case was written: ` +
        `a sandboxed preload gets "threw: module not found: node:fs". The mutation that proves ` +
        `the attribution is flipping sandbox BY ITSELF, which must redden this case while the ` +
        `node-surface case stays green; if both move, the union has been measured again.`,
    );

    // The list and the branch, compared rather than trusted to match.
    //
    // The count already comes from RUNTIME_CASES, so a case added without a line
    // fails the roster. This catches the other half: nine lines describing nine
    // DIFFERENT things still counts to nine, and the UNVERIFIABLE block would
    // then give a confident, wrong account of what could not be looked at — the
    // exact failure HH-4 is about, one level in.
    //
    // Thrown rather than checked, because a proof inconsistent with itself is
    // not a case it can report: the roster it would report through is the thing
    // in question.
    const ran = recorded.slice(STRING_CASES);
    if (ran.length !== RUNTIME_CASES.length || ran.some((label, at) => label !== RUNTIME_CASES[at]))
      throw new Error(
        `RUNTIME_CASES does not describe the runtime branch.\n  declared:\n    ` +
          `${RUNTIME_CASES.join('\n    ')}\n  ran:\n    ${ran.join('\n    ')}\n` +
          `That list is what a machine WITHOUT a runtime prints as its account of what could ` +
          `not be evaluated. A wrong account there is worse than no account, because it reads ` +
          `as rigour.`,
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
