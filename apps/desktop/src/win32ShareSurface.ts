import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import koffi, { type TypeObject } from 'koffi';

import {
  DATA_REQUESTED_HANDLER_SIGNATURE,
  type ShareDestination,
  ShareFailedError,
  type ShareOffer,
  parameterisedInterfaceId,
} from './sharing.js';

/**
 * The WinRT calls behind {@link ShareDestination}, bound with koffi
 * ([ADR-0080](../../../docs/DECISIONS/0080-emailing-a-document-is-the-windows-share-sheet-from-main.md)).
 * B7's sanctioned exception, one typed adapter module per native boundary, beside
 * `win32PrintSurface.ts`.
 *
 * ## Every vtable slot is the SDK header's
 *
 * A COM call here is *the function at slot N of the object's table*, and a wrong N calls
 * a different method with the same shape. Each slot below was read 2026-09-17 from
 * Windows SDK 10.0.26100's `winrt/windows.applicationmodel.datatransfer.h` and
 * `winrt/windows.storage.h`, counted from `IInspectable`'s six.
 *
 * ## The items are ready before the sheet opens
 *
 * The sheet raises `DataRequested` and gives the handler a deadline. Resolving a file
 * inside it would mean an asynchronous operation inside a callback, so the folder's item
 * list is resolved first and the handler only sets two values.
 *
 * ## Asynchronous results are POLLED
 *
 * `IAsyncInfo.Status` is read until it leaves *started*, yielding to the event loop
 * between reads. A completion delegate would be a second COM object implemented in
 * JavaScript for no measured gain; one is implemented, the event handler.
 *
 * ## Nothing is bound at import time
 *
 * `win32PrintSurface.ts`' reason: `combase.dll` is loaded when a person emails (§9.17).
 */

/** `IInspectable`'s methods come first in every WinRT interface. */
const INSPECTABLE = 6;

const IID = {
  unknown: '00000000-0000-0000-c000-000000000046',
  agile: '94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90',
  asyncInfo: '00000036-0000-0000-c000-000000000046',
  dataTransferManagerInterop: '3a3dcd6c-3eab-43dc-bcde-45671ce800c8',
  dataTransferManager: 'a5caee9b-8708-49d1-8d36-67d25a8da00c',
  storageFolderStatics: '08f327ff-85d5-48b9-aee9-28511e339f9f',
  dataPackage: '61ebf5c7-efea-4346-9554-981d7e198ffe',
  iterableStorageItem: 'bb8b8418-65d1-544b-b083-6d172f568c73',
  dataRequestedHandler: parameterisedInterfaceId(DATA_REQUESTED_HANDLER_SIGNATURE),
} as const;

/** Slots, by interface, from the SDK header. */
const SLOT = {
  release: 2,
  queryInterface: 0,
  interopGetForWindow: 3,
  interopShowShareUi: 4,
  managerAddDataRequested: INSPECTABLE + 0,
  managerRemoveDataRequested: INSPECTABLE + 1,
  folderStaticsGetFolderFromPath: INSPECTABLE + 0,
  folderGetItems: INSPECTABLE + 9,
  asyncInfoStatus: INSPECTABLE + 1,
  asyncOperationGetResults: INSPECTABLE + 2,
  requestedArgsGetRequest: INSPECTABLE + 0,
  requestGetData: INSPECTABLE + 0,
  packageGetProperties: INSPECTABLE + 1,
  packageSetStorageItems: INSPECTABLE + 17,
  propertiesPutTitle: INSPECTABLE + 1,
} as const;

/** `AsyncStatus.Started`; `Completed` is 1. */
const ASYNC_STARTED = 0;
const ASYNC_COMPLETED = 1;
/** How long a folder read may take before the share is refused. */
const ASYNC_BOUND_MS = 10_000;
const E_NOINTERFACE = 0x80004002 | 0;
const E_FAIL = 0x80004005 | 0;

/** The folders shares are written under, one per share. */
const SHARE_PREFIX = 'share-';

interface Guid {
  Data1: number;
  Data2: number;
  Data3: number;
  Data4: number[];
}

function guid(text: string): Guid {
  const hex = text.replaceAll('-', '');
  const tail: number[] = [];
  for (let at = 16; at < 32; at += 2) tail.push(Number.parseInt(hex.slice(at, at + 2), 16));
  return {
    Data1: Number.parseInt(hex.slice(0, 8), 16),
    Data2: Number.parseInt(hex.slice(8, 12), 16),
    Data3: Number.parseInt(hex.slice(12, 16), 16),
    Data4: tail,
  };
}

