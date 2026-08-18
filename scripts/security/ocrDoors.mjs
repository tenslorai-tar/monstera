// @ts-check
/**
 * Derives, from the engine source, every public MuPDF function through which
 * this application could reach Tesseract or Leptonica.
 *
 * ## Why a derivation rather than a list
 *
 * The advisory register holds a NOT-REACHABLE verdict for Tesseract and
 * Leptonica, and such a verdict is a claim about THIS codebase that expires
 * silently the moment a feature calls the wrong function. The mechanism that
 * catches it — `reachability` in engine-advisories.json — checks that shipped
 * code references no door symbol. That check is only as sound as the door list,
 * and a hand-written door list is a claim of the same kind as the verdict it
 * supports: correct on the day it was written, and unreviewed on the day MuPDF
 * adds an entry point.
 *
 * So the list is computed from the source we build, and a symbol appearing that
 * the register does not name is a failure.
 *
 * ## What "reachable" is measured over
 *
 * Presence in the DLL is not the question. `?AVTessErrStream@tesseract@@` is in
 * the shipped binary; the linker kept Tesseract because MuPDF's own OCR
 * translation units reference it, which says nothing about whether any of the
 * shim's 24 exported functions can get there. The question is a call path, so
 * the measurement is over call paths.
 *
 * Seeds are the two doors into the native libraries, read from the headers
 * rather than named here:
 *
 *   - `source/fitz/tessocr.h` — the entire Tesseract API MuPDF exposes to
 *     itself. Three functions.
 *   - `source/fitz/leptonica-wrap.h` — Leptonica's arming point. In this build
 *     Leptonica is armed from exactly one call site, `ocr_init` in tessocr.cpp,
 *     which is why Leptonica sits behind the same doors as Tesseract even
 *     though it is a separate library with a separate CVE history.
 *
 * From those, callers are walked UPWARD to a fixed point, and the members of
 * that closure which a public header declares are the doors. Upward rather than
 * downward because the closure is small in that direction and enormous in the
 * other.
 *
 * ## Function granularity, deliberately
 *
 * A file-level walk would call `fz_clone_text_span` a door, because it happens
 * to be defined in `ocr-device.c` while reaching no OCR code at all. Shipped
 * code calling it would then trip a security check for no reason — and a check
 * that fires on innocent code is the one that eventually gets switched off.
 *
 * ## What this does NOT establish
 *
 * A function-pointer table assigned at run time is invisible to this, and one
 * such door is real and is reported separately: `fz_new_document_writer`
 * selects the pdfocr writer from a FILE EXTENSION, so a path ending `.ocr`
 * reaches Tesseract without any caller naming a pdfocr symbol. That is why it
 * appears in the derived set — writer.c names the symbol — and why the register
 * records it as a filename-driven door rather than an ordinary call.
 *
 * Usage:
 *   node scripts/security/ocrDoors.mjs        print the derived doors
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { compiledSources } from '../lib/mupdfBuildGraph.mjs';

/** Headers whose declarations make a symbol part of MuPDF's public API. */
const PUBLIC_HEADER_ROOT = join('include', 'mupdf');

/** @param {string} directory @param {string[]} extensions @returns {string[]} */
function filesUnder(directory, extensions) {
  if (!existsSync(directory)) return [];
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(path, extensions));
    else if (extensions.includes(extname(entry.name))) found.push(path);
  }
  return found;
}

/** Column-0 words that begin a statement or directive, never a definition. */
const NOT_A_DEFINITION = new Set(['if', 'else', 'for', 'while', 'switch', 'return', 'do', 'case']);

