import type { Command, CommandOfKind, TimestampAuthority } from '@monstera/contract';

import type { CaptureResult } from './commandLog.js';
import type { CommandExecution } from './commandRouting.js';
import type { MupdfSession } from './engineSeam.js';
import { stagedBytes } from './savePipeline.js';
import {
  type PlaceholderRequest,
  type PreparedSignature,
  placeholderRequestOf,
  reservedSignatureBytes,
} from './signatureHole.js';
import { SignatureCredentialRefusedError, SignatureTooLargeError, TimestampUnreachableError } from './signingRefusals.js';

/**
 * Digitally signing a document, the half that holds the key — Stage 7's PKCS#7 row, over a placeholder this build
 * writes ([ADR-0054](../../../docs/DECISIONS/0054-the-signing-core-ships-and-the-placeholder-is-ours.md)).
 *
 * ## `main` signs over FOUR NUMBERS, and parses nothing
 *
 * [ADR-0148](../../../docs/DECISIONS/0148-signings-parse-runs-in-the-mupdf-host-and-main-keeps-only-the-key.md):
 * `@signpdf`'s `SignPdf.sign` is a keyless half — find the placeholder, find the hole, write the ranges — and a keyed
 * half — sign the bytes outside the hole and fill it. The keyless half runs in the MuPDF host beside the session
 * (`signaturePlaceholder.ts`), with the placeholder and the picture's decode. This module is the keyed half: it takes
 * the prepared bytes and their four numbers, checks the numbers against the hole without scanning the document, signs,
 * and fills. It imports neither pdf-lib nor the placeholder writer, and `proof:hostload` reads the emit to say so.
 *
 * The host is hostile (invariant 25), so it is handed {@link placeholderRequestOf}'s command, which has no certificate
 * and no passphrase, and what it answers is checked rather than trusted.
 */

/**
 * The PKCS#7 `P12Signer` produced, with an accepted timestamp token added to its
 * one SignerInfo as the unsigned attribute `id-aa-timeStampToken` (RFC 3161
 * Appendix A).
 *
 * **The imprint hashes the SignerInfo's `signature` value** — Appendix A's rule,
 * which is what makes the token a timestamp of THIS signature rather than of the
 * document. The reply is judged by `acceptTimestampReply` and nothing else; a
 * transport failure is named unreachable, and a reply that fails a check is named
 * by that module.
 *
 * node-forge and the token module load here, dynamically, for {@link signPrepared}'s
 * reason: main pays for them only when somebody asks for a timestamp.
 */
async function timestamped(
  raw: Buffer,
  authority: TimestampAuthority,
  requestTimestamp: RequestTimestamp,
): Promise<Buffer> {
  const [{ default: forge }, { acceptTimestampReply, TIMESTAMP_TOKEN_ATTRIBUTE_OID, timestampQuery }] =
    await Promise.all([import('node-forge'), import('./timestampToken.js')]);
  const { asn1 } = forge;

  const contentInfo = asn1.fromDer(raw.toString('binary'));
  // ContentInfo → [0] → SignedData, whose LAST element is `signerInfos`.
  const signedData = Array.isArray(contentInfo.value) ? contentInfo.value[1] : undefined;
  const signedFields = Array.isArray(signedData?.value) ? signedData.value[0]?.value : undefined;
  const signerInfos = Array.isArray(signedFields) ? signedFields.at(-1)?.value : undefined;
  const signerInfo = Array.isArray(signerInfos) && signerInfos.length === 1 ? signerInfos[0] : undefined;
  const fields = Array.isArray(signerInfo?.value) ? signerInfo.value : undefined;
  if (signerInfo === undefined || fields === undefined) {
    throw new Error('the signer produced a PKCS#7 without exactly one SignerInfo');
  }
  // A DEFECT, not a refusal: `P12Signer` writes no unsigned attributes, so one
  // already present means the signer changed underneath this code.
  // `[1]` IS TAG NUMBER 1 IN THE CONTEXT CLASS. `@types/node-forge` types every
  // node's tag as `asn1.Type`, whose members name the UNIVERSAL types, so the
  // number is given the field's own type at the comparison. The enum member that
  // is also 1 is `BOOLEAN`, and writing it here would describe a context tag as a
  // boolean.
  if (
    fields.some(
      (field) =>
        field.tagClass === asn1.Class.CONTEXT_SPECIFIC && field.type === (1 as typeof field.type),
    )
  ) {
    throw new Error('the SignerInfo already carries unsigned attributes');
  }
  const signature = fields.find(
    (field) => field.tagClass === asn1.Class.UNIVERSAL && field.type === asn1.Type.OCTETSTRING,
  );
  if (signature === undefined || typeof signature.value !== 'string') {
    throw new Error('the SignerInfo carries no signature value');
  }

  const query = timestampQuery(signature.value);
  let reply: Uint8Array;
  try {
    reply = await requestTimestamp(authority, query.der);
  } catch (cause) {
    throw new TimestampUnreachableError({ cause });
  }
  const accepted = acceptTimestampReply(reply, query);

  fields.push(
    // [1] IMPLICIT UnsignedAttributes — a SET OF Attribute, tagged in place.
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 1, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(
          asn1.Class.UNIVERSAL,
          asn1.Type.OID,
          false,
          asn1.oidToDer(TIMESTAMP_TOKEN_ATTRIBUTE_OID).getBytes(),
        ),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [accepted.token]),
      ]),
    ]),
  );
  return Buffer.from(asn1.toDer(contentInfo).getBytes(), 'binary');
}

