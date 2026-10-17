// @ts-check
/**
 * Proof for the index typecheck (scripts/lib/indexTypecheck.mjs; JJJJJJJ-5, the owner's decision of 2026-10-17).
 *
 * The real repository, never its index: git is pointed at a COPY of the index through `GIT_INDEX_FILE`, so a staged
 * blob can be changed without touching what the person has staged. The working tree is not written.
 *
 * - THE 98712352 SHAPE: the copy stages `packages/shared/src/result.ts` with a type error the working tree does not
 *   have. The scratch folder's typecheck fails naming that file — the working tree, which compiles, could not.
 * - CONTROL: the same copy, unchanged, typechecks; so the failure above is the staged blob's.
 * - The decision, both ways, and the premise check refusing a scratch folder whose packages are the checkout's.
 *
 * Usage: node scripts/proofs/indexTypecheck.proof.mjs   (about three minutes: two typechecks)
 */

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { git, repoRoot } from '../lib/gitScope.mjs';
import {
  checkoutIndex,
  decideIndexTypecheck,
  removeScratch,
  scratchReadsItsOwnPackages,
  typecheckIn,
  unstagedCompilerReads,
} from '../lib/indexTypecheck.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { TYPECHECKED_PATHSPECS } from '../hooks/prePush.mjs';
import { npmCliPath } from '../hooks/lockfileIntegrity.mjs';

const ROOT = repoRoot();
/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 7 });

/** @param {string} name @param {boolean} condition @param {string} detail */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

// THE DECISION.
check(
  'nothing compiler-read staged: no scratch typecheck',
  !decideIndexTypecheck([], ['a.ts']).check,
  JSON.stringify(decideIndexTypecheck([], ['a.ts'])),
);
check(
  'no unstaged compiler-read change: no scratch typecheck, the tree is the index',
  !decideIndexTypecheck(['a.ts'], []).check,
  JSON.stringify(decideIndexTypecheck(['a.ts'], [])),
);
check(
  'both: the index is typechecked apart',
  decideIndexTypecheck(['a.ts'], ['b.ts']).check,
  JSON.stringify(decideIndexTypecheck(['a.ts'], ['b.ts'])),
);

// THE PREMISE CHECK: a scratch folder linking the checkout's package is refused; one linking its own is not.
{
  const fake = mkdtempSync(join(tmpdir(), 'monstera-premise-'));
  try {
    mkdirSync(join(fake, 'node_modules', '@monstera'), { recursive: true });
    mkdirSync(join(fake, 'packages', 'shared'), { recursive: true });
    symlinkSync(join(ROOT, 'packages', 'shared'), join(fake, 'node_modules', '@monstera', 'shared'), 'junction');
    const outside = scratchReadsItsOwnPackages(fake);
    rmSync(join(fake, 'node_modules', '@monstera', 'shared'), { recursive: true, force: true });
    symlinkSync(join(fake, 'packages', 'shared'), join(fake, 'node_modules', '@monstera', 'shared'), 'junction');
    const inside = scratchReadsItsOwnPackages(fake);
    check(
      "a scratch folder whose package is the checkout's is refused, and one whose package is its own is not",
      !outside && inside,
      JSON.stringify({ outside, inside }),
    );
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }
}

// THE INDEX, read apart from the tree, through a copy of it.
const TARGET = 'packages/shared/src/result.ts';
const indexPath = `${git(['rev-parse', '--git-path', 'index'], { cwd: ROOT }).stdout}`.trim();
const holder = mkdtempSync(join(tmpdir(), 'monstera-index-copy-'));
const copy = join(holder, 'index');
copyFileSync(join(ROOT, indexPath), copy);
const previous = process.env['GIT_INDEX_FILE'];
process.env['GIT_INDEX_FILE'] = copy;
try {
  // CONTROL FIRST: the copy as the person staged it typechecks.
  {
    const scratch = checkoutIndex(ROOT);
    try {
      const result = typecheckIn(scratch, npmCliPath());
      check('CONTROL: the index as staged typechecks in the scratch folder', result.ok, result.output.slice(-2000));
    } finally {
      removeScratch(scratch, ROOT);
    }
  }

  const broken = `${readFileSync(join(ROOT, TARGET), 'utf8')}\nexport const indexOnly: number = 'not a number';\n`;
  const blob = `${git(['hash-object', '-w', '--stdin'], { cwd: ROOT, input: broken }).stdout}`.trim();
  git(['update-index', '--cacheinfo', `100644,${blob},${TARGET}`], { cwd: ROOT });

  const unstaged = unstagedCompilerReads(TYPECHECKED_PATHSPECS, ROOT);
  const scratch = checkoutIndex(ROOT);
  try {
    const result = typecheckIn(scratch, npmCliPath());
    check(
      'a staged blob with a type error the working tree lacks fails the scratch typecheck, naming its file',
      !result.ok && /result\.ts/u.test(result.output) && /TS2322/u.test(result.output),
      result.output.slice(-2000),
    );
  } finally {
    removeScratch(scratch, ROOT);
  }
  check(
    'and the working tree differs from that index at exactly the changed file, so the hook would have decided to look',
    unstaged.includes(TARGET),
    JSON.stringify(unstaged),
  );
} finally {
  if (previous === undefined) delete process.env['GIT_INDEX_FILE'];
  else process.env['GIT_INDEX_FILE'] = previous;
  rmSync(holder, { recursive: true, force: true });
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} index-typecheck case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('index-typecheck case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