/**
 * Removes comments and string literals, keeping line structure.
 *
 * Not tidiness — the derivation is unusable without it. `ocr-device.c` opens
 * with a prose block comment written flush to column 0, and one of its
 * sentences is "The incoming calls are also forwarded (mostly, eventually) to
 * the". That is an identifier at column 0 followed by a parenthesis, which is
 * exactly the shape of a definition, so the parser opened a function called
 * `forwarded` and swallowed the rest of the file: ONE function recognised in
 * the single most important translation unit, and every call site into
 * Tesseract invisible. The derivation reported that nothing reaches the OCR
 * subsystem, which is the answer someone hoping for a clean verdict would have
 * accepted.
 *
 * String literals go too, so a path or an error message mentioning a symbol
 * cannot forge a call edge.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripCommentsAndStrings(text) {
  let out = '';
  /** @type {'code' | 'line' | 'block' | 'string' | 'char'} */
  let state = 'code';

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];

    if (state === 'code') {
      if (c === '/' && next === '/') { state = 'line'; i += 1; continue; }
      if (c === '/' && next === '*') { state = 'block'; i += 1; continue; }
      if (c === '"') { state = 'string'; continue; }
      if (c === "'") { state = 'char'; continue; }
      out += c;
      continue;
    }

    // Newlines survive every state, so `^}` and column-0 tests still mean what
    // they mean in the original file.
    if (c === '\n') { out += '\n'; if (state === 'line') state = 'code'; continue; }
    if (state === 'block' && c === '*' && next === '/') { state = 'code'; i += 1; continue; }
    if (state === 'string' && c === '\\') { i += 1; continue; }
    if (state === 'string' && c === '"') { state = 'code'; continue; }
    if (state === 'char' && c === '\\') { i += 1; continue; }
    if (state === 'char' && c === "'") { state = 'code'; continue; }
  }
  return out;
}

/**
 * Function definitions in one translation unit.
 *
 * A definition starts at column 0 — MuPDF indents every nested construct — and
 * ends at a `}` in column 0. Both the C style, with the return type on the line
 * above the name, and the C++ style, with the type on the same line, are
 * accepted: reading only the first cost a whole measurement. The initial version
 * required the name itself at column 0, which is true of every `.c` file in the
 * engine and false of `tessocr.cpp`, so the three functions that ARE the
 * Tesseract door were never recognised as functions, every edge into them was
 * dropped, and the derivation reported that nothing reaches Tesseract. The
 * reassuring answer, produced by a parse bug.
 *
 * A line ending in `;` before any `{` is a declaration and is abandoned rather
 * than swallowing the rest of the file as one enormous body.
 *
 * `static` is reported because it decides linkage, and linkage decides identity:
 * two units may each define `file_level_headers` and they are different
 * functions. The keyword usually sits on the line ABOVE the name in this
 * codebase, so the previous line is part of the signature for this purpose.
 *
 * @param {string} source
 * @returns {Array<{ name: string, body: string, isStatic: boolean }>}
 */
export function functionsIn(source) {
  const text = stripCommentsAndStrings(source);
  /** @type {Array<{ name: string, body: string, isStatic: boolean }>} */
  const functions = [];

  /** @type {{ name: string, isStatic: boolean, lines: string[] } | null} */
  let signature = null;
  /** @type {{ name: string, isStatic: boolean, lines: string[] } | null} */
  let body = null;
  let previous = '';

  for (const line of text.split('\n')) {
    const wasPrevious = previous;
    previous = line;

    if (body !== null) {
      body.lines.push(line);
      if (line.startsWith('}')) {
        functions.push({ name: body.name, body: body.lines.join('\n'), isStatic: body.isStatic });
        body = null;
      }
      continue;
    }

    if (signature !== null) {
      signature.lines.push(line);
      if (line.includes('{')) {
        body = signature;
        signature = null;
      } else if (/;\s*$/u.test(line)) {
        signature = null;
      }
      continue;
    }

    // The last identifier before the opening parenthesis is the name; anything
    // before it is a return type, `static`, or pointer punctuation. The prefix
    // is OPTIONAL as a whole — written as a mandatory leading character it
    // consumed the name's own first letter, so a definition starting at column 0
    // could never match and only the prefixed C++ style was recognised.
    const definition = /^(?:[A-Za-z_][A-Za-z0-9_ \t*&]*?\b)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/u.exec(line);
    if (definition === null) continue;
    const name = `${definition[1]}`;
    if (NOT_A_DEFINITION.has(name) || /;\s*$/u.test(line)) continue;

    const isStatic = /\bstatic\b/u.test(line) || /\bstatic\b/u.test(wasPrevious);
    if (line.includes('{')) body = { name, isStatic, lines: [line] };
    else signature = { name, isStatic, lines: [line] };
  }
  return functions;
}