function sameGuid(a: Guid, b: Guid): boolean {
  return a.Data1 === b.Data1 && a.Data2 === b.Data2 && a.Data3 === b.Data3 && a.Data4.every((byte, at) => b.Data4[at] === byte);
}

/** An opaque COM interface pointer. */
type Com = unknown;

interface Protos {
  readonly queryInterface: TypeObject;
  readonly release: TypeObject;
  readonly outObject: TypeObject;
  readonly inStringOutObject: TypeObject;
  readonly inString: TypeObject;
  readonly outInt32: TypeObject;
  readonly getForWindow: TypeObject;
  readonly inHandle: TypeObject;
  readonly addHandler: TypeObject;
  readonly inToken: TypeObject;
  readonly setItems: TypeObject;
  readonly delegateQueryInterface: TypeObject;
  readonly delegateCount: TypeObject;
  readonly delegateInvoke: TypeObject;
}

export interface ShareBindings {
  readonly createString: (text: string, length: number, out: [unknown]) => number;
  readonly deleteString: (handle: unknown) => number;
  readonly activationFactory: (name: unknown, iid: Guid, out: [unknown]) => number;
  readonly protos: Protos;
}

/** Registered under process-global names, so once — named for this module. */
let registered: ShareBindings | undefined;

function bind(): ShareBindings {
  if (registered !== undefined) return registered;
  koffi.struct('MONSTERA_GUID', { Data1: 'uint32', Data2: 'uint16', Data3: 'uint16', Data4: koffi.array('uint8', 8) });
  const combase = koffi.load('combase.dll');
  // koffi's `func()` and `proto()` answer values assignable to any signature, so each
  // type is an assertion written from the prototype beside it.
  registered = {
    createString: combase.func('long __stdcall WindowsCreateString(const char16_t *text, uint32 length, _Out_ void **out)'),
    deleteString: combase.func('long __stdcall WindowsDeleteString(void *handle)'),
    activationFactory: combase.func('long __stdcall RoGetActivationFactory(void *name, MONSTERA_GUID *iid, _Out_ void **out)'),
    protos: {
      queryInterface: koffi.proto('long __stdcall MonsteraQueryInterface(void *self, MONSTERA_GUID *iid, _Out_ void **out)'),
      release: koffi.proto('uint32 __stdcall MonsteraRelease(void *self)'),
      outObject: koffi.proto('long __stdcall MonsteraOutObject(void *self, _Out_ void **out)'),
      inStringOutObject: koffi.proto('long __stdcall MonsteraInStringOutObject(void *self, void *text, _Out_ void **out)'),
      inString: koffi.proto('long __stdcall MonsteraInString(void *self, void *text)'),
      outInt32: koffi.proto('long __stdcall MonsteraOutInt32(void *self, _Out_ int32 *out)'),
      getForWindow: koffi.proto('long __stdcall MonsteraGetForWindow(void *self, uintptr_t window, MONSTERA_GUID *iid, _Out_ void **out)'),
      inHandle: koffi.proto('long __stdcall MonsteraInHandle(void *self, uintptr_t window)'),
      addHandler: koffi.proto('long __stdcall MonsteraAddHandler(void *self, void *handler, _Out_ int64 *token)'),
      inToken: koffi.proto('long __stdcall MonsteraInToken(void *self, int64 token)'),
      setItems: koffi.proto('long __stdcall MonsteraSetItems(void *self, void *items, uint8 readOnly)'),
      delegateQueryInterface: koffi.proto('long __stdcall MonsteraDelegateQueryInterface(void *self, MONSTERA_GUID *iid, void **out)'),
      delegateCount: koffi.proto('uint32 __stdcall MonsteraDelegateCount(void *self)'),
      delegateInvoke: koffi.proto('long __stdcall MonsteraDelegateInvoke(void *self, void *sender, void *args)'),
    },
  };
  return registered;
}

/** Calls slot `slot` of `object`'s table with `proto`, `object` first. */
function call(object: Com, slot: number, proto: TypeObject, ...rest: unknown[]): number {
  const table: unknown = koffi.decode(object, 'void *');
  const entries = koffi.decode(table, 'void *', slot + 1) as unknown[];
  return koffi.call(entries[slot], proto, object, ...rest) as number;
}

function checked(step: string, result: number): void {
  if (result < 0) throw new ShareFailedError(step, result);
}

function release(bindings: ShareBindings, object: Com): void {
  if (object !== null) call(object, SLOT.release, bindings.protos.release);
}

