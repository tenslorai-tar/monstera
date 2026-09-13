// @ts-check
/**
 * One signature timestamped by a LIVE RFC 3161 authority — the trigger D7's TSA
 * row carries.
 *
 * ## Why this exists and CI does not run it
 *
 * Every token `timestampToken.test.ts` accepts was built in this repository from
 * the RFCs. A real authority may carry an ESSCertID v1 attribute, a certificate
 * chain, or an encoding the hand-built token does not, and only a real reply can
 * say whether the verification accepts what authorities actually send. Nothing
 * under `scripts/probes/` is in a workflow: this reaches the network.
 *
 * **It has already paid for itself.** Its first runs, 2026-09-13, found two
 * shapes the hand-built tokens lacked: a token carrying BOTH signing-certificate
 * attributes, which the verification wrongly refused, and a token signed with
 * ECDSA, which this build cannot verify — so that authority is not offered.
 *
 * ## What leaves the machine
 *
 * One TimeStampReq: a SHA-256 of a signature value, a random nonce and `certReq`.
 * The document is drawn here and never sent, the certificate is minted in memory,
 * and nothing is written to disk.
 *
 * ## What it asserts — the SHIPPED route, not a harness's own
 *
 * The signature goes through the built kernel's `signDocumentWith` and the built
 * desktop `timestampTransport`, which are what the application registers. Then the
 * signed file is read back:
 *
 * - its one SignerInfo carries exactly one `id-aa-timeStampToken`;
 * - that token is accepted AGAIN, against a query rebuilt from the signature value
 *   the file actually carries — so a token over some other value fails here;
 * - the signature still covers the document.
 *
 * A refusal is reported by its NAME and reason, and — for a verification refusal
 * only — by which check refused it: those messages are fixed strings naming the
 * check, never a host.
 *
 * ## It ends by setting `process.exitCode`, never by calling `process.exit`
 *
 * Calling `process.exit()` while the request's timeout handles are still closing
 * aborted Node on Windows — *Assertion failed: !(handle->flags &
 * UV_HANDLE_CLOSING)* — and replaced the probe's own exit code with the abort's.
 *
 * Usage:
 *
 *     npm run probe:tsa                          (DigiCert)
 *     npm run probe:tsa -- --authority sectigo
 *
 * FreeTSA is not in the list: its tokens are signed with ECDSA, which this build's
 * verifier does not verify — measured by this probe on 2026-09-13.
 */

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import forge from 'node-forge';

import { TIMESTAMP_AUTHORITY_IDS } from '../../packages/contract/dist/index.js';
import { signDocumentWith } from '../../packages/kernel/dist/documentSign.js';
import { mupdfWriter } from '../../packages/kernel/dist/mupdfWriter.js';
import { pkcs7Asn1, readSignatures } from '../../packages/kernel/dist/signatureRead.js';
import { acceptTimestampReply } from '../../packages/kernel/dist/timestampToken.js';
import { timestampTransport } from '../../apps/desktop/dist/timestampTransport.js';
import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';

const ROOT = repoRoot();

// THE BUILT CODE IS THE SUBJECT, so a stale build would send last week's request
// and print the answer under this week's name.
refuseStaleBuild(
  ROOT,
  [
    ['packages/kernel/src/documentSign.ts', 'packages/kernel/dist/documentSign.js', 'tsc'],
    ['packages/kernel/src/timestampToken.ts', 'packages/kernel/dist/timestampToken.js', 'tsc'],
    ['packages/kernel/src/signedDataCheck.ts', 'packages/kernel/dist/signedDataCheck.js', 'tsc'],
    ['packages/kernel/src/signatureRead.ts', 'packages/kernel/dist/signatureRead.js', 'tsc'],
    ['apps/desktop/src/timestampTransport.ts', 'apps/desktop/dist/timestampTransport.js', 'tsc'],
  ],
  5,
);

const { asn1 } = forge;
const PASSPHRASE = 'tsa-live-probe';

/** A document to sign, drawn here. */
async function drawnDocument() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([400, 300]).drawText('MONSTERA', { font, size: 28, x: 40, y: 230 });
  return document.save();
}

/** A self-signed PKCS#12, minted in memory (B10). */
function mintedCertificate() {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  const names = [{ name: 'commonName', value: 'Monstera TSA probe' }];
  cert.setSubject(names);
  cert.setIssuer(names);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], PASSPHRASE, { algorithm: '3des' });
  return forge.util.binary.raw.decode(asn1.toDer(p12).getBytes());
}

/** @param {unknown} node @returns {forge.asn1.Asn1[]} */
function children(node) {
  const value = /** @type {forge.asn1.Asn1 | undefined} */ (node)?.value;
  if (!Array.isArray(value)) throw new Error('a node the probe walked is not a structure');
  return value;
}

/**
 * The authority named on the command line, or the default.
 *
 * @returns {import('../../packages/contract/dist/index.js').TimestampAuthority | null}
 */
function chosenAuthority() {
  const flag = process.argv.indexOf('--authority');
  const chosen = flag === -1 ? 'digicert' : process.argv[flag + 1];
  /** @type {readonly string[]} */
  const known = TIMESTAMP_AUTHORITY_IDS;
  if (chosen === undefined || !known.includes(chosen)) {
    process.stderr.write(
      `\n--authority must be one of ${known.join(', ')}; received ${String(chosen)}.\n`,
    );
    return null;
  }
  return /** @type {import('../../packages/contract/dist/index.js').TimestampAuthority} */ (chosen);
}

