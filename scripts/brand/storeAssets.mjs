// @ts-check
/**
 * The Microsoft Store package's images, derived from the owner's mark (the 26 September list, item 9: *"Store
 * submission assets from the two logo masters — monstera_logo_no_text.png for app and tiles"*). Since 2026-10-04 there
 * is one master, `brandMaster.mjs`' (ADR-0002's note of that day), and it is the mark alone as that one was.
 *
 * ## The list is Microsoft's, read from Microsoft
 *
 * Every name and size below is from *Construct your Windows app's icon* on Microsoft Learn
 * (learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction, page dated 2026-07-27, read
 * 2026-09-27): the app-list icon at fourteen target sizes, each in its default, dark (`altform-unplated`) and light
 * (`altform-lightunplated`) form — **required**, or Windows puts the icon on a plate; the StoreLogo at five scales —
 * **required to publish**; the four tiles at five scales — the medium one at 100% required to publish, the rest used by
 * Windows 10; and the app list's own scales, optional. The splash screen and badge are left out: the page marks both
 * optional, and a desktop application draws its own first window. One image more is for the listing rather than the
 * package: its 300 px app tile icon.
 *
 * ## Built, not committed
 *
 * Seventy-three images a package and a listing need and nothing else reads. They are written into the desktop package's `dist/`,
 * which is not committed, and remade from the master on demand — the rule `generateAssets.mjs` states for the
 * committed sizes (*"committing a generated file is acceptable where regenerating it is one command"*) applied the
 * other way: here nothing needs them on disk between packagings.
 *
 * ## How the mark sits in each
 *
 * An icon is the mark itself filling its square: the master's transparent margin is trimmed and the portrait mark
 * runs the square's full height, as first-party portrait icons do (`storeImage`). A TILE is a surface Windows draws the
 * mark ON, so the master takes two thirds of the tile's shorter side and is centred, never stretched — ADR-0002 rules
 * out altering a mark. Every image keeps the master's transparency, so no background colour is invented here.
 *
 * Usage: node scripts/brand/storeAssets.mjs [output-directory]
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import { formatError } from '../lib/reportError.mjs';
import { isMain } from '../lib/isMain.mjs';
import { MASTER } from './brandMaster.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where a packaging step finds them. Inside a `dist/`, which `.gitignore` excludes. */
export const STORE_ASSETS_DIRECTORY = join(REPO_ROOT, 'apps', 'desktop', 'dist', 'store-assets');

const SCALES = [100, 125, 150, 200, 400];
const TARGET_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256];

/** A tile at one scale: the base size, and the pixels Microsoft's table gives at that scale. */
const TILES = [
  { name: 'SmallTile', width: 71, height: 71 },
  { name: 'MedTile', width: 150, height: 150 },
  { name: 'WideTile', width: 310, height: 150 },
  { name: 'LargeTile', width: 310, height: 310 },
];

/**
 * Every image, by file name: its pixel size and whether the mark fills it (an icon) or sits on it (a tile).
 *
 * @type {ReadonlyArray<{ readonly file: string, readonly width: number, readonly height: number, readonly fill: boolean }>}
 */
export const STORE_ASSETS = [
  ...TARGET_SIZES.flatMap((size) =>
    ['', '_altform-unplated', '_altform-lightunplated'].map((form) => ({
      file: `AppList.targetsize-${String(size)}${form}.png`,
      width: size,
      height: size,
      fill: true,
    })),
  ),
  ...SCALES.map((scale) => ({
    file: `AppList.scale-${String(scale)}.png`,
    width: scaled(44, scale),
    height: scaled(44, scale),
    fill: true,
  })),
  ...SCALES.map((scale) => ({
    file: `StoreLogo.scale-${String(scale)}.png`,
    width: scaled(50, scale),
    height: scaled(50, scale),
    fill: true,
  })),
  ...TILES.flatMap((tile) =>
    SCALES.map((scale) => ({
      file: `${tile.name}.scale-${String(scale)}.png`,
      width: scaled(tile.width, scale),
      height: scaled(tile.height, scale),
      fill: false,
    })),
  ),
  // THE LISTING'S 1:1 APP TILE ICON, uploaded in Partner Center rather than packaged: *"strongly recommend"* for an
  // app, and preferred by the Store over the package's image (*App screenshots, images, and trailers for MSIX app*,
  // Microsoft Learn, read 2026-09-27). Poster and box art are for games there, and screenshots come from the running
  // application, not from a master.
  { file: 'Listing.AppTileIcon-300.png', width: 300, height: 300, fill: true },
];

/**
 * A base size at a scale, as Microsoft's table rounds it: 150 at 125% is 188, 71 at 150% is 107.
 *
 * @param {number} base
 * @param {number} scale
 */
function scaled(base, scale) {
  return Math.round((base * scale) / 100);
}

/**
 * One image from the master.
 *
 * @param {Buffer} master
 * @param {{ width: number, height: number, fill: boolean }} asset
 * @returns {Promise<Buffer>}
 */
export async function storeImage(master, asset) {
  const clear = { r: 0, g: 0, b: 0, alpha: 0 };
  const side = asset.fill
    ? Math.min(asset.width, asset.height)
    : Math.round((Math.min(asset.width, asset.height) * 2) / 3);
  // AN ICON IS THE MARK ITSELF, not the master's canvas: the master is a square holding a portrait mark inside a
  // transparent margin, and fitting the canvas kept that margin — the app-list icon filled 75% of its width and 87–88%
  // of its height, and sat visibly smaller on the taskbar than Notepad's portrait page, which runs the full height
  // (measured 2026-10-01 on the owner's taskbar: about 20 of 24 pixels against 24). So for an icon the transparent
  // border is trimmed first and the mark itself is fitted, touching the square's top and bottom. Nothing of the mark is
  // altered (ADR-0002): only fully transparent rows and columns go. A TILE keeps the canvas, two thirds of its side.
  const source = asset.fill ? await sharp(master).trim().png().toBuffer() : master;
  const mark = await sharp(source).resize(side, side, { fit: 'contain', background: clear }).png().toBuffer();
  return sharp({ create: { width: asset.width, height: asset.height, channels: 4, background: clear } })
    .composite([{ input: mark, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Writes every image into `directory`.
 *
 * @param {string} directory
 * @returns {Promise<number>} how many were written
 */
export async function writeStoreAssets(directory) {
  const master = await readFile(MASTER);
  await mkdir(directory, { recursive: true });
  for (const asset of STORE_ASSETS) {
    await writeFile(join(directory, asset.file), await storeImage(master, asset));
  }
  return STORE_ASSETS.length;
}

if (isMain(import.meta.url)) {
  const directory = process.argv[2] ?? STORE_ASSETS_DIRECTORY;
  writeStoreAssets(directory).then(
    (count) => {
      process.stdout.write(`${String(count)} Store images written to ${directory}\n`);
    },
    (error) => {
      process.stderr.write(`${formatError(error)}\n`);
      process.exit(1);
    },
  );
}
