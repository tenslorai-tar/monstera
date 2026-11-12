import { createHash } from 'node:crypto';

/**
 * A ONE-PAGE PDF WHOSE PAGE TREE CAN BE READ ONLY WITH ITS PASSWORD, built byte by byte for the cases (B10: no file is
 * committed): the catalogue, the page tree and the page sit in an object stream, and the object stream is encrypted
 * under the standard security handler, revision 2 (RC4, 40-bit, ISO 32000-1 §7.6.3). That is the shape qpdf writes by
 * default with `--encrypt ... --object-streams=generate` and many producers write too; MuPDF and pdf-lib, encrypting,
 * leave the page dictionaries in the clear, so neither can make it.
 *
 * Revision 2 because its algorithms are short enough to write here and read in a review: no AES and no iterated hash.
 * The cross-reference stream is never encrypted, by the format, so the file opens to a reader without the password and
 * shows no pages until it is given one.
 */

/** The padding string every standard-handler key derivation starts from (ISO 32000-1 §7.6.3.3, Algorithm 2 step a). */
const PADDING = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
const PERMISSIONS = -4;
const ID = Buffer.from('6d6f6e73746572612d6669787475726531', 'hex').subarray(0, 16);

function padded(password: string): Buffer {
  return Buffer.concat([Buffer.from(password, 'latin1'), PADDING]).subarray(0, 32);
}

function md5(...parts: readonly Buffer[]): Buffer {
  const hash = createHash('md5');
  for (const part of parts) hash.update(part);
  return hash.digest();
}

/** RC4, the stream cipher revision 2 encrypts with: the same function encrypts and decrypts. */
function rc4(key: Buffer, data: Buffer): Buffer {
  const state = Array.from({ length: 256 }, (_unused, at) => at);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + (state[i] ?? 0) + (key[i % key.length] ?? 0)) % 256;
    [state[i], state[j]] = [state[j] ?? 0, state[i] ?? 0];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let at = 0; at < data.length; at += 1) {
    i = (i + 1) % 256;
    j = (j + (state[i] ?? 0)) % 256;
    [state[i], state[j]] = [state[j] ?? 0, state[i] ?? 0];
    out[at] = (data[at] ?? 0) ^ (state[((state[i] ?? 0) + (state[j] ?? 0)) % 256] ?? 0);
  }
  return out;
}

function littleEndian(value: number, bytes: number): Buffer {
  const out = Buffer.alloc(bytes);
  for (let at = 0; at < bytes; at += 1) out[at] = (value >>> (8 * at)) & 0xff;
  return out;
}

function bigEndian(value: number, bytes: number): Buffer {
  const out = Buffer.alloc(bytes);
  for (let at = 0; at < bytes; at += 1) out[bytes - 1 - at] = (value >>> (8 * at)) & 0xff;
  return out;
}

/** The file, protected by `userPassword` to open and `ownerPassword` to change, one 300 by 300 page. */
export function lockedPageTree(userPassword: string, ownerPassword: string): Uint8Array {
  // ALGORITHM 3 (revision 2): the owner entry, the user's padded password under a key from the owner's.
  const owner = rc4(md5(padded(ownerPassword)).subarray(0, 5), padded(userPassword));
  // ALGORITHM 2: the file key, then ALGORITHM 4: the user entry.
  const fileKey = md5(padded(userPassword), owner, littleEndian(PERMISSIONS >>> 0, 4), ID).subarray(0, 5);
  const user = rc4(fileKey, PADDING);
  // ALGORITHM 1: an object's key, from the file key and its number and generation.
  const objectKey = (number: number): Buffer => md5(fileKey, littleEndian(number, 3), littleEndian(0, 2)).subarray(0, 10);

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >>',
  ];
  const offsets: number[] = [];
  let body = '';
  for (const object of objects) {
    offsets.push(body.length);
    body += `${object} `;
  }
  const header = objects.map((_object, at) => `${String(at + 1)} ${String(offsets[at])}`).join(' ') + ' ';
  const plainStream = Buffer.from(header + body, 'latin1');
  const sealedStream = rc4(objectKey(4), plainStream);

  const parts: Buffer[] = [];
  let length = 0;
  const write = (part: Buffer | string): void => {
    const bytes = typeof part === 'string' ? Buffer.from(part, 'latin1') : part;
    parts.push(bytes);
    length += bytes.length;
  };
  write('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n');
  const at4 = length;
  write(`4 0 obj\n<< /Type /ObjStm /N 3 /First ${String(header.length)} /Length ${String(sealedStream.length)} >>\nstream\n`);
  write(sealedStream);
  write('\nendstream\nendobj\n');
  const at5 = length;
  const rows = Buffer.concat([
    Buffer.concat([bigEndian(0, 1), bigEndian(0, 4), bigEndian(65535, 2)]),
    ...[0, 1, 2].map((index) => Buffer.concat([bigEndian(2, 1), bigEndian(4, 4), bigEndian(index, 2)])),
    Buffer.concat([bigEndian(1, 1), bigEndian(at4, 4), bigEndian(0, 2)]),
    Buffer.concat([bigEndian(1, 1), bigEndian(at5, 4), bigEndian(0, 2)]),
  ]);
  const id = ID.toString('hex');
  write(
    `5 0 obj\n<< /Type /XRef /Size 6 /W [1 4 2] /Root 1 0 R /ID [<${id}> <${id}>] ` +
      `/Encrypt << /Filter /Standard /V 1 /R 2 /O <${owner.toString('hex')}> /U <${user.toString('hex')}> /P ${String(PERMISSIONS)} >> ` +
      `/Length ${String(rows.length)} >>\nstream\n`,
  );
  write(rows);
  write(`\nendstream\nendobj\nstartxref\n${String(at5)}\n%%EOF\n`);
  return Uint8Array.from(Buffer.concat(parts));
}
