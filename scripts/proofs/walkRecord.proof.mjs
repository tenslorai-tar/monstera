// @ts-check
/**
 * Proves the pack's walk gate (`scripts/release/walkRecord.mjs`, ADR-0285) over written-down records and reports, so it
 * runs on every platform and needs no build: a pack is refused from a commit with no record, with a failed row, with a
 * row nothing reached, with a record of another commit, and with a build whose digest differs; and allowed from a commit
 * whose walk passed. The allowed case is the control that the refusals are not a refusal of everything.
 *
 * Usage: node scripts/proofs/walkRecord.proof.mjs
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { FULL_WALK, commandIds, countsFor, programDigest, refusals, reportsOf, rowsFrom } from '../release/walkRecord.mjs';
import { stepTable, walkingRow } from '../research/walkSteps.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 32 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const COMMIT = 'a'.repeat(40);
const DIGEST = 'b'.repeat(64);
const COMMANDS = ['document.open', 'document.save', 'view.zoom-in'];

/** @typedef {import('../release/walkRecord.mjs').WalkReport} WalkReport */
/** @typedef {import('../release/walkRecord.mjs').WalkRecord} WalkRecord */

/** A walk report of this build, with its steps. @param {WalkReport['steps']} steps @returns {WalkReport} */
const report = (steps) => ({ walk: 'every-tool', folder: '2026-11-03T00-00-00', build: { commit: COMMIT, clean: true, digest: DIGEST }, steps });

/** The record a walk of `steps` writes. @param {WalkReport['steps']} steps @returns {WalkRecord} */
const recordOf = (steps) => ({
  commit: COMMIT,
  build: DIGEST,
  commands: COMMANDS.length,
  rows: rowsFrom(COMMANDS, [report(steps)]),
  written: '2026-11-03T00:00:00.000Z',
  reports: ['every-tool/2026-11-03T00-00-00'],
});

/** @typedef {import('../release/walkRecord.mjs').WalkStep} WalkStep */

/** @type {WalkStep} */
const OPEN_SAVE = { name: 'open and save', outcome: 'passed', covers: ['document.open', 'document.save'] };
/** @type {WalkStep} */
const ZOOM_SAID = { name: 'zoom', outcome: 'passed', notWalked: { 'view.zoom-in': 'needs the owner’s second display' } };
/** Every command walked and passed, one of them said not walked with its reason. */
const WALKED = [OPEN_SAVE, ZOOM_SAID];

