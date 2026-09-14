// @ts-check
/**
 * A detached OpenPGP signature, checked by `node:crypto` and narrowed to exactly
 * what a pinned artefact needs: a version 4 signature of class 0x00 (a binary
 * document), RSA, SHA-256 or SHA-512, made by the PRIMARY key whose v4
 * fingerprint is pinned. Anything else is refused by name (ADR-0063).
 *
 * RFC 9580 is the authority, and this is its v4 subset, written once (B3a).
 * `gpg` is not the verifier because it is ambient: which build a machine has is
 * pinned by nothing in this repository.
 *
 * ## The fingerprint is COMPUTED, never read
 *
 * A key block says nothing trustworthy about itself. The fingerprint is SHA-1
 * over `0x99 ‖ length ‖ body` of the primary key packet, and the signature's
 * issuer subpacket is compared to the pin as well. That subpacket is a claim,
 * so the RSA verification decides even when the claim matches.
 *
 * ## The 16-bit quick check is not the verification
 *
 * A signature carries the digest's first two octets so a reader can refuse the
 * wrong file cheaply. It is checked first because it names that refusal
 * precisely, and never instead of RSA: two octets are forgeable by anyone.
 *
 * ## Every octet is read through a method that throws past the end
 *
 * `bytes[at]` past a Buffer's end is `undefined`, and length arithmetic on it is
 * `NaN`, which then compares false against every bound. A truncated packet would
 * walk on instead of stopping. `readUInt8` and its siblings throw `RangeError`
 * there, so a short input is a refusal, never a quiet misparse.
 */

import { createHash, createPublicKey, createVerify } from 'node:crypto';
import { createReadStream } from 'node:fs';

/** @type {ReadonlyMap<number, 'sha256' | 'sha512'>} */
const HASHES = new Map([
  [8, 'sha256'],
  [10, 'sha512'],
]);

/**
 * ASCII armor → bytes, with the CRC-24 checked when present.
 *
 * @param {string} text
 * @returns {Buffer}
 */
export function dearmor(text) {
  const lines = text.replaceAll('\r', '').split('\n');
  const begin = lines.findIndex((line) => line.startsWith('-----BEGIN PGP '));
  const end = lines.findIndex((line, index) => index > begin && line.startsWith('-----END PGP '));
  if (begin < 0 || end < 0) throw new Error('not an ASCII-armored OpenPGP block');
  // Armor headers end at the first blank line after BEGIN.
  const blank = lines.findIndex((line, index) => index > begin && index < end && line.trim() === '');
  if (blank < 0) throw new Error('armor has no blank line ending its headers');
  const body = lines
    .slice(blank + 1, end)
    .map((line) => line.trim())
    .filter(Boolean);
  const last = body.at(-1);
  const checksum = last?.startsWith('=') === true ? body.pop() : undefined;
  const bytes = Buffer.from(body.join(''), 'base64');
  if (checksum !== undefined) {
    const expected = Buffer.from(checksum.slice(1), 'base64').readUIntBE(0, 3);
    if (crc24(bytes) !== expected) throw new Error('armor checksum does not match');
  }
  return bytes;
}

/** @param {Uint8Array} bytes */
function crc24(bytes) {
  let crc = 0xb704ce;
  for (const byte of bytes) {
    crc ^= byte << 16;
    for (let bit = 0; bit < 8; bit += 1) {
      crc <<= 1;
      if (crc & 0x1000000) crc ^= 0x1864cfb;
    }
  }
  return crc & 0xffffff;
}

/**
 * The packets in a binary OpenPGP message. Partial and indeterminate lengths are
 * refused: neither is used by a detached signature or a public key block.
 *
 * @param {Buffer} bytes
 * @returns {{ tag: number, body: Buffer }[]}
 */
export function packets(bytes) {
  const out = [];
  let at = 0;
  while (at < bytes.length) {
    const ctb = bytes.readUInt8(at);
    if ((ctb & 0x80) === 0) throw new Error(`not a packet header at offset ${String(at)}`);
    let tag;
    let length;
    if (ctb & 0x40) {
      tag = ctb & 0x3f;
      const first = bytes.readUInt8(at + 1);
      if (first < 192) {
        length = first;
        at += 2;
      } else if (first < 224) {
        length = ((first - 192) << 8) + bytes.readUInt8(at + 2) + 192;
        at += 3;
      } else if (first === 255) {
        length = bytes.readUInt32BE(at + 2);
        at += 6;
      } else {
        throw new Error('partial body lengths are refused');
      }
    } else {
      tag = (ctb >> 2) & 0x0f;
      const kind = ctb & 0x03;
      if (kind === 0) {
        length = bytes.readUInt8(at + 1);
        at += 2;
      } else if (kind === 1) {
        length = bytes.readUInt16BE(at + 1);
        at += 3;
      } else if (kind === 2) {
        length = bytes.readUInt32BE(at + 1);
        at += 5;
      } else {
        throw new Error('indeterminate lengths are refused');
      }
    }
    if (at + length > bytes.length) throw new Error('packet runs past the end');
    out.push({ tag, body: bytes.subarray(at, at + length) });
    at += length;
  }
  return out;
}

/**
 * @param {Buffer} body
 * @param {number} at
 * @returns {{ value: Buffer, next: number }}
 */
function mpi(body, at) {
  const bits = body.readUInt16BE(at);
  const size = Math.ceil(bits / 8);
  if (at + 2 + size > body.length) throw new Error('MPI runs past the packet');
  return { value: body.subarray(at + 2, at + 2 + size), next: at + 2 + size };
}

