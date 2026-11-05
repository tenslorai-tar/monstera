// @ts-check
/**
 * Pins the internal MuPDF declarations the redaction cut is written against
 * ([ADR-0286](../../docs/DECISIONS/0286-a-burn-in-cuts-drawings-at-the-marks-edge-before-mupdf-removes-the-rest.md)
 * Decision 6).
 *
 *   npm run proof:drawimppin
 *
 * `mz_cut_line_art` in `native/mupdf-shim/monstera_mupdf.c` includes `source/fitz/draw-imp.h`, a header MuPDF does not
 * install and does not promise to keep: it builds a rasteriser of its own through `fz_new_rasterizer_of_size`, fills in
 * `fz_rasterizer_fns` by position and sets fields of `fz_aa_context` by name, and feeds it with
 * `fz_flatten_fill_path` and `fz_flatten_stroke_path`, and frees it through the inline `fz_drop_rasterizer`. An upgrade that reorders that table, adds a member to it or
 * changes a parameter can still compile and then calls the wrong function. So the text of each declaration, read from
 * the provisioned source as a declaration rather than by line, is compared with the text below, which is what the cut
 * was written against (MuPDF 1.28.0). A difference is red until the cut is read again and this text is moved with it.
 *
 * And the set is closed: every name the shim uses that MuPDF declares only in its internal headers (the identifiers of
 * `draw-imp.h` that no installed header under `include/` names) must be one pinned here. A new internal call is red
 * until it is pinned too. That set can only grow by a use, so it is derived (CLAUDE.md item 4c).
 *
 * What MuPDF does BEHIND these declarations, such as the stroker sending a dash's cap edges twice, is not text and is
 * not pinned here: the rendered cases in `packages/kernel/src/redactionLineArt.test.ts` hold it.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { mupdfSourcePath } from './mupdf.mjs';

const ROOT = repoRoot();
/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 6 });

/**
 * The declarations as the cut was written against them, whitespace collapsed to one space.
 * @type {Readonly<Record<string, { readonly header: 'draw-imp.h' | 'context.h', readonly text: string }>>}
 */
export const PINNED = {
  fz_rasterizer_drop_fn: { header: 'draw-imp.h', text: 'typedef void (fz_rasterizer_drop_fn)(fz_context *ctx, fz_rasterizer *r);' },
  fz_rasterizer_reset_fn: { header: 'draw-imp.h', text: 'typedef int (fz_rasterizer_reset_fn)(fz_context *ctx, fz_rasterizer *r);' },
  fz_rasterizer_postindex_fn: { header: 'draw-imp.h', text: 'typedef void (fz_rasterizer_postindex_fn)(fz_context *ctx, fz_rasterizer *r);' },
  fz_rasterizer_insert_fn: {
    header: 'draw-imp.h',
    text: 'typedef void (fz_rasterizer_insert_fn)(fz_context *ctx, fz_rasterizer *r, float x0, float y0, float x1, float y1, int rev);',
  },
  fz_rasterizer_insert_rect_fn: {
    header: 'draw-imp.h',
    text: 'typedef void (fz_rasterizer_insert_rect_fn)(fz_context *ctx, fz_rasterizer *r, float fx0, float fy0, float fx1, float fy1);',
  },
  fz_rasterizer_gap_fn: { header: 'draw-imp.h', text: 'typedef void (fz_rasterizer_gap_fn)(fz_context *ctx, fz_rasterizer *r);' },
  fz_rasterizer_fn: {
    header: 'draw-imp.h',
    text: 'typedef void (fz_rasterizer_fn)(fz_context *ctx, fz_rasterizer *r, int eofill, const fz_irect *clip, fz_pixmap *pix, unsigned char *colorbv, fz_overprint *eop);',
  },
  fz_rasterizer_is_rect_fn: { header: 'draw-imp.h', text: 'typedef int (fz_rasterizer_is_rect_fn)(fz_context *ctx, fz_rasterizer *r);' },
  fz_rasterizer_fns: {
    header: 'draw-imp.h',
    text: 'typedef struct { fz_rasterizer_drop_fn *drop; fz_rasterizer_reset_fn *reset; fz_rasterizer_postindex_fn *postindex; fz_rasterizer_insert_fn *insert; fz_rasterizer_insert_rect_fn *rect; fz_rasterizer_gap_fn *gap; fz_rasterizer_fn *convert; fz_rasterizer_is_rect_fn *is_rect; int reusable; } fz_rasterizer_fns;',
  },
  fz_rasterizer: {
    header: 'draw-imp.h',
    text: 'struct fz_rasterizer { fz_rasterizer_fns fns; fz_aa_context aa; fz_irect clip; /* Specified clip rectangle */ fz_irect bbox; /* Measured bbox of path while stroking/filling */ };',
  },
  fz_new_rasterizer_of_size: { header: 'draw-imp.h', text: 'void *fz_new_rasterizer_of_size(fz_context *ctx, int size, const fz_rasterizer_fns *fns);' },
  fz_flatten_fill_path: {
    header: 'draw-imp.h',
    text: 'int fz_flatten_fill_path(fz_context *ctx, fz_rasterizer *rast, const fz_path *path, fz_matrix ctm, float flatness, fz_irect scissor, fz_irect *bbox);',
  },
  fz_flatten_stroke_path: {
    header: 'draw-imp.h',
    text: 'int fz_flatten_stroke_path(fz_context *ctx, fz_rasterizer *rast, const fz_path *path, const fz_stroke_state *stroke, fz_matrix ctm, float flatness, float linewidth, fz_irect scissor, fz_irect *bbox);',
  },
  // AN INLINE DEFINITION, pinned with its body: what it does is what the shim relies on.
  fz_drop_rasterizer: {
    header: 'draw-imp.h',
    text: 'static inline void fz_drop_rasterizer(fz_context *ctx, fz_rasterizer *r) { if (r) r->fns.drop(ctx, r); }',
  },
  fz_aa_context: {
    header: 'context.h',
    text: 'typedef struct { int hscale; int vscale; int scale; int bits; int text_bits; float min_line_width; } fz_aa_context;',
  },
};

