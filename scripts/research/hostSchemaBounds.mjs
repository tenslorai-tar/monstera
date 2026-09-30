// @ts-check
/**
 * What is the largest answer each engine host channel's own result schema admits, against the frame it must fit?
 *
 * ## Why this exists
 *
 * `hostAnswerSizes.mjs` measures what documents DO produce. This asks what a channel PROMISES: a result schema that
 * admits more bytes than `ENGINE_HOST_FRAME_MAX_BYTES` carries is a promise the transport cannot keep, and the day a
 * document produces such an answer the host ends itself with the answer unsent — which is what the owner's install
 * of 0.1.5.0 met on `engine/text-runs` (2026-09-30). A measurement over a corpus finds the documents that happen to
 * be in it; the schema says what every document may do.
 *
 * ## How the maximum is computed
 *
 * A walk of zod 4's own definition objects (`_zod.def`). An array is its declared maximum times its element; a string
 * its maximum characters; a number the longest a double renders (24 characters); an object the sum of its keys and
 * values with JSON punctuation. Anything without a declared maximum — an array or string with no `.max`, a record, an
 * `unknown` — is UNBOUNDED, which is a finding of its own. Two figures per channel: PLAIN, one byte per character, and
 * WORST, six per character, the length of a `\u` escape — the latter is what a hostile host may send, the former
 * roughly what an honest one does.
 *
 * Positive control: `engine/text-runs`, whose schema admits far more than a frame, must be reported over it; a walk
 * that answered small for everything would print the reassuring answer, so without the control it refuses.
 *
 * Usage: node scripts/research/hostSchemaBounds.mjs
 */

import { pathToFileURL } from 'node:url';

