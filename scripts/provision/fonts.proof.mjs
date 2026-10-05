// @ts-check
/**
 * Proves the bundled fonts are exactly the pinned set, that the licence notice names exactly the families shipped,
 * and that a font present on disk but not pinned, or a licence copy that is missing, is refused before it reaches
 * anything (ADR-0172).
 *
 * ## Why the notice and the bundle are compared in BOTH directions
 *
 * A family shipped and not in the notice is a licence breach; a family in the notice and not shipped is a notice
 * claiming terms for something absent. A one-way check finds one of the two and reads clean on the other. Each
 * direction has a control that removes one family from a copy of the other side and must be reported by name.
 *
 * ## Why the tamper case plants a font into a copy of the REAL tree
 *
 * A font in the folder is a font the resolver may embed. The case copies the genuine provisioned files into a fresh
 * root, adds one more, and requires the provisioner to refuse and remove the tree; the CONTROL is the same copy
 * without the extra file, which must be accepted with no download, so the refusal is about the planted font.
 *
 * Downloads nothing. Needs the fonts provisioned for the copy cases (`--require-fonts` makes their absence red).
 *
 * Usage: node scripts/provision/fonts.proof.mjs [--require-fonts]
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { nativeManifest } from '../release/nativeManifest.mjs';
import {
  BUNDLED_FONTS,
  BUNDLED_FONTS_BYTES,
  BUNDLED_FONT_PINS,
  FONT_LICENCES,
  fontLicenceRoot,
  fontsDirectory,
  provisionFonts,
} from './fonts.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const requireFonts = process.argv.includes('--require-fonts');

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 11 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/**
 * The families the notice declares for the bundled fonts, from the licence files it renders.
 *
 * @param {unknown} declared nativeComponents.json, parsed
 * @returns {string[]}
 */
function noticeFamilies(declared) {
  const programs = /** @type {{ programs?: { licenceRoot?: string, components?: { texts?: string[] }[] }[] }} */ (declared)
    .programs ?? [];
  const entry = programs.find((program) => program.licenceRoot === 'scripts/release/licences/fonts');
  if (entry === undefined) return [];
  return (entry.components ?? []).flatMap((component) => component.texts ?? []).map((text) => text.replace(/\.txt$/u, ''));
}

/**
 * What one side lacks of the other, by name.
 *
 * @param {readonly string[]} shipped @param {readonly string[]} noticed
 */
function disagreement(shipped, noticed) {
  return {
    unlisted: [...new Set(shipped)].filter((family) => !noticed.includes(family)),
    absent: [...new Set(noticed)].filter((family) => !shipped.includes(family)),
  };
}

const scratch = mkdtempSync(join(tmpdir(), 'monstera-fonts-proof-'));

