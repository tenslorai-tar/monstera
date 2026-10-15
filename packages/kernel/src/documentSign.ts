import { createHash } from 'node:crypto';

import type { Command, CommandOfKind, TimestampAuthority } from '@monstera/contract';

import type { CaptureResult } from './commandLog.js';
import type { CommandExecution } from './commandRouting.js';
import type { MupdfSession } from './engineSeam.js';
import { type StagedImage, stagedBytes } from './savePipeline.js';
import {
  type ByteRange,
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
 * The PKCS#7 `signedDataOverDigest` produced (`P12Signer`'s bytes, ADR-0248), with an accepted timestamp token added to its
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
  // A DEFECT, not a refusal: the signer writes no unsigned attributes, so one
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
async function checkPrepared(image: SignableImage, reserved: number): Promise<void> {
  const { byteLength, byteRange } = image;
  const [start, holeStart, holeEnd, rest] = byteRange;
  const refuse = (why: string): never => {
    throw new Error(`the engine host prepared a signature whose ranges ${JSON.stringify(byteRange)} ${why}`);
  };
  if (!byteRange.every((value) => Number.isSafeInteger(value) && value >= 0)) refuse('are not whole numbers');
  if (start !== 0) refuse('do not start at the first byte');
  if (holeEnd + rest !== byteLength) refuse(`do not end at the file's last byte, ${String(byteLength)}`);
  if (holeEnd - holeStart !== reserved * 2 + 2) {
    refuse(`hold a hole of ${String(holeEnd - holeStart)} bytes where the placeholder reserved ${String(reserved * 2 + 2)}`);
  }
  // THE HOLE ALONE IS READ, so the check costs the hole's length and never the document's.
  const hole = await image.read(holeStart, holeEnd);
  if (hole[0] !== OPEN || hole[hole.byteLength - 1] !== CLOSE) refuse('do not bracket a hex string');
  for (let at = 1; at < hole.byteLength - 1; at += 1) {
    if (hole[at] !== ZERO) refuse(`hold a hole that is not empty at byte ${String(holeStart + at)}`);
  }
}

/**
 * A prepared document as `main` signs it, in place and a range at a time: its length, its four numbers, and reads and
 * writes by offset ([ADR-0248](../../../docs/DECISIONS/0248-a-signature-is-made-over-a-digest-read-from-the-prepared-file.md)).
 * A file `main` owns, from a host; bytes in hand, from a local session.
 */
export interface SignableImage {
  readonly byteLength: number;
  readonly byteRange: ByteRange;
  readonly read: (offset: number, end: number) => Promise<Uint8Array>;
  readonly write: (offset: number, bytes: Uint8Array) => Promise<void>;
}

/** What a {@link SignatureHost} answers: a {@link SignableImage} that is given up as the signed document's staged image. */
export interface PreparedImage extends SignableImage {
  /** The document as it now stands, staged for the bus; once signed, the signed document. Ends reads and writes. */
  readonly staged: () => StagedImage;
}

/** A prepared document held as bytes, signed in place: a local session's, and every case's. */
export function preparedInMemory(prepared: PreparedSignature): PreparedImage {
  const { bytes, byteRange } = prepared;
  return {
    byteLength: bytes.byteLength,
    byteRange,
    read: (offset, end) => Promise.resolve(bytes.subarray(offset, end)),
    write: (offset, written) => {
      bytes.set(written, offset);
      return Promise.resolve();
    },
    staged: () => stagedBytes(bytes),
  };
}

/**
 * The ranges a signature covers: everything but the hole, in file order. `SignPdf.sign`'s own cut, spelt once: the
 * digest reads these ranges, and {@link bytesToSign} joins them for the fill's proof.
 */
function rangesOutsideHole(image: Pick<SignableImage, 'byteLength' | 'byteRange'>): readonly (readonly [number, number])[] {
  const [, holeStart, holeEnd] = image.byteRange;
  return [
    [0, holeStart],
    [holeEnd, image.byteLength],
  ];
}

/**
 * The bytes a signature covers, joined: the proof's form, which holds them whole. Signing never does; it reads them into
 * a digest a part at a time ({@link digestOutsideHole}).
 */
export function bytesToSign(prepared: PreparedSignature): Buffer {
  return Buffer.concat(rangesOutsideHole({ byteLength: prepared.bytes.byteLength, byteRange: prepared.byteRange }).map(([from, to]) => prepared.bytes.subarray(from, to)));
}

/** How many bytes the digest reads at a time: `main` holds one read, whatever the document's size. */
const DIGEST_READ_BYTES = 16 * 1_048_576;

/** The SHA-256 of the bytes outside the hole, read {@link DIGEST_READ_BYTES} at a time. */
async function digestOutsideHole(image: SignableImage): Promise<Uint8Array> {
  const hash = createHash('sha256');
  for (const [from, to] of rangesOutsideHole(image)) {
    for (let at = from; at < to; at += DIGEST_READ_BYTES) hash.update(await image.read(at, Math.min(at + DIGEST_READ_BYTES, to)));
  }
  return hash.digest();
}

/**
 * Writes a signature into the prepared hole, in place.
 *
 * **The fill, spelt once.** It is `SignPdf.sign`'s last step: the signature hexed, padded with zeros to the hole's
 * length, between the brackets. The hole is already all zeros and of that length, so writing the hex from just after
 * the `<` is the whole of it, and the file keeps its length — the property the ranges rest on. Its proof requires the
 * result to be byte-identical to `SignPdf.sign` over the same placeholder with the same signature.
 *
 * @throws {@link SignatureTooLargeError} when the signature does not fit the reserved space
 */
async function fillHole(image: SignableImage, signature: Uint8Array): Promise<void> {
  const [, holeStart, holeEnd] = image.byteRange;
  const reserved = (holeEnd - holeStart - 2) / 2;
  if (signature.byteLength > reserved) throw new SignatureTooLargeError(signature.byteLength, reserved);
  await image.write(holeStart + 1, Buffer.from(Buffer.from(signature).toString('hex'), 'latin1'));
}

/** {@link fillHole} over bytes in hand, answering them: the fill's proof's form. */
export async function fillSignature(prepared: PreparedSignature, signature: Uint8Array): Promise<Uint8Array> {
  await fillHole(preparedInMemory(prepared), signature);
  return prepared.bytes;
}

/**
 * Signs a prepared document in place: checks its ranges against its hole, digests the bytes outside the hole a read at
 * a time, signs the digest, adds a timestamp when one is asked for, and fills the hole
 * ([ADR-0248](../../../docs/DECISIONS/0248-a-signature-is-made-over-a-digest-read-from-the-prepared-file.md)).
 *
 * **Each failure is named where it happens.** The credential's refusal is only what opening the credential and signing
 * with it throw; a signature too large for its hole is the fill's; a host whose ranges do not describe its file is a
 * defect and propagates as one. Wrapping all of it in the credential's name would tell a person a wrong password for a
 * document problem.
 *
 * `signedDigest.ts` loads here, dynamically, so main pays for node-forge only when somebody signs something — the same
 * reason `nspell` is behind one.
 */
export async function signImage(
  image: SignableImage,
  command: CommandOfKind<'signDocument'>,
  requestTimestamp: RequestTimestamp,
): Promise<void> {
  await checkPrepared(image, reservedSignatureBytes(command));
  const digest = await digestOutsideHole(image);
  const { openCredential, signedDataOverDigest } = await import('./signedDigest.js');
  let raw: Buffer;
  try {
    // THE PASSPHRASE REACHES ONE CALL. Nothing here records it, and the error carries none of it.
    raw = signedDataOverDigest(openCredential(command.bytes, command.passphrase), digest, new Date());
  } catch (cause) {
    throw new SignatureCredentialRefusedError({ cause });
  }
  const withToken = command.timestamp === undefined ? raw : await timestamped(raw, command.timestamp, requestTimestamp);
  await fillHole(image, withToken);
}

/** {@link signImage} over bytes in hand, answering them signed: a local session's form, and every case's. */
export async function signPrepared(
  prepared: PreparedSignature,
  command: CommandOfKind<'signDocument'>,
  requestTimestamp: RequestTimestamp,
): Promise<Uint8Array> {
  await signImage(preparedInMemory(prepared), command, requestTimestamp);
  return prepared.bytes;
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
export type SignatureHost = (session: MupdfSession, request: PlaceholderRequest) => Promise<PreparedImage>;

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
      try {
        await signImage(prepared, signing, requestTimestamp);
      } catch (refused) {
        // NOTHING SIGNED IS KEPT: a file `main` took for this signature is removed with the refusal.
        await prepared.staged().discard();
        throw refused;
      }
      return prepared.staged();
    },
    capture: () => captureSignDocument(),
    invert: (_session, kind) =>
      Promise.reject(new Error(`${kind} is not invertible — its prior state is never — so nothing can hold an inverse to run.`)),
  };
}
