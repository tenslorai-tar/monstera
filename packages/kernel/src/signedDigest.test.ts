import { createHash } from 'node:crypto';

import { P12Signer } from '@signpdf/signer-p12';
import forge from 'node-forge';
import { beforeAll, describe, expect, it } from 'vitest';

import { openCredential, signedDataOverDigest } from './signedDigest.js';

/**
 * ADR-0248: a signature made from a digest is the signature `P12Signer` makes from the bytes.
 *
 * ## The oracle is the library this replaces, run on the same inputs
 *
 * RSASSA-PKCS1-v1_5 is deterministic, so `P12Signer.sign(content, at)` is one byte string for one credential. Every case
 * here asks it for that string and requires the digest path to answer the same one. A case that compared the result
 * with a structure this file built would pass for any field both spelt wrong.
 */

const PASSPHRASE = 'digest-passphrase';
let credential: Uint8Array;
let otherKeyCredential: Uint8Array;

/** A self-signed P12, as `documentSign.test.ts` builds one; `mismatched` pairs the certificate with another key. */
function selfSigned(mismatched = false): Uint8Array {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '0a1b';
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2027-01-01T00:00:00Z');
  const attrs = [
    { name: 'commonName', value: 'Monstera Digest Test' },
    { name: 'organizationName', value: 'Tenslor Inc.' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const key = mismatched ? forge.pki.rsa.generateKeyPair(2048).privateKey : keys.privateKey;
  const der = forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(key, [cert], PASSPHRASE, { algorithm: '3des' })).getBytes();
  return Uint8Array.from(der, (character: string) => character.charCodeAt(0));
}

beforeAll(() => {
  credential = selfSigned();
  otherKeyCredential = selfSigned(true);
});

const sha256 = (bytes: Uint8Array): Uint8Array => createHash('sha256').update(bytes).digest();

describe('signedDataOverDigest', () => {
  it('answers P12Signer’s own bytes for the same content and signing time, across contents and times', async () => {
    const opened = openCredential(credential, PASSPHRASE);
    const contents = [new Uint8Array(0), Uint8Array.of(0x25), Buffer.from('%PDF-1.7 a document to sign\n'), new Uint8Array(70_000).fill(7)];
    // INSIDE and OUTSIDE UTCTime's range, so both encodings forge chooses between are compared.
    const times = [new Date('2026-10-15T09:30:00Z'), new Date('2051-02-03T04:05:06Z')];
    for (const content of contents) {
      for (const at of times) {
        const expected = await new P12Signer(credential, { passphrase: PASSPHRASE }).sign(Buffer.from(content), at);
        expect(signedDataOverDigest(opened, sha256(content), at).equals(expected)).toBe(true);
      }
    }
  });

  it('CONTROL: a digest of different bytes is a different signature, so the comparison above can fail', async () => {
    const opened = openCredential(credential, PASSPHRASE);
    const at = new Date('2026-10-15T09:30:00Z');
    const expected = await new P12Signer(credential, { passphrase: PASSPHRASE }).sign(Buffer.from('the signed bytes'), at);
    expect(signedDataOverDigest(opened, sha256(Buffer.from('other bytes')), at).equals(expected)).toBe(false);
  });

  it('refuses a digest that is not SHA-256’s length', () => {
    expect(() => signedDataOverDigest(openCredential(credential, PASSPHRASE), new Uint8Array(20), new Date())).toThrow('32 bytes');
  });
});

describe('openCredential', () => {
  it('refuses a wrong passphrase, as P12Signer does', async () => {
    expect(() => openCredential(credential, 'not the passphrase')).toThrow();
    await expect(new P12Signer(credential, { passphrase: 'not the passphrase' }).sign(Buffer.from('x'))).rejects.toThrow();
  });

  it('refuses a credential whose certificate does not match its key, with P12Signer’s words', async () => {
    expect(() => openCredential(otherKeyCredential, PASSPHRASE)).toThrow('Failed to find a certificate that matches the private key.');
    await expect(new P12Signer(otherKeyCredential, { passphrase: PASSPHRASE }).sign(Buffer.from('x'))).rejects.toThrow(
      'Failed to find a certificate that matches the private key.',
    );
  });
});
