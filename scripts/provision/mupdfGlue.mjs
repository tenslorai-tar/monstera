// @ts-check
/**
 * MuPDF's own WASM binding, turned into C a native build can compile
 * ([ADR-0124](../../docs/DECISIONS/0124-mupdfs-own-bindings-compiled-native-are-the-shims-abi.md)).
 *
 * `platform/wasm/lib/mupdf.c` is MuPDF's flat-C layer under the npm package's
 * object model: 319 `wasm_*` exports over MuPDF's API, written for emscripten.
 * This module rewrites the three things in it that only emscripten can run, and
 * leaves every line of MuPDF's logic as it is:
 *
 * 1. **Every export gets a wrapper that ends MuPDF's unwind inside the DLL.**
 *    `wasm_rethrow` throws a JavaScript exception in WASM; native, it becomes a
 *    `longjmp` to the innermost wrapper, which `setjmp`s in its own frame and
 *    returns zero. So nothing unwinds through koffi's frames — the shim's
 *    founding rule (`native/mupdf-shim/README.md`).
 * 2. **Every `EM_ASM` becomes a typed call.** Its arguments mix floats and
 *    pointers, and some cast a pointer to `int` — which WASM allows and a 64-bit
 *    build truncates. So each call site's target has a TYPE STRING in
 *    {@link CALLBACKS}, written from the C it replaces, and the generator refuses
 *    a target it does not know or an argument count that disagrees with it.
 * 3. **The DLL carries its own signature table**, so `mupdfRaw.ts` binds from the
 *    C prototypes rather than from a second list of them.
 *
 * Pure: {@link generateGlue} takes the source text and returns the C, so its
 * proof runs on fixtures with no MuPDF tree present.
 */
import { createHash } from 'node:crypto';

