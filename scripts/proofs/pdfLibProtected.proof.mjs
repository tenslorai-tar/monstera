// @ts-check
/**
 * A pdf-lib command on a protected document runs on its readable bytes and its result is written protected again
 * ([ADR-0220](../../docs/DECISIONS/0220-a-pdf-lib-command-on-a-protected-document-runs-on-its-readable-bytes-and-is-written-protected.md)).
 *
 * ## The failure this closes
 *
 * `@cantoo/pdf-lib` refuses an encrypted file. Given the password it decrypts in memory, and the revision it then appends
 * is written with no `/Encrypt` and no encrypted stream, appended to a file whose other objects are encrypted: measured
 * 2026-10-08, the result opened with no password at all and its streams inflated to nothing (`zlib error: incorrect header
 * check`). So all eight commands routed to pdf-lib (Watermark, Headers and footers, Bates numbering, Page background,
 * Insert image, a drawn form field, a table of contents, a recognised page's text) either failed or damaged a protected
 * document.
 *
 * ## What runs
 *
 * The real MuPDF engine and the kernel's own pdf-lib execution (`localPdfLibWriter`), which does what the MuPDF host does.
 * Protected documents are written by MuPDF itself, so they are the encryption a person's file has. The result is read by
 * the npm WASM build of MuPDF, which is not the engine that wrote it.
 *
 * ## Its controls
 *
 * - **The path before the fix fails on the same document.** Serialise, then run the command on the protected image: pdf-lib
 *   refuses it. Without that, a result that passes proves nothing about the fix.
 * - **An unprotected document comes out unprotected**, so protection is not something every result gains.
 * - **Opened with the owner password where the user password differs**, the one case that cannot be written again, is
 *   refused by name and writes nothing, beside the same document opened with its user password, which works.
 *
 * Usage: node scripts/proofs/pdfLibProtected.proof.mjs [--require-engine]
 */

import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import * as wasm from 'mupdf';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

import { PDF_LIB_PROTECTED, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';

const ROOT = repoRoot();
const REQUIRED = process.argv.includes('--require-engine');

/** Made up for this proof. A comma in the user password is on purpose (CR-DOC-06). */
const USER = 'user,pass-0220';
const OWNER = 'owner-pass-0220';
const SAME = 'one-for-both-0220';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 17 });

/** @param {string} name @param {boolean} held @param {string} detail */
function check(name, held, detail) {
  const mark = roster.mark();
  if (!held) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

/** What a PNG of one colour holds, built here so the fixture owns every byte. @param {number} width @param {number} height */
function png(width, height) {
  const crc = (/** @type {Uint8Array} */ bytes) => {
    let value = ~0;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
    return ~value >>> 0;
  };
  /** @param {string} type @param {Uint8Array} body */
  const chunk = (type, body) => {
    const name = Buffer.from(type, 'latin1');
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    name.copy(out, 4);
    Buffer.from(body).copy(out, 8);
    out.writeUInt32BE(crc(Buffer.concat([name, Buffer.from(body)])), 8 + body.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x90)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', new Uint8Array()),
    ]),
  );
}

/** A two page document with a line of words on each. */
async function plainDocument() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let at = 0; at < 2; at += 1) {
    const page = document.addPage([300, 400]);
    page.drawText('Original words', { x: 30, y: 300, size: 14, font, color: rgb(0, 0, 0) });
  }
  document.setModificationDate(new Date(Date.UTC(2026, 9, 8)));
  return new Uint8Array(await document.save());
}

/**
 * What the second reader (the WASM MuPDF) makes of `bytes` with `password`.
 *
 * @param {Uint8Array} bytes
 * @param {string} [password]
 */
function read(bytes, password) {
  const document = /** @type {wasm.PDFDocument} */ (wasm.PDFDocument.openDocument(bytes, 'application/pdf'));
  const access = document.authenticatePassword(password ?? '');
  const encrypt = document.getTrailer().get('Encrypt');
  const encrypted = !encrypt.isNull();
  const permissions = encrypted ? encrypt.get('P').asNumber() : undefined;
  const version = encrypted ? encrypt.get('V').asNumber() : undefined;
  if (access === 0) {
    document.destroy();
    return { access, encrypted, permissions, version, pages: 0, text: '', widgets: 0, canPrint: false };
  }
  const pages = document.countPages();
  let text = '';
  let widgets = 0;
  for (let at = 0; at < pages; at += 1) {
    const page = document.loadPage(at);
    text += `${page.toStructuredText('preserve-whitespace').asText()}\n`;
    widgets += (page instanceof wasm.PDFPage ? page.getWidgets() : []).length;
  }
  const canPrint = document.hasPermission('print');
  document.destroy();
  return { access, encrypted, permissions, version, pages, text, widgets, canPrint };
}