async function main() {
  check(
    'CONTROL: a commit whose full walk passed, or said why a row was not walked, is allowed',
    refusals(recordOf(WALKED), COMMIT, DIGEST, COMMANDS).length === 0,
    JSON.stringify(refusals(recordOf(WALKED), COMMIT, DIGEST, COMMANDS)),
  );

  const none = refusals(undefined, COMMIT, DIGEST, COMMANDS);
  check('a commit with no record is refused', none.length === 1 && none[0]?.includes('no full walk') === true, JSON.stringify(none));

  const failed = refusals(recordOf([{ ...OPEN_SAVE, outcome: 'failed' }, ZOOM_SAID]), COMMIT, DIGEST, COMMANDS);
  check('a record with a failed row is refused, naming the row', failed.some((said) => said.includes('failed: document.open, document.save')), JSON.stringify(failed));

  const unreached = refusals(recordOf([OPEN_SAVE]), COMMIT, DIGEST, COMMANDS);
  check(
    'a row no step reached and no step explained is refused, naming it',
    unreached.some((said) => said.includes('reached by no step') && said.includes('view.zoom-in')),
    JSON.stringify(unreached),
  );

  const blank = refusals(recordOf([OPEN_SAVE, { name: 'zoom', outcome: 'passed', notWalked: { 'view.zoom-in': '  ' } }]), COMMIT, DIGEST, COMMANDS);
  check('a reason of only white space is no reason', blank.some((said) => said.includes('view.zoom-in')), JSON.stringify(blank));

  const other = refusals(recordOf(WALKED), 'c'.repeat(40), DIGEST, COMMANDS);
  check('a record of another commit is refused', other.some((said) => said.includes('not cccc')), JSON.stringify(other));

  const rebuilt = refusals(recordOf(WALKED), COMMIT, 'd'.repeat(64), COMMANDS);
  check('a build whose bytes differ from the walked build is refused', rebuilt.some((said) => said.includes('digest')), JSON.stringify(rebuilt));

  const grown = refusals(recordOf(WALKED), COMMIT, DIGEST, [...COMMANDS, 'document.new-command']);
  check(
    'a command the registry gained after the walk is refused as a row the record lacks',
    grown.some((said) => said.includes('document.new-command')),
    JSON.stringify(grown),
  );

  // A FAILED STEP OUTWEIGHS A PASSED ONE: a row is passed only when every step that covers it passed.
  const mixed = rowsFrom(COMMANDS, [report([OPEN_SAVE, { name: 'save again', outcome: 'failed', covers: ['document.save'] }])]);
  check('a row one step passed and another failed is failed', mixed.find((row) => row.id === 'document.save')?.result === 'failed', JSON.stringify(mixed));

  // THE BUILD, NOT THE COMMIT (the correction of 2026-11-03): a row walked at an EARLIER commit on the same bytes counts,
  // and a row walked on other bytes does not, whatever commit it names.
  /** @param {string} commit @param {string} digest @param {string} folder @param {WalkReport['steps']} steps @returns {WalkReport} */
  const reportAt = (commit, digest, folder, steps) => ({ walk: 'every-tool', folder, build: { commit, clean: true, digest }, steps });
  const earlier = { ...recordOf(WALKED), rows: rowsFrom(COMMANDS, [reportAt('f'.repeat(40), DIGEST, '2026-11-02T00-00-00', WALKED)]) };
  check(
    'CONTROL: a row walked at an earlier commit on the same build is kept',
    refusals(earlier, COMMIT, DIGEST, COMMANDS).length === 0,
    JSON.stringify(refusals(earlier, COMMIT, DIGEST, COMMANDS)),
  );
  const otherBytes = { ...recordOf(WALKED), rows: rowsFrom(COMMANDS, [reportAt(COMMIT, 'e'.repeat(64), '2026-11-03T00-00-00', WALKED)]) };
  const refusedBytes = refusals(otherBytes, COMMIT, DIGEST, COMMANDS);
  check(
    'a row walked on another build is refused, naming it, though the record names this commit and digest',
    refusedBytes.some((said) => said.includes('walked on another build') && said.includes('document.open')),
    JSON.stringify(refusedBytes),
  );

  // THE NEWEST RUN DECIDES A ROW, in both directions: reports are given newest first.
  const olderFail = reportAt(COMMIT, DIGEST, '2026-11-03T01-00-00', [{ ...OPEN_SAVE, outcome: 'failed' }, ZOOM_SAID]);
  const newerPass = reportAt(COMMIT, DIGEST, '2026-11-03T02-00-00', WALKED);
  const recovered = rowsFrom(COMMANDS, [newerPass, olderFail]).find((row) => row.id === 'document.save');
  check('a newer pass outweighs an older failure of the same row', recovered?.result === 'passed', JSON.stringify(recovered));
  const broken = rowsFrom(COMMANDS, [olderFail, newerPass].map((each, at) => ({ ...each, folder: at === 0 ? '2026-11-03T03-00-00' : each.folder }))).find((row) => row.id === 'document.save');
  check('and a newer failure outweighs an older pass', broken?.result === 'failed', JSON.stringify(broken));

  // A FULL WALK'S FAILURE STANDS (the owner's ruling, ADR-0285's correction of 2026-11-06). The narrower walk is newer in both.
  const narrow = { ...reportAt(COMMIT, DIGEST, '2026-11-03T05-00-00', [OPEN_SAVE]), walk: 'new-features' };
  const stood = rowsFrom(COMMANDS, [narrow, olderFail]);
  const saveStood = stood.find((row) => row.id === 'document.save');
  check(
    'a narrower walk’s newer pass does not clear a full walk’s failure, and the row names the full walk',
    saveStood?.result === 'failed' && saveStood.walkedOn?.report.startsWith(FULL_WALK) === true,
    JSON.stringify(saveStood),
  );
  check('and the pack refuses that row', refusals({ ...recordOf(WALKED), rows: stood }, COMMIT, DIGEST, COMMANDS).some((said) => said.includes('document.save')), JSON.stringify(stood));
  const cleared = rowsFrom(COMMANDS, [narrow, newerPass, olderFail]).find((row) => row.id === 'document.save');
  check('CONTROL: the full walk passing that row again clears it, the narrower walk still the newest', cleared?.result === 'passed', JSON.stringify(cleared));
  const neverFailed = rowsFrom(COMMANDS, [narrow, newerPass]).find((row) => row.id === 'document.save');
  check('CONTROL: a narrower walk’s pass still counts where the full walk did not fail the row', neverFailed?.result === 'passed' && neverFailed.walkedOn?.report.startsWith('new-features') === true, JSON.stringify(neverFailed));
  const narrowFailed = rowsFrom(COMMANDS, [{ ...narrow, steps: [{ ...OPEN_SAVE, outcome: 'failed' }] }, newerPass]).find((row) => row.id === 'document.save');
  check('CONTROL: a narrower walk’s newer failure still fails the row', narrowFailed?.result === 'failed', JSON.stringify(narrowFailed));
  const named = readFileSync(join(repoRoot(), 'scripts/research/everyToolWalk.mjs'), 'utf8');
  check('the full walk’s program gives its reports the name the rule keys on', named.includes(`startWalk('${FULL_WALK}'`), FULL_WALK);

  // THE GATE'S OWN REFUSALS (the stage audit's EEEEEEEEE-2): a report of a dirty tree or of other bytes is not counted, and each
  // case holds everything else right, so the clause named is the one refusing. The real walk script is the program.
  const program = 'scripts/research/everyToolWalk.mjs';
  const countable = { commit: COMMIT, clean: true, digest: DIGEST, walker: { script: program, digest: programDigest(repoRoot(), program) } };
  check('CONTROL: a clean report of this build and of the program now is counted', countsFor(repoRoot(), countable, DIGEST), JSON.stringify(countable));
  check('a report of a dirty tree is not counted', !countsFor(repoRoot(), { ...countable, clean: false }, DIGEST), 'counted');
  check('a report of other bytes is not counted', !countsFor(repoRoot(), { ...countable, digest: 'e'.repeat(64) }, DIGEST), 'counted');
  // NEWEST FIRST, read from folders on disk given oldest first, or `rowsFrom`'s "newest" would be whatever the disk listed.
  const walksRoot = mkdtempSync(join(tmpdir(), 'walk-record-'));
  try {
    writeFileSync(join(walksRoot, 'walk.mjs'), "import { a } from './liveWalk.mjs';\nexport const b = a;\n");
    writeFileSync(join(walksRoot, 'liveWalk.mjs'), 'export const a = 1;\n');
    const walker = { script: 'walk.mjs', digest: programDigest(walksRoot, 'walk.mjs') };
    for (const folder of ['2026-11-03T01-00-00', '2026-11-03T03-00-00', '2026-11-03T02-00-00']) {
      mkdirSync(join(walksRoot, '_review', 'walks', 'every-tool', folder), { recursive: true });
      writeFileSync(join(walksRoot, '_review', 'walks', 'every-tool', folder, 'report.json'), JSON.stringify({ walk: 'every-tool', build: { commit: COMMIT, clean: true, digest: DIGEST, walker }, steps: [] }));
    }
    const order = reportsOf(walksRoot, { digest: DIGEST }).map((each) => each.folder);
    check('reports are read newest first, whatever order the folders are listed in', JSON.stringify(order) === JSON.stringify(['2026-11-03T03-00-00', '2026-11-03T02-00-00', '2026-11-03T01-00-00']), JSON.stringify(order));
  } finally {
    rmSync(walksRoot, { recursive: true, force: true });
  }

  // A WALK PROGRAM THAT CHANGED: the report counts only while its program's digest is the program's now. The real walk
  // script is the control, read through its own imports, so the digest is one this repository's files produce.
  const script = 'scripts/research/everyToolWalk.mjs';
  const now = programDigest(repoRoot(), script);
  const current = { commit: COMMIT, clean: true, digest: DIGEST, walker: { script, digest: now } };
  check(
    'a report whose walk program has changed is not counted, and one whose program is unchanged is',
    countsFor(repoRoot(), current, DIGEST) && !countsFor(repoRoot(), { ...current, walker: { script, digest: '0'.repeat(64) } }, DIGEST),
    `unchanged ${String(countsFor(repoRoot(), current, DIGEST))}`,
  );
  // A REPORT NAMING NO PROGRAM, as a trial run from outside the checkout writes (`liveWalk.mjs`), is never counted, on
  // this very build: it may run, and it cannot pass a row.
  const { walker: _walker, ...programless } = current;
  check('a report that names no walk program is not counted, on the same build', !countsFor(repoRoot(), programless, DIGEST), JSON.stringify(programless));
  // THE DIGEST FOLLOWS THE IMPORTS: a change to a module the script takes, and not to the script, moves it.
  const scratch = mkdtempSync(join(tmpdir(), 'walk-program-'));
  try {
    writeFileSync(join(scratch, 'entry.mjs'), "import { a } from './liveWalk.mjs';\nexport const b = a;\n");
    writeFileSync(join(scratch, 'liveWalk.mjs'), 'export const a = 1;\n');
    const before = programDigest(scratch, 'entry.mjs');
    writeFileSync(join(scratch, 'liveWalk.mjs'), 'export const a = 2;\n');
    const after = programDigest(scratch, 'entry.mjs');
    check('the program digest moves when a module the walk imports changes, the script itself unchanged', before !== after, `${before} then ${after}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  // A STEP TABLE ANSWERS ONLY ITS OWN ROW (the correction of 2026-11-04): its own command's entry while that row is
  // walked; another command's, a listing, or a read outside any row throws. The first is the control that the guard does
  // not refuse everything.
  const table = stepTable('TRIAL', { 'document.open': 'own', 'document.save': 'other' });
  /** @param {() => unknown} read */
  const throws = (read) => {
    try {
      read();
      return false;
    } catch {
      return true;
    }
  };
  const own = await walkingRow('document.open', async () => table['document.open']);
  check('CONTROL: a step table answers the row being walked with that row\'s own entry', own === 'own', String(own));
  const across = await walkingRow('document.open', async () => throws(() => table['document.save']));
  check('a step table read for another row\'s command in a row throws', across, 'read across rows without throwing');
  const listed = await walkingRow('document.open', async () => throws(() => Object.keys(table)));
  check('a step table listed in a row throws, since a listing reads every row\'s entry', listed, 'listed without throwing');
  check('a step table read outside any row throws', throws(() => table['document.open']), 'read outside a row without throwing');

  // THE ROWS ARE THE REGISTRY'S: read from the checklist the registry generates, with its own positive control.
  const ids = commandIds(readFileSync(join(repoRoot(), 'docs', 'manual-test-checklist.md'), 'utf8'));
  check('the checklist names every command once, document.save among them, and more than two hundred', ids.length > 200 && new Set(ids).size === ids.length, `${String(ids.length)} ids`);

  // THE PACK ASKS IT, after its own clean build: a gate no pack calls refuses nothing, and these cases would stay green.
  const pack = readFileSync(join(repoRoot(), 'scripts', 'release', 'packageMsix.mjs'), 'utf8');
  const built = pack.indexOf("execFileSync('npm run build'");
  const asked = pack.indexOf('refuseUnwalked(REPO_ROOT, commit)');
  const staged = pack.indexOf("step('runtime')");
  check(
    'the pack refuses through this gate after its clean build and before it stages anything',
    built > 0 && asked > built && staged > asked,
    `npm run build at ${String(built)}, refuseUnwalked at ${String(asked)}, staging at ${String(staged)}`,
  );

  process.stdout.write(
    failures.length > 0 ? `${String(failures.length)} walk-record failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n` : roster.format('walk-record case'),
  );
  return failures.length > 0 ? 1 : 0;
}

try {
  process.exit(await main());
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exit(1);
}