/**
 * The callback targets `mupdf.c` calls into JavaScript, and each argument's C
 * type: `p` a pointer, `i` an int, `l` a 64-bit integer, `f` a float.
 *
 * Written from the C arguments at each site, not from the `$n` the JavaScript
 * reads — `begin_tile` passes eight and reads seven, and it is the C call whose
 * types the varargs must match. A leading `(int)` cast on a `p` or `l` argument
 * is removed: it is WASM's 32-bit assumption, and native it truncates.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CALLBACKS = {
  load_font_file: 'ppii',
  stm_close: 'i',
  stm_read: 'ilpi',
  stm_seek: 'illi',
  'path_walk.moveto': 'pff',
  'path_walk.lineto': 'pff',
  'path_walk.curveto': 'pffffff',
  'path_walk.closepath': 'p',
  'text_walk.begin_span': 'ippiiip',
  'text_walk.show_glyph': 'ippiiiii',
  'text_walk.end_span': 'i',
  log_error: 'p',
  log_warning: 'p',
  'device.drop_device': 'i',
  'device.close_device': 'i',
  'device.fill_path': 'ipippipf',
  'device.clip_path': 'ipip',
  'device.stroke_path': 'ippppipf',
  'device.clip_stroke_path': 'ippp',
  'device.fill_text': 'ipppipf',
  'device.stroke_text': 'ippppipf',
  'device.clip_text': 'ipp',
  'device.clip_stroke_text': 'ippp',
  'device.ignore_text': 'ipp',
  'device.fill_shade': 'ippf',
  'device.fill_image': 'ippf',
  'device.fill_image_mask': 'ipppipf',
  'device.clip_image_mask': 'ipp',
  'device.pop_clip': 'i',
  'device.begin_mask': 'ipipip',
  'device.end_mask': 'ip',
  'device.begin_group': 'ippiiif',
  'device.end_group': 'i',
  'device.begin_tile': 'ippffpii',
  'device.end_tile': 'i',
  'device.begin_layer': 'ip',
  'device.end_layer': 'i',
};

/**
 * Exports of MuPDF's binding this build does NOT carry, each with its reason. Removing the definition removes the
 * only reference to what it calls, so the linker drops it.
 *
 * `wasm_pdf_enable_js` turns on MuPDF's JavaScript interpreter. Invariant 24 rests on no interpreter being linked
 * into the shipped shim (`proof:activecontent`), and this export is the one call that brings it back — measured
 * 2026-09-30: with it compiled in, the scan found MuJS's registration strings in `monstera_mupdf.dll`.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const WITHHELD = {
  wasm_pdf_enable_js: 'turns on the JavaScript interpreter, which invariant 24 keeps out of the shipped shim',
  // (Each reason completes "an export that …" in the marker the generator leaves in the glue.)
  // Measured 2026-09-30 by `check:pathdispatch`, once it read the generated glue: this export is MuPDF's
  // format-string dispatcher, `fz_new_document_writer_with_buffer`, whose `ocr` writer starts Tesseract.
  wasm_new_document_writer_with_buffer:
    'passes a format string to MuPDF\'s writer dispatcher, which invariant 23 bans from shipped code',
  // Found 2026-09-30 by `check:advisories`, once the object model was shipped code: font subsetting is the path to
  // ARTIFEX-BUG-709567, a memory overwrite in CFF2 subsetting that no release fixes, and to CVE-2026-7233's code. The
  // register's NOT-REACHABLE verdicts rest on no shipped path reaching it; withholding the export keeps that true.
  wasm_pdf_subset_fonts: 'is font subsetting, the path to a memory overwrite no MuPDF release fixes (ARTIFEX-BUG-709567)',
};

/** The error kinds `wasm_rethrow` distinguishes, as the runtime numbers them. */
const THROWS = [
  { pattern: /^\{\s*throw\s+"TRYLATER";\s*\}$/, kind: 'MZG_TRYLATER', message: 'argument' },
  { pattern: /^\{\s*throw\s+"ABORT";\s*\}$/, kind: 'MZG_ABORT', message: 'argument' },
  { pattern: /^\{\s*throw\s+new\s+Error\(UTF8ToString\(\$0\)\);\s*\}$/, kind: 'MZG_ERROR', message: 'argument' },
  { pattern: /^\{\s*throw\s+new\s+Error\(("[^"]*")\);\s*\}$/, kind: 'MZG_ERROR', message: 'literal' },
];

/**
 * C parameter and return types, as koffi spells them at the boundary. Every
 * pointer crosses as `intptr_t`: an exact JavaScript number (measured
 * 2026-09-30), which the object model compares with 0 and offsets.
 *
 * @param {string} type a C type with its whitespace normalised
 * @returns {string}
 */
export function koffiType(type) {
  const t = type.replace(/\bconst\b/g, '').replace(/\s+/g, ' ').trim();
  if (t.includes('*')) return 'intptr_t';
  switch (t) {
    case 'void':
      return 'void';
    case 'int':
    case 'boolean':
      return 'int';
    case 'float':
      return 'float';
    case 'double':
      return 'double';
    case 'size_t':
      return 'size_t';
    case 'int64_t':
      return 'int64_t';
    case 'unsigned int':
      return 'uint32_t';
    default:
      throw new Error(`mupdfGlue: no koffi spelling for the C type "${type}"`);
  }
}

/**
 * Index of the character closing the bracket opened at `open`, skipping string
 * and character literals and comments.
 *
 * @param {string} text
 * @param {number} open index of `(`, `{` or `[`
 */
export function matching(text, open) {
  const pairs = /** @type {Record<string, string>} */ ({ '(': ')', '{': '}', '[': ']' });
  const opener = text[open];
  const closer = opener === undefined ? undefined : pairs[opener];
  if (closer === undefined) throw new Error(`mupdfGlue: no bracket at ${open}`);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"' || c === "'") {
      i += 1;
      while (i < text.length && text[i] !== c) i += text[i] === '\\' ? 2 : 1;
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      i = text.indexOf('\n', i);
    } else if (c === opener) {
      depth += 1;
    } else if (c === closer) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`mupdfGlue: unbalanced ${opener} at ${open}`);
}

/**
 * Splits at commas outside brackets and literals.
 *
 * @param {string} text
 */
export function splitTopLevel(text) {
  /** @type {string[]} */
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"' || c === "'") {
      i += 1;
      while (i < text.length && text[i] !== c) i += text[i] === '\\' ? 2 : 1;
    } else if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') depth -= 1;
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part, index, all) => part !== '' || all.length > 1);
}

/**
 * One parameter split into its type and name. `(void)` has none.
 *
 * @param {string} parameter
 */
