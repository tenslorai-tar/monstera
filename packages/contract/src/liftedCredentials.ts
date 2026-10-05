import { z } from 'zod';

import { CREDENTIAL_NAME } from './credentialFields.js';
import { DOCUMENT_PASSWORD_MAX_CHARS } from './schemas.js';

/**
 * A credential never enters a file the host transport writes
 * ([ADR-0171](../../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md)'s correction of
 * 2026-10-05, finding RRRRRRR-1).
 *
 * A file-routed call's params, and a file-routed answer, are written whole as JSON into a host's granted directory, and
 * a file reaches the disk the moment it is written: a removal afterwards does not take it back, and a crash between
 * leaves it. So every string held under a credential-named key is LIFTED out of the value before it is written and
 * travels in the frame beside the file's name, and the other side puts each back at its path before the channel's
 * schema runs. A handler sees its params whole; the file never held the secret.
 *
 * ## One rule for what a credential is
 *
 * {@link CREDENTIAL_NAME}, the rule that keeps a credential out of the undo log and out of every renderer answer (B3a).
 * By name, so a credential named as something else is out of reach, and the remedy for one is naming it for what it
 * holds, as the protect's prior names its terms `passwordTerms`.
 *
 * ## Refused rather than guessed
 *
 * A credential-named key holding anything but a string or `null` is refused before anything is written: nothing here
 * can say which part of an object or a list is the secret. `null` stays where it is, since it is no secret.
 */

/** The longest credential-bearing value a host channel carries: a protect's terms with both passwords at their bound. */
export const PROTECTION_TERMS_MAX = 4 * DOCUMENT_PASSWORD_MAX_CHARS + 128;

/**
 * How many values one call lifts at most. One is the most any channel carries today (a PDFium call's key, or a protect
 * prior's terms); the bound keeps the frame's size the frame's question rather than a figure measured once.
 */
export const LIFTED_CREDENTIALS_MAX = 4;

/** How deep a lifted value's path may be: the deepest today is an invert's `inverse.prior.passwordTerms`. */
const PATH_DEPTH_MAX = 16;

/** One value lifted out of a file-routed value: where it was, and what it was. */
export const liftedCredentialSchema = z
  .object({
    path: z
      .array(z.union([z.string().min(1).max(256), z.number().int().nonnegative().max(1_000_000)]))
      .min(1)
      .max(PATH_DEPTH_MAX),
    value: z.string().max(PROTECTION_TERMS_MAX),
  })
  .strict();

/** One of {@link liftedCredentialSchema}. */
export type LiftedCredential = z.infer<typeof liftedCredentialSchema>;

/** Every lifted value of one call, bounded by {@link LIFTED_CREDENTIALS_MAX}. */
export const liftedCredentialsSchema = z.array(liftedCredentialSchema).max(LIFTED_CREDENTIALS_MAX);

/** A value with its credentials taken out, and the credentials, each named by its path. */
export interface Lifted {
  readonly filed: unknown;
  readonly credentials: readonly LiftedCredential[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `value` with every string under a credential-named key taken out, as a copy: the value handed in is not changed,
 * because its caller still holds it (the client resolves the call's answer against its own params).
 *
 * @throws when a credential-named key holds anything but a string or `null`, or when the lifted values exceed the
 *   frame's bounds, so that nothing is written that the frame could not carry
 */
export function liftCredentials(value: unknown): Lifted {
  const credentials: LiftedCredential[] = [];
  const copy = (node: unknown, path: readonly (string | number)[]): unknown => {
    if (Array.isArray(node)) return node.map((item, index) => copy(item, [...path, index]));
    if (!isRecord(node)) return node;
    // `fromEntries` DEFINES each key, where an assignment to `__proto__` would set the copy's prototype instead.
    const kept: [string, unknown][] = [];
    for (const [key, child] of Object.entries(node)) {
      if (!CREDENTIAL_NAME.test(key)) {
        kept.push([key, copy(child, [...path, key])]);
        continue;
      }
      if (child === null || child === undefined) {
        kept.push([key, child]);
        continue;
      }
      if (typeof child !== 'string') {
        throw new TypeError(`"${[...path, key].join('.')}" is named as a credential and holds no string, so it cannot be lifted`);
      }
      credentials.push(liftedCredentialSchema.parse({ path: [...path, key], value: child }));
    }
    return Object.fromEntries(kept);
  };
  const filed = copy(value, []);
  if (credentials.length > LIFTED_CREDENTIALS_MAX) {
    throw new RangeError(`${String(credentials.length)} credentials in one call, above the frame's ${String(LIFTED_CREDENTIALS_MAX)}`);
  }
  return { filed, credentials };
}

/**
 * `filed` with each credential put back at its path: the inverse of {@link liftCredentials}, run by the side that READ
 * the file.
 *
 * Each path must end at a credential-named key its parent object does not already hold. A file that already holds one
 * is not one this transport wrote, and a path that ends anywhere else would let a frame place a value a file-routed
 * schema never sees named as a credential.
 *
 * @throws on any path that does not meet that rule
 */
export function restoreCredentials(filed: unknown, credentials: readonly LiftedCredential[]): unknown {
  for (const { path, value } of credentials) {
    const last = path[path.length - 1];
    if (typeof last !== 'string' || !CREDENTIAL_NAME.test(last)) {
      throw new TypeError('a lifted credential names a key that is not a credential’s');
    }
    // OWN PROPERTIES ONLY, because a host is hostile (invariant 25) and its frame names the path: `__proto__` read as a
    // property is `Object.prototype`, and a value placed there would reach every object in this process.
    let parent: unknown = filed;
    for (const step of path.slice(0, -1)) {
      if (Array.isArray(parent) && typeof step === 'number' && step < parent.length) parent = parent[step];
      else if (isRecord(parent) && typeof step === 'string' && Object.hasOwn(parent, step)) parent = parent[step];
      else parent = undefined;
    }
    if (!isRecord(parent)) throw new TypeError('a lifted credential names a place the file does not hold');
    if (Object.hasOwn(parent, last)) throw new TypeError('a lifted credential names a key the file already holds');
    (parent as Record<string, unknown>)[last] = value;
  }
  return filed;
}
