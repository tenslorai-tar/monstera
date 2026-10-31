// @ts-check
/**
 * ADR-0279's measurements, as the owner answered it on 2026-10-31: ONE history file per PDF (`historyPerPdfStore.mjs`, a
 * prototype never imported by shipped code), against today's single `chat-history.json` as the control
 * (`historyTodayControl.mjs`). No AI service is called and no conversation is real.
 *
 * Two processes, because only the control needs the Windows account's cipher once per entry:
 *
 * - this one, plain Node, measures the per-PDF shape, whose records are sealed with AES-256-GCM under one data key (the
 *   key itself is wrapped by `safeStorage` once, measured in the other process), the guard on Monstera's own saves with
 *   the real engine and the real write-then-rename, the 24-hour check, and that Delete takes a conversation off the disk;
 * - the pinned Electron binary's main process, emitted below, measures the control with the real `safeStorage`, and the
 *   one wrap and unwrap of a data key.
 *
 * Every timing is the median of five, warm (each read is run once before it is timed), on whatever machine runs it.
 *
 *   node scripts/research/historyPerPdf.mjs
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';
import { CARD, GUARD, TURNS, createPerPdfHistory, fileHolds, seal } from './historyPerPdfStore.mjs';
import { conversationOf } from './historyTodayControl.mjs';

const ROOT = repoRoot();
/** @param {string} relative */
const built = (relative) => import(pathToFileURL(join(ROOT, relative)).href);
const { replaceWithRetry } = await built('apps/desktop/dist/settingsFile.js');
const { atomicWrite } = await built('packages/kernel/dist/atomicWrite.js');
const { nodeFileSurface } = await built('packages/kernel/dist/fileSurface.js');

const work = mkdtempSync(join(tmpdir(), 'monstera-history-'));
const key = () => randomBytes(32).toString('hex');
/** @param {number[]} values */
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;
/** @param {() => void} run */
const time = (run) => {
  const started = performance.now();
  run();
  return performance.now() - started;
};
/** @param {() => void} run */
const timed = (run) => {
  run();
  return median(Array.from({ length: 5 }, () => time(run)));
};
/** @param {number} value */
const ms = (value) => `${value.toFixed(1)} ms`;
const SHORT = conversationOf(4, false);
const LONG = conversationOf(32, true);
const dataKey = randomBytes(32);
/** @param {string} line */
const say = (line) => process.stdout.write(`${line}\n`);

/** A history folder holding `others` PDFs' files of one short conversation each, and the measured PDF with `own` of `turns`. @param {number} others @param {number} own @param {import('./historyPerPdfStore.mjs').Turn[]} turns */
function seeded(others, own, turns) {
  const directory = join(work, 'history');
  rmSync(directory, { recursive: true, force: true });
  const store = createPerPdfHistory(directory, dataKey, replaceWithRetry);
  for (let at = 0; at < others; at += 1) store.save(key(), key(), SHORT, 'other.pdf');
  const measured = key();
  store.guard(measured, { path: 'C:/documents/measured.pdf', id: 'A1B2', size: 1, mtimeMs: 1 });
  for (let at = 0; at < own; at += 1) store.save(measured, key(), turns, 'measured.pdf');
  return { directory, store, measured };
}

say('THE OWNER\'S SHAPE: one history file per PDF, records appended, AES-256-GCM under one data key.\n');
say('Opening a PDF: 0 bytes of history read. Nothing in this shape is read when a PDF opens (decision e); the file is read when History is opened.');