/**
 * Every identifier a function body mentions — not only those in call position.
 *
 * A call-position edge is the wrong relation for this engine and measuring it
 * proved so: the first run returned a closure of 8 functions and ZERO public
 * doors, because `fz_new_ocr_device` does not call `ocr_init`. It builds a
 * device whose vtable holds `fz_ocr_close_device`, and the OCR work happens when
 * something later calls `fz_close_device` on it. Every door into this subsystem
 * is a stored function pointer, so an analysis that only follows direct calls
 * reports that nothing reaches Tesseract — the reassuring answer, and wrong.
 *
 * Taking a mention as an edge over-approximates: a function that merely names
 * another in a comment is counted as reaching it. That is the safe direction for
 * a security verdict, and the derivation's size is asserted rather than assumed
 * so the over-approximation cannot quietly swell into the whole engine.
 *
 * @param {string} text
 * @returns {string[]}
 */
function referencesIn(text) {
  return [...text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/gu)].map((match) => `${match[1]}`);
}

/**
 * Function names a header declares.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function declaredIn(source) {
  const text = stripCommentsAndStrings(source);

  // Split on `;` first, then take the identifier before each statement's first
  // `(`. Matching a whole declaration with one pattern does not survive this
  // input: a greedy run of "anything but `;` or `{`" has to cross newlines,
  // because MuPDF wraps long declarations over three lines — and once it can, a
  // candidate that is not a declaration extends to the next `);` several lines
  // down and consumes the real declarations in between. That is how
  // `fz_new_document_writer` went missing from the public API set while sitting
  // on one unremarkable line of writer.h, and a door absent from this set is
  // a door the reachability check will never watch.
  // Within a statement, the parameter list is the parenthesised group that ENDS
  // it, so the opening bracket is found by matching backwards from the last `)`.
  // Taking the first `(` instead is wrong whenever a statement carries leading
  // debris — a macro, or a struct body whose `;` sits far below — and that is
  // still enough to lose `fz_new_document_writer`.
  /** @type {string[]} */
  const names = [];
  for (const statement of text.split(';')) {
    const trimmed = statement.trimEnd();
    if (!trimmed.endsWith(')')) continue;

    let depth = 0;
    let open = -1;
    for (let i = trimmed.length - 1; i >= 0; i -= 1) {
      const c = trimmed[i];
      if (c === ')') depth += 1;
      else if (c === '(') {
        depth -= 1;
        if (depth === 0) { open = i; break; }
      }
    }
    if (open <= 0) continue;

    const before = /([A-Za-z_][A-Za-z0-9_]*)\s*$/u.exec(trimmed.slice(0, open));
    if (before !== null) names.push(`${before[1]}`);
  }
  return names;
}

/**
 * @typedef {{
 *   seeds: string[],
 *   doors: string[],
 *   closure: string[],
 *   publicSymbols: number,
 *   pathToSeed: (name: string) => string[],
 * }} OcrDoors
 */

/**
 * Every function name MuPDF's public headers declare.
 *
 * @param {string} sourceRoot
 * @returns {Set<string>}
 */
export function publicApiSymbols(sourceRoot) {
  /** @type {Set<string>} */
  const symbols = new Set();
  for (const path of filesUnder(join(sourceRoot, PUBLIC_HEADER_ROOT), ['.h'])) {
    for (const name of declaredIn(readFileSync(path, 'utf8'))) symbols.add(name);
  }

  if (symbols.size === 0) {
    throw new Error(
      `No declarations were found under ${PUBLIC_HEADER_ROOT}/. Without the public API there is ` +
        `nothing to intersect a closure with, and every derived list would come back empty — ` +
        `which reads as "nothing to worry about".`,
    );
  }
  return symbols;
}

/**
 * @typedef {{
 *   callers: Map<string, string[]>,
 *   callees: Map<string, string[]>,
 *   globals: Set<string>,
 *   locals: Set<string>,
 *   fileCount: number,
 * }} CallGraph
 */

