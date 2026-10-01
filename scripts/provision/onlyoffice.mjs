// @ts-check
/**
 * Provisions ONLYOFFICE's `x2t.exe` for Office import
 * ([ADR-0120](../../docs/DECISIONS/0120-office-import-is-onlyoffices-x2t-contained.md)).
 *
 * ## What is provisioned
 *
 * Document Builder 9.4.0's archive — the owner's choice over Desktop Editors', 82 MB against 599 MB for the same
 * `x2t` — pinned by the SHA-256 GitHub's release API gives. ONLYOFFICE publishes no signature for it, so the digest
 * is its whole verification. The tree is what `x2t` loads and nothing of Document Builder's own scripting:
 *
 * - **Every DLL stays.** Measured 2026-09-29 by removing each in turn: `x2t` exits `0xC0000135`
 *   (`STATUS_DLL_NOT_FOUND`) without any one of them, so all twenty are in its import table — including the
 *   readers for formats this feature never converts.
 * - **Removed:** `docbuilder.*`, the spelling `dictionaries/`, the C `include/` headers, `doctrenderer.lib` and the
 *   `empty/` templates. The three conversions read back whole without them.
 *
 * ## The font cache is generated here, BUNDLED FONTS ONLY, and made location-independent
 *
 * `x2t` refuses to convert without a cache (exit 80). Document Builder writes one on start, and by default indexes
 * the machine's fonts; started with `--fonts-system=false` it indexes the tree's own eleven. So it is started once
 * here, on a script that makes nothing, and then removed. {@link bundledOnly} refuses a cache naming any file
 * outside the tree's `fonts/`, so a machine font cannot reach the pins in silence.
 *
 * **The cache records absolute paths**, which would tie it to wherever this run staged the tree. Measured
 * 2026-09-29: the same cache with each path made relative to the tree converts from the tree as its working
 * directory — which is what the converter seam gives every converter — and embeds Carlito; with the tree's
 * `fonts/` moved away, the same relative cache fails the conversion (exit 80). So {@link relativeFontCache}
 * rewrites the paths, and the cache is pinned like every other file, wherever the tree lives.
 *
 * ## Licences
 *
 * ONLYOFFICE core is AGPL-3.0. Its third-party components are the ones its own `3DPARTY.md` declares at the tag
 * the shipped `x2t.exe` names (9.4.0.130, read from its strings) — that file is fetched pinned here and every
 * name in it must be a component in `nativeComponents.json`, so the declaration and the notice cannot drift apart.
 * The texts those rows link sit on moving branches, so they were read once (2026-09-29) and committed, and each
 * committed copy is checked against the digest recorded below. The four font licences travel in the archive and
 * are compared with the committed copies byte for byte.
 *
 * Usage:
 *   node scripts/provision/onlyoffice.mjs [--force] [--check]
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extract } from '../lib/extract.mjs';
import { downloadVerified, fileExists, toolPath } from '../lib/fetchVerified.mjs';
import { filesUnder, treeProblems, verifyPinnedTree } from '../lib/pinnedTree.mjs';
import { formatError } from '../lib/reportError.mjs';
import { normaliseLayout } from '../release/generateNotice.mjs';
import { sameAsCommitted } from './condaForge.mjs';
import { isMain } from '../lib/isMain.mjs';

export const ONLYOFFICE_VERSION = '9.4.0';

/** The build the shipped `x2t.exe` names in its own strings, and the core tag its licences are read at. */
export const ONLYOFFICE_BUILD = '9.4.0.130';

export const ONLYOFFICE_ARCHIVE = {
  url: `https://github.com/ONLYOFFICE/DocumentBuilder/releases/download/v${ONLYOFFICE_VERSION}/onlyoffice-documentbuilder-windows-x64.zip`,
  name: 'onlyoffice-documentbuilder-windows-x64.zip',
  sha256: '5b509f6d36c810848ffad1e7c8860b36abf05ac757df66a7691ac4c7d3e488e2',
  bytes: 81_782_152,
};

const ALLOWED_HOSTS = ['github.com', 'release-assets.githubusercontent.com'];

