// @ts-check
/**
 * Provisions the bundled open fonts — the faces one resolver falls back to when neither a document's own font nor an
 * installed one carries a word ([ADR-0172](../../docs/DECISIONS/0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md)).
 *
 * ## One pinned commit, every file by digest, never committed
 *
 * Every face is read from `google/fonts` at one commit, through `raw.githubusercontent.com` with the commit in the
 * path, so the URL names an immutable tree. Each file is pinned by SHA-256 and by size, read 2026-10-05 from the bytes
 * that commit served; `downloadVerified` refuses a host, a size or a digest that differs. The folder is checked as a
 * WHOLE tree (`pinnedTree.mjs`): a font that is in it is a font the resolver embeds, so a file the table does not name
 * is removed and the run fails, the same rule that keeps an extra DLL out of PDFium's folder. Nothing here is
 * committed: the set is 9,965,868 bytes and the commit hook refuses files over 5 MB for the same reason.
 *
 * ## The licence texts are committed, and checked offline on every run
 *
 * NOTICE renders each family's terms from `scripts/release/licences/fonts/`. Seven are that commit's own `OFL.txt`,
 * byte for byte. Tinos' folder at that commit holds none, so its copy is the SIL Open Font License 1.1 text the other
 * families carry with Tinos' own copyright line, read from its `name` table (record 0): *Copyright 2026 The Tinos
 * Project Authors (https://github.com/googlefonts/tinos)*, and record 13 names the same licence. Every copy is pinned by
 * digest, so a committed text that is not what was read is a red run rather than a notice claiming terms nobody read.
 *
 * Carlito's text declares a Reserved Font Name, "Carlito". A document Monstera writes embeds a subset under a tagged
 * name (`ABCDEF+Carlito-Regular`), which is how PDF names every embedded subset; whether that touches the reservation
 * is a licence reading this file does not make, and it is recorded for the owner.
 *
 * Usage:
 *   node scripts/provision/fonts.mjs [--force] [--check]
 */

import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { downloadVerified, fileExists, toolPath, verifyFileDigest } from '../lib/fetchVerified.mjs';
import { isMain } from '../lib/isMain.mjs';
import { treeProblems, verifyPinnedTree } from '../lib/pinnedTree.mjs';
import { formatError } from '../lib/reportError.mjs';

/** The `google/fonts` commit every face is read from, by `git ls-remote https://github.com/google/fonts HEAD`, 2026-10-05. */
export const FONTS_COMMIT = '7085eb89a950e85db5b166b7a58d414544b4140c';

const ALLOWED_HOSTS = ['raw.githubusercontent.com'];

/** The largest face below is Noto Sans Symbols 2 at 1,233,128 bytes; two megabytes stops a replaced URL early. */
const MAX_FONT_BYTES = 2 * 1024 * 1024;

/**
 * @typedef {object} BundledFont
 * @property {string} family the folder under `ofl/` at the pinned commit, and the licence file's name
 * @property {string} file the font file, as the commit names it
 * @property {string} sha256
 * @property {number} bytes
 */