import { HOST_READS, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';

const ROOT = repoRoot();
// THE BUILT SCHEMAS ARE THE SUBJECT, so a stale build would walk yesterday's channels under today's name.
refuseStaleBuild(ROOT, HOST_READS, 3);
/** @param {string} relative */
const built = (relative) => import(pathToFileURL(`${ROOT}/${relative}`).href);

const { ENGINE_HOST_FRAME_MAX_BYTES } = await built('packages/contract/dist/hostProtocol.js');
const { engineChannels } = await built('packages/kernel/dist/host/engineChannels.js');
const { pdfiumChannels } = await built('packages/kernel/dist/host/pdfiumChannels.js');
const { composeChannels } = await built('packages/kernel/dist/host/composeChannels.js');

/** The longest a JavaScript number renders in JSON: `-1.7976931348623157e+308`. */
const NUMBER_CHARS = 24;
/** The longest a safe integer renders: `-9007199254740991`. */
const INTEGER_CHARS = 17;

/**
 * @param {any} schema a zod 4 schema
 * @param {number} perChar bytes one string character may cost
 * @param {Set<unknown>} seen guards recursion through lazies
 * @returns {number} the maximum encoded bytes, or Infinity where nothing bounds it
 */
function maxBytes(schema, perChar, seen = new Set()) {
  const def = schema?._zod?.def;
  if (def === undefined) return Infinity;
  const checks = /** @type {any[]} */ (def.checks ?? []);
  /** @param {string} kind */
  const limit = (kind) => {
    const values = checks
      .map((check) => check?._zod?.def)
      .filter((entry) => entry?.check === kind)
      .map((entry) => entry.maximum ?? entry.value);
    return values.length === 0 ? undefined : Math.min(...values);
  };
  switch (def.type) {
    case 'string': {
      const maximum = limit('max_length') ?? limit('length_equals');
      return maximum === undefined ? Infinity : 2 + maximum * perChar;
    }
    case 'number':
      return checks.some((check) => check?._zod?.def?.format === 'safeint') ? INTEGER_CHARS : NUMBER_CHARS;
    case 'boolean':
      return 5;
    case 'null':
      return 4;
    case 'undefined':
      return 0;
    case 'literal':
      return Math.max(...def.values.map((/** @type {unknown} */ value) => Buffer.byteLength(JSON.stringify(value) ?? '')));
    case 'enum':
      return Math.max(...Object.values(def.entries).map((value) => Buffer.byteLength(JSON.stringify(value))));
    case 'array': {
      const maximum = limit('max_length') ?? limit('length_equals');
      if (maximum === undefined) return Infinity;
      return 2 + maximum * (maxBytes(def.element, perChar, seen) + 1);
    }
    case 'tuple':
      return (
        2 +
        def.items.reduce(
          (/** @type {number} */ sum, /** @type {unknown} */ item) => sum + maxBytes(item, perChar, seen) + 1,
          0,
        )
      );
    case 'object':
      return (
        2 +
        Object.entries(def.shape).reduce(
          (sum, [key, value]) => sum + Buffer.byteLength(JSON.stringify(key)) + 2 + maxBytes(value, perChar, seen),
          0,
        )
      );
    case 'union':
      return Math.max(...def.options.map((/** @type {unknown} */ option) => maxBytes(option, perChar, seen)));
    case 'optional':
    case 'nullable':
    case 'readonly':
    case 'default':
    case 'prefault':
    case 'catch':
    case 'nonoptional':
      return maxBytes(def.innerType, perChar, seen);
    case 'pipe':
      return maxBytes(def.out, perChar, seen);
    case 'lazy': {
      if (seen.has(schema)) return Infinity;
      seen.add(schema);
      return maxBytes(def.getter(), perChar, seen);
    }
    default:
      return Infinity;
  }
}

/**
 * The paths inside a schema that nothing bounds — what makes a channel UNBOUNDED, so the answer names a field rather
 * than a verdict.
 *
 * @param {any} schema
 * @param {string} path
 * @param {string[]} found
 * @param {Set<unknown>} seen
 * @returns {string[]}
 */
function unboundedPaths(schema, path, found = [], seen = new Set()) {
  const def = schema?._zod?.def;
  if (def === undefined || seen.has(schema)) return found;
  seen.add(schema);
  const own = maxBytes(schema, 1);
  if (own !== Infinity) return found;
  switch (def.type) {
    case 'object':
      for (const [key, value] of Object.entries(def.shape)) unboundedPaths(value, `${path}.${key}`, found, seen);
      break;
    case 'array':
      if (maxBytes({ _zod: { def: { ...def, element: { _zod: { def: { type: 'null' } } } } } }, 1) === Infinity) {
        found.push(`${path}[] (no .max)`);
      }
      unboundedPaths(def.element, `${path}[]`, found, seen);
      break;
    case 'union':
      def.options.forEach((/** @type {unknown} */ option, /** @type {number} */ index) =>
        unboundedPaths(option, `${path}|${String(index)}`, found, seen),
      );
      break;
    case 'optional':
    case 'nullable':
    case 'readonly':
    case 'default':
    case 'prefault':
    case 'catch':
    case 'nonoptional':
      unboundedPaths(def.innerType, path, found, seen);
      break;
    case 'pipe':
      unboundedPaths(def.out, path, found, seen);
      break;
    case 'lazy':
      unboundedPaths(def.getter(), path, found, seen);
      break;
    default:
      found.push(`${path} (${String(def.type)})`);
  }
  return found;
}

/** @param {number} value */
const shown = (value) => (value === Infinity ? 'UNBOUNDED' : `${String(Math.round(value))} B`);

const explain = process.argv.indexOf('--explain');
if (explain !== -1) {
  const name = process.argv[explain + 1] ?? '';
  for (const [host, channels] of Object.entries({ MuPDF: engineChannels, PDFium: pdfiumChannels })) {
    const declared = channels[name];
    if (declared === undefined) continue;
    console.log(`${host} ${name}:`);
    for (const found of unboundedPaths(declared.result, 'result')) console.log(`  ${found}`);
  }
  process.exit(0);
}

const hosts = { 'MuPDF host': engineChannels, 'PDFium host': pdfiumChannels, 'compose host': composeChannels };
/** @type {{ host: string, channel: string, plain: number, worst: number }[]} */
const rows = [];
for (const [host, channels] of Object.entries(hosts)) {
  for (const [name, declared] of Object.entries(channels)) {
    rows.push({ host, channel: name, plain: maxBytes(declared.result, 1), worst: maxBytes(declared.result, 6) });
  }
}

const control = rows.find((row) => row.channel === 'engine/text-runs');
if (control === undefined || !(control.plain > ENGINE_HOST_FRAME_MAX_BYTES)) {
  throw new Error(
    `REFUSING TO REPORT: engine/text-runs computed ${shown(control?.plain ?? 0)}, which must exceed the frame. A walk ` +
      'that cannot see the channel the owner hit reports every channel as fitting.',
  );
}

console.log(`frame maximum: ${String(ENGINE_HOST_FRAME_MAX_BYTES)} bytes; ${String(rows.length)} channels`);
for (const row of rows.sort((a, b) => b.plain - a.plain)) {
  const verdict =
    row.plain > ENGINE_HOST_FRAME_MAX_BYTES ? 'OVER (plain)' : row.worst > ENGINE_HOST_FRAME_MAX_BYTES ? 'over (worst)' : 'fits';
  console.log(
    `  ${row.host.padEnd(13)} ${row.channel.padEnd(32)} plain ${shown(row.plain).padStart(16)}  worst ${shown(row.worst).padStart(16)}  ${verdict}`,
  );
}