/**
 * `bytes` as a MuPDF session, written by MuPDF with the protection a person's file would carry.
 *
 * @param {any} kernel
 * @param {Uint8Array} plain
 * @param {Record<string, unknown>} protection a `setDocumentProtection` without its kind
 */
async function protectedFile(kernel, plain, protection) {
  const session = await kernel.mupdfWriter.open(plain);
  try {
    await kernel.localMupdfExecution.apply({
      session,
      command: { kind: 'setDocumentProtection', ...protection },
      sources: [],
      reads: undefined,
    });
    return new Uint8Array(await kernel.mupdfWriter.serialise(session));
  } finally {
    await kernel.mupdfWriter.close(session);
  }
}

/** The staged result of a pdf-lib command on `session`, as bytes. */
async function runCommand(/** @type {any} */ kernel, /** @type {any} */ session, /** @type {any} */ command, /** @type {any} */ reads) {
  const staged = await kernel.localPdfLibWriter.apply({ session, command, sources: [], reads });
  const directory = mkdtempSync(join(tmpdir(), 'monstera-pdflib-protected-'));
  try {
    const destination = join(directory, 'result.pdf');
    await staged.place(destination);
    return new Uint8Array(readFileSync(destination));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** One command per family, with what its result must hold. */
const COMMANDS = /** @type {const} */ ([
  ['watermarkPages', { kind: 'watermarkPages', pages: 'all', text: 'DRAFT', opacity: 0.3, rotationDegrees: 45, fontSize: 36 }, undefined],
  [
    'headerFooterPages',
    { kind: 'headerFooterPages', pages: 'all', header: { left: 'Monstera', centre: '', right: '' }, footer: { left: '', centre: '', right: '' }, fontSize: 10, marginPoints: 36 },
    undefined,
  ],
  [
    'batesNumberPages',
    { kind: 'batesNumberPages', pages: 'all', prefix: 'ABC-', suffix: '', start: 1, digits: 4, edge: 'footer', slot: 'right', fontSize: 9, marginPoints: 36 },
    undefined,
  ],
]);

async function main(/** @type {any} */ kernel) {
  process.stdout.write('# A pdf-lib command on a protected document\n\n');
  const plain = await plainDocument();
  /** @param {Uint8Array} bytes @param {string} [password] */
  const open = (bytes, password) => kernel.mupdfWriter.open(bytes, password);

  const restricted = { encryption: 'aes-256', userPassword: USER, ownerPassword: OWNER, permissions: ['copy'] };
  const aes256 = await protectedFile(kernel, plain, restricted);
  const before = read(aes256, USER);

  // THE CONTROL: what happened to this document before the fix.
  {
    const session = await open(aes256, USER);
    let refused = '';
    try {
      await kernel.applyPdfLibImage(await kernel.mupdfWriter.serialise(session), COMMANDS[0][1], undefined);
    } catch (error) {
      refused = String(error);
    }
    await kernel.mupdfWriter.close(session);
    check('CONTROL: the command run on the protected image, as it was before, is refused by pdf-lib', /encrypted/iu.test(refused), refused.slice(0, 160));
  }

  // THE THREE PAGE STAMPS, each on a document opened with its user password.
  for (const [name, command, reads] of COMMANDS) {
    const session = await open(aes256, USER);
    try {
      const result = await runCommand(kernel, session, command, reads);
      const after = read(result, USER);
      const refusedWithout = read(result).access === 0;
      const wrong = read(result, 'not-the-password').access === 0;
      const words = name === 'watermarkPages' ? 'DRAFT' : name === 'headerFooterPages' ? 'Monstera' : 'ABC-0001';
      check(
        `${name}: the result opens only with the password, keeps the document's own permissions, and holds what the command wrote`,
        refusedWithout && wrong && after.access !== 0 && after.encrypted && after.permissions === before.permissions && after.text.includes(words) && after.text.includes('Original words') && !after.canPrint === !before.canPrint,
        JSON.stringify({ refusedWithout, wrong, after: { ...after, text: after.text.slice(0, 80) }, permissions: before.permissions }),
      );
    } finally {
      await kernel.mupdfWriter.close(session);
    }
  }

  // THE FIRST OF THE OTHER FAMILIES.
  {
    const session = await open(aes256, USER);
    try {
      const background = await runCommand(kernel, session, { kind: 'setPageBackground', pages: 'all', red: 1, green: 0, blue: 0 }, undefined);
      const after = read(background, USER);
      check(
        'setPageBackground: the protected result opens only with the password and keeps its words',
        read(background).access === 0 && after.access !== 0 && after.text.includes('Original words') && after.permissions === before.permissions,
        JSON.stringify({ ...after, text: after.text.slice(0, 40) }),
      );
      const image = await runCommand(kernel, session, { kind: 'insertImagePage', at: 1, bytes: png(8, 6), mediaType: 'image/png' }, undefined);
      const inserted = read(image, USER);
      check('insertImagePage: a page is added to the protected document, which stays protected', inserted.pages === 3 && inserted.encrypted && read(image).access === 0, JSON.stringify(inserted.pages));
      const field = await runCommand(
        kernel,
        session,
        { kind: 'createFormField', page: 0, fields: [{ rect: { x0: 100, y0: 100, x1: 220, y1: 124 }, name: 'applicant.name', field: { type: 'text' } }] },
        undefined,
      );
      const withField = read(field, USER);
      check('createFormField: the field is on the protected page, which stays protected', withField.widgets === 1 && withField.encrypted && read(field).access === 0, JSON.stringify(withField.widgets));
      const toc = await runCommand(
        kernel,
        session,
        { kind: 'generateToc', at: 0 },
        [
          { title: 'First chapter', page: 0, depth: 0 },
          { title: 'Second chapter', page: 1, depth: 0 },
        ],
      );
      const table = read(toc, USER);
      check('generateToc: a contents page is added to the protected document, which stays protected', table.pages === 3 && table.text.includes('First chapter') && read(toc).access === 0, JSON.stringify({ pages: table.pages }));
      const recognised = await runCommand(
        kernel,
        session,
        { kind: 'ocrPage', page: 1, languages: ['eng'], engine: 'tesseract' },
        { lines: [{ text: 'Recognised', box: [30, 100, 120, 116], words: [{ text: 'Recognised', box: [30, 100, 120, 116] }] }], confidence: 90, languages: ['eng'] },
      );
      const layered = read(recognised, USER);
      check('ocrPage: the recognised words are in the protected page, which stays protected', layered.text.includes('Recognised') && read(recognised).access === 0, JSON.stringify(layered.text.slice(0, 60)));
    } finally {
      await kernel.mupdfWriter.close(session);
    }
  }

  // EVERY SCHEME MuPDF WRITES.
  {
    /** @type {string[]} */
    const wrong = [];
    for (const encryption of ['rc4-40', 'rc4-128', 'aes-128', 'aes-256']) {
      const file = await protectedFile(kernel, plain, { encryption, userPassword: USER, ownerPassword: OWNER });
      const session = await open(file, USER);
      try {
        const result = await runCommand(kernel, session, COMMANDS[0][1], undefined);
        const was = read(file, USER);
        const now = read(result, USER);
        if (!(now.version === was.version && now.access !== 0 && read(result).access === 0 && now.text.includes('DRAFT'))) {
          wrong.push(`${encryption}: V ${String(was.version)} -> ${String(now.version)}, access ${String(now.access)}`);
        }
      } finally {
        await kernel.mupdfWriter.close(session);
      }
    }
    check('the scheme is kept for every one MuPDF writes: RC4 40, RC4 128, AES 128 and AES 256', wrong.length === 0, wrong.join('; '));
  }

  // ONE PASSWORD THAT IS BOTH.
  {
    const file = await protectedFile(kernel, plain, { encryption: 'aes-256', userPassword: SAME, ownerPassword: SAME, permissions: ['copy'] });
    const session = await open(file, SAME);
    try {
      const result = await runCommand(kernel, session, COMMANDS[0][1], undefined);
      const now = read(result, SAME);
      check('opened with the one password that is both, the result is opened by it as both', now.access === 6 && now.text.includes('DRAFT'), JSON.stringify(now.access));
    } finally {
      await kernel.mupdfWriter.close(session);
    }
  }

  // PROTECTED IN THIS SESSION, both passwords known.
  {
    const session = await open(plain);
    try {
      await kernel.localMupdfExecution.apply({
        session,
        command: { kind: 'setDocumentProtection', encryption: 'aes-256', userPassword: USER, ownerPassword: OWNER, permissions: ['copy'] },
        sources: [],
        reads: undefined,
      });
      const result = await runCommand(kernel, session, COMMANDS[0][1], undefined);
      const asUser = read(result, USER);
      const asOwner = read(result, OWNER);
      check(
        'protected in this session, both passwords are kept: the user password opens it restricted and the owner password opens it with every right',
        asUser.access === 2 && !asUser.canPrint && asOwner.access === 4 && asOwner.canPrint && asUser.text.includes('DRAFT'),
        JSON.stringify({ user: asUser.access, owner: asOwner.access, userCanPrint: asUser.canPrint, ownerCanPrint: asOwner.canPrint }),
      );
    } finally {
      await kernel.mupdfWriter.close(session);
    }
  }

  // A DOCUMENT THAT OPENS FOR EVERYBODY AND PROTECTS ONLY WHAT IT GRANTS.
  {
    const file = await protectedFile(kernel, plain, { encryption: 'aes-128', ownerPassword: OWNER, permissions: ['copy'] });
    const was = read(file);
    const session = await open(file);
    try {
      const result = await runCommand(kernel, session, COMMANDS[0][1], undefined);
      const now = read(result);
      check(
        'a document with an owner password and no password to open it still opens for everybody, with the same rights withheld',
        was.access === 2 && now.access === 2 && now.permissions === was.permissions && !now.canPrint && now.text.includes('DRAFT'),
        JSON.stringify({ was: was.access, now: now.access, permissions: [was.permissions, now.permissions] }),
      );
    } finally {
      await kernel.mupdfWriter.close(session);
    }
  }

  // THE CASE THAT CANNOT BE WRITTEN AGAIN, beside the same document that can.
  {
    const session = await open(aes256, OWNER);
    let refusal = '';
    let wrote = false;
    try {
      await runCommand(kernel, session, COMMANDS[0][1], undefined);
      wrote = true;
    } catch (error) {
      refusal = error instanceof Error ? error.name : String(error);
    } finally {
      await kernel.mupdfWriter.close(session);
    }
    check(
      'opened with the owner password where the user password differs, the command is refused by name and nothing is written',
      !wrote && refusal === 'ProtectionNotReproducible',
      `wrote ${String(wrote)}, refusal ${refusal}`,
    );
  }

  // THE PERSON IS TOLD WHEN A PASSWORD WAS MADE UP, and only then (ADR-0220): the engine's own record of whether the owner
  // (permissions) password was the one typed.
  {
    /** @param {Uint8Array} bytes @param {string} [password] */
    const flagFor = async (bytes, password) => {
      const session = await open(bytes, password);
      try {
        const writing = await kernel.protectedWritingOf(session);
        return writing === undefined ? 'unprotected' : writing.permissionPasswordReplaced;
      } finally {
        await kernel.mupdfWriter.close(session);
      }
    };
    const withUserPassword = await flagFor(aes256, USER);
    const withOwnerAsBoth = await flagFor(
      await protectedFile(kernel, plain, { encryption: 'aes-256', userPassword: SAME, ownerPassword: SAME, permissions: ['copy'] }),
      SAME,
    );
    const noPassword = await flagFor(plain);
    check(
      'opened with only the user password, the owner password is reported replaced; opened as both, or unprotected, it is not',
      withUserPassword === true && withOwnerAsBoth === false && noPassword === 'unprotected',
      JSON.stringify({ withUserPassword, withOwnerAsBoth, noPassword }),
    );
  }

  // AN UNPROTECTED DOCUMENT GAINS NO PROTECTION.
  {
    const session = await open(plain);
    try {
      const result = await runCommand(kernel, session, COMMANDS[0][1], undefined);
      const now = read(result);
      check('CONTROL: an unprotected document comes out unprotected, with the command applied', !now.encrypted && now.access === 1 && now.text.includes('DRAFT'), JSON.stringify({ ...now, text: '' }));
    } finally {
      await kernel.mupdfWriter.close(session);
    }
  }

  // A DOCUMENT WHOSE PROTECTION WAS REMOVED IN THIS SESSION IS WRITTEN WITH NONE.
  {
    const session = await open(aes256, USER);
    try {
      await kernel.localMupdfExecution.apply({ session, command: { kind: 'setDocumentProtection', encryption: 'none' }, sources: [], reads: undefined });
      const result = await runCommand(kernel, session, COMMANDS[0][1], undefined);
      const now = read(result);
      check('a document whose password was removed in this session is not protected again by the command', !now.encrypted && now.text.includes('DRAFT'), JSON.stringify({ ...now, text: '' }));
    } finally {
      await kernel.mupdfWriter.close(session);
    }
  }

  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} protected pdf-lib case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('protected pdf-lib case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

// THE ENTRY IS LAST, so every constant above is initialised before the first case reads one.
if (bindNativeEngine(ROOT) === null) {
  exitUnverifiable({
    required: REQUIRED,
    subject: 'a pdf-lib command on a protected document',
    why: 'The MuPDF shim is not built. Run `npm run provision:mupdf`.',
    flag: '--require-engine',
  });
} else {
  refuseStaleBuild(ROOT, PDF_LIB_PROTECTED, 7);
  const [{ mupdfWriter }, { localMupdfExecution }, { localPdfLibWriter }, { applyPdfLibImage }, { protectedWritingOf }] =
    await Promise.all([
      import('../../packages/kernel/dist/mupdfWriter.js'),
      import('../../packages/kernel/dist/commandSpecs.js'),
      import('../../packages/kernel/dist/localEngine.js'),
      import('../../packages/kernel/dist/pdfLibWriter.js'),
      import('../../packages/kernel/dist/documentProtection.js'),
    ]);
  await main({ mupdfWriter, localMupdfExecution, localPdfLibWriter, applyPdfLibImage, protectedWritingOf });
}