/** @param {string} text */
const collapse = (text) => text.replace(/\s+/gu, ' ').trim();

/**
 * Every declaration of `name` in `source`, as text: a typedef of a function type, a struct typedef that ends in the
 * name, a struct of that tag, or a prototype. Read as a declaration, so a wrapped line or a moved block is the same text.
 * @param {string} source @param {string} name
 * @returns {string[]}
 */
export function declarationsOf(source, name) {
  const found = [];
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  // typedef void (NAME)(...);
  for (const match of source.matchAll(new RegExp(`typedef[^;{}]*\\(${escaped}\\)\\s*\\([^;]*\\);`, 'gu'))) found.push(match[0]);
  // typedef struct { ... } NAME;  (no nested braces in the structs pinned here)
  for (const match of source.matchAll(new RegExp(`typedef\\s+struct\\s*\\{[^{}]*\\}\\s*${escaped}\\s*;`, 'gu'))) found.push(match[0]);
  // struct NAME { ... };
  for (const match of source.matchAll(new RegExp(`(?<![\\w])struct\\s+${escaped}\\s*\\{[^{}]*\\}\\s*;`, 'gu'))) found.push(match[0]);
  // A prototype at the start of a line: a return type, the name, a parameter list, a semicolon.
  for (const match of source.matchAll(new RegExp(`^[A-Za-z_][\\w \\t*]*?\\b${escaped}\\s*\\([^;{}]*\\)\\s*;`, 'gmu'))) found.push(match[0]);
  // static inline T NAME(...) { ... }  (one level of braces, as the inline helpers here are written)
  for (const match of source.matchAll(new RegExp(`^static\\s+inline\\b[\\w \\t*]*?\\b${escaped}\\s*\\([^;{}]*\\)\\s*\\{[^{}]*\\}`, 'gmu')))
    found.push(match[0]);
  return found.map(collapse);
}

/**
 * The pinned declarations whose text in the given headers is not the pinned text, each with what was found.
 * @param {Readonly<Record<string, string>>} headers the header texts by file name
 * @returns {string[]}
 */
export function differences(headers) {
  const out = [];
  for (const [name, { header, text }] of Object.entries(PINNED)) {
    const source = headers[header];
    if (source === undefined) throw new Error(`no text for ${header}`);
    const found = declarationsOf(source, name);
    if (found.length !== 1 || found[0] !== text)
      out.push(`${name} in ${header}: pinned\n    ${text}\n  found ${String(found.length)}\n    ${found.join('\n    ') || '(none)'}`);
  }
  return out;
}

/**
 * The identifiers `draw-imp.h` declares that no installed header names, which are the internal ones.
 * @param {string} internal @param {string} installed every installed header's text, joined
 */
export function internalNames(internal, installed) {
  const declared = new Set([...internal.matchAll(/\bfz_[A-Za-z0-9_]+\b/gu)].map((m) => m[0]));
  const publicNames = new Set([...installed.matchAll(/\bfz_[A-Za-z0-9_]+\b/gu)].map((m) => m[0]));
  return new Set([...declared].filter((name) => !publicNames.has(name)));
}

/**
 * The internal names `shim` uses that are not pinned.
 * @param {string} shim @param {ReadonlySet<string>} internal
 */
export function unpinnedUses(shim, internal) {
  const used = new Set([...shim.matchAll(/\bfz_[A-Za-z0-9_]+\b/gu)].map((m) => m[0]).filter((name) => internal.has(name)));
  return [...used].filter((name) => !Object.hasOwn(PINNED, name)).sort();
}

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

/** @param {boolean} ok @param {string} detail */
function expect(ok, detail) {
  if (!ok) throw new Error(detail);
}

