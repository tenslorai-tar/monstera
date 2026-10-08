// @ts-check
/**
 * The native components' manifest: each one's name, version and `{ path: sha256 }` for every file the application
 * runs, relative to that component's folder
 * ([ADR-0122](../../docs/DECISIONS/0122-native-components-one-resolver-a-pinned-manifest-status-and-verify.md)).
 *
 * ## FROM THE PINS, never from the files present
 *
 * Every digest here is a provisioning script's own constant — read from a tree the script had just extracted from
 * its verified archive — so the manifest certifies what was pinned, not whatever is on disk (the failure row 306
 * fixed in the development trees). One exception, and it says so: the MuPDF shim is COMPILED here and has no
 * reproducible digest, so its entry is the digest of the DLL the build produced, `pinnedFrom: 'build'`.
 *
 * The component ids and each component's folder layout are `apps/desktop/src/nativeComponents.ts`'; the packaging
 * step (item 14) copies each file to `resources/native/<id>/<path>` and this manifest beside them.
 *
 * Usage: node scripts/release/nativeManifest.mjs <out-file>
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUNDLED_FONT_PINS, FONTS_COMMIT } from '../provision/fonts.mjs';
import { GHOSTSCRIPT_BIN, GHOSTSCRIPT_VERSION } from '../provision/ghostscript.mjs';
import { MUPDF_VERSION } from '../provision/mupdf.mjs';
import { ONLYOFFICE_BUILD, onlyofficePins } from '../provision/onlyoffice.mjs';
import { PDFIUM_BIN, PDFIUM_VERSION } from '../provision/pdfium.mjs';
import { POPPLER_BIN, POPPLER_VERSION } from '../provision/poppler.mjs';
import { TESSDATA_MODELS } from '../provision/tessdata.mjs';
import { isMain } from '../lib/isMain.mjs';
import { shimPath } from '../lib/shimBinary.mjs';

/**
 * @typedef {{
 *   readonly name: string;
 *   readonly version: string;
 *   readonly pinnedFrom: 'provisioning' | 'build';
 *   readonly files: Readonly<Record<string, string>>;
 * }} ManifestComponent
 * @typedef {{ readonly manifest: 1; readonly components: Readonly<Record<string, ManifestComponent>> }} NativeManifest
 */

/**
 * The manifest for this checkout.
 *
 * @param {string} root the repository root
 * @returns {NativeManifest}
 */
export function nativeManifest(root) {
  const shim = shimPath(root);
  // A CHECKOUT THAT HAS NOT BUILT THE SHIM has no digest to record, and the component is then not in this build —
  // which the Components dialog says. The packaging step requires every one.
  const shimDigest = existsSync(shim) ? createHash('sha256').update(readFileSync(shim)).digest('hex') : null;
  return {
    manifest: 1,
    components: {
      pdfium: { name: 'PDFium', version: PDFIUM_VERSION, pinnedFrom: 'provisioning', files: PDFIUM_BIN },
      poppler: { name: 'Poppler (pdftotext)', version: POPPLER_VERSION, pinnedFrom: 'provisioning', files: POPPLER_BIN },
      ghostscript: { name: 'Ghostscript', version: GHOSTSCRIPT_VERSION, pinnedFrom: 'provisioning', files: GHOSTSCRIPT_BIN },
      onlyoffice: { name: 'ONLYOFFICE x2t', version: ONLYOFFICE_BUILD, pinnedFrom: 'provisioning', files: onlyofficePins() },
      ...(shimDigest === null
        ? {}
        : {
            'mupdf-shim': {
              name: 'MuPDF (native)',
              version: MUPDF_VERSION,
              pinnedFrom: /** @type {const} */ ('build'),
              files: { 'monstera_mupdf.dll': shimDigest },
            },
          }),
      'ocr-models': {
        name: 'Tesseract language models',
        version: '4.0.0_fast',
        pinnedFrom: 'provisioning',
        files: Object.fromEntries(TESSDATA_MODELS.map((model) => [`${model.language}.traineddata.gz`, model.sha256])),
      },
      fonts: {
        name: 'Bundled open fonts',
        version: `google/fonts ${FONTS_COMMIT.slice(0, 12)}`,
        pinnedFrom: 'provisioning',
        files: BUNDLED_FONT_PINS,
      },
    },
  };
}

if (isMain(import.meta.url)) {
  const out = process.argv[2];
  if (out === undefined) {
    process.stderr.write('Usage: node scripts/release/nativeManifest.mjs <out-file>\n');
    process.exit(2);
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  writeFileSync(out, `${JSON.stringify(nativeManifest(root), null, 2)}\n`, 'utf8');
}