/** @type {readonly BundledFont[]} */
export const BUNDLED_FONTS = [
  { family: 'arimo', file: 'Arimo[wght].ttf', sha256: 'e43898b143ec826ac8cb4034816458a7047fbe0836558de2a1f8c6223ae3e0ca', bytes: 496268 },
  { family: 'arimo', file: 'Arimo-Italic[wght].ttf', sha256: 'a80fc54fd0233c1dfe298577c4d00f5ae81d5bb83510975e473c47e699b7f4ed', bytes: 543196 },
  { family: 'tinos', file: 'Tinos-Regular.ttf', sha256: '60a0e8ef0c04dd5dd69ffe91025fa2ae5836cbd35600a82ba031977557e2cb61', bytes: 521588 },
  { family: 'tinos', file: 'Tinos-Bold.ttf', sha256: '393269dbab8899f938db19783eca5eac92eb431f7ae0ab45b8349ca895f1a06b', bytes: 597880 },
  { family: 'tinos', file: 'Tinos-Italic.ttf', sha256: '5942266ed398b155d7dc23e36833e7ec6be988f2439bdbeb8ef1bede808eaa91', bytes: 565016 },
  { family: 'tinos', file: 'Tinos-BoldItalic.ttf', sha256: 'a5de79f0fe863ea0954757acb3d47b3ccd0a930ce3dd5b97230cd3866790a06e', bytes: 578976 },
  { family: 'cousine', file: 'Cousine-Regular.ttf', sha256: '1da22250675fc4c42fcf3a9736c44bc0570516105331443b663fd5cfbd1412fe', bytes: 296856 },
  { family: 'cousine', file: 'Cousine-Bold.ttf', sha256: '17c8a7245156d2253531c9e529474937b09d9f641c5ae7695c5e33f22822eef4', bytes: 298048 },
  { family: 'cousine', file: 'Cousine-Italic.ttf', sha256: 'ea2a76ae3d0ece9cd59f0d30fdc08dd70e8f5f457beee5b0852a7b50c2286c7c', bytes: 306880 },
  { family: 'cousine', file: 'Cousine-BoldItalic.ttf', sha256: '848e858726fee0ae27b754e4cd6a2755209bf1428a8c91f747696d58c33906c3', bytes: 308292 },
  { family: 'carlito', file: 'Carlito-Regular.ttf', sha256: 'f6418f708baede9789daef5d458c0f53d2a888af9820e8062934e504fedc6595', bytes: 628032 },
  { family: 'carlito', file: 'Carlito-Bold.ttf', sha256: 'bb5d20f79b82599ec72983597437373a80f2d2085fa91fc144fd74e876a594db', bytes: 682468 },
  { family: 'carlito', file: 'Carlito-Italic.ttf', sha256: '0b019225e58d702bfedcbd35c21696769f8ee115cb6343f84c2f240312450d1c', bytes: 615236 },
  { family: 'carlito', file: 'Carlito-BoldItalic.ttf', sha256: 'b32928186c119599e03ca6a1ffc680fdcb7fac95772f4b95d989cf6cd3861517', bytes: 808508 },
  { family: 'caladea', file: 'Caladea-Regular.ttf', sha256: 'f1e899278b7b4491aba5b6a8253c4b04c050cc59b21865be5c37559a775153cd', bytes: 81600 },
  { family: 'caladea', file: 'Caladea-Bold.ttf', sha256: 'ae3cb2dcbc925809dd29d2a44e9802211cab66be541bacbfc9c08c74b27c3742', bytes: 84492 },
  { family: 'caladea', file: 'Caladea-Italic.ttf', sha256: '4359a8e24f748b6447b1ff6d7a174febe70961d29f8bb8634b56dacd740a3deb', bytes: 83780 },
  { family: 'caladea', file: 'Caladea-BoldItalic.ttf', sha256: 'ccabaa7b7e2fdf253d2b1a5fa699dd8a3df8d835a9eb285ad82631a677eb76c0', bytes: 83356 },
  { family: 'notosansarabic', file: 'NotoSansArabic[wdth,wght].ttf', sha256: '63111b5b2e074dd48cc67692e0a2726d86ee94c1c37fe8598257b7b4e87e869e', bytes: 844676 },
  { family: 'notonaskharabic', file: 'NotoNaskhArabic[wght].ttf', sha256: '67b5a525a661b607971fbd3f96a81b89d3a768e74534fca84f18ac97e6fab72f', bytes: 307592 },
  { family: 'notosanssymbols2', file: 'NotoSansSymbols2-Regular.ttf', sha256: '7d5fb73b7ca67a6798101741f5d280a3d016a56a197afcd4199dbb57b4b82a21', bytes: 1233128 },
];

/** What the set weighs, stated so nobody adds it up; a proof requires the table to sum to it. */
export const BUNDLED_FONTS_BYTES = 9_965_868;

/**
 * Each family's committed licence text and its digest. `source` says where it was read; Tinos' is composed as the
 * header says.
 *
 * @type {Readonly<Record<string, { readonly sha256: string, readonly source: string }>>}
 */
export const FONT_LICENCES = {
  arimo: { sha256: '11cce536cd2f3864d767003af5dcd739e2e15818cf2279b6175edeadd3960992', source: 'ofl/arimo/OFL.txt' },
  tinos: {
    sha256: 'b05110290d3d063280c260d5f28eabc8480cb57a30aca2f77730ecb1df10026e',
    source: "ofl/arimo/OFL.txt's licence text with Tinos-Regular.ttf's own name record 0 as its copyright line",
  },
  cousine: { sha256: 'b81c4d4dc0a9f72c9155e78187316e016e2012a8102468804173dc61468b906d', source: 'ofl/cousine/OFL.txt' },
  carlito: { sha256: '58402f82a7c332a700294988fe7554fbb0a63a8d27ccc1ee3bbc640311990a00', source: 'ofl/carlito/OFL.txt' },
  caladea: { sha256: 'ccdab61d371d8c8683a128a92cd7d498dbdb1d37689f7cb21f1bf6b16658d213', source: 'ofl/caladea/OFL.txt' },
  notosansarabic: { sha256: '07fc70bfeb985cc1a87a8587d0a0c80bab11c86c9dc3fd95b6f0cb332f983e96', source: 'ofl/notosansarabic/OFL.txt' },
  notonaskharabic: { sha256: 'a7a5a25eb188bf1cd96982030d53e23c33485c69b1044a562254226857ee13af', source: 'ofl/notonaskharabic/OFL.txt' },
  notosanssymbols2: { sha256: 'b118dd41337806a5d4797052c77caf3bd096aed783e5eb21b4d11154351e1ac0', source: 'ofl/notosanssymbols2/OFL.txt' },
};