/** @param {string} dir @returns {string[]} */
function headerFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...headerFiles(path));
    else if (entry.endsWith('.h')) out.push(path);
  }
  return out;
}

const shim = readFileSync(join(ROOT, 'native', 'mupdf-shim', 'monstera_mupdf.c'), 'utf8');

test('the shim includes draw-imp.h, so what this pins is what it compiles against (CONTROL: the subject is the file read)', () => {
  expect(shim.includes('#include "../source/fitz/draw-imp.h"'), 'the shim no longer includes draw-imp.h: this proof pins nothing it uses');
});

const source = mupdfSourcePath(ROOT);
const drawImp = join(source, 'source', 'fitz', 'draw-imp.h');
const context = join(source, 'include', 'mupdf', 'fitz', 'context.h');
const SOURCE_CASES = [
  'every pinned declaration reads, in the provisioned source, as the text the cut was written against',
  'a declaration changed in a copy of the header is reported, by name (CONTROL: the comparison can see a difference)',
  'every internal name the shim uses is pinned',
  'a use of an internal name that is not pinned is reported (CONTROL: the closure can see a new use)',
];

if (!existsSync(drawImp) || !existsSync(context)) {
  for (const label of SOURCE_CASES) roster.record(roster.mark(), `${label} — NOT RUN: MuPDF's source is not provisioned here`, false);
} else {
  const headers = { 'draw-imp.h': readFileSync(drawImp, 'utf8'), 'context.h': readFileSync(context, 'utf8') };
  test(SOURCE_CASES[0] ?? '', () => {
    const found = differences(headers);
    expect(found.length === 0, `MuPDF's internal declarations moved; read mz_cut_line_art again, then move PINNED:\n  ${found.join('\n  ')}`);
  });
  test(SOURCE_CASES[1] ?? '', () => {
    // TOWARDS DISAGREEMENT: two members of the table swapped, which compiles and calls the wrong function.
    const swapped = headers['draw-imp.h'].replace(
      'fz_rasterizer_insert_fn *insert;\n\tfz_rasterizer_insert_rect_fn *rect;',
      'fz_rasterizer_insert_rect_fn *rect;\n\tfz_rasterizer_insert_fn *insert;',
    );
    expect(swapped !== headers['draw-imp.h'], 'the mutation did not apply: the table is not spelt as it was');
    const found = differences({ ...headers, 'draw-imp.h': swapped });
    expect(found.length === 1 && (found[0] ?? '').startsWith('fz_rasterizer_fns '), `reported: ${found.join(' | ') || 'nothing'}`);
    // And a parameter widened on one prototype.
    const widened = headers['draw-imp.h'].replace('float flatness, float linewidth,', 'float flatness, float linewidth, int flags,');
    const second = differences({ ...headers, 'draw-imp.h': widened });
    expect(second.length === 1 && (second[0] ?? '').startsWith('fz_flatten_stroke_path '), `reported: ${second.join(' | ') || 'nothing'}`);
  });
  const installed = headerFiles(join(source, 'include'))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
  const internal = internalNames(headers['draw-imp.h'], installed);
  test(SOURCE_CASES[2] ?? '', () => {
    // A KNOWN-PRESENT ANCHOR: the stroker the cut calls is internal, so an empty set is a broken read and not a clean one.
    expect(internal.has('fz_flatten_stroke_path') && internal.has('fz_rasterizer_fns'), `the internal set lacks the stroker: ${String(internal.size)} names`);
    expect(!internal.has('fz_context'), 'fz_context, an installed name, was read as internal');
    const unpinned = unpinnedUses(shim, internal);
    expect(unpinned.length === 0, `the shim uses internal names this does not pin: ${unpinned.join(', ')}`);
  });
  test(SOURCE_CASES[3] ?? '', () => {
    const unpinned = unpinnedUses(`${shim}\nstatic void probe(fz_context *ctx) { fz_new_gel(ctx); }\n`, internal);
    expect(unpinned.join() === 'fz_new_gel', `reported: ${unpinned.join(', ') || 'nothing'}`);
  });
}

test('a declaration is read whole across a wrapped line, and a lookalike name is not taken for it', () => {
  const wrapped = 'int fz_flatten_fill_path(fz_context *ctx,\n\tfz_rasterizer *rast);\nint fz_flatten_fill_path_ex(fz_context *ctx);\n';
  const found = declarationsOf(wrapped, 'fz_flatten_fill_path');
  expect(found.length === 1 && found[0] === 'int fz_flatten_fill_path(fz_context *ctx, fz_rasterizer *rast);', `found: ${found.join(' | ')}`);
});

if (failures.length > 0) {
  process.stderr.write(`\n${String(failures.length)} draw-imp.h pin failure(s):\n\n${failures.join('\n\n')}\n\n`);
  process.exit(1);
}
process.stdout.write(roster.format('draw-imp.h pin case'));
