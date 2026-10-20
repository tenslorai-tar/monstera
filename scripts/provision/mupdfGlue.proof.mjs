// @ts-check
/**
 * Proves the generator that turns MuPDF's own WASM binding into native C
 * ([ADR-0124](../../docs/DECISIONS/0124-mupdfs-own-bindings-compiled-native-are-the-shims-abi.md)) does what its
 * header claims — on fixtures that run everywhere, and on the real `mupdf.c` where MuPDF's source is provisioned.
 *
 *   npm run proof:mupdfbinding
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { shimPath } from '../lib/shimBinary.mjs';
import { mupdfSourcePath, verifyExports, withheldExported } from './mupdf.mjs';
import { WITHHELD, generateGlue } from './mupdfGlue.mjs';

const ROOT = repoRoot();
/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 12 });

/** @param {string} body */
const fixture = (body) =>
  [
    '#include "emscripten.h"',
    'static fz_context *ctx;',
    'typedef int boolean;',
    '#define EXPORT EMSCRIPTEN_KEEPALIVE',
    '#define TRY(CODE) { fz_try(ctx) CODE fz_catch(ctx) wasm_rethrow(ctx); }',
    body,
    // One export always, because a source with none is refused as a diverged parse before anything else is read.
    'EXPORT\nvoid wasm_fixture_anchor(void)\n{\n}\n',
  ].join('\n');

/**
 * @param {string} label
 * @param {() => void} run
 */
