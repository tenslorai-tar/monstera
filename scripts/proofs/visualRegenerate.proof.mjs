// @ts-check
/**
 * Proof that regenerating the visual baselines rewrites only a baseline that FAILS the stated tolerance (W12).
 *
 * ## The mechanism
 *
 * `npm run test:visual:regenerate` passed `--update-snapshots=all`. In that mode Playwright 1.62.1 takes the
 * screenshot WITHOUT comparing it (`expected` is set to `undefined`, `lib/matchers/expect.js`) and writes it whenever
 * its bytes differ from the file at all. The capture spread on one machine is not zero — two regenerations of
 * identical code moved 17 of 36 images by up to 66 pixels (finding ZZZZZZ-3), under the 100-pixel tolerance — so every
 * image that wobbled was rewritten, and a regeneration for one screen came back with fifteen untouched baselines
 * changed. In `changed` mode the screenshot is compared with the tolerance and written only when it fails, which is
 * the gate's own definition of *different*.
 *
 * ## What this runs
 *
 * Real Playwright, on the provisioned browser, against a page drawn from a fixture: a black square on white. The mode
 * is READ from `package.json`'s script, so the case is about the command a person types, and the tolerance is the
 * visual config's own, so the case is about the gate's figure:
 *
 * 1. a baseline is written;
 * 2. the square moves by a few pixels (inside the tolerance) and the script's mode runs: the file must be unchanged;
 * 3. CONTROL — the same capture in `all` mode rewrites the file, so (2)'s unchanged file is the mode deciding and not
 *    a capture that happened to match byte for byte;
 * 4. the square grows past the tolerance and the script's mode runs: the file must change, so a real change is still
 *    regenerated.
 *
 * Usage: node scripts/proofs/visualRegenerate.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { BROWSERS_PATH, CLI } from '../provision/playwright.mjs';

const ROOT = repoRoot();

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 5 });

/** @param {string} name @param {boolean} condition @param {string} detail */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

// THE MODE THE COMMAND USES, read from the manifest rather than restated here.
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const regenerate = String(manifest.scripts?.['test:visual:regenerate'] ?? '');
const mode = /--update-snapshots(?:=|\s+)(\w+)/u.exec(regenerate)?.[1];
check(
  'test:visual:regenerate names its update mode',
  mode !== undefined,
  `the script reads "${regenerate}". Without a named mode Playwright presets one, and the case below would be about ` +
    `a mode nobody chose.`,
);

// INSIDE node_modules, so the spec's `@playwright/test` resolves to the repository's own copy; gitignored.
const work = join(ROOT, 'node_modules', '.cache', 'visual-regenerate-proof');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const visualConfig = pathToFileURL(join(ROOT, 'scripts', 'test', 'visual.config.mjs')).href;

writeFileSync(
  join(work, 'proof.config.mjs'),
  String.raw`import { defineConfig, devices } from '@playwright/test';
import visual from ${JSON.stringify(visualConfig)};

export default defineConfig({
  testDir: '.',
  testMatch: 'mark.spec.mjs',
  snapshotPathTemplate: '{testDir}/baseline{ext}',
  workers: 1,
  retries: 0,
  reporter: [['line']],
  expect: visual.expect,
  use: { ...devices['Desktop Chrome'] },
});
`,
);
writeFileSync(
  join(work, 'mark.spec.mjs'),
  String.raw`import { expect, test } from '@playwright/test';

test('mark', async ({ page }) => {
  await page.setViewportSize({ width: 200, height: 100 });
  const left = 10 + Number(process.env.MARK_SHIFT ?? '0');
  const size = Number(process.env.MARK_SIZE ?? '2');
  await page.setContent(
    '<body style="margin:0;background:#ffffff"><div style="position:absolute;top:10px;left:' + String(left) +
      'px;width:' + String(size) + 'px;height:' + String(size) + 'px;background:#000000"></div></body>',
  );
  await expect(page).toHaveScreenshot('mark.png');
});
`,
);

const baseline = join(work, 'baseline.png');

/**
 * Runs the fixture once and answers the baseline's bytes afterwards.
 *
 * @param {string} runMode
 * @param {{ shift: number, size: number }} mark
 */
function capture(runMode, mark) {
  const run = spawnSync(process.execPath, [CLI, 'test', '--config', join(work, 'proof.config.mjs'), `--update-snapshots=${runMode}`], {
    cwd: work,
    encoding: 'utf8',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS_PATH, MARK_SHIFT: String(mark.shift), MARK_SIZE: String(mark.size) },
  });
  if (run.status !== 0) {
    throw new Error(`Playwright exited ${String(run.status)} in ${runMode} mode:\n${run.stdout}\n${run.stderr}`);
  }
  return readFileSync(baseline);
}

try {
  const first = capture('all', { shift: 0, size: 2 });
  check('a baseline is written', first.length > 0, 'the first run wrote no baseline, so nothing after it means anything');

  const inside = capture(mode ?? 'changed', { shift: 3, size: 2 });
  check(
    `a capture INSIDE the tolerance leaves the baseline as it was, in the script's mode (${String(mode)})`,
    inside.equals(first),
    'the baseline was rewritten for a square moved three pixels, which the gate itself passes: a regeneration would ' +
      'come back with every image that wobbled changed.',
  );

  const control = capture('all', { shift: 3, size: 2 });
  check(
    'CONTROL: the same capture in `all` mode DOES rewrite it, so the unchanged file above is the mode deciding',
    !control.equals(first),
    'all mode left the file byte-identical, so the capture matched exactly and the case above separated nothing.',
  );

  const outside = capture(mode ?? 'changed', { shift: 3, size: 20 });
  check(
    "a capture OUTSIDE the tolerance is still regenerated in the script's mode",
    !outside.equals(control),
    'a 400-pixel change left the baseline as it was, so the mode no longer regenerates a real change.',
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} visualRegenerate case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('visualRegenerate case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