/** `<` and `>`, which bracket the hole, and `0`, which fills it until a signature does. */
const OPEN = 0x3c;
const CLOSE = 0x3e;
const ZERO = 0x30;

/**
 * Refuses a prepared document whose four numbers do not describe its own hole, in time proportional to the hole.
 *
 * **What it rules out is a signature that covers less than the file.** `main` signs exactly the bytes outside
 * `[holeStart, holeEnd)`, so ranges that start past zero, overlap, or stop short of the end would leave bytes the
 * signature does not cover, in a document that would still read as signed. The hole itself must be the placeholder's:
 * bracketed, exactly twice the reserved length, and all `0`, so a host that wrote anything into it is refused.
 *
 * A host that wrote a `/ByteRange` into the file other than the one it announced gains nothing: `main` signs the bytes
 * the announced ranges describe, and every reader then reports the signature invalid over the file's own ranges.
 */
function checkPrepared(prepared: PreparedSignature, reserved: number): void {
  const { bytes, byteRange } = prepared;
  const [start, holeStart, holeEnd, rest] = byteRange;
  const refuse = (why: string): never => {
    throw new Error(`the engine host prepared a signature whose ranges ${JSON.stringify(byteRange)} ${why}`);
  };
  if (!byteRange.every((value) => Number.isSafeInteger(value) && value >= 0)) refuse('are not whole numbers');
  if (start !== 0) refuse('do not start at the first byte');
  if (holeEnd + rest !== bytes.byteLength) refuse(`do not end at the file's last byte, ${String(bytes.byteLength)}`);
  if (holeEnd - holeStart !== reserved * 2 + 2) {
    refuse(`hold a hole of ${String(holeEnd - holeStart)} bytes where the placeholder reserved ${String(reserved * 2 + 2)}`);
  }
  if (bytes[holeStart] !== OPEN || bytes[holeEnd - 1] !== CLOSE) refuse('do not bracket a hex string');
  for (let at = holeStart + 1; at < holeEnd - 1; at += 1) {
    if (bytes[at] !== ZERO) refuse(`hold a hole that is not empty at byte ${String(at)}`);
  }
}

/**
 * The bytes a signature covers: everything but the hole, in file order.
 *
 * `SignPdf.sign`'s own cut, so a signature made here is a signature of the bytes `@signpdf` would have handed its signer
 * for the same file — the fill's proof requires the two to agree.
 */
export function bytesToSign(prepared: PreparedSignature): Buffer {
  const [, holeStart, holeEnd] = prepared.byteRange;
  return Buffer.concat([prepared.bytes.subarray(0, holeStart), prepared.bytes.subarray(holeEnd)]);
}

/**
 * Writes a signature into the prepared hole, in place, and answers the signed document.
 *
 * **The fill, spelt once.** It is `SignPdf.sign`'s last step: the signature hexed, padded with zeros to the hole's
 * length, between the brackets. The hole is already all zeros and of that length, so writing the hex from just after
 * the `<` is the whole of it, and the file keeps its length — the property the ranges rest on. Its proof requires the
 * result to be byte-identical to `SignPdf.sign` over the same placeholder with the same signature.
 *
 * @throws {@link SignatureTooLargeError} when the signature does not fit the reserved space
 */
export function fillSignature(prepared: PreparedSignature, signature: Uint8Array): Uint8Array {
  const [, holeStart, holeEnd] = prepared.byteRange;
  const reserved = (holeEnd - holeStart - 2) / 2;
  if (signature.byteLength > reserved) throw new SignatureTooLargeError(signature.byteLength, reserved);
  const hex = Buffer.from(Buffer.from(signature).toString('hex'), 'latin1');
  prepared.bytes.set(hex, holeStart + 1);
  return prepared.bytes;
}

