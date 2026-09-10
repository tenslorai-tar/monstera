// @ts-check
/**
 * Provisions the OCR language models — Stage 6's substrate.
 *
 * ## Why they are provisioned rather than fetched at run time
 *
 * `tesseract.js` downloads `<lang>.traineddata.gz` from a CDN on first use.
 * This build cannot: recognition runs inside the engine host, and invariant 25
 * gives that process **no network at all**. A model that arrived over HTTP
 * would also be a file nobody had pinned, reaching an engine whose two live
 * advisories are both reached *through a crafted model*
 * ([ADR-0014](../../docs/DECISIONS/0014-ocr-stays-inside-the-engine.md)'s
 * constraint 1: the language and datadir are OURS).
 *
 * So the models are fetched here, once, through `downloadVerified` — the one
 * download primitive (Part C8), which pins the host, the size and the digest.
 *
 * ## THE `fast` VARIANT, and it is the size arithmetic that decides
 *
 * `tessdata` publishes two builds of each model. Measured 2026-09-10 by reading
 * `Content-Length` from the CDN, for the fourteen below:
 *
 * | variant | English | all fourteen |
 * |---|---|---|
 * | `4.0.0` (standard) | 10,923,060 bytes | ~135 MB |
 * | `4.0.0_fast` | 1,984,273 bytes | **18,013,460 bytes** |
 *
 * `BUILD-PROMPT.md`'s installer target is **under 150 MB**, resized only by an
 * ADR. The standard models would take nine-tenths of it for one feature's data;
 * the fast ones take 17.2 MB. Nothing else was traded away to get that number,
 * and the accuracy cost is stated rather than assumed: a real corpus scan reads
 * at **mean confidence 94** through the fast English model
 * (`scripts/research/ocrCost.mjs`).
 *
 * ## Fourteen, where the founding record asks for "13+"
 *
 * `BUILD-PROMPT.md`:473 says *13+ languages* and names none, so the set is a
 * decision and this is where it is recorded. The seven Latin-script languages
 * are the most widely written ones this build is likely to meet; the other
 * seven are there because a language set that is Latin-only fails the documents
 * it would fail silently — Cyrillic, Arabic, Hebrew, Devanagari, Japanese,
 * Korean and Simplified Chinese each need their own model, and **two of them are
 * right-to-left**, which the supplied corpus contains an example of.
 *
 * Adding one is a row in this table, its digest, and one name in
 * `OCR_LANGUAGES`; `proof:ocrmodels` refuses a table and an enum that disagree
 * in either direction, so a language added to one and not the other is a red
 * build rather than a model nothing fetches.
 *
 * Usage:
 *   node scripts/provision/tessdata.mjs [--force] [--check]
 */

import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { downloadVerified, fileExists, toolPath, verifyFileDigest } from '../lib/fetchVerified.mjs';
import { isMain } from '../lib/isMain.mjs';

/** Where the CDN serves the pinned build from. */
const BASE = 'https://tessdata.projectnaptha.com/4.0.0_fast';

/** The one host these bytes may come from. */
const ALLOWED_HOSTS = ['tessdata.projectnaptha.com'];

/**
 * The largest model this table holds, plus room to read it.
 *
 * Not a round number chosen to be safe: the largest below is `nld` at 2,997,142
 * bytes, and a bound is what stops a redirected or replaced URL streaming
 * something else into the tool directory before the digest is checked.
 */
const MAX_MODEL_BYTES = 8 * 1024 * 1024;

/**
 * The models, pinned by digest and by size.
 *
 * Every figure read 2026-09-10 from the CDN above, and every digest computed
 * from the delivered bytes. A model whose digest moves is a model somebody
 * replaced — which for an engine whose advisories are reached through a crafted
 * `.traineddata` is the case the pin exists for.
 *
 * @type {readonly {language: string, sha256: string, bytes: number}[]}
 */
