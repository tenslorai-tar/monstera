// @ts-check
/**
 * Proof of invariant 24: opening a document runs none of its content.
 *
 * Verifying by executing rather than asserting. "Nothing calls the interpreter
 * on the open path" is a statement about source; "the shipped engine ran none
 * of this document" is a statement about the build, and using the first to skip
 * the second is the shortcut this project bans.
 *
 * ## The negative and what makes it mean anything
 *
 * Every case here is a negative — nothing fired, nothing was linked, nothing
 * reached disk — and a negative probe is worthless when its input would have
 * produced nothing anyway. So each one is paired with a control built from an
 * input that WOULD succeed if the guard were absent:
 *
 * | the claim | the control |
 * |---|---|
 * | the fixture's JavaScript does not run through the shim's call sequence | the same fixture, same binary, same observer, with `pdf_enable_js` — the alerts arrive |
 * | the shipped shim carries no JavaScript interpreter | the same scan over a binary that DOES link one — the strings are found |
 * | the embedded file does not reach disk | the file's body is a marker the scan is known to be able to match |
 *
 * The middle row is the one that matters most. A scan for absent strings
 * reports "found nothing" for a wrong pattern, a wrong file, and a genuine
 * absence identically, and "no interpreter in the engine" is exactly the answer
 * a reader hopes for (audit item 4b).
 *
 * ## What was measured, 2026-08-31
 *
 * MuJS is NOT in the shipped shim. `docs/ARCHITECTURE.md` invariant 24 said it
 * was, and that sentence is this proof's own motivation, so it was checked
 * rather than repeated: MuJS's registration strings — `Array.prototype.forEach`
 * and its siblings, which exist in `thirdparty/mujs/jsarray.c` and cannot come
 * from MuPDF's own C — are absent from `monstera_mupdf.dll`, while MuPDF
 * library strings from `pdf-xref.c` and `document.c` are present.
 *
 * The mechanism is ordinary static linking: `pdf_enable_js` is referenced by
 * exactly one file in all of MuPDF, `source/tools/murun.c`, and the shim
 * references neither it nor anything else in `pdf-js.c`. The linker therefore
 * never pulls `pdf-js.obj` out of `libmupdf.lib`, and MuJS comes in only behind
 * it.
 *
 * **That is a property of the current call graph, not of the build**, which is
 * why this proof does not stop there. Add one call to `pdf_enable_js` anywhere
 * in the shim and the interpreter arrives with it, silently, in a commit whose
 * diff shows one line. `FZ_ENABLE_JS=0` would make it structural — and that is
 * not taken here, because `docs/ARCHITECTURE.md` anticipates JavaScript-bearing
 * widgets in stages 3 and 4, so compiling the interpreter out forecloses a
 * decision that belongs to the owner rather than to this file.
 *
 * Usage: node scripts/security/activeContentProof.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from '../lib/msvc.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { mupdfSourcePath } from '../provision/mupdf.mjs';
import { shimPath } from '../lib/shimBinary.mjs';
import {
  DOC_LEVEL_MARKER,
  EMBEDDED_FILE_BODY,
  EMBEDDED_FILE_NAME,
  OPEN_ACTION_MARKER,
  activeContentPdf,
} from './makeActiveContentFixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** @returns {string} */
function repoRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (result.status !== 0) return resolve(HERE, '..', '..');
  return `${result.stdout}`.trim();
}

const ROOT = repoRoot();
const POC_DIR = join(ROOT, 'native', 'activecontent-poc');
const POC_EXE = join(POC_DIR, 'out', 'activecontent_poc.exe');
const POC_PROJECT = join(POC_DIR, 'activecontent_poc.vcxproj');

/**
 * Strings that exist ONLY in MuJS, taken from `thirdparty/mujs/jsarray.c` and
 * its siblings.
 *
 * Chosen for what they exclude. `syntax error`, `stack overflow` and `too much
 * recursion` are all present in the shim and none of them is evidence: MuPDF's
 * own C raises every one of those. A prototype-registration name cannot come
 * from anywhere but a JavaScript engine.
 */