/**
 * The primary key of an armored public key block, as a KeyObject plus its v4
 * fingerprint, computed from the packet and never read from anything the block
 * says about itself.
 *
 * @param {string} armored
 */
export function primaryKey(armored) {
  const primary = packets(dearmor(armored)).find((packet) => packet.tag === 6);
  if (primary === undefined) throw new Error('no public key packet');
  const { body } = primary;
  const version = body.readUInt8(0);
  if (version !== 4) throw new Error(`public key version ${String(version)} is refused; only v4`);
  const algorithm = body.readUInt8(5);
  if (algorithm !== 1) throw new Error(`public key algorithm ${String(algorithm)} is refused; only RSA`);
  const n = mpi(body, 6);
  const e = mpi(body, n.next);
  const header = Buffer.alloc(3);
  header.writeUInt8(0x99, 0);
  header.writeUInt16BE(body.length, 1);
  const fingerprint = createHash('sha1').update(header).update(body).digest('hex').toUpperCase();
  const key = createPublicKey({
    key: { kty: 'RSA', n: n.value.toString('base64url'), e: e.value.toString('base64url') },
    format: 'jwk',
  });
  return { fingerprint, key };
}

/**
 * Resolves only when `signature` verifies over the bytes of `file` under the key
 * in `publicKey`, and that key's computed fingerprint is `fingerprint`.
 *
 * @param {{ file: string, signature: string, publicKey: string, fingerprint: string }} input
 * @returns {Promise<void>}
 */
export async function verifyDetached({ file, signature, publicKey, fingerprint }) {
  const pinned = fingerprint.toUpperCase();
  const { fingerprint: actual, key } = primaryKey(publicKey);
  if (actual !== pinned) throw new Error(`key fingerprint ${actual} is not the pinned ${pinned}`);

  const signatures = packets(dearmor(signature)).filter((packet) => packet.tag === 2);
  const only = signatures.length === 1 ? signatures[0] : undefined;
  if (only === undefined) {
    throw new Error(`expected one signature packet, found ${String(signatures.length)}`);
  }
  const body = only.body;
  const version = body.readUInt8(0);
  if (version !== 4) throw new Error(`signature version ${String(version)} is refused; only v4`);
  const signatureClass = body.readUInt8(1);
  if (signatureClass !== 0x00) {
    throw new Error(`signature class ${String(signatureClass)} is refused; only a binary document`);
  }
  const algorithm = body.readUInt8(2);
  if (algorithm !== 1) throw new Error(`signature algorithm ${String(algorithm)} is refused; only RSA`);
  const hashAlgorithm = body.readUInt8(3);
  const hash = HASHES.get(hashAlgorithm);
  if (hash === undefined) throw new Error(`hash algorithm ${String(hashAlgorithm)} is refused`);

  const hashedEnd = 6 + body.readUInt16BE(4);
  if (hashedEnd > body.length) throw new Error('hashed subpackets run past the packet');
  const issuer = issuerFingerprint(body.subarray(6, hashedEnd));
  if (issuer !== pinned) throw new Error(`signed by ${issuer ?? 'an unnamed key'}, not the pinned ${pinned}`);

  const unhashedEnd = hashedEnd + 2 + body.readUInt16BE(hashedEnd);
  const left16 = body.subarray(unhashedEnd, unhashedEnd + 2);
  if (left16.length !== 2) throw new Error('signature packet ends before its quick check');
  const { value: signed } = mpi(body, unhashedEnd + 2);

  const trailer = Buffer.alloc(6);
  trailer.writeUInt8(0x04, 0);
  trailer.writeUInt8(0xff, 1);
  trailer.writeUInt32BE(hashedEnd, 2);
  const prefix = body.subarray(0, hashedEnd);

  const verifier = createVerify(hash);
  const quick = createHash(hash);
  for await (const chunk of createReadStream(file)) {
    verifier.update(chunk);
    quick.update(chunk);
  }
  verifier.update(prefix).update(trailer);
  quick.update(prefix).update(trailer);
  if (!quick.digest().subarray(0, 2).equals(left16)) throw new Error('signature does not match these bytes');
  // An MPI drops leading zero octets, and PKCS#1 verification wants the modulus width.
  const width = Math.ceil((key.asymmetricKeyDetails?.modulusLength ?? 0) / 8);
  const padded = Buffer.concat([Buffer.alloc(Math.max(0, width - signed.length)), signed]);
  if (!verifier.verify(key, padded)) throw new Error('signature does not verify');
}

/**
 * The v4 fingerprint an issuer-fingerprint subpacket (type 33) names, or null.
 *
 * @param {Buffer} area the hashed subpacket area
 * @returns {string | null}
 */
function issuerFingerprint(area) {
  let at = 0;
  while (at < area.length) {
    const first = area.readUInt8(at);
    let length;
    if (first < 192) {
      length = first;
      at += 1;
    } else if (first < 255) {
      length = ((first - 192) << 8) + area.readUInt8(at + 1) + 192;
      at += 2;
    } else {
      length = area.readUInt32BE(at + 1);
      at += 5;
    }
    if (length < 1 || at + length > area.length) throw new Error('a subpacket runs past its area');
    const type = area.readUInt8(at) & 0x7f;
    if (type === 33 && length >= 2 && area.readUInt8(at + 1) === 4) {
      return area.subarray(at + 2, at + length).toString('hex').toUpperCase();
    }
    at += length;
  }
  return null;
}
