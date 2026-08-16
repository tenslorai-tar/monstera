import { type Brand, brandValue } from './brand.js';

/**
 * Identity of an open document.
 *
 * The renderer holds this and nothing else — no bytes it can mutate, no path
 * (invariant L2). Every mutation names a `DocId` and travels as intent:
 * `deletePages([3, 5])` is the same size whether the document is 2 pages or
 * 20,000 (invariant L11).
 */
export type DocId = Brand<string, 'DocId'>;

/**
 * Monotonic version of a document's content.
 *
 * Bumped by every command. Bytes cross to the renderer once per *version*,
 * never once per operation, and the renderer names the version it is holding so
 * a snapshot that arrives late for a document that has moved on can be
 * recognised rather than rendered.
 */
export type DocVersion = Brand<number, 'DocVersion'>;

/**
 * An unguessable capability token standing for a filesystem location.
 *
 * This is the type that makes invariant L2 structural rather than aspirational.
 * The renderer is never given a path; it is given a handle minted by the
 * `CapabilityRegistry` wherever the user or the app produced a location —
 * dialogs, drag-drop, argv, file associations, app-created temp files. Every
 * path-consuming operation takes a handle, so **a string path in a
 * renderer-facing type is a compile error**.
 *
 * The rejected alternative was a runtime path-allowlist check, which fails open
 * at every handler that forgets to call it. A handler cannot forget to call a
 * type.
 *
 * The brand prevents confusing a handle with a path. It is not what makes a
 * handle unforgeable — that is the registry, which resolves only tokens it
 * actually minted. Constructing a `FileHandle` from an arbitrary string
 * therefore yields a token that resolves to nothing.
 */
export type FileHandle = Brand<string, 'FileHandle'>;

/**
 * @throws if `value` is empty — an empty id is always a bug at the producer,
 * and letting it travel turns a clear failure into a lookup miss somewhere else.
 */
export function asDocId(value: string): DocId {
  if (value.length === 0) throw new Error('DocId may not be empty');
  return brandValue<string, 'DocId'>(value);
}

/**
 * @throws if `value` is not a non-negative integer. Versions index a command
 * log; a fractional or negative one cannot.
 */
export function asDocVersion(value: number): DocVersion {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`DocVersion must be a non-negative integer, received ${String(value)}`);
  }
  return brandValue<number, 'DocVersion'>(value);
}

/**
 * @throws if `value` is empty.
 */
export function asFileHandle(value: string): FileHandle {
  if (value.length === 0) throw new Error('FileHandle may not be empty');
  return brandValue<string, 'FileHandle'>(value);
}