const INTERPRETER_STRINGS = [
  'Array.prototype.forEach',
  'String.prototype.charCodeAt',
  'Function.prototype.apply',
];

/**
 * Strings from MuPDF library code the shim certainly uses.
 *
 * The positive control, and it has to come from the LIBRARY rather than from
 * the shim's own C. `not a PDF` is written in `monstera_mupdf.c`, so finding it
 * proves the file was read and nothing more; these prove that strings compiled
 * out of `libmupdf.lib` reach the binary, which is what makes an absent
 * `pdf-js.c` string mean "not linked".
 */
const LIBRARY_STRINGS = ['Cannot read linearly with encryption', 'Document handler list not found'];

/**
 * Counts occurrences of an ASCII needle in a binary.
 *
 * Reading the whole file and scanning the buffer rather than shelling out: the
 * tool that would have done this, `strings`, is absent on this machine and
 * returned a confident zero for every needle when it was tried. A missing
 * binary and a genuine absence produce the same number, and that number is the
 * one this proof exists to interpret.
 *
 * @param {Buffer} haystack
 * @param {string} needle
 * @returns {number}
 */
function occurrences(haystack, needle) {
  const probe = Buffer.from(needle, 'ascii');
  let count = 0;
  let at = haystack.indexOf(probe, 0);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(probe, at + 1);
  }
  return count;
}

/**
 * Runs the harness and returns the events it observed.
 *
 * @param {string} fixture
 * @param {'js' | 'nojs'} mode
 * @returns {{ ok: boolean, events: string[], output: string }}
 */