/**
 * Signs once through the shipped route, or reports why not.
 *
 * @param {import('../../packages/contract/dist/index.js').TimestampAuthority} authority
 * @returns {Promise<Uint8Array | null>}
 */
async function signWithTimestamp(authority) {
  try {
    return await signDocumentWith(timestampTransport())(await drawnDocument(), {
      kind: 'signDocument',
      bytes: mintedCertificate(),
      passphrase: PASSPHRASE,
      timestamp: authority,
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : typeof error;
    const reason = /** @type {{ reason?: unknown }} */ (error).reason;
    // WHICH CHECK REFUSED IT, for a verification refusal only: those messages are
    // fixed strings written in `timestampToken.ts` — the check's name, never a host
    // or a byte of the reply. Every other error keeps its message unprinted, because
    // a transport's cause can name the host.
    const check =
      name === 'TimestampRefusedError' && error instanceof Error ? ` — ${error.message}` : '';
    process.stderr.write(
      `\nFAILED — ${authority} did not produce an accepted timestamp: ${name}` +
        `${reason === undefined ? '' : ` (${String(reason)})`}${check}. Nothing about this ` +
        'authority is proven by this run.\n',
    );
    return null;
  }
}

/**
 * The checks on the signed file, answered as failures.
 *
 * @param {Uint8Array} signed
 * @param {string} authority
 * @returns {Promise<string[]>}
 */
async function checkSigned(signed, authority) {
  /** @type {string[]} */
  const failures = [];

  // THE SIGNER INFO, out of the hole the file carries.
  const hole = /\/Contents <([0-9A-Fa-f]+)>/u.exec(Buffer.from(signed).toString('latin1'))?.[1];
  if (hole === undefined) return ['the signed file carries no /Contents'];
  const signedData = children(children(pkcs7Asn1(Buffer.from(hole, 'hex')))[1])[0];
  const signerInfos = children(children(signedData).at(-1));
  const fields = children(signerInfos[0]);

  const unsignedAttributes = fields.filter(
    (field) => field.tagClass === asn1.Class.CONTEXT_SPECIFIC && Number(field.type) === 1,
  );
  const attributes = unsignedAttributes.length === 1 ? children(unsignedAttributes[0]) : [];
  const tokens = attributes.filter(
    (attribute) =>
      asn1.derToOid(/** @type {string} */ (children(attribute)[0]?.value)) ===
      '1.2.840.113549.1.9.16.2.14',
  );
  if (tokens.length !== 1) {
    failures.push(`the SignerInfo carries ${String(tokens.length)} timestamp token(s), not one`);
  } else {
    const token = children(children(tokens[0])[1])[0];
    if (token === undefined) throw new Error('the timestamp attribute carries no token');
    const signature = fields.find(
      (field) => field.tagClass === asn1.Class.UNIVERSAL && field.type === asn1.Type.OCTETSTRING,
    );
    const digest = forge.md.sha256.create();
    digest.update(/** @type {string} */ (signature?.value));

    // ContentInfo → [0] → SignedData → encapContentInfo → [0] → OCTET STRING.
    const tokenSignedData = children(children(token)[1])[0];
    const encapContentInfo = children(tokenSignedData)[2];
    const eContent = children(children(encapContentInfo)[1])[0];
    if (typeof eContent?.value !== 'string') throw new Error('the token carries no TSTInfo');
    const tstInfo = asn1.fromDer(eContent.value);
    const nonceNode = children(tstInfo)
      .slice(5)
      .find((node) => node.tagClass === asn1.Class.UNIVERSAL && node.type === asn1.Type.INTEGER);

    // RE-ACCEPTED against the file's own signature value. The nonce was checked
    // against the request inside the signing call, and the file does not carry the
    // request, so the query supplies the token's own nonce.
    const reply = forge.util.binary.raw.decode(
      asn1
        .toDer(
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
              asn1.create(
                asn1.Class.UNIVERSAL,
                asn1.Type.INTEGER,
                false,
                asn1.integerToDer(0).getBytes(),
              ),
            ]),
            token,
          ]),
        )
        .getBytes(),
    );
    try {
      const accepted = acceptTimestampReply(reply, {
        der: new Uint8Array(),
        imprint: digest.digest().getBytes(),
        nonce: /** @type {string} */ (nonceNode?.value),
      });
      process.stdout.write(
        `\n${authority} timestamped the signature at ${accepted.genTime.toISOString()}.\n`,
      );
    } catch (error) {
      failures.push(
        `the embedded token was not accepted against the file's own signature value: ` +
          `${error instanceof Error ? error.message : typeof error}`,
      );
    }
  }

  const session = await mupdfWriter.open(signed);
  try {
    const [read] = await readSignatures(session, signed);
    if (read?.coversDocument !== true || read.coversWholeFile !== true) {
      failures.push('the timestamped signature does not verify as covering the whole document');
    }
  } finally {
    await mupdfWriter.close(session);
  }
  return failures;
}

/** @returns {Promise<number>} the exit code */
async function main() {
  const authority = chosenAuthority();
  if (authority === null) return 2;

  const signed = await signWithTimestamp(authority);
  if (signed === null) return 1;

  const failures = await checkSigned(signed, authority);
  if (failures.length > 0) {
    process.stderr.write(`\nFAILED — ${String(failures.length)} check(s):\n`);
    for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
    return 1;
  }

  process.stdout.write(
    `\nPASSED — ${authority}'s token was accepted by the shipped verification, embedded once, ` +
      're-accepted against the signature the file carries, and the signature still covers the ' +
      'document.\n',
  );
  return 0;
}

process.exitCode = await main();
