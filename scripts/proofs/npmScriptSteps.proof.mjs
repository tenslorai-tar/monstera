// @ts-check
/**
 * Proves the npm-script resolver can see, recurse and refuse (finding C2).
 *
 * `checkLocal.mjs` used to run only commands beginning with `node` and report
 * the rest as not run. The report was honest; what it hid was that `typecheck`,
 * `lint` and `build` were three of the four words ever in that list — so the
 * local gate ran no compiler and no linter, and `test` was in no roster at all.
 *
 * The resolver replaces that refusal, so the failure to fear now is the
 * opposite: a step it does not understand being DROPPED rather than reported,
 * which would make the gate's coverage a number nobody can check. Every case
 * below is about that direction, and each refusal is paired with a control that
 * resolves — because a resolver that returns nothing for everything satisfies
 * the refusals alone.
 *
 * Usage: node scripts/proofs/npmScriptSteps.proof.mjs
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { binaryMap, resolveScript } from '../lib/npmScriptSteps.mjs';
import { createRoster } from '../lib/passRoster.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 9 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/** @type {string[]} */
const scratches = [];

/**
 * A fixture root with a package whose `bin` points at a file.
 *
 * The bin's TARGET is written too, because a resolver reading `node_modules`
 * and one inventing a plausible path produce the same string for a package that
 * happens to follow convention — and the fixture uses an unconventional name
 * (`lib/run-me.js`, not `bin/tool.js`) so only a real read can produce it.
 *
 * @returns {string}
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'monstera-steps-'));
  scratches.push(root);
  mkdirSync(join(root, 'node_modules', 'toolkit', 'lib'), { recursive: true });
  writeFileSync(
    join(root, 'node_modules', 'toolkit', 'package.json'),
    JSON.stringify({ name: 'toolkit', bin: { tool: 'lib/run-me.js' } }),
    'utf8',
  );
  writeFileSync(join(root, 'node_modules', 'toolkit', 'lib', 'run-me.js'), '', 'utf8');
  mkdirSync(join(root, 'node_modules', 'solo'), { recursive: true });
  writeFileSync(
    join(root, 'node_modules', 'solo', 'package.json'),
    JSON.stringify({ name: 'solo', bin: 'main.js' }),
    'utf8',
  );
  return root;
}

/**
 * @param {string} root
 * @param {Record<string, string>} scripts
 * @param {string} name
 */
function resolve(root, scripts, name) {
  const bins = binaryMap(root, { toolkit: '*', solo: '*', missing: '*' });
  return resolveScript(name, { root, scripts, bins });
}

try {
  const root = fixture();

  {
    const result = resolve(root, { a: 'node scripts/one.mjs --flag' }, 'a');
    check(
      'a bare node invocation keeps its arguments',
      result.steps.length === 1 &&
        result.steps[0]?.js === join(root, 'scripts/one.mjs') &&
        result.steps[0]?.args.join(' ') === '--flag',
      `resolved ${JSON.stringify(result)}. Dropping the arguments would turn ` +
        `\`tsc -p tsconfig.scripts.json\` into a second copy of \`tsc --build\`, which is the ` +
        `exact half that ran nowhere locally and reddened the board.`,
    );
  }

  {
    const result = resolve(root, { a: 'node scripts/one.mjs && node scripts/two.mjs' }, 'a');
    check(
      'a chain resolves to every step, IN ORDER',
      result.steps.length === 2 &&
        result.steps[0]?.js === join(root, 'scripts/one.mjs') &&
        result.steps[1]?.js === join(root, 'scripts/two.mjs'),
      `resolved ${JSON.stringify(result)}. Order is the whole meaning of \`&&\`: running the ` +
        `second after the first failed reports a build made from a tree that does not compile.`,
    );
  }

  {
    const result = resolve(
      root,
      { outer: 'npm run inner && node scripts/last.mjs', inner: 'node scripts/deep.mjs' },
      'outer',
    );
    check(
      'npm run <name> is followed rather than treated as a command',
      result.steps.length === 2 &&
        result.steps[0]?.js === join(root, 'scripts/deep.mjs') &&
        result.steps[0]?.from === 'inner',
      `resolved ${JSON.stringify(result)}. \`build\` is \`npm run typecheck && npm run ` +
        `build:preload\`, so a resolver that stopped at the words would resolve the one script ` +
        `whose whole content is other scripts to nothing.`,
    );
  }

  {
    const result = resolve(root, { a: 'tool --check src' }, 'a');
    check(
      "a package's declared executable resolves to the file its own manifest names",
      result.steps.length === 1 &&
        result.steps[0]?.js === join(root, 'node_modules', 'toolkit', 'lib', 'run-me.js') &&
        result.steps[0]?.args.join(' ') === '--check src',
      `resolved ${JSON.stringify(result)}. The fixture's bin target is deliberately NOT at a ` +
        `conventional path, so a resolver guessing \`bin/tool.js\` produces a different string ` +
        `and this case separates reading from guessing.`,
    );
  }

  {
    const result = resolve(root, { a: 'solo run' }, 'a');
    check(
      '  ...including the string form of `bin`, where the package name IS the command',
      result.steps.length === 1 &&
        result.steps[0]?.js === join(root, 'node_modules', 'solo', 'main.js'),
      `resolved ${JSON.stringify(result)}. Both shapes are legal npm and a resolver handling ` +
        `only the object form fails on roughly half of real packages.`,
    );
  }

  {
    const result = resolve(root, { a: 'mystery --go && node scripts/after.mjs' }, 'a');
    check(
      'an unknown command is REPORTED as unresolved, not silently dropped',
      result.unresolved.length === 1 &&
        result.unresolved[0]?.command === 'mystery --go' &&
        result.steps.length === 1,
      `resolved ${JSON.stringify(result)}. This is the failure direction that replaced the old ` +
        `one: a dropped step makes the gate's coverage a number nobody can check, and its ` +
        `output is identical to a script that simply had fewer steps.`,
    );
  }

  {
    const result = resolve(root, { a: 'npm run b', b: 'npm run a' }, 'a');
    check(
      'a circular chain is reported rather than followed',
      result.unresolved.some((entry) => entry.why.includes('circular')),
      `resolved ${JSON.stringify(result)}. The alternative is a stack overflow whose message ` +
        `names neither script.`,
    );
  }

  {
    const result = resolve(root, { a: 'npm run absent' }, 'a');
    check(
      'a chain into a script that does not exist is reported',
      result.unresolved.some((entry) => entry.why.includes('no such script')),
      `resolved ${JSON.stringify(result)}. A renamed script leaves its caller pointing at ` +
        `nothing, and the caller still exits 0 if nobody says so.`,
    );
  }

  {
    // THE CONTROL FOR EVERY REFUSAL ABOVE. Four cases assert that something is
    // reported as unresolved, and a resolver that resolved NOTHING satisfies
    // all four — which is the version of this file that turns the local gate
    // back off while every case stays green.
    const result = resolve(
      root,
      { a: 'node scripts/one.mjs && tool x && npm run b', b: 'solo y' },
      'a',
    );
    check(
      'CONTROL: a command made only of understood steps has NO unresolved entries',
      result.unresolved.length === 0 && result.steps.length === 3,
      `resolved ${JSON.stringify(result)}. Every refusal case above passes for a resolver that ` +
        `understands nothing at all.`,
    );
  }
} finally {
  for (const path of scratches) rmSync(path, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(
    `\n${String(failures.length)} npm-script-step case(s) FAILED:\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      '\n',
  );
  process.exit(1);
}

process.stdout.write(roster.format('npm-script-step'));