function runPoc(fixture, mode) {
  const result = spawnSync(POC_EXE, [fixture, mode], { encoding: 'utf8', timeout: 60_000 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const events = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('EVENT '));
  return { ok: result.status === 0, events, output };
}

async function main() {
  if (process.platform !== 'win32') {
    process.stdout.write('  skip  the active-content harness links MuPDF and is Windows-only today\n');
    return 0;
  }

  const source = mupdfSourcePath(ROOT);
  if (!existsSync(join(source, 'platform', 'win32', 'x64', 'Release', 'libmupdf.lib'))) {
    process.stderr.write(
      `\nlibmupdf is not built. Run:  npm run provision:mupdf\n\n` +
        `This proof links the pinned engine and cannot run without it.\n\n`,
    );
    return 1;
  }

  const shim = shimPath(ROOT);
  if (!existsSync(shim)) {
    process.stderr.write(
      `\nThe shim is not built: ${shim}\n\nRun:  npm run provision:mupdf\n\n` +
        `Half of this proof is a statement about the shipped binary, and a missing\n` +
        `binary would make that half report a clean absence.\n\n`,
    );
    return 1;
  }

  const scratch = join(tmpdir(), `monstera-active-${String(process.pid)}`);
  mkdirSync(scratch, { recursive: true });
  /** @type {string[]} */
  const failures = [];
  const roster = createRoster(failures, { cases: 7 });
  let mark = roster.mark();

  try {
    const fixture = join(scratch, 'active-content.pdf');
    writeFileSync(fixture, activeContentPdf());

    build({
      project: POC_PROJECT,
      properties: ['Configuration=Release', 'Platform=x64', `MupdfRoot=${source}`],
      label: 'activecontent_poc (the control harness)',
    });

    // --- Case 1: THE CONTROL. The fixture's active content is live, and the
    // observer sees it. Everything below is a negative, and none of it means
    // anything until this passes.
    const withJs = runPoc(fixture, 'js');
    const firedDocLevel = withJs.events.some((line) => line.includes(DOC_LEVEL_MARKER));
    const firedOpenAction = withJs.events.some((line) => line.includes(OPEN_ACTION_MARKER));
    process.stdout.write(`  with JS enabled: ${String(withJs.events.length)} event(s)\n`);
    for (const line of withJs.events) process.stdout.write(`    ${line}\n`);
    if (!withJs.ok || !firedDocLevel) {
      failures.push(
        `CONTROL FAILED: with pdf_enable_js the fixture's document-level JavaScript did not ` +
          `raise "${DOC_LEVEL_MARKER}". Every other case here is a negative and proves nothing ` +
          `while this one is red — an inert fixture produces the same silence as a contained ` +
          `engine.\n${withJs.output}`,
      );
    }
    roster.record(mark, 'CONTROL: the fixture executes and is observed when JavaScript is enabled');

    mark = roster.mark();
    // --- Case 2: the /OpenAction clause, and it is NOT the case first written.
    //
    // This began as a second control — fire the /OpenAction with JavaScript
    // enabled, the way the document-level payload fires above — and it went
    // red, correctly. `pdf_enable_js` runs document-level JavaScript and
    // nothing else; an open action is dispatched by a VIEWER, and MuPDF is a
    // library.
    //
    // Measured 2026-08-31, and it is the stronger fact: `OpenAction` appears
    // nowhere in MuPDF 1.28.0 — not in `source/`, and not in the name table at
    // `include/mupdf/pdf/name-table.h`, which carries `AA` but not this. The
    // engine has no code that reads the key, so there is no dispatch to
    // contain rather than a dispatch that was contained.
    //
    // Kept as a real case rather than a paragraph, because that is a fact about
    // a pinned dependency and a version bump can change it. If MuPDF ever adds
    // open-action handling, this reddens and the clause needs a runtime guard.
    const nameTable = readFileSync(
      join(source, 'include', 'mupdf', 'pdf', 'name-table.h'),
      'utf8',
    );
    const tableControls = ['PDF_MAKE_NAME("AA", AA)', 'JavaScript'];
    if (!tableControls.every((needle) => nameTable.includes(needle))) {
      failures.push(
        `POSITIVE CONTROL FAILED: MuPDF's name table does not contain ` +
          `${tableControls.filter((n) => !nameTable.includes(n)).join(', ')}. The scan below ` +
          `reports an absence, and a scan that cannot find names it must find reports every ` +
          `absence identically.`,
      );
    } else if (/\bOpenAction\b/u.test(nameTable) || firedOpenAction) {
      failures.push(
        `the engine knows /OpenAction: name table match=${String(/\bOpenAction\b/u.test(nameTable))}, ` +
          `event observed=${String(firedOpenAction)}. This proof's "no automatic action runs" ` +
          `clause rested on the engine having no such code path, and it now needs a guard.`,
      );
    }
    roster.record(mark, 'the engine dispatches no /OpenAction — the name is absent from its own table');

    mark = roster.mark();
    // --- Case 3: the claim. The shim's exact call sequence runs none of it.
    const withoutJs = runPoc(fixture, 'nojs');
    process.stdout.write(`  without JS: ${String(withoutJs.events.length)} event(s)\n`);
    if (!withoutJs.ok) {
      failures.push(
        `the harness failed in nojs mode, so its silence is a crash rather than a result:\n` +
          `${withoutJs.output}`,
      );
    } else if (withoutJs.events.length !== 0) {
      failures.push(
        `mz_open's call sequence ran active content: ${withoutJs.events.join('; ')}. ` +
          `Invariant 24 says opening a document runs none of it.`,
      );
    }
    roster.record(mark, 'the shim call sequence raises no document event, with the observer installed');

    mark = roster.mark();
    // --- Case 4: no embedded file reached disk.
    //
    // BY CONTENT, not by filename. An extractor is free to name the output
    // anything, and a check that looks for `EMBEDDED_FILE_NAME` would pass over
    // a copy written as `tmp0001`. The payload's body is the marker, and the
    // fixture itself carries it — which is this case's positive control, since
    // "no file contains the marker" is also what a failed read produces.
    const carriers = readdirSync(scratch).filter((entry) => {
      try {
        return readFileSync(join(scratch, entry), 'ascii').includes(EMBEDDED_FILE_BODY);
      } catch {
        return false;
      }
    });
    if (!carriers.includes('active-content.pdf')) {
      failures.push(
        `POSITIVE CONTROL FAILED: the fixture itself does not appear to contain ` +
          `"${EMBEDDED_FILE_BODY}", so this scan cannot see the marker anywhere and its ` +
          `report of no stray copies is the scan failing rather than the engine behaving.`,
      );
    }
    const strays = carriers.filter((entry) => entry !== 'active-content.pdf');
    if (strays.length > 0) {
      failures.push(
        `opening the document wrote the embedded payload to ${String(strays.length)} file(s): ` +
          `${strays.join(', ')}. The fixture carries an embedded file named ` +
          `${EMBEDDED_FILE_NAME}, and invariant 24 says none reaches disk until asked for.`,
      );
    }
    roster.record(mark, 'no embedded file reaches disk, checked by payload rather than by name');

    mark = roster.mark();
    // --- Case 5: the shipped shim carries no interpreter.
    const shimBytes = readFileSync(shim);
    const controlHits = LIBRARY_STRINGS.map((needle) => occurrences(shimBytes, needle));
    if (controlHits.some((hits) => hits === 0)) {
      failures.push(
        `POSITIVE CONTROL FAILED: MuPDF library strings are absent from ${shim}. ` +
          `${LIBRARY_STRINGS.map((s, i) => `"${s}"=${String(controlHits[i])}`).join(', ')}. ` +
          `Without them, an absent interpreter string says nothing — a scan that cannot see ` +
          `libmupdf's own text cannot report on what libmupdf linked.`,
      );
    }
    roster.record(mark, 'CONTROL: the binary scan finds MuPDF library strings it must find');

    mark = roster.mark();
    const interpreterInShim = INTERPRETER_STRINGS.map((needle) => occurrences(shimBytes, needle));
    process.stdout.write(
      `  shim: ${INTERPRETER_STRINGS.map((s, i) => `${s}=${String(interpreterInShim[i])}`).join(' ')}\n`,
    );
    if (interpreterInShim.some((hits) => hits > 0)) {
      failures.push(
        `a JavaScript interpreter is linked into the shipped shim: ` +
          `${INTERPRETER_STRINGS.map((s, i) => `"${s}"=${String(interpreterInShim[i])}`).join(', ')}. ` +
          `That is not a failure of invariant 24 on its own — the invariant is about what RUNS — ` +
          `but it means the containment now rests on nothing calling it, so this proof's ` +
          `strongest case has gone and the open path needs a guard rather than an absence.`,
      );
    }
    roster.record(mark, 'the shipped shim links no JavaScript interpreter at all');

    mark = roster.mark();
    // --- Case 7: THE CONTROL for case 5/6. The same scan over a binary that
    // does link an interpreter must find it. Without this, "absent" is
    // indistinguishable from "this scan cannot find these strings anywhere".
    const pocBytes = readFileSync(POC_EXE);
    const interpreterInPoc = INTERPRETER_STRINGS.map((needle) => occurrences(pocBytes, needle));
    process.stdout.write(
      `  control exe: ${INTERPRETER_STRINGS.map((s, i) => `${s}=${String(interpreterInPoc[i])}`).join(' ')}\n`,
    );
    if (interpreterInPoc.some((hits) => hits === 0)) {
      failures.push(
        `CONTROL FAILED: the interpreter strings are absent from the harness too ` +
          `(${INTERPRETER_STRINGS.map((s, i) => `"${s}"=${String(interpreterInPoc[i])}`).join(', ')}), ` +
          `and that binary calls pdf_enable_js. So the scan cannot find these strings in any ` +
          `binary, and the shim's clean result above is the scan failing rather than the shim ` +
          `being clean.`,
      );
    }
    roster.record(mark, 'CONTROL: the same scan DOES find the interpreter in a binary that links it');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    process.stderr.write(
      `\n${String(failures.length)} active-content failure(s):\n\n${failures.join('\n\n')}\n\n`,
    );
    return 1;
  }

  process.stdout.write(`\n${roster.format('active-content case')}`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`\n${formatError(error)}\n`);
    process.exitCode = 1;
  });
