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
 * By `maxEncodedBytes` in `@monstera/contract`'s `schemaBound.ts`, which reads zod's own JSON Schema — the one reader
 * the route rule in `hostRoutes.test.ts` and invariant L11's sweep also take, so this table and the check that gates
 * a build cannot disagree about a channel. Two figures per channel: PLAIN, one byte per character, and WORST, six per
 * character, the length of a `\u` escape — the latter is what a hostile host may send, and what the rule holds at.
 *
 * Positive control: `engine/text-runs`, whose schema admits far more than a frame, must be reported over it; a walk
 * that answered small for everything would print the reassuring answer, so without the control it refuses.
 *
 * Usage: node scripts/research/hostSchemaBounds.mjs [--explain <channel>]
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
const { WORST_BYTES_PER_CHAR, maxEncodedBytes, unboundedMembers } = await built('packages/contract/dist/schemaBound.js');
const { engineChannels } = await built('packages/kernel/dist/host/engineChannels.js');
const { pdfiumChannels } = await built('packages/kernel/dist/host/pdfiumChannels.js');
const { composeChannels } = await built('packages/kernel/dist/host/composeChannels.js');

/** @param {number} value */
const shown = (value) => (value === Infinity ? 'UNBOUNDED' : `${String(Math.round(value))} B`);

const explain = process.argv.indexOf('--explain');
if (explain !== -1) {
  const name = process.argv[explain + 1] ?? '';
  for (const [host, channels] of Object.entries({ MuPDF: engineChannels, PDFium: pdfiumChannels })) {
    const declared = channels[name];
    if (declared === undefined) continue;
    console.log(`${host} ${name}:`);
    for (const found of unboundedMembers(declared.result, 'result')) console.log(`  ${String(found)}`);
  }
  process.exit(0);
}

const hosts = { 'MuPDF host': engineChannels, 'PDFium host': pdfiumChannels, 'compose host': composeChannels };
/** @type {{ host: string, channel: string, route: string, plain: number, worst: number }[]} */
const rows = [];
for (const [host, channels] of Object.entries(hosts)) {
  for (const [name, declared] of Object.entries(channels)) {
    rows.push({
      host,
      channel: name,
      route: declared.answer,
      plain: maxEncodedBytes(declared.result, 1),
      worst: maxEncodedBytes(declared.result, WORST_BYTES_PER_CHAR),
    });
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
    `  ${row.host.padEnd(13)} ${row.channel.padEnd(32)} ${row.route.padEnd(5)} plain ${shown(row.plain).padStart(16)}  worst ${shown(row.worst).padStart(16)}  ${verdict}`,
  );
}
