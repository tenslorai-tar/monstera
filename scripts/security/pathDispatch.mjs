// @ts-check
/**
 * Derives every MuPDF entry point that chooses an implementation from a
 * filename, and fails if shipped code names one.
 *
 * ## Why this is an invariant and not an OCR finding
 *
 * The OCR investigation established that `fz_new_document_writer` selects the
 * pdfocr writer — and therefore Tesseract, and therefore Leptonica — from a FILE
 * EXTENSION. A path ending `.ocr` runs an OCR engine with no caller naming a
 * single OCR symbol.
 *
 * The measured answer today is that no shim export reaches it
 * (`scripts/security/shimReach.mjs`). That makes the situation *currently
 * absent*, which is the weakest kind of safety: it has to be re-established
 * every time MuPDF adds a writer, and re-checked by whoever next writes an
 * export. The verdict expires on someone remembering.
 *
 * The invariant removes the class instead. **The shim names the engine entry
 * point it wants.** Wanting a PDF means calling the PDF constructor; it never
 * means handing a path to a chooser and letting the extension decide. Then no
 * filename can select a native library, a new upstream writer changes nothing
 * here, and there is no per-release recheck to forget.
 *
 * This is invariant 23, and it generalises the rule the renderer already lives
 * under — invariant 2, that a path never crosses into a position where it can
 * drive behaviour — across the native boundary, which was the one place it had
 * not been stated.
 *
 * ## What counts as a dispatcher, derived rather than listed
 *
 * `is_extension` in `source/fitz/writer.c` is MuPDF's own extension-matching
 * helper, and it is `static`, so every filename-driven selection in the engine
 * goes through that one function. The dispatchers are therefore exactly the
 * public functions that can reach it — computed on every run, so a writer added
 * upstream joins the banned set without anybody editing a list.
 *
 * A hand-written list would have been a claim of the same kind as the verdict it
 * replaces.
 *
 * Usage:
 *   node scripts/security/pathDispatch.mjs        print the dispatchers, check shipped code
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { filesInCommit, repoRoot } from '../lib/gitScope.mjs';
import { mupdfSourcePath } from '../provision/mupdf.mjs';
import { buildCallGraph, publicApiSymbols } from './ocrDoors.mjs';

/** MuPDF's own extension matcher. Static to writer.c, so it is the single seam. */
const EXTENSION_MATCHER = 'is_extension';

/** Where a call into the engine may appear. The shim is the only real one today. */
const SHIPPED_GLOBS = ['native/**', 'packages/*/src/**', 'apps/*/src/**'];

/**
 * @param {string} sourceRoot
 * @param {string} shimProject
 * @returns {{ dispatchers: string[], seeds: string[] }}
 */
export function deriveFormatDispatchers(sourceRoot, shimProject) {
  const { callers, locals, globals } = buildCallGraph(sourceRoot, shimProject);

  // The matcher is static, so it is keyed by the file that defines it. Seeding
  // by suffix rather than by a hardcoded path means a MuPDF reorganisation moves
  // the file without silently emptying the seed set.
  const seeds = [
    ...[...locals].filter((id) => id.endsWith(`::${EXTENSION_MATCHER}`)),
    ...(globals.has(EXTENSION_MATCHER) ? [EXTENSION_MATCHER] : []),
  ];

  if (seeds.length === 0) {
    throw new Error(
      `${EXTENSION_MATCHER} was not found in the compiled sources. MuPDF has renamed or removed ` +
        `its extension matcher, and this derivation would return an empty dispatcher set — which ` +
        `reads as "nothing dispatches on a filename" and is the opposite of what it means.`,
    );
  }

  /** @type {Set<string>} */
  const closure = new Set(seeds);
  /** @type {string[]} */
  const queue = [...seeds];
  while (queue.length > 0) {
    const name = `${queue.shift()}`;
    for (const caller of callers.get(name) ?? []) {
      if (closure.has(caller)) continue;
      closure.add(caller);
      queue.push(caller);
    }
  }

  const publicSymbols = publicApiSymbols(sourceRoot);
  return {
    seeds,
    dispatchers: [...closure].filter((name) => publicSymbols.has(name)).sort(),
  };
}

/**
 * Shipped files that name a dispatcher.
 *
 * Read from the commit scope rather than the working tree, for the reason
 * documented in scripts/lib/gitScope.mjs: a guard that asks git a question whose
 * answer is not the thing it guards will pass on the commit that breaks it.
 *
 * @param {readonly string[]} dispatchers
 * @param {string} root
 * @returns {Array<{ file: string, symbol: string }>}
 */
export function shippedUsesOfDispatchers(dispatchers, root) {
  const globs = SHIPPED_GLOBS.map((glob) => glob.replace(/\*.*$/u, ''));
  const candidates = filesInCommit().filter(
    (file) => globs.some((prefix) => file.startsWith(prefix)) && /\.(?:c|h|ts|tsx|mjs)$/u.test(file),
  );

  /** @type {Array<{ file: string, symbol: string }>} */
  const found = [];
  for (const file of candidates) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    for (const symbol of dispatchers) {
      if (new RegExp(`\\b${symbol}\\b`, 'u').test(text)) found.push({ file, symbol });
    }
  }
  return found;
}

if (process.argv[1]?.endsWith('pathDispatch.mjs')) {
  const root = repoRoot();
  const source = mupdfSourcePath(root);
  const shimProject = join(root, 'native', 'mupdf-shim', 'monstera_mupdf.vcxproj');

  if (!existsSync(join(source, 'source', 'fitz', 'writer.c'))) {
    process.stderr.write(
      'MuPDF source not provisioned — the dispatcher set was NOT derived and nothing was checked.\n',
    );
    process.exit(1);
  }

  const { dispatchers, seeds } = deriveFormatDispatchers(source, shimProject);
  const uses = shippedUsesOfDispatchers(dispatchers, root);

  process.stdout.write(
    `seeded from ${seeds.join(', ')}\n\n` +
      `FILENAME DISPATCHERS (${dispatchers.length}) — banned from shipped code by invariant 23:\n` +
      dispatchers.map((name) => `  ${name}\n`).join('') +
      `\n`,
  );

  if (uses.length > 0) {
    process.stderr.write(
      `Shipped code names a filename dispatcher:\n` +
        uses.map((use) => `  ${use.file}: ${use.symbol}\n`).join('') +
        `\nInvariant 23: the shim names the engine entry point it wants. Call the specific ` +
        `constructor — fz_new_pdf_writer for a PDF — rather than passing a path to a chooser. ` +
        `A filename must not be able to select which native library runs.\n`,
    );
    process.exit(1);
  }

  process.stdout.write('  ok  no shipped file names a filename dispatcher\n');
}
