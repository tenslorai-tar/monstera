import { access } from 'node:fs/promises';
import { join } from 'node:path';

import { OCR_LANGUAGES, type OcrLanguage } from '@monstera/contract';

import { nativeComponentPath } from './nativeComponents.js';

/**
 * Where the OCR models are, and which of them this machine has.
 *
 * `spellingDictionaries.ts`' shape, and for its reason: the question needs
 * `node:fs`, the renderer may never ask it, and a composition root that answered
 * it inline would put a filesystem read inside the graph that wires the
 * application together.
 *
 * ## THE PATH COMES FROM THE LAUNCHER, and this process never searches
 *
 * `scripts/provision/tessdata.mjs` owns *where a provisioned model lives*,
 * `scripts/` is not shipped, and `scripts/launch.mjs` is the one process that
 * knows the repository root and starts the shell — so it passes the directory
 * down as `MONSTERA_TESSDATA_DIRECTORY`, exactly as it passes PDFium's library
 * (`engineHostPlatform.ts`' `pdfiumLibraryPath`).
 *
 * A model directory reaching the engine must not be influenced by a document or
 * chosen by a renderer (ADR-0014 constraint 1), and this is the one place it is
 * decided.
 */

/** The file `scripts/provision/tessdata.mjs` writes for one language. */
function modelPath(directory: string, language: OcrLanguage): string {
  // THE `.gz` IS THE PROVISIONED FORM, not an implementation detail this file
  // chose: that is what the CDN serves and what `downloadVerified` pinned the
  // digest of, and `ocrRecognise.ts` expands it when it loads the model. A check
  // for the expanded name would report every provisioned model as missing.
  return join(directory, `${language}.traineddata.gz`);
}

/**
 * Where the provisioned models are, or `null`.
 *
 * **`null` is a build with no models** — a development launch that provisioned
 * none. A packaged build answers its `native/ocr-models` folder (ADR-0122), and
 * {@link provisionedOcrLanguages} still checks each model rather than trusting it.
 */
export function provisionedModelDirectory(): string | null {
  // THE ONE RESOLVER (ADR-0122): the launcher's variable in development — EMPTY IS ABSENT, for
  // `pdfiumLibraryPath`'s measured reason — and the package's `native/ocr-models` folder when packaged.
  return nativeComponentPath('ocr-models');
}


/**
 * Which of the fourteen languages this machine can actually recognise.
 *
 * ## Checked per model rather than assumed from the directory
 *
 * `scripts/provision/tessdata.mjs` downloads fourteen files into one directory
 * and CI provisions **`eng` alone**, so *the directory exists* and *this language
 * is available* are different facts. A surface offering all fourteen because the
 * directory is there would let a reader pick a model that then fails the
 * recognition — the wired-tools defect wearing a dropdown.
 *
 * ## An empty answer is a STATE, and the surface says so
 *
 * Not an error and not a throw: a machine with no models is the `no-key /
 * no-binary` state §10.5 requires every surface to design, and the OCR command's
 * dialog is where it is said. `settings.loadSecrets`' `available: false` is the
 * same shape one feature along.
 *
 * The order is {@link OCR_LANGUAGES}', which is the order the set is declared in
 * rather than the filesystem's — a surface listing languages must not reorder
 * itself because of the sequence a download happened to finish in.
 */
export async function provisionedOcrLanguages(): Promise<readonly OcrLanguage[]> {
  const directory = provisionedModelDirectory();
  if (directory === null) return [];

  const present = await Promise.all(
    OCR_LANGUAGES.map(async (language) => {
      try {
        await access(modelPath(directory, language));
        return language;
      } catch {
        // NOT RETHROWN, and it is the ordinary case rather than a failure:
        // thirteen of fourteen are absent on every CI run. `spellingDictionaries`
        // makes the same choice for the same reason one noun along.
        return null;
      }
    }),
  );
  return present.filter((language): language is OcrLanguage => language !== null);
}
