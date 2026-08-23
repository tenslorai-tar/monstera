// @ts-check
/**
 * Proof that the OCR door derivation can tell a real call path from no call
 * path, before any verdict is allowed to rest on it (rule B2, stage audit 4a).
 *
 * ## Why this proof is longer than the thing it proves
 *
 * The derivation was wrong four times, and every single failure produced the
 * REASSURING answer — "nothing reaches Tesseract" — which is exactly the answer
 * a security verdict wants to hear and the reason none of them announced
 * itself:
 *
 *   1. Edges followed direct calls only. Nothing in this subsystem is reached by
 *      a direct call: `fz_new_ocr_device` stores `fz_ocr_close_device` in a
 *      device vtable. Closure of 8, zero doors.
 *   2. The parser read comments. `ocr-device.c` opens with prose at column 0,
 *      and the sentence "The incoming calls are also forwarded (mostly,
 *      eventually) to the" has the exact shape of a definition, so a function
 *      called `forwarded` swallowed the file. ONE function parsed from the most
 *      important translation unit.
 *   3. The definition pattern's leading character consumed the name's own first
 *      letter, so a definition starting at column 0 — MuPDF's dominant style —
 *      could never match. Only prefixed lines did, which is why English prose
 *      matched and real functions did not.
 *   4. The public-API scan used one greedy pattern per declaration. It has to
 *      cross newlines, because declarations wrap; once it can, a non-declaration
 *      extends to the next `);` and eats the real declarations in between. That
 *      is how `fz_new_document_writer` — the filename-driven door, the most
 *      dangerous one in the set — went missing while sitting on one ordinary
 *      line of writer.h.
 *
 * A fifth, milder, was over-approximation rather than under: walking MuPDF's
 * whole tree pulled in mutool and mudraw, and with names keyed globally their
 * `main` bound unrelated programs into one node, so five SVG entry points
 * arrived as doors through a chain of two collisions and no real call. Spurious
 * doors matter too — a check that fires on innocent code is the one somebody
 * eventually switches off.
 *
 * ## The shape of the cases
 *
 * Synthetic cases pin the parser, and run anywhere. Real-source cases pin the
 * verdict, and are skipped-and-reported when the 69 MB tree is not provisioned.
 * The resolution test that matters most is `fz_clone_text_span`: it is defined
 * in `ocr-device.c`, the same file as a genuine door, and reaches no OCR code.
 * A file-level analysis calls it a door; a correct one does not. Nothing else in
 * this proof separates those two designs.
 *
 * Usage: node scripts/proofs/ocrDoors.proof.mjs
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { mupdfSourcePath } from '../provision/mupdf.mjs';
import { declaredSymbols } from '../security/claimSymbols.mjs';
import { declaredIn, deriveOcrDoors, functionsIn } from '../security/ocrDoors.mjs';

const ROOT = repoRoot();

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

// ---------------------------------------------------------------------------
// The parser, against the shapes that broke it.
// ---------------------------------------------------------------------------
{
  const cStyle = [
    'fz_device *',
    'fz_new_ocr_device(fz_context *ctx, fz_device *target)',
    '{',
    '\tdev->close_device = fz_ocr_close_device;',
    '\treturn dev;',
    '}',
  ].join('\n');

  const parsed = functionsIn(cStyle);
  check(
    'a definition whose name starts at column 0 is recognised',
    parsed.length === 1 && parsed[0]?.name === 'fz_new_ocr_device',
    `parsed ${parsed.length}: ${parsed.map((f) => f.name).join(', ') || '(none)'} — this is ` +
      `MuPDF's dominant style, and a pattern that cannot match it sees almost no functions`,
  );

  const cppStyle = ['void *ocr_init(fz_context *ctx, const char *lang)', '{', '\treturn api;', '}'].join('\n');
  const parsedCpp = functionsIn(cppStyle);
  check(
    'a definition with the return type on the same line is recognised',
    parsedCpp.length === 1 && parsedCpp[0]?.name === 'ocr_init',
    `parsed ${parsedCpp.map((f) => f.name).join(', ') || '(none)'} — tessocr.cpp is written this ` +
      `way, and it holds all three functions that ARE the Tesseract door`,
  );

  // RESOLUTION: the prose that actually broke this, verbatim from ocr-device.c.
  const prose = [
    '/*',
    'The incoming calls are also forwarded (mostly, eventually) to the',
    'target device.',
    '*/',
    'static void',
    'real_function(fz_context *ctx)',
    '{',
    '\tocr_init(ctx);',
    '}',
  ].join('\n');
  const parsedProse = functionsIn(prose);
  check(
    'RESOLUTION: English prose at column 0 does not parse as a definition',
    parsedProse.length === 1 && parsedProse[0]?.name === 'real_function',
    `parsed ${parsedProse.map((f) => f.name).join(', ') || '(none)'} — a sentence containing a ` +
      `parenthesis has a definition's exact shape, and one of them consumed an entire file`,
  );

  check(
    '`static` on the line above the name is detected',
    parsedProse[0]?.isStatic === true,
    'linkage decides identity: two translation units may each define `file_level_headers`, and ' +
      'merging them by name bled five unrelated entry points into the door list',
  );

  const declaration = ['void fz_declared_only(fz_context *ctx);', 'int other(void)', '{', '\treturn 0;', '}'].join('\n');
  const parsedDeclaration = functionsIn(declaration);
  check(
    'a declaration does not open a body and swallow what follows',
    parsedDeclaration.length === 1 && parsedDeclaration[0]?.name === 'other',
    `parsed ${parsedDeclaration.map((f) => f.name).join(', ') || '(none)'}`,
  );
}