/** Every file in the folder and its digest, as `pinnedTree.mjs` checks a whole tree. */
export const BUNDLED_FONT_PINS = Object.fromEntries(BUNDLED_FONTS.map((font) => [font.file, font.sha256]));

/** @param {string} root the repository root */
export function fontsDirectory(root) {
  return toolPath(root, 'fonts', FONTS_COMMIT.slice(0, 12));
}

/** @param {string} root the repository root */
export function fontLicenceRoot(root) {
  return join(root, 'scripts', 'release', 'licences', 'fonts');
}

/** @param {BundledFont} font */
function urlOf(font) {
  return `https://raw.githubusercontent.com/google/fonts/${FONTS_COMMIT}/ofl/${font.family}/${encodeURIComponent(font.file)}`;
}

/** @param {string} root */
async function verifyLicences(root) {
  for (const [family, licence] of Object.entries(FONT_LICENCES)) {
    await verifyFileDigest({
      path: join(fontLicenceRoot(root), `${family}.txt`),
      sha256: licence.sha256,
      context: `the committed licence text for ${family} (read from google/fonts ${FONTS_COMMIT.slice(0, 12)}: ${licence.source})`,
    });
  }
}

/**
 * Provisions the set, or verifies the one already there.
 *
 * @param {{ root: string, force?: boolean }} options
 * @returns {Promise<{ provisioned: boolean, directory: string }>}
 */
export async function provisionFonts({ root, force = false }) {
  await verifyLicences(root);
  const directory = fontsDirectory(root);
  if (!force && (await fileExists(join(directory, BUNDLED_FONTS[0]?.file ?? '')))) {
    await verifyPinnedTree({ directory, pins: BUNDLED_FONT_PINS, context: `the bundled fonts at google/fonts ${FONTS_COMMIT.slice(0, 12)}` });
    return { provisioned: false, directory };
  }
  // Staged and published by rename, `pdfium.mjs`' shape and its reason: two processes provisioning at once must never
  // leave a half-filled folder that the early return above would accept.
  const staging = `${directory}.staging-${String(process.pid)}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    for (const font of BUNDLED_FONTS) {
      await downloadVerified({
        url: urlOf(font),
        allowedHosts: ALLOWED_HOSTS,
        sha256: font.sha256,
        maxBytes: MAX_FONT_BYTES,
        destination: join(staging, font.file),
      });
    }
    await verifyPinnedTree({ directory: staging, pins: BUNDLED_FONT_PINS, context: 'the bundled fonts just fetched' });
    await rm(directory, { recursive: true, force: true });
    await mkdir(dirname(directory), { recursive: true });
    await rename(staging, directory);
    return { provisioned: true, directory };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  try {
    if (process.argv.includes('--check')) {
      // A CHECK REPORTS and never provisions or repairs, `pdfium.mjs`' rule.
      await verifyLicences(root);
      const problems = await treeProblems(fontsDirectory(root), BUNDLED_FONT_PINS).catch(() => ['missing']);
      process.stdout.write(
        problems.length === 0
          ? `Bundled fonts present at ${fontsDirectory(root)}, as pinned\n`
          : `Bundled fonts are NOT as pinned:\n  ${problems.join('\n  ')}\nRun: node scripts/provision/fonts.mjs\n`,
      );
      process.exit(problems.length === 0 ? 0 : 1);
    }
    const result = await provisionFonts({ root, force: process.argv.includes('--force') });
    process.stdout.write(
      `${result.provisioned ? 'Bundled fonts provisioned' : 'Bundled fonts already present and verified'} at ` +
        `${result.directory} (${String(BUNDLED_FONTS.length)} files, ${String(BUNDLED_FONTS_BYTES)} bytes)\n`,
    );
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    process.exit(1);
  }
}