say('\nOne save on a PDF holding 20, 200 and 1,000 conversations:');
for (const own of [20, 200, 1_000]) {
  for (const [label, turns] of /** @type {[string, import('./historyPerPdfStore.mjs').Turn[]][]} */ ([['short', SHORT], ['long', LONG]])) {
    const { store, measured } = seeded(0, own, turns);
    const size = statSync(store.path(measured)).size;
    // A NEW CONVERSATION'S FIRST SAVE writes its turns whole; A LATER SAVE writes the turns since, here one answer.
    const fresh = timed(() => store.save(measured, key(), turns, 'measured.pdf'));
    const conversation = key();
    store.save(measured, conversation, turns.slice(0, -2), 'measured.pdf');
    const later = median(
      Array.from({ length: 5 }, () => {
        const each = key();
        store.save(measured, each, turns.slice(0, -2), 'measured.pdf');
        return time(() => store.save(measured, each, turns, 'measured.pdf'));
      }),
    );
    say(`  ${String(own)} ${label}: first save of a new conversation ${ms(fresh)}, a later save (one more answer) ${ms(later)}; file ${(size / 1048576).toFixed(1)} MB`);
    if (own === 1_000 && turns === LONG) rmSync(join(work, 'history'), { recursive: true, force: true });
  }
}

say('\nOne save with 1, 200 and 10,000 other PDFs\' history files present:');
for (const others of [1, 200, 10_000]) {
  const { store, measured } = seeded(others, 1, SHORT);
  say(`  ${String(others)} others: a long conversation saved ${ms(timed(() => store.save(measured, key(), LONG, 'measured.pdf')))}`);
}

say('\nOpening History on a PDF holding 20, 200 and 1,000 conversations (its cards only):');
for (const own of [20, 200, 1_000]) {
  for (const [label, turns] of /** @type {[string, import('./historyPerPdfStore.mjs').Turn[]][]} */ ([['short', SHORT], ['long', LONG]])) {
    const { store, measured } = seeded(0, own, turns);
    let listed = 0;
    const took = timed(() => {
      listed = store.list(measured).length;
    });
    say(`  ${String(own)} ${label}: ${ms(took)}, ${String(listed)} listed`);
    if (own === 1_000 && turns === LONG) rmSync(join(work, 'history'), { recursive: true, force: true });
  }
}

say('\nDelete takes a conversation off the disk (the reviewer\'s fix 8):');
for (const [own, turns] of /** @type {[number, import('./historyPerPdfStore.mjs').Turn[]][]} */ ([[20, SHORT], [200, SHORT], [1_000, SHORT], [20, LONG], [200, LONG]])) {
  const { directory, store, measured } = seeded(5, own, turns);
  const gone = store.list(measured)[0]?.key ?? '';
  const took = time(() => store.remove(measured, gone));
  const holders = readdirSync(directory).filter((file) => fileHolds(join(directory, file), Buffer.from(gone, 'hex')));
  // CONTROL: a conversation not deleted IS found by the same search, so "no file holds it" is not a blind search.
  const kept = store.list(measured)[0]?.key ?? '';
  const keptFound = readdirSync(directory).some((file) => fileHolds(join(directory, file), Buffer.from(kept, 'hex')));
  say(`  ${String(own)} ${turns === LONG ? 'long' : 'short'} conversations: Delete ${ms(took)}; files still holding its record: ${String(holders.length)}; control, a kept conversation found: ${String(keptFound)}`);
}
{
  const { directory, store, measured } = seeded(3, 3, SHORT);
  store.clear(measured);
  const afterClear = existsSync(store.path(measured));
  store.clearAll();
  say(`  History's Clear all leaves this PDF's file: ${String(afterClear)}; Settings' Clear all leaves ${String(readdirSync(directory).length)} file(s)`);
}