// ---------------------------------------------------------------------------
// The public-API scan, against the shape that hid the most dangerous door.
// ---------------------------------------------------------------------------
{
  const header = [
    '#define FZ_THING(a) ((a) + 1)',
    'typedef struct fz_writer_s',
    '{',
    '\tint field;',
    '} fz_writer;',
    '',
    'fz_document_writer *fz_new_document_writer(fz_context *ctx, const char *path);',
    '',
    'fz_device *fz_new_ocr_device(fz_context *ctx,',
    '\tfz_device *target,',
    '\tconst char *language);',
  ].join('\n');

  const declared = declaredIn(header);
  check(
    'RESOLUTION: a declaration after macro and struct debris is still found',
    declared.includes('fz_new_document_writer'),
    `found ${declared.join(', ') || '(none)'} — a greedy scan starts on the debris and runs past ` +
      `the real declaration, which is precisely how this door disappeared from the set`,
  );
  check(
    'a declaration wrapped over three lines is found',
    declared.includes('fz_new_ocr_device'),
    `found ${declared.join(', ') || '(none)'} — MuPDF wraps long declarations, so a scan that ` +
      `refuses to cross newlines misses them`,
  );
}

// ---------------------------------------------------------------------------
// The verdict, against the real engine.
// ---------------------------------------------------------------------------
const source = mupdfSourcePath(ROOT);
const shimProject = join(ROOT, 'native', 'mupdf-shim', 'monstera_mupdf.vcxproj');

