// @ts-check
/**
 * Proof that a detached OpenPGP signature is accepted only under the pinned key
 * (rule B2).
 *
 * The signatures here are BUILT, from a key generated in this process, because
 * B10 admits no pasted fixture. That makes the signer and the verifier two
 * readings of RFC 9580 by one author. So the independent readings live elsewhere
 * and are named here, not implied:
 *
 * - `gpg` 2.4.8 made a key and a signature on 2026-09-14, and this module
 *   verified them (ADR-0063).
 * - The committed TDF key's computed fingerprint must equal the one pinned from
 *   the keyserver and the signature's own issuer subpacket. That is a case below.
 * - The provisioner verifies TDF's real signature over the real MSI.
 *
 * Every refusal case asserts WHICH rule refused, because a wrong key, a wrong file
 * and a tampered value all reach "not verified". A version that refused
 * everything would pass a case that only asserted the refusal.
 *
 * Usage: node scripts/proofs/openpgpVerify.proof.mjs
 */

import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRoster } from '../lib/passRoster.mjs';
import { primaryKey, verifyDetached } from '../lib/openpgpVerify.mjs';
import { LIBREOFFICE_KEY_FINGERPRINT, libreOfficeKeyPath } from '../provision/keys/libreOfficeKey.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 12 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const scratch = mkdtempSync(join(tmpdir(), 'monstera-openpgp-'));

/**
 * An OpenPGP MPI: a 16-bit bit count, then the value without leading zero octets.
 *
 * @param {Buffer} value
 */
function mpiOf(value) {
  let at = 0;
  while (at < value.length - 1 && value.readUInt8(at) === 0) at += 1;
  const trimmed = value.subarray(at);
  const bits = (trimmed.length - 1) * 8 + (32 - Math.clz32(trimmed.readUInt8(0)));
  const header = Buffer.alloc(2);
  header.writeUInt16BE(bits);
  return Buffer.concat([header, trimmed]);
}

/** @param {Buffer} bytes one byte flipped in the middle, in a copy */
function flipMiddle(bytes) {
  const copy = Buffer.from(bytes);
  const middle = copy.length >> 1;
  copy.writeUInt8(copy.readUInt8(middle) ^ 0x01, middle);
  return copy;
}

/** @param {number} tag @param {Buffer} body */
function packet(tag, body) {
  if (body.length > 0xffff) throw new Error('fixture packet too large');
  const header = Buffer.from([0xc0 | tag, 255, 0, 0, 0, 0]);
  header.writeUInt32BE(body.length, 2);
  return Buffer.concat([header, body]);
}

/** @param {Buffer} bytes @param {'PUBLIC KEY BLOCK' | 'SIGNATURE'} kind */
function armor(bytes, kind) {
  const lines = bytes.toString('base64').match(/.{1,64}/g) ?? [];
  return [`-----BEGIN PGP ${kind}-----`, '', ...lines, `-----END PGP ${kind}-----`, ''].join('\n');
}

/** A v4 RSA key, its public block, and a signer over `(bytes) → armored signature`. */
function makeKey() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const created = Buffer.alloc(4);
  created.writeUInt32BE(1_786_000_000);
  const body = Buffer.concat([
    Buffer.from([4]),
    created,
    Buffer.from([1]),
    mpiOf(Buffer.from(String(jwk.n), 'base64url')),
    mpiOf(Buffer.from(String(jwk.e), 'base64url')),
  ]);
  const header = Buffer.from([0x99, 0, 0]);
  header.writeUInt16BE(body.length, 1);
  const fingerprint = createHash('sha1').update(header).update(body).digest();

  /**
   * @param {Buffer} data
   * @param {{ signatureClass?: number, hashAlgorithm?: number, issuer?: Buffer, tamper?: 'value' }} [options]
   */
  const sign = (data, options = {}) => {
    const issuer = options.issuer ?? fingerprint;
    const hashName = options.hashAlgorithm === 10 ? 'sha512' : 'sha256';
    const hashed = Buffer.concat([Buffer.from([5, 2]), created, Buffer.from([22, 33, 4]), issuer]);
    const prefix = Buffer.concat([
      Buffer.from([4, options.signatureClass ?? 0, 1, options.hashAlgorithm ?? 8, 0, 0]),
      hashed,
    ]);
    prefix.writeUInt16BE(hashed.length, 4);
    const trailer = Buffer.from([4, 0xff, 0, 0, 0, 0]);
    trailer.writeUInt32BE(prefix.length, 2);
    const digest = createHash(hashName).update(data).update(prefix).update(trailer).digest();
    const signed = createSign(hashName).update(data).update(prefix).update(trailer).sign(privateKey);
    // The LAST octet, so the quick check (the digest's first two) stays intact and
    // only the RSA verification can refuse it.
    const value = options.tamper === 'value' ? flipLast(signed) : signed;
    const signature = Buffer.concat([prefix, Buffer.from([0, 0]), digest.subarray(0, 2), mpiOf(value)]);
    return armor(packet(2, signature), 'SIGNATURE');
  };

  return {
    armored: armor(packet(6, body), 'PUBLIC KEY BLOCK'),
    fingerprint: fingerprint.toString('hex').toUpperCase(),
    sign,
  };
}