function parameter(parameter) {
  const match = /^(.*?)([A-Za-z_]\w*)$/s.exec(parameter.trim());
  if (match === null || match[1] === undefined || match[2] === undefined || match[1].trim() === '') {
    throw new Error(`mupdfGlue: cannot read the parameter "${parameter}"`);
  }
  return { type: match[1].trim(), name: match[2] };
}

/**
 * @typedef {{ name: string, returns: string, parameters: { type: string, name: string }[] }} Export
 */

/**
 * Expands, in place, every invocation of a macro that DEFINES exports.
 *
 * `mupdf.c` defines about 170 of its exports through macros — `GET(buffer, int,
 * len)`, `PDF_ANNOT_HAS(rect)`, `REFS(pixmap)` — and several of them wrap a
 * throwing call, so an export left inside a macro would reach `wasm_rethrow`
 * with no wrapper to jump to. The expansion is the C preprocessor's own rule for
 * these simple forms: whole-token parameter substitution, then `##` pasting, then
 * the result rescanned for further export macros. Macros that do not define an
 * export (`POINTER`, `TRY`) are left for the compiler.
 *
 * @param {string} text
 * @returns {string}
 */
export function expandExportMacros(text) {
  /** @type {Map<string, { params: string[], body: string }>} */
  const macros = new Map();
  const define = /^#define\s+([A-Za-z_]\w*)\(([^)]*)\)((?:[^\n]*\\\n)*[^\n]*)$/gm;
  for (let match = define.exec(text); match !== null; match = define.exec(text)) {
    const [, name = '', params = '', body = ''] = match;
    macros.set(name, { params: params.split(',').map((p) => p.trim()), body: body.replace(/\\\n/g, ' ') });
  }
  /** @param {string} name @param {Set<string>} seen @returns {boolean} */
  const definesExports = (name, seen = new Set()) => {
    const macro = macros.get(name);
    if (macro === undefined || seen.has(name)) return false;
    seen.add(name);
    if (/\bEXPORT\b/.test(macro.body)) return true;
    return [...macro.body.matchAll(/\b([A-Z_][A-Z0-9_]*)\s*\(/g)].some((m) => definesExports(m[1] ?? '', seen));
  };
  const exporting = new Set([...macros.keys()].filter((name) => definesExports(name)));

  /** @param {string} source @param {number} depth @returns {string} */
  const expand = (source, depth) => {
    if (depth > 8) throw new Error('mupdfGlue: export macros nest deeper than eight');
    let out = '';
    let cursor = 0;
    const call = /\b([A-Z_][A-Z0-9_]*)\s*\(/g;
    for (let match = call.exec(source); match !== null; match = call.exec(source)) {
      const name = match[1] ?? '';
      if (!exporting.has(name)) continue;
      const macro = macros.get(name);
      if (macro === undefined) continue;
      const open = source.indexOf('(', match.index);
      const close = matching(source, open);
      const args = splitTopLevel(source.slice(open + 1, close));
      if (args.length !== macro.params.length) {
        throw new Error(`mupdfGlue: ${name} takes ${macro.params.length} arguments and is given ${args.length}`);
      }
      let body = macro.body;
      macro.params.forEach((param, i) => {
        body = body.replace(new RegExp(`\\b${param}\\b`, 'g'), args[i] ?? '');
      });
      body = body.replace(/\s*##\s*/g, '');
      out += `${source.slice(cursor, match.index)}${expand(body, depth + 1)}`;
      cursor = close + 1;
      call.lastIndex = cursor;
    }
    return out + source.slice(cursor);
  };

  // Only invocations at the start of a line are definitions; the #define lines themselves are skipped.
  return text
    .split('\n')
    .map((line) => {
      const name = /^([A-Z_][A-Z0-9_]*)\s*\(/.exec(line)?.[1];
      if (name === undefined || !exporting.has(name)) return line;
      return expand(line, 0).replace(/\s*\bEXPORT\b/g, '\nEXPORT').replace(/^\n/, '');
    })
    .join('\n');
}

/**
 * Rewrites the exports: `EXPORT <ret> wasm_x(<params>)` becomes a static
 * `mzg_impl_wasm_x`, and the list is returned for the wrappers.
 *
 * @param {string} text
 * @returns {{ text: string, exports: Export[] }}
 */
function renameExports(text) {
  /** @type {Export[]} */
  const exports = [];
  let out = '';
  let cursor = 0;
  const marker = /^EXPORT\b/gm;
  for (let match = marker.exec(text); match !== null; match = marker.exec(text)) {
    const at = match.index;
    const open = text.indexOf('(', at);
    const close = matching(text, open);
    const body = text.indexOf('{', close);
    const between = text.slice(close + 1, body);
    if (between.trim() !== '') throw new Error(`mupdfGlue: text between an export's parameters and its body: "${between}"`);
    const head = text.slice(at + 'EXPORT'.length, open).replace(/\s+/g, ' ').trim();
    const named = /^(.*?)\b(wasm_\w+)$/.exec(head);
    if (named === null || named[1] === undefined || named[2] === undefined) {
      throw new Error(`mupdfGlue: an EXPORT that is not a wasm_ function: "${head}"`);
    }
    const inside = text.slice(open + 1, close).replace(/\s+/g, ' ').trim();
    if (WITHHELD[named[2]] !== undefined) {
      // The whole definition goes, so nothing in the DLL references what it called — and the marker left in its
      // place gives the reason without the name, so no text the library is built from names a withheld path.
      out += `${text.slice(cursor, at)}/* WITHHELD by scripts/provision/mupdfGlue.mjs: an export that ${WITHHELD[named[2]]} */`;
      cursor = matching(text, body) + 1;
      continue;
    }
    const parameters = inside === 'void' || inside === '' ? [] : splitTopLevel(inside).map(parameter);
    exports.push({ name: named[2], returns: named[1].trim(), parameters });
    out += `${text.slice(cursor, at)}static ${named[1].trim()} mzg_impl_${named[2]}(${inside})`;
    cursor = close + 1;
  }
  out += text.slice(cursor);
  if (exports.length === 0) throw new Error('mupdfGlue: found no EXPORT — the source and this parser have diverged');
  return { text: out, exports };
}

/**
 * Rewrites every `EM_ASM`, `EM_ASM_INT` and `EM_ASM_PTR` call into a typed call.
 *
 * @param {string} text
 * @returns {{ text: string, sites: number }}
 */
function rewriteEmAsm(text) {
  let out = '';
  let cursor = 0;
  let sites = 0;
  const marker = /\bEM_ASM(_INT|_PTR)?\s*\(/g;
  for (let match = marker.exec(text); match !== null; match = marker.exec(text)) {
    const open = text.indexOf('(', match.index);
    const close = matching(text, open);
    const [code = '', ...args] = splitTopLevel(text.slice(open + 1, close));
    const js = code.replace(/\s+/g, ' ').trim();
    const flavour = match[1] ?? '';
    let call;
    const thrown = THROWS.find((each) => each.pattern.test(js));
    if (thrown !== undefined) {
      if (flavour !== '') throw new Error(`mupdfGlue: a throw that returns a value: ${js}`);
      const literal = thrown.pattern.exec(js)?.[1];
      const message = thrown.message === 'literal' ? literal : args[0];
      if (message === undefined) throw new Error(`mupdfGlue: a throw with no message: ${js}`);
      call = `mzg_throw(${thrown.kind}, ${message})`;
    } else {
      const target = /globalThis\.\$libmupdf_([A-Za-z_]+(?:\.[A-Za-z_]+)?)\(/.exec(js)?.[1];
      if (target === undefined) throw new Error(`mupdfGlue: an EM_ASM this generator does not know: ${js}`);
      const types = CALLBACKS[target];
      if (types === undefined) throw new Error(`mupdfGlue: no type string for the callback "${target}"`);
      if (types.length !== args.length) {
        throw new Error(`mupdfGlue: "${target}" passes ${args.length} arguments and its type string names ${types.length}`);
      }
      const typed = args.map((arg, i) => {
        const kind = types[i];
        const bare = kind === 'p' || kind === 'l' ? arg.replace(/^\(\s*int\s*\)\s*/, '') : arg;
        switch (kind) {
          case 'p':
            return `(void *)(intptr_t)(${bare})`;
          case 'l':
            return `(int64_t)(${bare})`;
          case 'i':
            return `(int)(${bare})`;
          case 'f':
            return `(double)(${bare})`;
          default:
            throw new Error(`mupdfGlue: unknown type letter "${kind}"`);
        }
      });
      const invoke = `mzg_js("${target}", "${types}"${typed.map((arg) => `, ${arg}`).join('')})`;
      call = flavour === '_INT' ? `(int)${invoke}` : flavour === '_PTR' ? `(void *)(intptr_t)${invoke}` : `(void)${invoke}`;
    }
    out += `${text.slice(cursor, match.index)}${call}`;
    cursor = close + 1;
    sites += 1;
  }
  out += text.slice(cursor);
  return { text: out, sites };
}

/** @param {Export} each */
function wrapper(each) {
  const params = each.parameters.map((p) => `${p.type} ${p.name}`).join(', ') || 'void';
  const names = each.parameters.map((p) => p.name).join(', ');
  const isVoid = each.returns === 'void';
  const zero = isVoid ? 'return' : `return (${each.returns})0`;
  const lines = [
    `MZG_EXPORT ${each.returns} ${each.name}(${params})`,
    '{',
    '\tjmp_buf here;',
    '\tjmp_buf *outer = mzg_enter(&here);',
    `\tif (setjmp(here)) { mzg_leave(outer); ${zero}; }`,
  ];
  if (isVoid) lines.push(`\tmzg_impl_${each.name}(${names});`, '\tmzg_leave(outer);');
  else lines.push(`\t${each.returns} result = mzg_impl_${each.name}(${names});`, '\tmzg_leave(outer);', '\treturn result;');
  lines.push('}', '');
  return lines.join('\n');
}

/**
 * @param {string} source `platform/wasm/lib/mupdf.c`
 * @returns {{ c: string, exports: Export[], callbackSites: number, digest: string }}
 */
export function generateGlue(source) {
  const digest = createHash('sha256').update(source).digest('hex');
  if (!source.includes('#include "emscripten.h"')) throw new Error('mupdfGlue: the source does not include emscripten.h');
  const included = source.replace('#include "emscripten.h"', '#include "monstera_emscripten.h"');
  const renamed = renameExports(expandExportMacros(included));
  const rewritten = rewriteEmAsm(renamed.text);
  if (/\bEM_ASM/.test(rewritten.text)) throw new Error('mupdfGlue: an EM_ASM survived the rewrite');

  const prototypes = renamed.exports
    .map((each) => `MZG_EXPORT ${each.returns} ${each.name}(${each.parameters.map((p) => `${p.type} ${p.name}`).join(', ') || 'void'});`)
    .join('\n');
  const anchor = 'typedef int boolean;';
  if (!rewritten.text.includes(anchor)) throw new Error(`mupdfGlue: "${anchor}" is where the prototypes go and it is gone`);
  const withPrototypes = rewritten.text.replace(anchor, `${anchor}\n\n/* Generated: the exports, declared before the implementations that call one another. */\n${prototypes}\n`);

  const rows = renamed.exports.map(
    (each) =>
      `\t"${each.name}|${koffiType(each.returns)}|${each.parameters.map((p) => koffiType(p.type)).join(',')}",`,
  );
  const c = [
    `/* GENERATED by scripts/provision/mupdfGlue.mjs from MuPDF's platform/wasm/lib/mupdf.c (sha256 ${digest}). Do not edit. */`,
    withPrototypes,
    '',
    '/* ---- Generated: one wrapper per export (ADR-0124 Decision 2). ---- */',
    '',
    ...renamed.exports.map(wrapper),
    '/* ---- Generated: the context, for the runtime, and the signature table (ADR-0124 Decision 3). ---- */',
    '',
    'fz_context *mzg_context(void) { return ctx; }',
    '',
    'static const char *const mzg_rows[] = {',
    ...rows,
    '};',
    '',
    `MZG_EXPORT const char *mzg_upstream_digest(void) { return "${digest}"; }`,
    'MZG_EXPORT int mzg_signature_count(void) { return (int)(sizeof mzg_rows / sizeof mzg_rows[0]); }',
    'MZG_EXPORT const char *mzg_signature(int i) { return i >= 0 && i < mzg_signature_count() ? mzg_rows[i] : 0; }',
    '',
  ].join('\n');
  return { c, exports: renamed.exports, callbackSites: rewritten.sites, digest };
}