try {
  const sum = BUNDLED_FONTS.reduce((total, font) => total + font.bytes, 0);
  const files = new Set(BUNDLED_FONTS.map((font) => font.file));
  check(
    'the table is twenty-one distinct files that weigh the stated total',
    BUNDLED_FONTS.length === 21 && files.size === 21 && sum === BUNDLED_FONTS_BYTES,
    `${String(BUNDLED_FONTS.length)} rows, ${String(files.size)} distinct, ${String(sum)} bytes against ${String(BUNDLED_FONTS_BYTES)}`,
  );

  const shippedFamilies = BUNDLED_FONTS.map((font) => font.family);
  check(
    'every shipped family has a pinned licence text, and every pinned text a shipped family',
    disagreement(shippedFamilies, Object.keys(FONT_LICENCES)).unlisted.length === 0 &&
      disagreement(shippedFamilies, Object.keys(FONT_LICENCES)).absent.length === 0,
    JSON.stringify(disagreement(shippedFamilies, Object.keys(FONT_LICENCES))),
  );

  const declared = JSON.parse(readFileSync(join(REPO_ROOT, 'scripts', 'release', 'nativeComponents.json'), 'utf8'));
  const noticed = noticeFamilies(declared);
  const both = disagreement(shippedFamilies, noticed);
  check(
    'the notice names exactly the families shipped, in both directions',
    noticed.length > 0 && both.unlisted.length === 0 && both.absent.length === 0,
    `notice ${JSON.stringify(noticed)}; ${JSON.stringify(both)}`,
  );
  const dropped = noticed.filter((family) => family !== 'carlito');
  check(
    'CONTROL: a notice missing one shipped family is reported by name',
    disagreement(shippedFamilies, dropped).unlisted.join() === 'carlito',
    JSON.stringify(disagreement(shippedFamilies, dropped)),
  );
  check(
    'CONTROL: a notice naming a family not shipped is reported by name',
    disagreement(shippedFamilies.filter((family) => family !== 'caladea'), noticed).absent.join() === 'caladea',
    JSON.stringify(disagreement(shippedFamilies.filter((family) => family !== 'caladea'), noticed)),
  );

  const manifestFonts = nativeManifest(REPO_ROOT).components['fonts'];
  check(
    'the packaged manifest carries exactly the pinned files and digests',
    manifestFonts !== undefined && JSON.stringify(manifestFonts.files) === JSON.stringify(BUNDLED_FONT_PINS),
    JSON.stringify(manifestFonts),
  );

  let refusal = '';
  try {
    await provisionFonts({ root: join(scratch, 'no-licences') });
    refusal = 'accepted';
  } catch (error) {
    refusal = formatError(error);
  }
  check(
    'a checkout missing a committed licence text is refused before anything is fetched',
    refusal !== 'accepted' && refusal.includes('licence') && !existsSync(fontsDirectory(join(scratch, 'no-licences'))),
    `provisionFonts answered ${refusal}`,
  );

  const genuine = fontsDirectory(REPO_ROOT);
  if (existsSync(join(genuine, BUNDLED_FONTS[0]?.file ?? ''))) {
    /** @param {string} name @param {boolean} plant */
    const copyRoot = (name, plant) => {
      const root = join(scratch, name);
      mkdirSync(fontLicenceRoot(root), { recursive: true });
      for (const family of Object.keys(FONT_LICENCES)) {
        copyFileSync(join(fontLicenceRoot(REPO_ROOT), `${family}.txt`), join(fontLicenceRoot(root), `${family}.txt`));
      }
      mkdirSync(fontsDirectory(root), { recursive: true });
      for (const font of BUNDLED_FONTS) copyFileSync(join(genuine, font.file), join(fontsDirectory(root), font.file));
      if (plant) writeFileSync(join(fontsDirectory(root), 'Planted-Regular.ttf'), 'a font nobody pinned');
      return root;
    };
    /** @param {string} root */
    const answer = async (root) => {
      try {
        return (await provisionFonts({ root })).provisioned ? 'downloaded' : 'accepted';
      } catch (error) {
        return formatError(error);
      }
    };

    const planted = copyRoot('planted', true);
    const plantedAnswer = await answer(planted);
    check(
      'a font nobody pinned beside the set is refused, and the tree removed',
      plantedAnswer !== 'accepted' && plantedAnswer.includes('Planted-Regular.ttf') && !existsSync(fontsDirectory(planted)),
      `provisionFonts answered ${plantedAnswer}`,
    );

    const altered = copyRoot('altered', false);
    writeFileSync(join(fontsDirectory(altered), 'Tinos-Regular.ttf'), 'not the pinned bytes');
    const alteredAnswer = await answer(altered);
    check(
      'a pinned file with other bytes is refused',
      alteredAnswer !== 'accepted' && alteredAnswer.includes('Tinos-Regular.ttf'),
      `provisionFonts answered ${alteredAnswer}`,
    );

    const exact = copyRoot('exact', false);
    check(
      'CONTROL: the genuine set at the same place is accepted with no download',
      (await answer(exact)) === 'accepted',
      'the copied genuine tree was not accepted',
    );
    check('CONTROL: the planted case ran on a tree that held every genuine file', existsSync(genuine), genuine);
  } else if (requireFonts) {
    for (const label of ['planted', 'altered', 'exact', 'genuine']) {
      check(`the bundled fonts are provisioned here (${label})`, false, `${genuine} is absent and --require-fonts was given`);
    }
  } else {
    for (const label of ['planted', 'altered', 'exact', 'genuine']) {
      check(`UNVERIFIABLE (${label}): the bundled fonts are not provisioned here`, true, '');
    }
  }
} catch (error) {
  failures.push(`the proof itself failed: ${formatError(error)}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

process.stdout.write(
  failures.length > 0
    ? `${String(failures.length)} bundled-font failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
    : roster.format('bundled-font case'),
);
process.exitCode = failures.length > 0 ? 1 : 0;