/**
 * The call graph over the files the shim compiles, plus any extra sources.
 *
 * Both directions are kept. The door derivation walks callers upward from
 * Tesseract; the shim-reachability question walks callees downward from our own
 * exports, and the two must agree about what an edge is or the pair of answers
 * means nothing.
 *
 * @param {string} sourceRoot
 * @param {string} shimProject
 * @param {object} [options]
 * @param {readonly string[]} [options.extraFiles] Sources outside the MuPDF
 *   build graph — our own shim translation unit, for the forward walk.
 * @param {readonly string[]} [options.assumeDefined] Names that are functions
 *   whether or not a definition was parsed. A parse that stops recognising one
 *   must lose call sites, not lose the node and report an empty result.
 * @returns {CallGraph}
 */
export function buildCallGraph(sourceRoot, shimProject, options = {}) {
  const build = compiledSources(sourceRoot, shimProject);
  if (build === null) {
    throw new Error(
      `Could not read the build graph rooted at ${shimProject}. An analysis over the wrong file ` +
        `set is not a smaller answer, it is a different one.`,
    );
  }

  const units = [...build.files, ...(options.extraFiles ?? [])]
    .filter((path) => existsSync(path))
    .map((path) => ({ path, functions: functionsIn(readFileSync(path, 'utf8')) }));

  // A `static` function's name is file-local: two translation units may each
  // define `file_level_headers` and they are different functions. Keying every
  // name globally merged them, and five unrelated entry points bled into the
  // door list through one such collision.
  /** @type {Set<string>} */
  const globals = new Set(options.assumeDefined ?? []);
  /** @type {Set<string>} */
  const locals = new Set();
  for (const unit of units) {
    for (const fn of unit.functions) {
      if (fn.isStatic) locals.add(`${unit.path}::${fn.name}`);
      else globals.add(fn.name);
    }
  }

  if (globals.size <= (options.assumeDefined ?? []).length && locals.size === 0) {
    throw new Error(
      `No function definitions were found in ${units.length} source file(s). The parse is reading ` +
        `the wrong thing, and an analysis over an empty call graph reports nothing — which reads ` +
        `as "nothing is reachable".`,
    );
  }

  /** @type {Map<string, string[]>} */
  const callers = new Map();
  /** @type {Map<string, string[]>} */
  const callees = new Map();
  for (const unit of units) {
    for (const fn of unit.functions) {
      const from = fn.isStatic ? `${unit.path}::${fn.name}` : fn.name;
      for (const referenced of new Set(referencesIn(fn.body))) {
        // File-local resolution first, exactly as C resolves it.
        const local = `${unit.path}::${referenced}`;
        const target = locals.has(local) ? local : globals.has(referenced) ? referenced : null;
        if (target === null || target === from) continue;

        const inbound = callers.get(target);
        if (inbound === undefined) callers.set(target, [from]);
        else inbound.push(from);

        const outbound = callees.get(from);
        if (outbound === undefined) callees.set(from, [target]);
        else outbound.push(target);
      }
    }
  }

  return { callers, callees, globals, locals, fileCount: units.length };
}

/**
 * @param {string} sourceRoot Absolute path to the MuPDF source tree.
 * @param {string} shimProject Absolute path to monstera_mupdf.vcxproj — the
 *   root of the link line, and therefore of the file set this walks.
 * @returns {OcrDoors}
 */
