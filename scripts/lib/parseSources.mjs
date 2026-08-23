// @ts-check
/**
 * Parses a list of JavaScript files with V8's own parser and reports which
 * ones failed. Spawned by {@link ../lib/stagedSyntax.mjs}; not useful alone.
 *
 * ## Why a child process at all
 *
 * `node --check <file>` is the obvious tool and costs ~330 ms per file on
 * Windows, nearly all of it process startup. A pre-commit guard that adds ten
 * seconds to a thirty-file commit is one somebody turns off, which this
 * repository has already written down about scanners that cry wolf.
 *
 * **And `node --check` accepts several paths and silently checks only the
 * first.** Measured 2026-08-23: `node --check good.mjs bad.mjs` exits 0. So the
 * cheap fix — pass them all — is not merely unsupported, it is a green tick for
 * files nobody parsed, which is the reassuring answer arriving from the tool
 * rather than from our code.
 *
 * One spawn that loops costs ~154 ms for six files and uses the SAME parser,
 * which is the part that matters: `vm.SourceTextModule` and `vm.Script` are V8
 * compiling the source, not a second opinion about JavaScript syntax (B3a). A
 * third-party parser here — acorn is already in the tree — would be exactly
 * that, and it would disagree with the runtime in the corners.
 *
 * ## The goal per extension
 *
 * `.mjs` is a module and `.cjs` is a script; both are decided by the extension
 * alone, with no lookup. `.js` depends on the nearest `package.json` `type`,
 * and resolving that here would reimplement Node's own rule — so a `.js` file
 * is accepted if it parses under EITHER goal, and rejected only when both
 * refuse. That is narrower than `node --check` and it is honest: a file that
 * parses in one goal is syntactically valid JavaScript, and this claims nothing
 * more than that.
 *
 * ## Requires `--experimental-vm-modules`
 *
 * `vm.SourceTextModule` is unavailable without it — measured on Node 24.12.0,
 * which reports "not a constructor". The caller passes it. If the API is ever
 * withdrawn, every module-goal parse throws, and the caller's known-GOOD control
 * turns that into BLIND rather than into "every staged file is broken".
 *
 * Usage: node --experimental-vm-modules --no-warnings parseSources.mjs <manifest.json>
 */

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/**
 * @param {string} source
 * @param {'module' | 'script'} goal
 * @returns {string | null} The parser's message, or null when it parses.
 */
function parseFailure(source, goal) {
  try {
    if (goal === 'module') new vm.SourceTextModule(source);
    else new vm.Script(source);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const manifestPath = process.argv[2];
if (manifestPath === undefined) {
  process.stderr.write('parseSources.mjs needs a manifest path.\n');
  process.exit(2);
}

/** @type {Array<{ id: string, file: string, goal: 'module' | 'script' | 'either' }>} */
const entries = JSON.parse(readFileSync(manifestPath, 'utf8'));

/** @type {Array<{ id: string, detail: string | null }>} */
const results = [];
for (const entry of entries) {
  const source = readFileSync(entry.file, 'utf8');
  if (entry.goal === 'either') {
    const asModule = parseFailure(source, 'module');
    // Reported as the MODULE failure when both refuse, because this repository
    // is `"type": "module"` and that is the goal a `.js` here almost always
    // has. The script attempt exists to avoid a false positive on a CommonJS
    // file, not to change which message a human reads.
    results.push({
      id: entry.id,
      detail: asModule === null || parseFailure(source, 'script') === null ? null : asModule,
    });
    continue;
  }
  results.push({ id: entry.id, detail: parseFailure(source, entry.goal) });
}

process.stdout.write(`${JSON.stringify(results)}\n`);