/**
 * Signs a prepared document: checks its ranges, signs the bytes outside the hole, adds a timestamp when one is asked
 * for, and fills the hole.
 *
 * **Each failure is named where it happens.** The credential's refusal is only what `P12Signer` itself throws; a
 * signature too large for its hole is `fillSignature`'s; a host whose ranges do not describe its file is a defect and
 * propagates as one. Wrapping all of it in the credential's name would tell a person a wrong password for a document
 * problem.
 *
 * `@signpdf/signer-p12` loads here, dynamically, so main pays for node-forge only when somebody signs something — the
 * same reason `nspell` is behind one.
 */
export async function signPrepared(
  prepared: PreparedSignature,
  command: CommandOfKind<'signDocument'>,
  requestTimestamp: RequestTimestamp,
): Promise<Uint8Array> {
  checkPrepared(prepared, reservedSignatureBytes(command));
  const { P12Signer } = await import('@signpdf/signer-p12');
  let raw: Buffer;
  try {
    // THE PASSPHRASE REACHES ONE CALL. Nothing here records it, and the error carries none of it.
    raw = await new P12Signer(command.bytes, { passphrase: command.passphrase }).sign(bytesToSign(prepared));
  } catch (cause) {
    throw new SignatureCredentialRefusedError({ cause });
  }
  const withToken = command.timestamp === undefined ? raw : await timestamped(raw, command.timestamp, requestTimestamp);
  return fillSignature(prepared, withToken);
}

/**
 * Asks a timestamp authority, by id, with a DER TimeStampReq, and answers the
 * reply's body — already bounded by the transport.
 *
 * **A port, supplied by the composition root** (ADR-0058 Decision 4): the kernel
 * holds no network code, and its cases drive the whole flow with an authority
 * minted in memory. Anything it throws is the authority being unreachable; what
 * it answers is judged by `acceptTimestampReply` alone.
 */
export type RequestTimestamp = (authority: TimestampAuthority, query: Uint8Array) => Promise<Uint8Array>;

/**
 * The port for a writer built without one — unit cases, and the spec table's own
 * apply. A command that asks for a timestamp through it is refused as unreachable
 * rather than signed without one, which is the decorative defect ADR-0058 exists
 * to rule out.
 */
export const NO_TIMESTAMPS: RequestTimestamp = () =>
  Promise.reject(new Error('no timestamp transport is registered with this writer'));

/**
 * Prepares a signature beside `session`, in the process that holds it, and answers the prepared bytes and their
 * ranges: the MuPDF host's `engine/prepareSignature` in `main`, a local session's serialise in a test.
 */
export type SignatureHost = (session: MupdfSession, request: PlaceholderRequest) => Promise<PreparedSignature>;

/**
 * Reports that a signature's prior state is not recorded.
 *
 * The prior state is the unsigned document, which is the whole file. A
 * checkpoint holds exactly that, and it is the right place for it.
 */
export const captureSignDocument = (): Promise<CaptureResult<never>> =>
  Promise.resolve({
    captured: false,
    reason:
      'a signature cannot be recorded as prior state: the prior state is the unsigned document, ' +
      'which is the whole file, and the checkpoint holds it',
  });

/** Refuses to invert, for {@link captureSignDocument}'s reason. */
export const invertSignDocument = (): never => {
  throw new Error('signDocument is declared non-invertible. Undo restores the checkpoint.');
};

/**
 * The signing writer's execution: the placeholder prepared by `host` beside the MuPDF session, the signature made here
 * ([ADR-0148](../../../docs/DECISIONS/0148-signings-parse-runs-in-the-mupdf-host-and-main-keeps-only-the-key.md)).
 *
 * The signed bytes are this process's own, so they are staged as bytes in hand; the bus places them where `adopt`
 * rebuilds the session, as it does any hosted result. `capture` answers from nothing, as {@link captureSignDocument}
 * says, and `invert` is unreachable for the same reason.
 *
 * @param requestTimestamp the composition's timestamp port, or {@link NO_TIMESTAMPS}
 */
export function signpdfExecutionWith(host: SignatureHost, requestTimestamp: RequestTimestamp): CommandExecution<'signpdf'> {
  return {
    apply: async ({ session, command }) => {
      // `signDocument` IS THE ONE KIND ROUTED HERE, and the kind is still read rather than assumed: a routing defect
      // must not reach the signer as some other command's payload. The cast is that check's: `K` is generic over the
      // kinds routed to this writer, and the checker cannot narrow `CommandOfKind<K>` by a discriminant.
      const routed: Command = command;
      if (routed.kind !== 'signDocument') throw new Error(`"${routed.kind}" is not routed to the signpdf writer.`);
      const signing = routed;
      const prepared = await host(session, placeholderRequestOf(signing));
      return stagedBytes(await signPrepared(prepared, signing, requestTimestamp));
    },
    capture: () => captureSignDocument(),
    invert: (_session, kind) =>
      Promise.reject(new Error(`${kind} is not invertible — its prior state is never — so nothing can hold an inverse to run.`)),
  };
}
