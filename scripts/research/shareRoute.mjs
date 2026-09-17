// @ts-check
/**
 * The share route's data path, measured through the module the application ships
 * (`apps/desktop/dist/win32ShareSurface.js`, ADR-0080). Windows only; build first.
 *
 * ## What it reads, and what it cannot
 *
 * The Share sheet's handler does two things: it puts a title and a folder's item list on
 * the `DataPackage` the sheet hands it. This runs **the shipped `folderItems` and
 * `fillDataPackage`** on a package it activates itself, then reads the package back
 * through its **view** — `GetView`, `GetStorageItemsAsync` — a second path through WinRT
 * that the shipped module never calls.
 *
 * **The control is a package given no items**: the same read must fail, or a read that
 * answers anything for any package would pass the first reading.
 *
 * What it cannot read is the sheet itself — `ShowShareUIForWindow` and the operating
 * system raising `DataRequested` — because both put a window in front of a person. That
 * is the row's live run.
 *
 * Usage: node scripts/research/shareRoute.mjs
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from '../lib/gitScope.mjs';

if (process.platform !== 'win32') throw new Error('the share route is WinRT; nothing was measured');

const root = repoRoot();
const require = createRequire(join(root, 'package.json'));
const koffi = require('koffi');
const surface = await import(pathToFileURL(join(root, 'apps/desktop/dist/win32ShareSurface.js')).href);

const bindings = surface.win32ShareBindings();
const combase = koffi.load('combase.dll');
/** Plain Node has no apartment; Electron's `main` has one already. 1 is RO_INIT_MULTITHREADED. */
const RoInitialize = combase.func('long __stdcall RoInitialize(int32 type)');
const RoActivateInstance = combase.func('long __stdcall RoActivateInstance(void *name, _Out_ void **out)');
const WindowsCreateString = combase.func('long __stdcall WindowsCreateString(const char16_t *text, uint32 length, _Out_ void **out)');
const WindowsGetStringRawBuffer = combase.func('const char16_t * __stdcall WindowsGetStringRawBuffer(void *text, _Out_ uint32 *length)');

const QueryInterface = koffi.proto('long __stdcall ResearchQueryInterface(void *self, MONSTERA_GUID *iid, _Out_ void **out)');
const OutObject = koffi.proto('long __stdcall ResearchOutObject(void *self, _Out_ void **out)');
const OutInt32 = koffi.proto('long __stdcall ResearchOutInt32(void *self, _Out_ int32 *out)');
const OutUInt32 = koffi.proto('long __stdcall ResearchOutUInt32(void *self, _Out_ uint32 *out)');
const GetAt = koffi.proto('long __stdcall ResearchGetAt(void *self, uint32 index, _Out_ void **out)');

/** @param {number} result */
const hex = (result) => `0x${(result >>> 0).toString(16).padStart(8, '0')}`;

/** @param {unknown} object @param {number} slot @param {import('koffi').TypeObject} proto @param {unknown[]} rest */
function call(object, slot, proto, ...rest) {
  const table = koffi.decode(object, 'void *');
  return koffi.call(koffi.decode(table, 'void *', slot + 1)[slot], proto, object, ...rest);
}

/** @param {string} text */
function guid(text) {
  const plain = text.replaceAll('-', '');
  const tail = [];
  for (let at = 16; at < 32; at += 2) tail.push(Number.parseInt(plain.slice(at, at + 2), 16));
  return {
    Data1: Number.parseInt(plain.slice(0, 8), 16),
    Data2: Number.parseInt(plain.slice(8, 12), 16),
    Data3: Number.parseInt(plain.slice(12, 16), 16),
    Data4: tail,
  };
}

/** @param {unknown} operation */
async function completed(operation) {
  const info = [null];
  call(operation, 0, QueryInterface, guid('00000036-0000-0000-c000-000000000046'), info);
  const status = [0];
  for (let polls = 0; polls < 2000 && status[0] === 0; polls += 1) {
    call(info[0], 7, OutInt32, status);
    if (status[0] === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (status[0] !== 1) return { status: status[0], result: null };
  const result = [null];
  call(operation, 8, OutObject, result);
  return { status: status[0], result: result[0] };
}

/** @param {unknown} handle */
const text = (handle) => WindowsGetStringRawBuffer(handle, [0]);

/** @param {unknown} items null for the control */
async function readBack(items) {
  const name = [null];
  const className = 'Windows.ApplicationModel.DataTransfer.DataPackage';
  WindowsCreateString(className, className.length, name);
  const inspectable = [null];
  const activated = RoActivateInstance(name[0], inspectable);
  if (activated < 0) throw new Error(`DataPackage could not be activated: ${hex(activated)}`);
  const dataPackage = [null];
  call(inspectable[0], 0, QueryInterface, guid('61ebf5c7-efea-4346-9554-981d7e198ffe'), dataPackage);

  if (items !== null) surface.fillDataPackage(bindings, dataPackage[0], 'Quarterly report', items);

  const view = [null];
  call(dataPackage[0], 6, OutObject, view);
  const properties = [null];
  call(view[0], 6, OutObject, properties);
  const title = [null];
  call(properties[0], 6, OutObject, title);

  const reading = [null];
  const asked = call(view[0], 19, OutObject, reading);
  if (asked < 0) return { title: items === null ? null : text(title[0]), read: hex(asked), names: [] };
  const answered = await completed(reading[0]);
  if (answered.result === null) return { title: text(title[0]), read: `status ${String(answered.status)}`, names: [] };
  const size = [0];
  call(answered.result, 7, OutUInt32, size);
  const names = [];
  for (let at = 0; at < (size[0] ?? 0); at += 1) {
    const item = [null];
    call(answered.result, 6, GetAt, at, item);
    const itemName = [null];
    call(item[0], 11, OutObject, itemName);
    names.push(text(itemName[0]));
  }
  return { title: text(title[0]), read: 'ok', names };
}

process.stdout.write(`RoInitialize: ${hex(RoInitialize(1))}\n`);
const folder = mkdtempSync(join(tmpdir(), 'monstera-share-route-'));
try {
  writeFileSync(join(folder, 'Quarterly report.pdf'), '%PDF-1.4\n%%EOF\n');
  const items = await surface.folderItems(bindings, folder);

  const filled = await readBack(items);
  process.stdout.write(`FILLED:  title=${JSON.stringify(filled.title)} read=${filled.read} items=${JSON.stringify(filled.names)}\n`);
  const empty = await readBack(null);
  process.stdout.write(`CONTROL: read=${empty.read} items=${JSON.stringify(empty.names)}\n`);

  const separated = filled.read === 'ok' && filled.names.length === 1 && filled.names[0] === 'Quarterly report.pdf' && filled.title === 'Quarterly report' && empty.read !== 'ok';
  process.stdout.write(separated ? 'SEPARATED: the shipped handler steps fill the package, and an unfilled one reads as unfilled\n' : 'NOT SEPARATED\n');
  process.exitCode = separated ? 0 : 1;
} finally {
  rmSync(folder, { recursive: true, force: true });
}