if (!existsSync(join(source, 'source', 'fitz', 'tessocr.h')) || !existsSync(shimProject)) {
  passed.push('SKIPPED: MuPDF source not provisioned — the real door set was NOT derived here');
} else {
  const derived = deriveOcrDoors(source, shimProject);
  const doors = new Set(derived.doors);

  for (const seed of ['ocr_init', 'ocr_recognise', 'ocr_fin']) {
    check(
      `the Tesseract door ${seed} is read from tessocr.h rather than hardcoded`,
      derived.seeds.includes(seed),
      `seeds are ${derived.seeds.join(', ')} — a MuPDF release that renames these must fail here`,
    );
  }

  check(
    'Leptonica is seeded through its own arming point, not folded into Tesseract',
    derived.seeds.includes('fz_set_leptonica_mem'),
    `seeds are ${derived.seeds.join(', ')} — Leptonica is a separate library with a separate CVE ` +
      `history, and it is the one that parses image formats`,
  );

  for (const door of ['fz_new_ocr_device', 'fz_new_ocr_device_with_options']) {
    check(`${door} is derived as a door`, doors.has(door), `doors: ${derived.doors.join(', ')}`);
  }

  check(
    'fz_new_document_writer is derived as a door — the filename-driven one',
    doors.has('fz_new_document_writer'),
    `doors: ${derived.doors.join(', ')}. This is the door that needs no caller to name an OCR ` +
      `symbol: the writer is selected from a file extension, so a path ending ".ocr" reaches ` +
      `Tesseract. Three separate parse defects hid it.`,
  );

  // RESOLUTION at the granularity that separates a correct analysis from a
  // plausible one. Same file as a real door, no path to OCR.
  check(
    'RESOLUTION: fz_clone_text_span is NOT a door despite living in ocr-device.c',
    !doors.has('fz_clone_text_span'),
    `doors: ${derived.doors.join(', ')} — a file-level analysis calls this a door, and shipped ` +
      `code calling it would then expire an unrelated security verdict for no reason`,
  );

  for (const innocent of ['pdf_save_document', 'fz_new_svg_device', 'fz_open_document']) {
    check(
      `${innocent} is NOT a door`,
      !doors.has(innocent),
      `doors: ${derived.doors.join(', ')} — ${innocent} reaches no OCR code, and pdf_save_document ` +
        `is the shim's actual save path`,
    );
  }

  check(
    'the closure stays small enough to be an analysis rather than a smear',
    derived.closure.length < 60,
    `${derived.closure.length} functions. Mentions are taken as edges to survive function ` +
      `pointers, which over-approximates; if that swells into the engine the door list stops ` +
      `meaning anything.`,
  );

  check(
    'every door traces back to a seed by a recorded chain',
    derived.doors.every((door) => {
      const chain = derived.pathToSeed(door);
      return chain.length > 1 && derived.seeds.includes(`${chain[chain.length - 1]}`);
    }),
    'an unexplained entry in a security-bearing list is one nobody can check and nobody removes',
  );

  // The register's declared door set, and the control that the comparison can
  // fail. Without the control, a comparison that always agreed would pass every
  // case above — which is the shape of a green check that verifies nothing.
  {
    /** @type {{ reachability?: Record<string, { symbols?: string[] }> }} */
    const baseline = JSON.parse(
      readFileSync(join(ROOT, 'docs', 'security', 'engine-advisories.json'), 'utf8'),
    );
    // `declaredSymbols`, NOT an inline `?? []`, and not `watchedSymbols`
    // either (finding TTT-2). The question here is what the register's list
    // explicitly NAMES, compared against a derived door set — so a missing list
    // must read as naming nothing, where the other rule would add the verdict's
    // own key as a phantom door no engine source can declare.
    //
    // It was spelt inline until the shared module existed. That is exactly the
    // shape OOO-1's third opinion had: a bare expression whose correctness lives
    // in a paragraph beside it, in a file that reads the register's JSON with
    // its own hand-written type. Two named functions make the choice a pick from
    // a list instead.
    const declared = declaredSymbols(baseline.reachability?.['ocr']);

    /** @param {readonly string[]} a @param {readonly string[]} b */
    const agrees = (a, b) => a.length === b.length && a.every((entry) => b.includes(entry));

    check(
      'the advisory register declares exactly the derived door set',
      agrees(declared, derived.doors),
      `register: ${declared.join(', ') || '(none)'}\n      derived: ${derived.doors.join(', ')}`,
    );

    check(
      'CONTROL: dropping one door from the register is detected',
      !agrees(declared.slice(1), derived.doors),
      'the comparison agrees with a list missing an entry, so it would agree with anything',
    );

    check(
      'CONTROL: adding a symbol that is not a door is detected',
      !agrees([...declared, 'fz_open_document'], derived.doors),
      'over-declaring is not caught, so the check can drift into firing on innocent code',
    );
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `\nOCR door derivation proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} OCR door cases passed.\n`);