/** Core's own texts at the build's tag: its licence, rendered, and its third-party declaration, checked. */
const CORE_TEXTS = {
  licence: {
    url: `https://raw.githubusercontent.com/ONLYOFFICE/core/v${ONLYOFFICE_BUILD}/LICENSE`,
    sha256: '3a9b4b6ab698d668dcedcda1c2da598f4ca9789a0d8b4aefb90e00e2cb425040',
    into: 'onlyoffice/LICENSE.txt',
  },
  declaration: {
    url: `https://raw.githubusercontent.com/ONLYOFFICE/core/v${ONLYOFFICE_BUILD}/3DPARTY.md`,
    sha256: '9ee4ef08abca2bb524ad41da2f79b605b5e755f7f68e24b61888dad0fb08c822',
  },
};

/**
 * Each third-party text as `3DPARTY.md` links it, and the digest of what that link served on 2026-09-29. The
 * links name branches, not tags, so they are not fetched again: the committed copy is the record, and this is
 * what keeps it the text that was read.
 *
 * THE DIGEST IS OF THE TEXT WITH ITS LAYOUT NORMALISED, the notice's own rule (`normaliseLayout`): two of these
 * were served with CRLF, which git commits as LF, and x265's carries the GNU page breaks, which this repository's
 * guard refuses to commit — so a digest of the served bytes would fail every fresh checkout, or could never be
 * committed, while the terms were unchanged.
 */