export const TESSDATA_MODELS = [
  { language: 'eng', sha256: '18c1ac52b75e35d44735fb6c2a60acfaf23033524653200738e98f0243edb75b', bytes: 1984273 },
  { language: 'spa', sha256: '8db1167a8c9bb015ac8e97278384c3b07dfa9bc8271569beea071d9e296b4487', bytes: 1137561 },
  { language: 'fra', sha256: '9800c70d1db21689e1ee91b5c81fe4c822120fa92cf5f0dab0d2b81b616fd468', bytes: 609363 },
  { language: 'deu', sha256: 'acb48fa5d63b5088b6299bda4a700d86e97bb9421253be8fc4af8ea2d8247740', bytes: 854318 },
  { language: 'por', sha256: '7b0f1749aa255a593b14160c75f74690be740edcae94c5a45efc24ab50235f4d', bytes: 1009185 },
  { language: 'ita', sha256: '8a4a1415e492f78d046dab8b8b0efa2c32bd377960ec7db8e9e7b0d28ba54d20', bytes: 1287268 },
  { language: 'nld', sha256: '4d966ff690c60dcf8421d0033a95d696f8069d6946b8668ac6e8ead2e2610518', bytes: 2997142 },
  { language: 'rus', sha256: '56703dfb466e5d3bac7a5758ab479c5c8a173eb419a146fd934d11406b4bccf3', bytes: 1622027 },
  { language: 'ara', sha256: 'cfdec92af6c72289984b03dfe5e03d25f7fee591733081aa6f40761f3f5884cf', bytes: 725639 },
  { language: 'heb', sha256: '0fc2700ff64581b9dca24ae4edd503c1d58b5cb0ba55b9dac5337a9045efc0b2', bytes: 483854 },
  { language: 'hin', sha256: '87f789843eaa8a7a75be0c34d39da51ea6db12a101d78641ce02f37075cf1ba9', bytes: 922758 },
  { language: 'jpn', sha256: 'cac936a50547d9546d48bd6d46372fd89f1ba49209b678cf23ed938092688a28', bytes: 1535471 },
  { language: 'kor', sha256: 'aae6df1bbd206053b366b0b0f00e2211637d0923e8c3c64a0cbc9edaf61a5896', bytes: 1114590 },
  { language: 'chi_sim', sha256: '3aa140069a09796b8cb8d3ccd0c052e8ed67f20cddb24b70ffa3344b3b94346b', bytes: 1730011 },
];

/** What the fourteen weigh together, stated so a reader need not add them up. */
export const TESSDATA_TOTAL_BYTES = 18_013_460;

/** Where a provisioned model lives, and what `langPath` is pointed at. */
export function tessdataDirectory(/** @type {string} */ root) {
  return toolPath(root, 'tessdata', '4.0.0_fast');
}

/** One model's path. `tesseract.js` appends `.traineddata.gz` itself. */
export function tessdataPath(/** @type {string} */ root, /** @type {string} */ language) {
  return join(tessdataDirectory(root), `${language}.traineddata.gz`);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

/**
 * Fetches every model that is absent, and verifies every model that is present.
 *
 * `--check` verifies without fetching, which is what a job that expects a warm
 * cache runs; `--force` re-fetches regardless.
 */
async function main() {
  const force = process.argv.includes('--force');
  const checkOnly = process.argv.includes('--check');
  const directory = tessdataDirectory(REPO_ROOT);
  await mkdir(directory, { recursive: true });

  let fetched = 0;
  let verified = 0;
  for (const model of TESSDATA_MODELS) {
    const destination = tessdataPath(REPO_ROOT, model.language);
    const present = await fileExists(destination);

    if (present && !force) {
      // A PRESENT FILE IS VERIFIED RATHER THAN TRUSTED. The digest is the whole
      // mechanism, and a provisioner that checked it only on the way in would
      // leave a replaced file in place for ever.
      await verifyFileDigest({
        path: destination,
        sha256: model.sha256,
        context: `the ${model.language} OCR model`,
      });
      verified += 1;
      continue;
    }
    if (checkOnly) {
      process.stderr.write(
        `\n${destination} is absent. Run \`node scripts/provision/tessdata.mjs\` — it fetches ` +
          `the pinned model and verifies it against a recorded SHA-256.\n`,
      );
      process.exitCode = 1;
      return;
    }

    await downloadVerified({
      url: `${BASE}/${model.language}.traineddata.gz`,
      allowedHosts: ALLOWED_HOSTS,
      sha256: model.sha256,
      maxBytes: MAX_MODEL_BYTES,
      destination,
    });
    fetched += 1;
  }

  process.stdout.write(
    `OCR models ready in ${directory}\n` +
      `  ${String(fetched)} fetched, ${String(verified)} already present and verified, ` +
      `${String(TESSDATA_MODELS.length)} languages, ${String(TESSDATA_TOTAL_BYTES)} bytes\n`,
  );
}

// Run only as a script, so the table above can be imported by the proof that
// ties it to `OCR_LANGUAGES` without fetching anything. Through `isMain`
// because the comparison is a URL rather than a path and writing it by hand is
// correct on POSIX and silently wrong on Windows (finding AAAA-5).
if (isMain(import.meta.url)) {
  await main();
}