function queried(bindings: ShareBindings, object: Com, iid: string, step: string): Com {
  const out: [unknown] = [null];
  checked(step, call(object, SLOT.queryInterface, bindings.protos.queryInterface, guid(iid), out));
  return out[0];
}

function hstring(bindings: ShareBindings, text: string): unknown {
  const out: [unknown] = [null];
  checked('a string', bindings.createString(text, text.length, out));
  return out[0];
}

function factory(bindings: ShareBindings, className: string, iid: string): Com {
  const name = hstring(bindings, className);
  try {
    const out: [unknown] = [null];
    checked(`the ${className} factory`, bindings.activationFactory(name, guid(iid), out));
    return out[0];
  } finally {
    bindings.deleteString(name);
  }
}

/** Polls an `IAsyncOperation<T>` to completion and answers its result, owned by the caller. */
async function completed(bindings: ShareBindings, operation: Com, step: string): Promise<Com> {
  const info = queried(bindings, operation, IID.asyncInfo, step);
  try {
    const status: [number] = [ASYNC_STARTED];
    const deadline = Date.now() + ASYNC_BOUND_MS;
    for (;;) {
      checked(step, call(info, SLOT.asyncInfoStatus, bindings.protos.outInt32, status));
      if (status[0] !== ASYNC_STARTED || Date.now() > deadline) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    if (status[0] !== ASYNC_COMPLETED) throw new ShareFailedError(step, status[0]);
    const result: [unknown] = [null];
    checked(step, call(operation, SLOT.asyncOperationGetResults, bindings.protos.outObject, result));
    return result[0];
  } finally {
    release(bindings, info);
  }
}

/**
 * The item list of `folder` — every file in it — as `IIterable<IStorageItem>`, the type
 * `SetStorageItems` takes. Owned by the caller.
 *
 * Exported for the research instrument, which fills a package it activated itself and
 * reads it back through the package's view.
 */
export async function folderItems(bindings: ShareBindings, folder: string): Promise<Com> {
  const statics = factory(bindings, 'Windows.Storage.StorageFolder', IID.storageFolderStatics);
  const path = hstring(bindings, folder);
  let folderObject: Com = null;
  let list: Com = null;
  try {
    const opened: [unknown] = [null];
    checked('the folder', call(statics, SLOT.folderStaticsGetFolderFromPath, bindings.protos.inStringOutObject, path, opened));
    try {
      folderObject = await completed(bindings, opened[0], 'the folder');
    } finally {
      release(bindings, opened[0]);
    }
    const listing: [unknown] = [null];
    checked('the folder items', call(folderObject, SLOT.folderGetItems, bindings.protos.outObject, listing));
    try {
      list = await completed(bindings, listing[0], 'the folder items');
    } finally {
      release(bindings, listing[0]);
    }
    return queried(bindings, list, IID.iterableStorageItem, 'the item list');
  } finally {
    release(bindings, list);
    release(bindings, folderObject);
    bindings.deleteString(path);
    release(bindings, statics);
  }
}

/**
 * Puts the title and the items on a `DataPackage` — the whole of what the handler does.
 *
 * Exported for the research instrument, for {@link folderItems}' reason.
 */
export function fillDataPackage(bindings: ShareBindings, dataPackage: Com, title: string, items: Com): void {
  const properties: [unknown] = [null];
  checked('the package properties', call(dataPackage, SLOT.packageGetProperties, bindings.protos.outObject, properties));
  const text = hstring(bindings, title);
  try {
    checked('the title', call(properties[0], SLOT.propertiesPutTitle, bindings.protos.inString, text));
  } finally {
    bindings.deleteString(text);
    release(bindings, properties[0]);
  }
  // READ-ONLY: the receiving application gets the file to attach, not to change.
  checked('the items', call(dataPackage, SLOT.packageSetStorageItems, bindings.protos.setItems, items, 1));
}

/** What the handler shares when the sheet asks. */
interface Pending {
  readonly title: string;
  readonly items: Com;
}

/** The bindings, for the research instrument. */
export function win32ShareBindings(): ShareBindings {
  return bind();
}

/**
 * @param temporaryRoot a directory `main` owns, under which each share gets a folder of
 *   its own. The previous share's folder is removed when the next one is made, not when
 *   the sheet closes: the receiving application may read the file after that.
 * @param owner the window the sheet belongs to, as its handle's value
 */
export function createWin32ShareSurface(temporaryRoot: string, owner: () => bigint): ShareDestination {
  let pending: Pending | undefined;
  /** The delegate, built once: its callbacks must outlive every registration. */
  let delegate: Com = null;
  /**
   * The registration each window holds. **Replaced on every share** rather than kept for
   * the window's life: a closed window's handle value can be given to a new window, and a
   * registration keyed on the old one would open a sheet with nothing in it.
   */
  const registrations = new Map<bigint, { readonly manager: Com; readonly token: bigint }>();

  const handlerObject = (bindings: ShareBindings): Com => {
    if (delegate !== null) return delegate;
    const { protos } = bindings;
    const accepted = [IID.unknown, IID.agile, IID.dataRequestedHandler].map(guid);
    // A STATIC OBJECT, never freed: its count is kept for the contract and ignored for
    // lifetime, because the process holds it until it exits.
    let references = 1;
    const queryInterface = koffi.register((self: unknown, iid: unknown, out: unknown) => {
      const asked = koffi.decode(iid, 'MONSTERA_GUID') as Guid;
      if (accepted.some((known) => sameGuid(known, asked))) {
        koffi.encode(out, 'void *', self);
        references += 1;
        return 0;
      }
      koffi.encode(out, 'void *', null);
      return E_NOINTERFACE;
    }, koffi.pointer(protos.delegateQueryInterface));
    const addRef = koffi.register(() => {
      references += 1;
      return references;
    }, koffi.pointer(protos.delegateCount));
    const releaseRef = koffi.register(() => {
      references = Math.max(1, references - 1);
      return references;
    }, koffi.pointer(protos.delegateCount));
    const invoke = koffi.register((_self: unknown, _sender: unknown, args: unknown) => {
      if (pending === undefined) return 0;
      const request: [unknown] = [null];
      const data: [unknown] = [null];
      try {
        checked('the request', call(args, SLOT.requestedArgsGetRequest, protos.outObject, request));
        checked('the package', call(request[0], SLOT.requestGetData, protos.outObject, data));
        fillDataPackage(bindings, data[0], pending.title, pending.items);
        return 0;
      } catch {
        // THE SHEET GETS AN HRESULT, never a JavaScript exception across the boundary:
        // a throw here would unwind through the operating system's stack frames.
        return E_FAIL;
      } finally {
        release(bindings, data[0]);
        release(bindings, request[0]);
      }
    }, koffi.pointer(protos.delegateInvoke));
    const table: unknown = koffi.alloc('void *', 4);
    koffi.encode(table, 'void *', [queryInterface, addRef, releaseRef, invoke], 4);
    const object: unknown = koffi.alloc('void *', 1);
    koffi.encode(object, 'void *', table);
    delegate = object;
    return delegate;
  };

  return {
    offer: async (offer: ShareOffer): Promise<void> => {
      const bindings = bind();
      const window = owner();

      await mkdir(temporaryRoot, { recursive: true });
      for (const entry of await readdir(temporaryRoot)) {
        if (entry.startsWith(SHARE_PREFIX)) await rm(join(temporaryRoot, entry), { recursive: true, force: true });
      }
      const folder = await mkdtemp(join(temporaryRoot, SHARE_PREFIX));
      await writeFile(join(folder, offer.fileName), offer.bytes);

      const items = await folderItems(bindings, folder);
      if (pending !== undefined) release(bindings, pending.items);
      pending = { title: offer.title, items };

      const interop = factory(bindings, 'Windows.ApplicationModel.DataTransfer.DataTransferManager', IID.dataTransferManagerInterop);
      try {
        const previous = registrations.get(window);
        if (previous !== undefined) {
          registrations.delete(window);
          call(previous.manager, SLOT.managerRemoveDataRequested, bindings.protos.inToken, previous.token);
          release(bindings, previous.manager);
        }
        const manager: [unknown] = [null];
        checked(
          'the share manager for this window',
          call(interop, SLOT.interopGetForWindow, bindings.protos.getForWindow, window, guid(IID.dataTransferManager), manager),
        );
        const token: [bigint] = [0n];
        const added = call(manager[0], SLOT.managerAddDataRequested, bindings.protos.addHandler, handlerObject(bindings), token);
        if (added < 0) {
          release(bindings, manager[0]);
          throw new ShareFailedError('the share handler', added);
        }
        registrations.set(window, { manager: manager[0], token: token[0] });
        checked('the share sheet', call(interop, SLOT.interopShowShareUi, bindings.protos.inHandle, window));
      } finally {
        release(bindings, interop);
      }
    },
  };
}
