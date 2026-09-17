import { createHash } from 'node:crypto';

/**
 * What emailing a document needs from the platform, named with no WinRT anything
 * ([ADR-0080](../../../docs/DECISIONS/0080-emailing-a-document-is-the-windows-share-sheet-from-main.md)).
 *
 * `DocumentCommands.email` takes the save's flush and offers it to the Windows Share
 * sheet as a file; the person picks the mail application there. The WinRT half is
 * `win32ShareSurface.ts`; a case here injects its own.
 */

/** One document offered to the sheet. */
export interface ShareOffer {
  /** The file's name as the receiving application shows it — the document's own. */
  readonly fileName: string;
  /** The sheet's title for what is shared. */
  readonly title: string;
  /** The document's current bytes. */
  readonly bytes: Uint8Array;
}

/** The Windows Share sheet, or null where there is none. */
export interface ShareDestination {
  /** Opens the sheet for `offer`; resolves once the sheet is shown, not when anything is sent. */
  readonly offer: (offer: ShareOffer) => Promise<void>;
}

/** Raised when a step before the sheet opens refuses; nothing was shown. */
export class ShareFailedError extends Error {
  constructor(step: string, code: number) {
    super(`the share sheet refused ${step} (HRESULT 0x${(code >>> 0).toString(16).padStart(8, '0')}), so nothing was shown`);
    this.name = 'ShareFailedError';
  }
}

/**
 * The sheet's title for a document: its file name without the extension, or the whole
 * name where the name is only an extension.
 */
export function shareTitle(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot <= 0 ? fileName : fileName.slice(0, dot);
}

/** The namespace WinRT hashes a parameterised interface's signature under. */
const PINTERFACE_NAMESPACE = Buffer.from('11f47ad57b7342c0abae878b1e16adee', 'hex');

/**
 * The interface ID of a parameterised WinRT interface — `TypedEventHandler<A, B>`,
 * `IIterable<T>` — from its type signature.
 *
 * **WinRT defines it, and it is not a table this build may keep a copy of**: a
 * specialisation has no ID of its own in any registry; the runtime and every
 * projection compute it the same way, an RFC 4122 version-5 UUID over a fixed
 * namespace and the UTF-8 signature. So this computes it once, and the test holds it
 * to IDs the Windows SDK declares.
 */
export function parameterisedInterfaceId(signature: string): string {
  const hash = createHash('sha1')
    .update(Buffer.concat([PINTERFACE_NAMESPACE, Buffer.from(signature, 'utf8')]))
    .digest();
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** The signature of `TypedEventHandler<DataTransferManager, DataRequestedEventArgs>`. */
export const DATA_REQUESTED_HANDLER_SIGNATURE =
  'pinterface({9de1c534-6ae1-11e0-84e1-18a905bcc53f};' +
  'rc(Windows.ApplicationModel.DataTransfer.DataTransferManager;{a5caee9b-8708-49d1-8d36-67d25a8da00c});' +
  'rc(Windows.ApplicationModel.DataTransfer.DataRequestedEventArgs;{cb8ba807-6ac5-43c9-8ac5-9ba232163182}))';