export const THIRD_PARTY_TEXTS = {
  boost: { url: 'https://raw.githubusercontent.com/boostorg/boost/master/LICENSE_1_0.txt', sha256: 'c9bff75738922193e67fa726fa225535870d2aa1059f91452c411736284ad566' },
  icu: { url: 'https://raw.githubusercontent.com/unicode-org/icu/main/LICENSE', sha256: 'e09827667e0bb3c808b2a463548ba814a5e6249b67353234d70c8dfc2bcc417d' },
  freetype: { url: 'https://raw.githubusercontent.com/freetype/freetype/master/docs/FTL.TXT', sha256: '5a5ee54c5001bbad1cdc1a57cc3dd4c42199b2da09d39c7ee41fab002d02967f' },
  harfbuzz: { url: 'https://raw.githubusercontent.com/harfbuzz/harfbuzz/main/COPYING', sha256: 'ba8f810f2455c2f08e2d56bb49b72f37fcf68f1f4fade38977cfd7372050ad64' },
  hyphen: { url: 'https://raw.githubusercontent.com/hunspell/hyphen/master/COPYING', sha256: '706294d8b12dd1b11d229f0d8e2a869e20f1622c8bacd18efb62f999e56e65e9' },
  hunspell: { url: 'https://raw.githubusercontent.com/hunspell/hunspell/master/COPYING.MPL', sha256: '53692a2ed6c6a2c6ec9b32dd0b820dfae91e0a1fcdf625ca9ed0bdf8705fcc4f' },
  gumbo: { url: 'https://raw.githubusercontent.com/google/gumbo-parser/master/COPYING', sha256: 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4' },
  katana: { url: 'https://raw.githubusercontent.com/jasenhuang/katana-parser/master/LICENSE', sha256: 'ec400e80cb6f41880c97723d722cfcba44273918f488db567f94c1262776beb7' },
  cximage: { url: 'https://raw.githubusercontent.com/movableink/cximage/master/license.txt', sha256: '1af63d984d83cb995e84bf633396ddc044bb4d0a251710164ad68e4b80a6886a' },
  openjpeg: { url: 'https://raw.githubusercontent.com/uclouvain/openjpeg/master/LICENSE', sha256: 'a6af136f3e15038a666b61f376612a07d9a4e48cb7c01adbf3e33b3f14ab49b6' },
  'socket.io-client-cpp': { url: 'https://raw.githubusercontent.com/socketio/socket.io-client-cpp/master/LICENSE', sha256: '4d0c9045a592ece85e8d1decbe5282d51164bb9b23b4a33309623e2542389b26' },
  curl: { url: 'https://raw.githubusercontent.com/curl/curl/master/COPYING', sha256: '82f2f4427d6545ee5aaac4f0b80428da6cc8ba41c2cf5da3a03680ec327b9681' },
  cryptopp: { url: 'https://raw.githubusercontent.com/weidai11/cryptopp/master/License.txt', sha256: '9f3af322ff503edfa605f8559a704b6e2f0ea78227841917a3729ec0fbeb42f4' },
  openssl: { url: 'https://raw.githubusercontent.com/openssl/openssl/master/LICENSE.txt', sha256: '7d5450cb2d142651b8afa315b5f238efc805dad827d91ba367d8516bc9d49e7a' },
  v8: { url: 'https://raw.githubusercontent.com/v8/v8/main/LICENSE', sha256: '6ab33af8774a0f396ee3aeeb761e3229057682d6f9fa7f572e390c2cb3a6e509' },
  googletest: { url: 'https://raw.githubusercontent.com/google/googletest/refs/heads/main/LICENSE', sha256: '9702de7e4117a8e2b20dafab11ffda58c198aede066406496bef670d40a22138' },
  glm: { url: 'https://raw.githubusercontent.com/g-truc/glm/refs/heads/master/copying.txt', sha256: '62d2d642c7d054d4fb4c9b42faad617d6c88fcd91e317f8035aa9f277cc159c3' },
  mdds: { url: 'https://raw.githubusercontent.com/kohei-us/mdds/refs/heads/master/LICENSES/MIT.txt', sha256: 'b05785f9f18e6716bab63424b11454513b9943a222595b70411009202fc592b5' },
  librevenge: { url: 'https://raw.githubusercontent.com/Distrotech/librevenge/refs/heads/distrotech-librevenge/COPYING.MPL', sha256: 'fab3dd6bdab226f1c08630b1dd917e11fcb4ec5e1e020e2c16f83a0a13863e85' },
  libodfgen: { url: 'https://raw.githubusercontent.com/Distrotech/libodfgen/refs/heads/master/COPYING.MPL', sha256: 'fab3dd6bdab226f1c08630b1dd917e11fcb4ec5e1e020e2c16f83a0a13863e85' },
  libetonyek: { url: 'https://raw.githubusercontent.com/LibreOffice/libetonyek/refs/heads/master/COPYING', sha256: 'fab3dd6bdab226f1c08630b1dd917e11fcb4ec5e1e020e2c16f83a0a13863e85' },
  md4c: { url: 'https://raw.githubusercontent.com/mity/md4c/refs/heads/master/LICENSE.md', sha256: 'e547c9a66c120b19f9838a1f7c2f51137f5c71ba27b70c3611b673f2cdb4e02e' },
  libheif: { url: 'https://raw.githubusercontent.com/strukturag/libheif/refs/heads/master/COPYING', sha256: 'fa81ce652315b013359d6e8e4744335f31a50c7c192907176d3632f78a3b4596' },
  libde265: { url: 'https://raw.githubusercontent.com/strukturag/libde265/refs/heads/master/COPYING', sha256: '02cc1585a20677992e0ba578fa692635dc193735f2691dc81de924b51c4e8020' },
  x265: { url: 'https://bitbucket.org/multicoreware/x265_git/raw/cfee9638c82b655c5887cedbdf1aa856f81b906a/COPYING', sha256: '1dd4b927dde31c605545dca483ca1a8d9b47fab5dce981f4027e53afa0238b85' },
  pole: { url: 'https://raw.githubusercontent.com/otofoto/Pole/master/pole/LICENSE', sha256: '65cd8e7cce255f865c6f95798f7ca1c9af548950cee016e303da95ee05b9a258' },
};

/** The four font licences the archive carries, by where it carries them and where the notice's copy is. */
const FONT_TEXTS = [
  { inArchive: 'fonts/crosextra/LICENSE.txt', into: 'carlito/LICENSE.txt' },
  { inArchive: 'fonts/caladea/LICENSE.txt', into: 'caladea/LICENSE.txt' },
  { inArchive: 'fonts/asana/LICENSE.txt', into: 'asana/LICENSE.txt' },
  { inArchive: 'fonts/openoffice/LICENSE.txt', into: 'opensymbol/LICENSE.txt' },
];

/**
 * What the archive holds that `x2t` does not load, removed before the tree is pinned. Each must be present: a name
 * that matches nothing is a subset that silently stopped removing it.
 */
export const ONLYOFFICE_EXCLUDED = Object.freeze([
  'docbuilder.c.dll',
  'docbuilder.com.dll',
  'docbuilder.exe',
  'docbuilder.jar',
  'docbuilder.jni.dll',
  'docbuilder.net.dll',
  'docbuilder.py',
  'doctrenderer.lib',
  'dictionaries',
  'include',
  'empty',
  // Document Builder's log of the cache it just wrote.
  'sdkjs/common/fonts.log',
]);

/** Where the two cache files are, under the tree. */
const FONT_CACHE = { script: 'sdkjs/common/AllFonts.js', selection: 'sdkjs/common/font_selection.bin' };

const PINS_PATH = join(dirname(fileURLToPath(import.meta.url)), 'onlyofficePins.json');

/**
 * Every file of the provisioned tree by its path under the tree, read from a tree this script extracted from the
 * verified archive (`pinnedTree.mjs`' `pinsOf`), never from one found on disk.
 *
 * @returns {Readonly<Record<string, string>>}
 */
export function onlyofficePins() {
  /** @type {Record<string, string>} */
  const pins = JSON.parse(readFileSync(PINS_PATH, 'utf8'));
  return pins;
}

/** @param {string} root */
export function onlyofficeRoot(root) {
  return toolPath(root, 'onlyoffice', ONLYOFFICE_VERSION);
}

/** @param {string} root */
export function x2tPath(root) {
  return join(onlyofficeRoot(root), 'x2t.exe');
}

/** @param {string} root */
export function onlyofficeLicenceRoot(root) {
  return join(root, 'scripts', 'release', 'licences', 'onlyoffice');
}

/**
 * The component names `3DPARTY.md` declares, in order: its `- name ([licence](url))` rows.
 *
 * @param {string} markdown
 * @returns {string[]}
 */
export function declaredThirdParty(markdown) {
  const names = [...markdown.matchAll(/^- ([^([]+?) ?\(\[/gmu)].map((row) => (row[1] ?? '').trim());
  // AN EMPTY LIST IS A BROKEN PARSE, never a clean declaration.
  if (names.length === 0) throw new Error('3DPARTY.md declared no component; the row pattern no longer matches it');
  return names;
}

/**
 * Throws unless every path the cache names is a font file under `fontsDirectory`, and every font file there is
 * named — so a cache built over the machine's fonts, or over none, is refused.
 *
 * @param {string} script `AllFonts.js` as Document Builder wrote it
 * @param {string} fontsDirectory
 * @param {readonly string[]} fontFiles the tree's font files, relative to `fontsDirectory`, forward slashes
 */
export function bundledOnly(script, fontsDirectory, fontFiles) {
  const listed = fontsNamedIn(script);
  const prefix = `${fontsDirectory.replaceAll('\\', '/')}/`;
  const outside = listed.filter((path) => !path.startsWith(prefix));
  if (outside.length > 0) {
    throw new Error(`the font cache names ${String(outside.length)} font(s) outside the tree, first ${String(outside[0])}`);
  }
  const named = new Set(listed.map((path) => path.slice(prefix.length)));
  const missing = fontFiles.filter((file) => !named.has(file));
  if (missing.length > 0 || named.size !== fontFiles.length) {
    throw new Error(`the font cache does not name exactly the tree's fonts: missing ${missing.join(', ') || 'none'}`);
  }
}

/**
 * The font file paths `AllFonts.js` lists in `window["__fonts_files"]`.
 *
 * @param {string} script
 * @returns {string[]}
 */
function fontsNamedIn(script) {
  const block = /window\["__fonts_files"\] = (\[[^\]]*\]);/u.exec(script);
  if (block === null) throw new Error('AllFonts.js carries no __fonts_files list');
  /** @type {unknown} */
  const parsed = JSON.parse(block[1] ?? '[]');
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((entry) => typeof entry === 'string')) {
    throw new Error('AllFonts.js lists no font files');
  }
  return /** @type {string[]} */ (parsed);
}

/**
 * The cache with `tree` — as Document Builder spelt it — replaced by `.` in every font path, so it holds for the
 * tree wherever it is.
 *
 * ## THREE copies of each path, and all three are rewritten
 *
 * `AllFonts.js` lists the files in `__fonts_files`; `font_selection.bin` holds one record per face; and
 * `AllFonts.js` carries that `.bin` again, base64-encoded, as `g_fonts_selection_bin` — the copy the scripts `x2t`
 * runs read. A rewrite of two of the three leaves the third naming the staging directory.
 *
 * ## The `.bin`'s faces are PARSED, not searched
 *
 * A 32-bit little-endian face count, then per face a 32-bit record length that counts itself, in which the path is a
 * 32-bit length and its bytes. A path is the one string in its record that begins with the tree. Changing a path
 * changes its record's length, so both lengths are rewritten, and the embedded copy must equal the faces exactly —
 * a layout this does not understand fails here rather than writing a cache that sends `x2t` somewhere else.
 *
 * ## A path that does not resolve is not an error `x2t` reports
 *
 * Measured 2026-09-29 with the cache left naming a directory that no longer existed: all three conversions exited
 * 0 and the `.docx` embedded a Carlito program of 30,632 bytes in a 31,812-byte PDF, where the resolved cache gives
 * 30,836 in 53,300. WHICH file that Carlito came from was not established — this machine's `C:\Windows\Fonts` holds
 * one byte-identical to the bundled copy, and the container can read that directory. So a wrong rewrite would not
 * fail; it would convert differently, in silence. That is why this parses rather than searches.
 *
 * @param {{ script: string, selection: Uint8Array, tree: string, fonts: number }} cache
 * @returns {{ script: string, selection: Uint8Array }}
 */
export function relativeFontCache({ script, selection, tree, fonts }) {
  const forward = tree.replaceAll('\\', '/');
  const inScript = script.split(`"${forward}/`).length - 1;
  if (inScript !== fonts) {
    throw new Error(`AllFonts.js names the tree ${String(inScript)} time(s) for ${String(fonts)} font(s)`);
  }

  const bytes = Buffer.from(selection);
  const embedded = /window\["g_fonts_selection_bin"\] = "([A-Za-z0-9+/=]*)";/u.exec(script);
  if (embedded === null) throw new Error('AllFonts.js carries no g_fonts_selection_bin');

  const needle = Buffer.from(tree, 'latin1');
  const faces = bytes.readInt32LE(0);
  /** @type {Buffer[]} */
  const out = [bytes.subarray(0, 4)];
  let at = 4;
  for (let face = 0; face < faces; face += 1) {
    if (at + 4 > bytes.length) throw new Error(`font_selection.bin ends before face ${String(face + 1)} of ${String(faces)}`);
    // THE RECORD LENGTH COUNTS ITS OWN FOUR BYTES: face 1 at offset 4 declares 246, and face 2's length is at 250.
    const recordLength = bytes.readInt32LE(at);
    const record = bytes.subarray(at + 4, at + recordLength);
    if (recordLength < 8 || record.length !== recordLength - 4) {
      throw new Error(`face ${String(face + 1)}'s record length ${String(recordLength)} does not fit the file`);
    }
    const start = record.indexOf(needle);
    if (start < 4 || record.indexOf(needle, start + 1) !== -1) {
      throw new Error(`face ${String(face + 1)}'s record does not name the tree exactly once after a length`);
    }
    const pathLength = record.readInt32LE(start - 4);
    const path = record.subarray(start, start + pathLength).toString('latin1');
    if (start + pathLength > record.length || path.includes('\0')) {
      throw new Error(`face ${String(face + 1)}'s path length ${String(pathLength)} does not bound a path`);
    }
    const replaced = Buffer.from(`.${path.slice(tree.length)}`, 'latin1');
    const newPathLength = Buffer.alloc(4);
    newPathLength.writeInt32LE(replaced.length);
    const rebuilt = Buffer.concat([
      record.subarray(0, start - 4),
      newPathLength,
      replaced,
      record.subarray(start + pathLength),
    ]);
    const newRecordLength = Buffer.alloc(4);
    newRecordLength.writeInt32LE(rebuilt.length + 4);
    out.push(newRecordLength, rebuilt);
    at += recordLength;
  }
  // A FACE IS AN ENTRY, so a collection file can be named more than once; fewer faces than files is the broken case.
  if (faces < fonts) throw new Error(`font_selection.bin has ${String(faces)} face(s) for ${String(fonts)} font file(s)`);
  // THE EMBEDDED COPY IS THE FACES AND NOTHING AFTER THEM, measured: what follows in the file is a table of
  // character ranges by family name, which names no file.
  if (!Buffer.from(embedded[1] ?? '', 'base64').equals(bytes.subarray(0, at))) {
    throw new Error("AllFonts.js embeds a font selection that is not font_selection.bin's faces");
  }
  const rest = bytes.subarray(at);
  if (rest.includes(needle)) throw new Error('font_selection.bin names the tree after its faces');

  const facesRewritten = Buffer.concat(out);
  const rewritten = Buffer.concat([facesRewritten, rest]);
  const rewrittenScript = script
    .replaceAll(`"${forward}/`, '"./')
    .replace(embedded[0], `window["g_fonts_selection_bin"] = "${facesRewritten.toString('base64')}";`);
  if (rewrittenScript.includes(forward) || rewritten.includes(needle)) {
    throw new Error('the font cache still names the tree after the rewrite');
  }
  return { script: rewrittenScript, selection: new Uint8Array(rewritten) };
}

/**
 * Downloads, verifies and extracts the archive into `staging/tree`, generates and rewrites the font cache, removes
 * what `x2t` does not load, and checks every licence — everything but the pins and the publish.
 *
 * @param {{ root: string, staging: string }} options
 * @returns {Promise<string>} the staged tree
 */
export async function stageOnlyOffice({ root, staging }) {
  const tree = join(staging, 'tree');
  await mkdir(tree, { recursive: true });
  const licences = onlyofficeLicenceRoot(root);

  await downloadVerified({
    url: ONLYOFFICE_ARCHIVE.url,
    allowedHosts: ALLOWED_HOSTS,
    sha256: ONLYOFFICE_ARCHIVE.sha256,
    maxBytes: ONLYOFFICE_ARCHIVE.bytes + 1024 * 1024,
    destination: join(tree, ONLYOFFICE_ARCHIVE.name),
  });
  extract(tree, ONLYOFFICE_ARCHIVE.name);
  await rm(join(tree, ONLYOFFICE_ARCHIVE.name), { force: true });
  if (!(await fileExists(join(tree, 'x2t.exe')))) throw new Error(`${ONLYOFFICE_ARCHIVE.name} did not contain x2t.exe`);

  const texts = join(staging, 'texts');
  await downloadVerified({
    url: CORE_TEXTS.licence.url,
    allowedHosts: ['raw.githubusercontent.com'],
    sha256: CORE_TEXTS.licence.sha256,
    maxBytes: 64 * 1024,
    destination: join(texts, 'LICENSE'),
  });
  await sameAsCommitted(licences, join(texts, 'LICENSE'), CORE_TEXTS.licence.into);
  await downloadVerified({
    url: CORE_TEXTS.declaration.url,
    allowedHosts: ['raw.githubusercontent.com'],
    sha256: CORE_TEXTS.declaration.sha256,
    maxBytes: 64 * 1024,
    destination: join(texts, '3DPARTY.md'),
  });
  const declared = declaredThirdParty(await readFile(join(texts, '3DPARTY.md'), 'utf8'));
  const recorded = Object.keys(THIRD_PARTY_TEXTS);
  const unrecorded = declared.filter((name) => !recorded.includes(name));
  const undeclared = recorded.filter((name) => !declared.includes(name));
  if (unrecorded.length > 0 || undeclared.length > 0) {
    throw new Error(
      `3DPARTY.md at ${ONLYOFFICE_BUILD} and THIRD_PARTY_TEXTS differ: declared and not recorded ` +
        `${unrecorded.join(', ') || 'none'}; recorded and not declared ${undeclared.join(', ') || 'none'}`,
    );
  }
  for (const [name, text] of Object.entries(THIRD_PARTY_TEXTS)) {
    const committed = join(licences, name, 'LICENSE.txt');
    const actual = existsSync(committed)
      ? createHash('sha256').update(normaliseLayout(await readFile(committed, 'utf8')), 'utf8').digest('hex')
      : 'missing';
    if (actual !== text.sha256) {
      throw new Error(`the committed licence text for ${name} is not the one read from ${text.url} (${actual})`);
    }
  }
  for (const font of FONT_TEXTS) await sameAsCommitted(licences, join(tree, font.inArchive), font.into);

  await generateFontCache(staging, tree);

  for (const excluded of ONLYOFFICE_EXCLUDED) {
    const path = join(tree, excluded);
    if (!existsSync(path)) throw new Error(`the subset excludes ${excluded}, and the extracted tree has no such path`);
    await rm(path, { recursive: true, force: true });
  }
  await rm(texts, { recursive: true, force: true });
  return tree;
}

/**
 * Starts Document Builder once over its own fonts only, checks the cache it wrote names exactly them, and rewrites
 * it to hold wherever the tree is published.
 *
 * @param {string} staging
 * @param {string} tree
 */
async function generateFontCache(staging, tree) {
  const work = join(staging, 'fontcache');
  await mkdir(work, { recursive: true });
  // A SCRIPT THAT MAKES NOTHING: the cache is written as Document Builder starts, and nothing it builds is kept.
  await writeFile(join(work, 'nothing.docbuilder'), 'builder.SetTmpFolder("tmp");\nbuilder.CreateFile("docx");\nbuilder.CloseFile();\n');
  const run = spawnSync(join(tree, 'docbuilder.exe'), ['--fonts-system=false', 'nothing.docbuilder'], {
    cwd: work,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (run.error !== undefined) throw new Error(`docbuilder.exe could not run: ${run.error.message}`);
  const scriptPath = join(tree, FONT_CACHE.script);
  const selectionPath = join(tree, FONT_CACHE.selection);
  if (!existsSync(scriptPath) || !existsSync(selectionPath)) {
    throw new Error(`docbuilder.exe exited ${String(run.status)} and wrote no font cache: ${(run.stdout + run.stderr).trim()}`);
  }

  const fontsDirectory = join(tree, 'fonts');
  const fontFiles = (await filesUnder(fontsDirectory)).filter((file) => /\.(?:ttf|ttc|otf)$/iu.test(file));
  const script = await readFile(scriptPath, 'utf8');
  bundledOnly(script, fontsDirectory, fontFiles);
  const rewritten = relativeFontCache({
    script,
    selection: await readFile(selectionPath),
    tree,
    fonts: fontFiles.length,
  });
  await writeFile(scriptPath, rewritten.script);
  await writeFile(selectionPath, rewritten.selection);
  await rm(work, { recursive: true, force: true });
}

/**
 * @param {{ root: string, force?: boolean }} options
 * @returns {Promise<{ provisioned: boolean, executable: string }>}
 */
export async function provisionOnlyOffice({ root, force = false }) {
  const executable = x2tPath(root);
  if (!force && (await fileExists(executable))) {
    // PRESENT IS NOT PINNED (`pinnedTree.mjs`): every file of the tree is checked, and no other may be there.
    await verifyPinnedTree({ directory: onlyofficeRoot(root), pins: onlyofficePins(), context: `ONLYOFFICE ${ONLYOFFICE_VERSION}` });
    return { provisioned: false, executable };
  }

  const versionDirectory = onlyofficeRoot(root);
  const staging = `${versionDirectory}.staging-${String(process.pid)}`;
  await rm(staging, { recursive: true, force: true });
  try {
    process.stderr.write(`Provisioning ONLYOFFICE x2t ${ONLYOFFICE_BUILD} (Document Builder ${ONLYOFFICE_VERSION})…\n`);
    const tree = await stageOnlyOffice({ root, staging });
    // THE FRESH TREE MEETS THE SAME PINS, so a new archive or a cache that differs fails here until the table is
    // rewritten from a verified extraction.
    await verifyPinnedTree({ directory: tree, pins: onlyofficePins(), context: `the extracted ONLYOFFICE ${ONLYOFFICE_VERSION}` });
    await rm(versionDirectory, { recursive: true, force: true });
    await mkdir(dirname(versionDirectory), { recursive: true });
    await rename(tree, versionDirectory);
    return { provisioned: true, executable };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const check = process.argv.includes('--check');
  const force = process.argv.includes('--force');

  if (check) {
    const executable = x2tPath(root);
    // PRESENT AND PINNED, reported and never repaired: a check that removed a tree would be provisioning by another name.
    const problems = existsSync(executable) ? await treeProblems(onlyofficeRoot(root), onlyofficePins()) : ['missing'];
    process.stdout.write(
      problems.length === 0
        ? `ONLYOFFICE ${ONLYOFFICE_VERSION} present at ${executable}, every file as pinned\n`
        : existsSync(executable)
          ? `ONLYOFFICE ${ONLYOFFICE_VERSION} is present but NOT as pinned:\n  ${problems.join('\n  ')}\nRun: npm run provision:onlyoffice\n`
          : `ONLYOFFICE ${ONLYOFFICE_VERSION} is NOT provisioned. Run: npm run provision:onlyoffice\n`,
    );
    process.exit(problems.length === 0 ? 0 : 1);
  }

  try {
    const result = await provisionOnlyOffice({ root, force });
    process.stdout.write(
      result.provisioned
        ? `ONLYOFFICE ${ONLYOFFICE_VERSION} provisioned at ${result.executable}\n`
        : `ONLYOFFICE ${ONLYOFFICE_VERSION} already present at ${result.executable}\n`,
    );
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    process.exit(1);
  }
}