say('\nThe guard on Monstera\'s own saves, with the real engine and the real write-then-rename:');
if (bindNativeEngine(ROOT) === null) throw new Error('the native MuPDF shim is not built: node scripts/provision/mupdf.mjs');
const mupdf = await built('packages/kernel/dist/mupdfRaw.js');
const require = createRequire(join(ROOT, 'packages/testing/package.json'));
const { PDFDocument, PDFHexString, StandardFonts } = require('@cantoo/pdf-lib');
/** @param {boolean} withId @param {string} words */
async function made(withId, words) {
  const document = await PDFDocument.create();
  const page = document.addPage([300, 200]);
  page.drawText(words, { x: 20, y: 100, size: 12, font: await document.embedFont(StandardFonts.Helvetica) });
  if (withId) document.context.trailerInfo.ID = document.context.obj([PDFHexString.of(randomBytes(16).toString('hex')), PDFHexString.of(randomBytes(16).toString('hex'))]);
  return /** @type {Uint8Array} */ (await document.save({ useObjectStreams: false }));
}
/** The /ID's first string as hex, read by the engine, or null. @param {Uint8Array} bytes */
function idOf(bytes) {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  try {
    const id = document.getTrailer().get('ID');
    return id.isArray() ? Buffer.from(id.get(0).asString(), 'latin1').toString('hex') : null;
  } finally {
    document.destroy();
  }
}
/** What the guard records for the PDF at `path`. @param {string} path */
async function guardOf(path) {
  const { readFile } = await import('node:fs/promises');
  const stat = statSync(path);
  return { path, id: idOf(await readFile(path)), size: stat.size, mtimeMs: stat.mtimeMs };
}
/** Whether a recorded guard still names the PDF at its place: the /ID where it has one, else its size and write time. @param {import('./historyPerPdfStore.mjs').Guard} recorded @param {import('./historyPerPdfStore.mjs').Guard} now */
const sameDocument = (recorded, now) => (recorded.id !== null ? recorded.id === now.id : recorded.size === now.size && recorded.mtimeMs === now.mtimeMs);
/** Monstera's full save of `path` (the engine's 'garbage' save, then `atomicWrite`'s write-then-rename). @param {string} path */
async function monsteraSave(path) {
  const { readFile } = await import('node:fs/promises');
  const document = mupdf.PDFDocument.openDocument(await readFile(path), 'application/pdf');
  let bytes;
  try {
    bytes = document.saveToBuffer('garbage,encrypt=none').asUint8Array().slice();
  } finally {
    document.destroy();
  }
  const result = await atomicWrite(nodeFileSurface, path, (/** @type {string} */ temp) => nodeFileSurface.write(temp, bytes), { temp: `${path}.monstera-save`, previous: `${path}.previous`, backups: [], retired: [] }, () => Promise.resolve());
  if (!result.ok) throw new Error(`the save failed: ${JSON.stringify(result.error)}`);
}
{
  const directory = join(work, 'guard');
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  const store = createPerPdfHistory(join(directory, 'history'), dataKey, replaceWithRetry);
  for (const withId of [true, false]) {
    const path = join(directory, withId ? 'with-id.pdf' : 'no-id.pdf');
    writeFileSync(path, await made(withId, 'the measured document'));
    const placeKey = key();
    store.guard(placeKey, await guardOf(path));
    store.save(placeKey, key(), SHORT, 'measured.pdf');
    await monsteraSave(path);
    const unlinked = sameDocument(/** @type {import('./historyPerPdfStore.mjs').Guard} */ (store.guardOf(placeKey)), await guardOf(path));
    // RE-LINKED: the save appends the guard of the bytes it wrote, as the application would at the end of its own save.
    store.guard(placeKey, await guardOf(path));
    const relinked = sameDocument(/** @type {import('./historyPerPdfStore.mjs').Guard} */ (store.guardOf(placeKey)), await guardOf(path));
    // CONTROL: a different PDF put at the same place is not the same document.
    writeFileSync(path, await made(withId, 'a different document at the same place'));
    const stranger = sameDocument(/** @type {import('./historyPerPdfStore.mjs').Guard} */ (store.guardOf(placeKey)), await guardOf(path));
    say(`  ${withId ? 'a PDF with an /ID' : 'a PDF with no /ID'}: after Monstera's save, recognised before re-linking: ${String(unlinked)}, after: ${String(relinked)}; control, a different PDF at its place recognised: ${String(stranger)}`);
  }
}