/** @param {Buffer} bytes */
function flipLast(bytes) {
  const copy = Buffer.from(bytes);
  const last = copy.length - 1;
  copy.writeUInt8(copy.readUInt8(last) ^ 0x01, last);
  return copy;
}

const signer = makeKey();
const stranger = makeKey();
const DATA = Buffer.from('the pinned artefact, and nothing else');
const file = join(scratch, 'artefact.bin');
writeFileSync(file, DATA);
const flipped = join(scratch, 'flipped.bin');
writeFileSync(flipped, flipMiddle(DATA));

/** @param {Parameters<typeof verifyDetached>[0]} input */
async function outcome(input) {
  try {
    await verifyDetached(input);
    return 'verified';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const good = { file, signature: signer.sign(DATA), publicKey: signer.armored, fingerprint: signer.fingerprint };

{
  const pinned = primaryKey(readFileSync(libreOfficeKeyPath(), 'utf8'));
  check(
    'the committed TDF key computes to the pinned fingerprint',
    pinned.fingerprint === LIBREOFFICE_KEY_FINGERPRINT,
    `computed ${pinned.fingerprint}`,
  );
}

{
  const result = await outcome(good);
  check('a signature by the pinned key over these bytes verifies', result === 'verified', result);
}

{
  const result = await outcome({ ...good, signature: signer.sign(DATA, { hashAlgorithm: 10 }) });
  check('SHA-512 is accepted as well', result === 'verified', result);
}

{
  const result = await outcome({ ...good, file: flipped });
  check('one flipped bit in the file is refused by the digest', result === 'signature does not match these bytes', result);
}

{
  const result = await outcome({ ...good, signature: signer.sign(DATA, { tamper: 'value' }) });
  check('a tampered value with its quick check intact is refused by RSA', result === 'signature does not verify', result);
}

{
  const result = await outcome({ ...good, publicKey: stranger.armored });
  check(
    'a key other than the pinned one is refused before any hashing',
    result.startsWith(`key fingerprint ${stranger.fingerprint} is not the pinned`),
    result,
  );
}

{
  const result = await outcome({ ...good, signature: stranger.sign(DATA) });
  check('a signature naming another issuer is refused by name', result.startsWith(`signed by ${stranger.fingerprint}`), result);
}

{
  // The issuer subpacket claims the pinned key; the value is the stranger's. What
  // refuses it must be the mathematics, never the claim.
  const forged = stranger.sign(DATA, { issuer: Buffer.from(signer.fingerprint, 'hex') });
  const result = await outcome({ ...good, signature: forged });
  check('a signature CLAIMING the pinned issuer is refused by RSA', result === 'signature does not verify', result);
}

{
  const result = await outcome({ ...good, signature: signer.sign(DATA, { signatureClass: 0x01 }) });
  check('a text-document signature is refused by class', result.startsWith('signature class 1 is refused'), result);
}

{
  const result = await outcome({ ...good, signature: signer.sign(DATA, { hashAlgorithm: 2 }) });
  check('SHA-1 is refused by name', result.startsWith('hash algorithm 2 is refused'), result);
}

{
  // The committed key block carries the keyserver's own CRC-24 line, and the first
  // case above already parses it with that checksum checked — so this module's
  // CRC agrees with one computed elsewhere. Changing that line by one character
  // must refuse, on a fixed input, every run.
  const armored = readFileSync(libreOfficeKeyPath(), 'utf8');
  const line = armored.split('\n').find((candidate) => /^=[A-Za-z0-9+/]{4}\r?$/u.test(candidate));
  let result = 'the committed key block has no checksum line to change';
  if (line !== undefined) {
    const changed = `=${line.charAt(1) === 'A' ? 'B' : 'A'}${line.slice(2)}`;
    try {
      primaryKey(armored.replace(line, changed));
      result = 'parsed';
    } catch (error) {
      result = error instanceof Error ? error.message : String(error);
    }
  }
  check('a changed armor checksum is refused', result === 'armor checksum does not match', result);
}

{
  // CONTROL on the fixture builder: a signature it made must be refused when the
  // pinned fingerprint is changed by one nibble, or every case above could be
  // passing on a verifier that ignores the pin.
  const wrong = signer.fingerprint.replace(/.$/u, (last) => (last === '0' ? '1' : '0'));
  const result = await outcome({ ...good, fingerprint: wrong });
  check('CONTROL: the pin is read — one nibble off refuses a good signature', result.includes('is not the pinned'), result);
}

rmSync(scratch, { recursive: true, force: true });

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} openpgpVerify case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('openpgpVerify case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