export function deriveOcrDoors(sourceRoot, shimProject) {
  const tessocr = join(sourceRoot, 'source', 'fitz', 'tessocr.h');
  const leptonica = join(sourceRoot, 'source', 'fitz', 'leptonica-wrap.h');
  for (const header of [tessocr, leptonica]) {
    if (!existsSync(header)) {
      throw new Error(
        `${header} does not exist. The seeds of this derivation are read from the headers rather ` +
          `than hardcoded, so a MuPDF release that restructures them must fail here — a walk that ` +
          `silently started from nothing would report no doors and read as "not reachable".`,
      );
    }
  }

  const seeds = [
    ...new Set([
      ...declaredIn(readFileSync(tessocr, 'utf8')),
      ...declaredIn(readFileSync(leptonica, 'utf8')),
    ]),
  ].sort();

  if (seeds.length === 0) {
    throw new Error(
      `No function declarations were found in tessocr.h or leptonica-wrap.h. The parse is reading ` +
        `the wrong thing, and an empty seed set would make every door disappear.`,
    );
  }

  // The graph is built over the files this project COMPILES, not over MuPDF's
  // repository. Walking the whole tree pulls in mutool, mudraw and muconvert;
  // each has a `main`, and with names keyed globally that one identifier binds
  // unrelated programs into a single node, so the walk bleeds through it. It did
  // — five SVG entry points arrived as doors by way of
  // `fz_new_svg_device_with_options -> main -> file_level_headers`, a chain
  // through two collisions and no real call.
  const { callers } = buildCallGraph(sourceRoot, shimProject, { assumeDefined: seeds });

  // Upward closure: anything that can reach something already in the set.
  //
  // `via` records the edge each member entered by, so a door can be explained
  // rather than merely asserted. An unexplained entry in a security-bearing list
  // is one nobody can check and nobody removes.
  /** @type {Map<string, string>} */
  const via = new Map();
  /** @type {Set<string>} */
  const closure = new Set(seeds);
  /** @type {string[]} */
  const queue = [...seeds];
  while (queue.length > 0) {
    const name = `${queue.shift()}`;
    for (const caller of callers.get(name) ?? []) {
      if (closure.has(caller)) continue;
      closure.add(caller);
      via.set(caller, name);
      queue.push(caller);
    }
  }

  const publicSymbols = publicApiSymbols(sourceRoot);
  const doors = [...closure].filter((name) => publicSymbols.has(name)).sort();

  // POSITIVE CONTROL, in the instrument rather than only in its proof (audit
  // item 4b). Every one of this derivation's four failures produced an empty or
  // near-empty door list, and the empty-set floors above catch only the ones
  // that empty an INPUT — a walk that reads every input correctly and still
  // reaches nothing looked exactly like a clean result.
  //
  // Zero doors is never a legitimate answer here: MuPDF exposes OCR through its
  // public API by construction, so `ocr_init` is reachable from something
  // declared in a public header. If that ever stops being true it is a finding,
  // not a quiet pass.
  //
  // The proof asserts specific doors; this cannot, because the names are
  // version-specific and the whole point is to survive an engine upgrade. What
  // it can refuse is silence — and the proof runs in CI while the instrument
  // gets run by hand on the day somebody needs an answer.
  if (doors.length === 0) {
    throw new Error(
      `The closure reached ${closure.size} function(s) from ${seeds.length} seed(s) but none of ` +
        `them is declared in a public header, so this run found no doors at all. MuPDF exposes ` +
        `OCR through its public API, so zero doors means the walk is broken — not that nothing ` +
        `reaches Tesseract. Run with the closure printed and find where the chain stops.`,
    );
  }

  /** @param {string} name @returns {string[]} The edge chain back to a seed. */
  const pathToSeed = (name) => {
    /** @type {string[]} */
    const chain = [name];
    let current = via.get(name);
    while (current !== undefined && !chain.includes(current)) {
      chain.push(current);
      current = via.get(current);
    }
    return chain;
  };

  return {
    seeds,
    doors,
    closure: [...closure].sort(),
    publicSymbols: publicSymbols.size,
    pathToSeed,
  };
}

if (process.argv[1]?.endsWith('ocrDoors.mjs')) {
  const { mupdfSourcePath } = await import('../provision/mupdf.mjs');
  const { repoRoot } = await import('../lib/gitScope.mjs');
  const root = repoRoot();
  const derived = deriveOcrDoors(
    mupdfSourcePath(root),
    join(root, 'native', 'mupdf-shim', 'monstera_mupdf.vcxproj'),
  );
  process.stdout.write(
    `seeds (${derived.seeds.length}): ${derived.seeds.join(', ')}\n\n` +
      `public API symbols seen: ${derived.publicSymbols}\n` +
      `closure (${derived.closure.length}): ` +
      `${derived.closure.map((name) => name.replace(/^.*[\\/]/u, '')).join(', ')}\n\n` +
      `PUBLIC DOORS (${derived.doors.length}), each with the chain back to a seed:\n` +
      derived.doors
        .map((door) => `  ${door}\n      ${derived.pathToSeed(door).join(' -> ')}\n`)
        .join(''),
  );
}