say('\nThe 24-hour check over 10,000 history files (half their PDFs gone), one pass:');
{
  const directory = join(work, 'check');
  rmSync(directory, { recursive: true, force: true });
  const documents = join(directory, 'documents');
  mkdirSync(documents, { recursive: true });
  const store = createPerPdfHistory(join(directory, 'history'), dataKey, replaceWithRetry);
  /** @type {string[]} */
  const places = [];
  for (let at = 0; at < 10_000; at += 1) {
    const path = join(documents, `document-${String(at)}.pdf`);
    writeFileSync(path, 'x');
    const placeKey = key();
    const stat = statSync(path);
    store.guard(placeKey, { path, id: null, size: stat.size, mtimeMs: stat.mtimeMs });
    store.save(placeKey, key(), SHORT, 'document.pdf');
    places.push(placeKey);
    if (at % 2 === 1) unlinkSync(path);
  }
  /** @type {Record<string, number>} */
  const missingSince = {};
  const pass = () => {
    let same = 0;
    let missing = 0;
    for (const placeKey of places) {
      const guard = store.guardOf(placeKey);
      if (guard === null) continue;
      if (!existsSync(guard.path)) {
        missing += 1;
        missingSince[placeKey] ??= Date.now();
        continue;
      }
      // UNCHANGED SINCE THE GUARD WAS RECORDED: its size and write time; a changed file would have its /ID read by the
      // contained host, which is the one place a document is parsed.
      const stat = statSync(guard.path);
      if (stat.size === guard.size && stat.mtimeMs === guard.mtimeMs) same += 1;
    }
    writeFileSync(join(directory, 'missing.ledger'), seal(dataKey, JSON.stringify(missingSince)));
    return { same, missing };
  };
  let result = { same: 0, missing: 0 };
  const whole = timed(() => {
    result = pass();
  });
  say(`  ${ms(whole)} for 10,000 (${String(result.same)} found unchanged, ${String(result.missing)} missing), about ${(whole / 10_000).toFixed(2)} ms a file`);
}

say('\nTODAY, the control, in the pinned Electron main with the real safeStorage:');
const MAIN = String.raw`
const { app, safeStorage } = require('electron');
const { pathToFileURL } = require('node:url');
app.whenReady().then(async () => {
  const control = await import(pathToFileURL(CONTROL).href);
  const cipher = {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (blob) => safeStorage.decryptString(blob),
  };
  const say = (line) => process.stdout.write('MONSTERA_HISTORY ' + line + '\n');
  const started = performance.now();
  safeStorage.decryptString(safeStorage.encryptString('k'.repeat(64)));
  say('  one data key wrapped and unwrapped by safeStorage: ' + (performance.now() - started).toFixed(2) + ' ms, once per session');
  await control.measureToday({ root: ROOT, work: WORK, cipher, short: control.conversationOf(4, false), long: control.conversationOf(32, true), say });
  app.quit();
}).catch((error) => {
  process.stderr.write(String((error && error.stack) || error) + '\n');
  app.exit(1);
});
`;
const program = join(work, 'control-main');
mkdirSync(program, { recursive: true });
const constants = [
  `const ROOT = ${JSON.stringify(ROOT)};`,
  `const WORK = ${JSON.stringify(work)};`,
  `const CONTROL = ${JSON.stringify(join(ROOT, 'scripts/research/historyTodayControl.mjs'))};`,
].join('\n');
writeFileSync(join(program, 'main.js'), `${constants}\n${MAIN}`, 'utf8');
writeFileSync(join(program, 'package.json'), `${JSON.stringify({ name: 'monstera-history-control', version: '0.0.0', main: 'main.js' })}\n`, 'utf8');
// AS ELECTRON'S MAIN, never Node mode: the variable present at all, even empty, starts the binary as Node, where
// `safeStorage` does not exist.
const environment = { ...process.env };
Reflect.deleteProperty(environment, 'ELECTRON_RUN_AS_NODE');
const control = spawnSync(electronBinaryPath(), [program], { encoding: 'utf8', env: environment, timeout: 1_800_000 });
const lines = `${control.stdout}`.split('\n').filter((line) => line.startsWith('MONSTERA_HISTORY '));
if (lines.length === 0) throw new Error(`the control printed nothing: ${`${control.stderr}`.slice(0, 2000)}`);
for (const line of lines) say(line.slice('MONSTERA_HISTORY '.length));
rmSync(work, { recursive: true, force: true });
say('\n(record types: guard ' + String(GUARD) + ', card ' + String(CARD) + ', turns ' + String(TURNS) + ')');
