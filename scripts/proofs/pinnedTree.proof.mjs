// @ts-check
/**
 * Proves a pinned tree is refused for every way it can differ, and passed only when it is exactly what was pinned.
 *
 * ## Why this file exists
 *
 * `scripts/lib/pinnedTree.mjs` replaced an early return — *"the output file exists, so it is provisioned"* — in three
 * provisioning scripts. The reassuring answer there is *verified*, and the three ways to be wrongly given it are one
 * per axis the check reads: a file with other bytes, a file missing, and a file nobody pinned. Each is a case, and each
 * is built from a tree that would PASS with the one difference removed, so a refusal cannot be for another reason.
 *
 * Case 1 is the control for the rest: the exact tree passes. Without it, a check that refused everything would pass
 * cases 2 to 5.
 *
 * Usage: node scripts/proofs/pinnedTree.proof.mjs
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRoster } from '../lib/passRoster.mjs';
import { pinsOf, presentAsPinned, treeProblems, verifyPinnedTree } from '../lib/pinnedTree.mjs';
import { formatError } from '../lib/reportError.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 8 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const scratch = mkdtempSync(join(tmpdir(), 'monstera-pinned-tree-'));

/**
 * A folder holding a program and a library beside it, the shape the three scripts pin.
 *
 * @param {string} name
 * @returns {string}
 */
function tree(name) {
  const directory = join(scratch, name);
  mkdirSync(join(directory, 'sub'), { recursive: true });
  writeFileSync(join(directory, 'tool.exe'), 'the program');
  writeFileSync(join(directory, 'sub', 'library.dll'), 'the library');
  return directory;
}