function test(label, run) {
  const mark = roster.mark();
  try {
    run();
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
  roster.record(mark, label);
}

/**
 * @param {boolean} ok
 * @param {string} detail
 */
function expect(ok, detail) {
  if (!ok) throw new Error(detail);
}

test('an export becomes a static implementation behind a wrapper that setjmps and returns zero after an unwind', () => {
  const { c, exports } = generateGlue(fixture('EXPORT\nint wasm_count(pdf_document *doc)\n{\n\treturn 1;\n}\n'));
  expect(exports[0]?.name === 'wasm_count', `exports: ${JSON.stringify(exports)}`);
  expect(c.includes('static int mzg_impl_wasm_count(pdf_document *doc)'), 'no static implementation');
  expect(/MZG_EXPORT int wasm_count\(pdf_document \*\s?doc\)\n\{/u.test(c), 'no exported wrapper');
  expect(c.includes('if (setjmp(here)) { mzg_leave(outer); return (int)0; }'), 'the wrapper does not return zero after an unwind');
  expect(c.includes('"wasm_count|int|intptr_t"'), 'no signature row, or a pointer that does not cross as intptr_t');
});

test('an export a macro DEFINES is expanded, token-pasted, and wrapped like any other', () => {
  const { c, exports } = generateGlue(
    fixture('#define GET(S,T,F) EXPORT T wasm_ ## S ## _get_ ## F(fz_ ## S *p) { return p->F; }\nGET(buffer, int, len)\n'),
  );
  expect(exports.some((each) => each.name === 'wasm_buffer_get_len'), `exports: ${exports.map((e) => e.name).join(', ')}`);
  expect(c.includes('static int mzg_impl_wasm_buffer_get_len(fz_buffer *p)'), 'the macro was not expanded into a wrapped export');
});

test('a callback site is rewritten with its types, and a WASM (int) cast on a pointer is removed', () => {
  const { c } = generateGlue(
    fixture('static void f(void *arg, float x, float y)\n{\n\tEM_ASM({ globalThis.$libmupdf_path_walk.moveto($0, $1, $2) }, (int)arg, x, y);\n}\n'),
  );
  expect(
    c.includes('(void)mzg_js("path_walk.moveto", "pff", (void *)(intptr_t)(arg), (double)(x), (double)(y))'),
    'the typed call is not the one expected',
  );
});

test('REFUSES a callback target with no type string', () => {
  let refused = false;
  try {
    generateGlue(fixture('static void f(void)\n{\n\tEM_ASM({ globalThis.$libmupdf_nothing($0) }, 1);\n}\n'));
  } catch (error) {
    refused = String(error).includes('no type string');
  }
  expect(refused, 'an unknown target was accepted, so its arguments would cross untyped');
});

test('REFUSES a callback whose argument count disagrees with its type string', () => {
  let refused = false;
  try {
    generateGlue(fixture('static void f(void *a)\n{\n\tEM_ASM({ globalThis.$libmupdf_path_walk.closepath($0) }, a, a);\n}\n'));
  } catch (error) {
    refused = String(error).includes('passes 2 arguments');
  }
  expect(refused, 'an arity mismatch was accepted, so the varargs would read garbage');
});

test('a WITHHELD export leaves nothing that names what it called, and a kept one keeps its callee (the control)', () => {
  const withheld = Object.keys(WITHHELD)[0] ?? '';
  expect(withheld === 'wasm_pdf_enable_js', `the first withheld export is ${withheld}`);
  const { c, exports } = generateGlue(
    fixture(
      'EXPORT\nvoid wasm_pdf_enable_js(pdf_document *doc)\n{\n\tpdf_enable_js(ctx, doc);\n}\n' +
        'EXPORT\nvoid wasm_pdf_disable_js(pdf_document *doc)\n{\n\tpdf_disable_js(ctx, doc);\n}\n',
    ),
  );
  expect(!/\bpdf_enable_js\s*\(/u.test(c), 'the withheld body is still compiled, so the linker keeps what it calls');
  expect(!exports.some((each) => each.name === 'wasm_pdf_enable_js'), 'the withheld export is still in the table');
  expect(/\bpdf_disable_js\s*\(/u.test(c), 'CONTROL: the kept export lost its callee, so the removal is not selective');
});

test('the export scan reports a withheld export a DLL carries (CONTROL), and none from a table without one (DEBIAN-CVE-2026-112036)', () => {
  expect(Object.hasOwn(WITHHELD, 'wasm_pdf_validate_change_history'), 'the change-history door is not withheld');
  const carrying = withheldExported(new Set(['wasm_pdf_count_versions', 'wasm_pdf_validate_change_history']));
  expect(carrying.join() === 'wasm_pdf_validate_change_history', `a table exporting the door reported ${carrying.join() || 'nothing'}`);
  const clean = withheldExported(new Set(['wasm_pdf_count_versions']));
  expect(clean.length === 0, `a table without a withheld export reported ${clean.join()}`);
});

const upstreamC = join(mupdfSourcePath(ROOT), 'platform', 'wasm', 'lib', 'mupdf.c');
const upstreamTs = join(mupdfSourcePath(ROOT), 'platform', 'wasm', 'lib', 'mupdf.ts');
const raw = readFileSync(join(ROOT, 'packages', 'kernel', 'src', 'mupdfRaw.ts'), 'utf8');
const provisioned = existsSync(upstreamC) && existsSync(upstreamTs);
const sha256 = (/** @type {string} */ path) => createHash('sha256').update(readFileSync(path)).digest('hex');

if (!provisioned) {
  for (const label of [
    'the real mupdf.c carries the change-history door and the generated glue does not',
    'the real mupdf.c yields every export the object model calls',
    'the DLL is generated from the mupdf.c the object model was ported against',
    'the object model is ported from the provisioned mupdf.ts',
  ]) {
    roster.record(roster.mark(), `${label} — NOT RUN: MuPDF's source is not provisioned here`, false);
  }
} else {
  const real = generateGlue(readFileSync(upstreamC, 'utf8'));
  test('the real mupdf.c carries the change-history door and the generated glue does not', () => {
    // CONTROL FIRST: the upstream source exports it, so its absence below is the withholding and not an upstream rename.
    expect(/\bwasm_pdf_validate_change_history\s*\(/u.test(readFileSync(upstreamC, 'utf8')), 'upstream mupdf.c no longer names the door');
    expect(!real.exports.some((each) => each.name === 'wasm_pdf_validate_change_history'), 'the generated glue exports it');
    expect(!/\bpdf_validate_change_history\s*\(/u.test(real.c), 'the generated glue still calls pdf_validate_change_history');
  });
  test('the real mupdf.c yields every export the object model calls', () => {
    const generated = new Set(real.exports.map((each) => each.name));
    const called = new Set([...raw.matchAll(/libmupdf\._(wasm_[A-Za-z0-9_]+)/gu)].map((m) => m[1] ?? ''));
    expect(real.exports.length > 500, `only ${String(real.exports.length)} exports`);
    const missing = [...called].filter((name) => !generated.has(name) && !name.startsWith('wasm_Memento'));
    expect(missing.length === 0, `called and not generated: ${missing.join(', ')}`);
  });
  test('the DLL is generated from the mupdf.c the object model was ported against', () => {
    const pinned = /PORTED_FROM_MUPDF_C = "([0-9a-f]{64})"/u.exec(raw)?.[1];
    expect(pinned === real.digest, `mupdfRaw.ts pins ${String(pinned)}; the provisioned mupdf.c is ${real.digest}`);
  });
  test('the object model is ported from the provisioned mupdf.ts', () => {
    const pinned = /Ported from upstream mupdf\.ts sha256 ([0-9a-f]{64})/u.exec(raw)?.[1];
    expect(pinned === sha256(upstreamTs), `mupdfRaw.ts pins ${String(pinned)}; the provisioned mupdf.ts is ${sha256(upstreamTs)}`);
  });
}

// THE BUILT DLL, read through the shim build's own export scan (`verifyExports`): every declared export present and
// no withheld one. It needs the DLL and an export reader; where either is missing it is named as not run.
const dll = shimPath(ROOT);
const dllLabel = 'the built shim exports every declared symbol and none of the withheld ones, read from its export table';
const scanned = existsSync(dll) ? await verifyExports(ROOT, dll).then((read) => read, (error) => String(error)) : null;
if (scanned === null || (typeof scanned !== 'string' && !scanned.verified)) {
  roster.record(roster.mark(), `${dllLabel} — NOT RUN: ${scanned === null ? 'no built shim here' : 'no export reader here'}`, false);
} else {
  test(dllLabel, () => {
    expect(typeof scanned !== 'string', `the scan refused the DLL: ${String(scanned)}`);
  });
}

if (failures.length > 0) {
  process.stderr.write(`\n${String(failures.length)} binding failure(s):\n\n${failures.join('\n\n')}\n\n`);
  process.exit(1);
}
process.stdout.write(roster.format('MuPDF binding case'));
