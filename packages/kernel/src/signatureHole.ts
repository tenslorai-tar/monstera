import type { CommandOfKind } from '@monstera/contract';

/**
 * What both halves of a signature agree on: the request the MuPDF host is handed, how much room the hole has, and the
 * four numbers that describe it ([ADR-0148](../../../docs/DECISIONS/0148-signings-parse-runs-in-the-mupdf-host-and-main-keeps-only-the-key.md)).
 *
 * No library is imported here. The host writes the placeholder with pdf-lib and `main` signs with the certificate,
 * and each half takes these from one module so the two cannot disagree about the size of the hole.
 */

/**
 * The signing command as the MuPDF host may hold it: everything but the credential.
 *
 * **Removed, never copied out field by field.** A field the command gains tomorrow arrives here without anyone listing
 * it, and the two that must not are named once, in {@link placeholderRequestOf}.
 *
 * **And FORBIDDEN, not only left out.** `Omit` alone admits the whole command, since a value with more fields is
 * assignable to one with fewer — so handing the host the command itself compiled, and the credential crossed the pipe
 * before the host's strict schema refused it (measured 2026-10-03: the composition case's request carried both). The
 * two `never` members make that a compile error, so the only request that reaches a host is one with neither field.
 */
export type PlaceholderRequest = Omit<CommandOfKind<'signDocument'>, 'bytes' | 'passphrase'> & {
  readonly bytes?: never;
  readonly passphrase?: never;
};

/** The command without its PKCS#12 bytes and passphrase: the host is hostile, and a host that holds a key can sign anything. */
export function placeholderRequestOf(command: CommandOfKind<'signDocument'>): PlaceholderRequest {
  const { bytes: _certificate, passphrase: _passphrase, ...request } = command;
  return request;
}

/**
 * `/ByteRange`'s four numbers: from 0 to the hole, and from after the hole to the end.
 *
 * `[0, hole start, hole end, length − hole end]`, where the hole is `/Contents`' hex string including its brackets.
 */
export type ByteRange = readonly [number, number, number, number];

/** A document ready to be signed: its ranges written, its hole all `0`, and the four numbers that say where. */
export interface PreparedSignature {
  readonly bytes: Uint8Array;
  readonly byteRange: ByteRange;
}

/**
 * How many bytes of `/Contents` the placeholder reserves for the signature.
 *
 * Measured 2026-09-12 in the gate's own run: a self-signed P12 produced a
 * **1,295-byte** PKCS#7 blob. This is the gate's 8,192, which leaves room for a
 * chain of several certificates and a timestamp token later — and the number
 * matters in one direction only, because the signed file must be **exactly** as
 * long as the placeholder. Too small and the signature does not fit; too large
 * costs padding.
 */
const SIGNATURE_BYTES = 8192;

/**
 * How many bytes the placeholder reserves when a timestamp is asked for.
 *
 * **A bound, not a measurement**, and chosen from the one direction that matters:
 * a token carries the authority's certificate — RFC 3161 §2.4.1 obliges it when
 * `certReq` is set, which this build sets — and often its chain, so the 8,192
 * above is not a ceiling a timestamped signature can be held to. Too large costs
 * zero padding and nothing else; too small refuses a signature by name
 * (`SignatureTooLargeError`), which is how a figure that proves wrong announces
 * itself.
 */
const TIMESTAMPED_SIGNATURE_BYTES = 32_768;

/** The space the placeholder reserves for this command's signature, in bytes; the hole holds twice as many hex digits. */
export function reservedSignatureBytes(request: Pick<PlaceholderRequest, 'timestamp'>): number {
  return request.timestamp === undefined ? SIGNATURE_BYTES : TIMESTAMPED_SIGNATURE_BYTES;
}