try {
  const pins = await pinsOf(tree('source'));

  // ---- 1. CONTROL: the exact tree passes ----
  const exact = await treeProblems(tree('exact'), pins);
  check(
    'the tree that was pinned passes, nested paths included',
    exact.length === 0 && Object.keys(pins).join(',') === 'sub/library.dll,tool.exe',
    `problems ${JSON.stringify(exact)}, pinned ${JSON.stringify(Object.keys(pins))}. Without this, a check that refused ` +
      'every tree would pass every case below.',
  );

  // ---- 2. OTHER BYTES under a pinned name ----
  const changed = tree('changed');
  writeFileSync(join(changed, 'sub', 'library.dll'), 'the library, altered');
  const changedProblems = await treeProblems(changed, pins);
  check(
    'a pinned file with other bytes is refused, and named',
    changedProblems.length === 1 && changedProblems[0]?.startsWith('different sub/library.dll') === true,
    `problems ${JSON.stringify(changedProblems)}. This is the cache-restored or tampered tree the early return passed.`,
  );

  // ---- 3. A PINNED FILE MISSING ----
  const missing = tree('missing');
  rmSync(join(missing, 'tool.exe'));
  const missingProblems = await treeProblems(missing, pins);
  check(
    'a pinned file that is absent is refused',
    JSON.stringify(missingProblems) === JSON.stringify(['missing tool.exe']),
    `problems ${JSON.stringify(missingProblems)}.`,
  );

  // ---- 4. A FILE NOBODY PINNED, beside the pinned ones ----
  const extra = tree('extra');
  writeFileSync(join(extra, 'version.dll'), 'a library the search order would load');
  const extraProblems = await treeProblems(extra, pins);
  check(
    'an extra file is refused — a DLL beside the program is one Windows loads',
    JSON.stringify(extraProblems) === JSON.stringify(['not pinned version.dll']),
    `problems ${JSON.stringify(extraProblems)}. Every pinned file is intact here, so only the set rule can refuse it.`,
  );

  // ---- 5. REFUSAL REMOVES THE TREE and says so; a pass leaves it ----
  let refused = '';
  try {
    await verifyPinnedTree({ directory: changed, pins, context: 'the case tree' });
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  const kept = tree('kept');
  await verifyPinnedTree({ directory: kept, pins, context: 'the kept tree' });
  check(
    'a refused tree is removed and the run fails; an exact one is left in place',
    refused.includes('removed unread') && !existsSync(changed) && existsSync(join(kept, 'tool.exe')),
    `message "${refused}", changed tree still present: ${String(existsSync(changed))}, kept tree present: ` +
      `${String(existsSync(join(kept, 'tool.exe')))}. Repairing silently would launder a poisoned tree as a corrupt one.`,
  );

  // ---- 6. AN EMPTY PIN TABLE pins nothing, and is refused rather than passing an empty folder ----
  let empty = '';
  try {
    await treeProblems(join(scratch, 'source'), {});
  } catch (error) {
    empty = error instanceof Error ? error.message : String(error);
  }
  check(
    'an empty pin table is an error, not a pass',
    empty.includes('at least one pinned file'),
    `message "${empty}". A table that lost its rows would otherwise verify an empty folder.`,
  );

  // ---- 7. A TREE FOUND ON DISK that is not as pinned is removed, said, and answered false; an exact one is true ----
  /** @type {string[]} */
  const said = [];
  const stale = tree('stale');
  writeFileSync(join(stale, 'tool.exe'), 'the program, last version');
  const staleAnswer = await presentAsPinned({ directory: stale, pins, context: 'the stale tree', report: (line) => said.push(line) });
  const exactAnswer = await presentAsPinned({ directory: tree('present'), pins, context: 'the present tree', report: (line) => said.push(line) });
  check(
    'a stale tree on disk is removed and reported, and the caller told to provision; an exact one passes',
    !staleAnswer && !existsSync(stale) && said.length === 1 && said[0]?.includes('different tool.exe') === true && exactAnswer,
    `stale answered ${String(staleAnswer)}, still present ${String(existsSync(stale))}, said ${JSON.stringify(said)}, ` +
      `exact answered ${String(exactAnswer)}.`,
  );

  // ---- 8. AN OLD TREE COMES UP TO DATE IN ONE RUN (addendum 5's P1), in the provisioners' own shape ----
  /**
   * One provisioning run as every script now spells it: a tree present and as pinned stops there; otherwise the tree is
   * written again from the source (the verified archive's stand-in) and held to the pins before it counts.
   *
   * @param {string} directory
   * @param {'new' | 'old'} shape
   */
  const provision = async (directory, shape) => {
    if (existsSync(join(directory, 'tool.exe'))) {
      if (shape === 'new' && (await presentAsPinned({ directory, pins, context: 'the case tree', report: () => undefined }))) return 'present';
      // THE OLD SHAPE, the control: the present tree is refused and the run stops.
      if (shape === 'old') await verifyPinnedTree({ directory, pins, context: 'the case tree' });
    }
    mkdirSync(join(directory, 'sub'), { recursive: true });
    writeFileSync(join(directory, 'tool.exe'), 'the program');
    writeFileSync(join(directory, 'sub', 'library.dll'), 'the library');
    await verifyPinnedTree({ directory, pins, context: 'the provisioned tree' });
    return 'provisioned';
  };
  const upgraded = tree('upgraded');
  writeFileSync(join(upgraded, 'sub', 'library.dll'), 'the library, last version');
  const firstRun = await provision(upgraded, 'new');
  const after = await treeProblems(upgraded, pins);
  const control = tree('control');
  writeFileSync(join(control, 'sub', 'library.dll'), 'the library, last version');
  let oldRun = '';
  try {
    oldRun = await provision(control, 'old');
  } catch (error) {
    oldRun = error instanceof Error ? error.message : String(error);
  }
  check(
    'an out-of-date tree is replaced and pinned in the SAME run; the old shape stopped and asked for another',
    firstRun === 'provisioned' && after.length === 0 && oldRun.includes('Run the provisioning again'),
    `first run answered ${firstRun} with problems ${JSON.stringify(after)}; the old shape answered "${oldRun}".`,
  );

  if (failures.length > 0) {
    process.stderr.write(
      `\nPinned-tree proof — ${failures.length} failure(s):\n\n` +
        failures.map((failure) => `  - ${failure}`).join('\n\n') +
        '\n\n',
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`${roster.format('pinned-tree case')}\n`);
  }
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
