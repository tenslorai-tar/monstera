// @ts-check
/**
 * The Help articles the merged cloud work wrote from tests (`01d02a84..658e14df`), walked in the running app on Windows:
 * each article's steps followed as written, with a real mouse and keyboard, against documents the walk writes and signs
 * itself, and the effect a reader is told to expect asserted.
 *
 *   node scripts/research/helpArticlesWalk.mjs [--app-root <checkout>] [--only <part,part>]
 *
 * Parts: `certified` (certified-documents.md: a document certified "nothing may be changed", its line, a rotation refused,
 * Work on a copy, the copy's line, the original untouched); `signed-version` (check-signatures.md: Save this signed
 * version… on a file with bytes after its signature, and the document's own file refused); `sign-window`
 * (sign-a-document.md: on a signed document the window says why it cannot certify); `history-locked` (ai-assistant.md:
 * History says a history locked to another account is, in the approved line); `protected`
 * (open-a-protected-pdf.md: Cancel at the password, then Enter password and Close).
 *
 * THE CERTIFICATE IS THE WALK'S OWN: a self-signed one made here with node-forge, as `documentCommands.test.ts` makes
 * its, under a password generated here. It is a test credential for this application and nothing else.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, sep } from 'node:path';

import { expect } from '@playwright/test';

import { appRootOption, startWalk } from './liveWalk.mjs';

const require = createRequire(import.meta.url);
/** @type {typeof import('@cantoo/pdf-lib')} */
const pdfLib = require('@cantoo/pdf-lib');
const { PDFDocument, StandardFonts, rgb } = pdfLib;
/** @type {any} */
const forge = require('node-forge');

const at = process.argv.indexOf('--only');
const ONLY = at === -1 ? undefined : new Set((process.argv[at + 1] ?? '').split(','));
const runs = (/** @type {string} */ part) => ONLY === undefined || ONLY.has(part);

const walk = await startWalk('help-articles', appRootOption(process.argv));
const { page, output, open, pickFiles, saveTo, command, step, finish } = walk;

/** The open dialog: the box every dialog is drawn in, the palette apart. */
const dialog = () => page.locator('.m-dialog:not(.m-palette)').last();

/**
 * Every tab closed, answering "Don't save", and how many asked: the close's question is answered once the read behind it
 * is, which can take seconds, so each close waits for the question OR its tab going, never a fixed pause.
 */
async function closeAll() {
  let asked = 0;
  for (let tab = 0; tab < 8; tab += 1) {
    const tabs = await page.locator('.m-tab-close').count();
    if (tabs === 0) break;
    await page.locator('.m-tab-close').first().click();
    const dontSave = dialog().getByRole('button', { name: 'Don’t save' });
    await expect
      .poll(async () => (await dontSave.count()) > 0 || (await page.locator('.m-tab-close').count()) < tabs, { timeout: 30_000 })
      .toBe(true);
    if ((await dontSave.count()) > 0) {
      asked += 1;
      await dontSave.click();
    }
    await expect(page.locator('.m-tab-close')).toHaveCount(tabs - 1, { timeout: 30_000 });
  }
  return asked;
}

/** A plain two-page document with words on each page. @param {string} words */
async function plainDocument(words) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 2; index += 1) {
    document.addPage([612, 792]).drawText(`${words}, page ${String(index + 1)}`, { x: 72, y: 700, size: 18, font, color: rgb(0, 0, 0) });
  }
  return document.save();
}

/** The walk's own self-signed certificate as a .p12, and its password. */
function walkCertificate() {
  const password = randomBytes(9).toString('base64url');
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  cert.setSubject([{ name: 'commonName', value: 'Walk Certifier' }]);
  cert.setIssuer([{ name: 'commonName', value: 'Walk Certifier' }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const der = forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' })).getBytes();
  const path = join(output, 'walk-certificate.p12');
  writeFileSync(path, Buffer.from(der, 'binary'));
  return { path, password };
}
const certificate = walkCertificate();

/**
 * Signs the document on show as sign-a-document.md's steps say, then saves it, and waits for the FILE to carry the
 * signature. The status bar's "Saved" is no wait: it says so of the document as opened, before this save, so the first
 * run closed the tab while the save was still queued behind the signing.
 * @param {string} says the "This signature says" choice, as the window words it
 * @param {string} path the document's file
 */
async function signAndSave(says, path) {
  await command('Sign with Certificate');
  const sign = dialog();
  await sign.getByLabel('Certificate password (leave empty if it has none)').fill(certificate.password);
  await sign.locator('[data-sign-certify]').selectOption({ label: says });
  await pickFiles([certificate.path]);
  await sign.getByRole('button', { name: 'Choose certificate and sign', exact: true }).click();
  await expect(dialog()).toHaveCount(0, { timeout: 60_000 });
  await page.keyboard.press('Control+S');
  await expect.poll(() => readFileSync(path).includes('/ByteRange'), { timeout: 60_000 }).toBe(true);
  await page.waitForTimeout(500);
}

// ——————————————————————————————————————— certified-documents.md ———————————————————————————————————————

if (runs('certified')) {
  const certified = join(output, 'certified.pdf');
  writeFileSync(certified, await plainDocument('A certified document'));
  await step('certified: certified "nothing may be changed", the line at its top names the certifier and what may change', async () => {
    await open(certified);
    await signAndSave('I am the author — nothing may be changed', certified);
    // SAVED, SO CLOSING IT ASKS NOTHING: the first run saw the close ask about unsaved changes after the status said saved.
    const asked = await closeAll();
    if (asked > 0) throw new Error('closing the document just signed and saved asked about unsaved changes');
    await open(certified);
    await expect(page.getByText('Certified by Walk Certifier, who allows no changes to it.')).toBeVisible({ timeout: 30_000 });
  });
  const before = readFileSync(certified);
  const copy = join(output, 'certified-copy.pdf');
  await step('certified: a rotation is refused, says who certified it, and changes nothing', async () => {
    await command('Rotate page');
    const refused = dialog();
    await expect(refused).toContainText('This document is certified', { timeout: 30_000 });
    await expect(refused).toContainText('Walk Certifier');
    await expect(refused.getByRole('button', { name: 'Work on a copy', exact: true })).toBeVisible();
  });
  await step('certified: Work on a copy opens a copy in a new tab with the page turned, and says the copy is not certified', async () => {
    await saveTo(copy);
    await dialog().getByRole('button', { name: 'Work on a copy', exact: true }).click();
    await expect(page.locator('.m-status-name').first()).toHaveAttribute('title', 'certified-copy.pdf', { timeout: 60_000 });
    await expect(page.getByText('This copy is not certified. The original, certified by Walk Certifier, is unchanged.')).toBeVisible({ timeout: 30_000 });
    // THE PAGE ON SHOW IS TURNED: the copy's first card, in the strip on show, is wider than it is tall.
    const card = page.locator('[data-thumb-page="0"] canvas:visible').first();
    await expect.poll(async () => card.evaluate((element) => element.getBoundingClientRect().width > element.getBoundingClientRect().height), { timeout: 30_000 }).toBe(true);
    // AND THE TURN IS AN UNSAVED CHANGE IN THE COPY, said as such: the first walk found the bar saying "Saved" here while
    // the close asked to save, the copy's tab having been opened with the edit's version as its saved one.
    await expect(page.getByRole('status', { name: 'Document status' })).toContainText('Unsaved changes', { timeout: 10_000 });
    if (readFileSync(copy).includes('/Rotate')) throw new Error('the copy’s file already holds the turn, which the article does not say');
  });
  await step('certified: the turned copy is kept: closing it asks to save the turn', async () => {
    const asked = await closeAll();
    if (asked === 0) throw new Error('the copy closed without asking, and its file does not hold the turn: the change is lost');
    return { asked };
  });
  await step('certified: the certified document itself is left exactly as it was', () => {
    if (!readFileSync(certified).equals(before)) throw new Error('the certified document changed on disk');
    return Promise.resolve({ bytes: before.length });
  });
  await closeAll();
  // THE LINE'S BUTTON IS A PROJECTION since ADR-0295: drawn because Check signatures is placed on the line, not named.
  await step('certified: Check signatures on the line opens the signatures, and a certification over the whole file offers no signed version', async () => {
    await open(certified);
    const line = page.locator('[data-certification-line="certified"]');
    await expect(line).toBeVisible({ timeout: 30_000 });
    await line.getByRole('button', { name: 'Check signatures', exact: true }).click();
    await expect(dialog()).toContainText('Walk Certifier', { timeout: 30_000 });
    await expect(dialog()).toContainText('Unchanged since it was signed');
    // THE FILE IS ITS SIGNED VERSION: nothing to offer, whatever the check would answer.
    await page.waitForTimeout(2000);
    await expect(dialog().getByRole('button', { name: 'Save this signed version…', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });
  // THE CLAIM THAT READ AS A CONTRADICTION (HHHHHHHHH-15): certified-documents.md says File › Save a copy… keeps the
  // certification; save-a-document.md says the copy a REFUSED APPEND offers is no longer certified. Two routes, run here.
  const keptCopy = join(output, 'certified-saved-copy.pdf');
  await step('certified: File › Save a copy… writes the document unchanged, still certified, and the copy opens saying so', async () => {
    await saveTo(keptCopy);
    await command('Save a copy…');
    // NOT THERE UNTIL THE COPY IS WRITTEN: the wait is for the file, then for what it holds.
    await expect.poll(() => existsSync(keptCopy) && readFileSync(keptCopy).includes('/DocMDP'), { timeout: 60_000 }).toBe(true);
    await closeAll();
    await open(keptCopy);
    await expect(page.getByText('Certified by Walk Certifier, who allows no changes to it.')).toBeVisible({ timeout: 30_000 });
    return { bytes: readFileSync(keptCopy).length };
  });
  await closeAll();
}

// ——————————————————————————————————————— check-signatures.md ———————————————————————————————————————

if (runs('signed-version') || runs('sign-window')) {
  const signed = join(output, 'signed.pdf');
  writeFileSync(signed, await plainDocument('A signed document'));
  /** @type {Buffer} */
  let signedBytes = Buffer.alloc(0);
  await step('signed: signed "I approve this document" and saved', async () => {
    await open(signed);
    await signAndSave('I approve this document', signed);
    signedBytes = readFileSync(signed);
    await closeAll();
  });

  if (runs('sign-window')) {
    await step('sign window: on a signed document it says why it cannot certify, in place of the author choices', async () => {
      await open(signed);
      await command('Sign with Certificate');
      // ASKED FIRST on a signed document: the new signature goes after the one there, which stays valid.
      await expect(dialog()).toContainText('This document is already signed', { timeout: 30_000 });
      await dialog().getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(dialog()).toContainText('I signed this. The document is already signed, and only its first signature can certify it.');
      await expect(dialog().locator('[data-sign-certify]')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await closeAll();
    });
  }

  if (runs('signed-version')) {
    const version = join(output, 'signed-version.pdf');
    await step('signed version: with bytes added after the signature, Save this signed version… writes the file as signed', async () => {
      // A TAIL NO READER CAN MAKE SENSE OF, `documentCommands.test.ts`' own: forty bytes after the signed file.
      writeFileSync(signed, Buffer.concat([signedBytes, Buffer.alloc(40, 0x2a)]));
      await open(signed);
      await command('Check signatures');
      const save = dialog().getByRole('button', { name: 'Save this signed version…', exact: true }).first();
      await expect(save).toBeVisible({ timeout: 60_000 });
      await saveTo(version);
      await save.click();
      await expect(page.getByText('Signed version saved.', { exact: false })).toBeVisible({ timeout: 60_000 });
      if (!readFileSync(version).equals(signedBytes)) throw new Error('the signed version is not the file as it was signed, byte for byte');
    });
    await step('signed version: the document’s own file, spelt with a "." in its folder, is refused and left as it was', async () => {
      const own = readFileSync(signed);
      await command('Check signatures');
      const save = dialog().getByRole('button', { name: 'Save this signed version…', exact: true }).first();
      await expect(save).toBeVisible({ timeout: 60_000 });
      await saveTo(`${output}${sep}.${sep}signed.pdf`);
      await save.click();
      await expect(dialog()).toContainText('A copy can’t replace the document it came from.', { timeout: 60_000 });
      if (!readFileSync(signed).equals(own)) throw new Error('the document’s own file changed');
      await page.keyboard.press('Escape');
    });
    await closeAll();
    // DECISION 7 AS WRITTEN (HHHHHHHHH-12): a signature whose signed bytes were changed has no signed version to save, so
    // no button; and the window opens at once, its checks made after it is shown.
    await step('signed version: a signature whose signed bytes were changed offers no signed version, and the window opens at once', async () => {
      const tampered = Buffer.from(signedBytes);
      // ONE BYTE INSIDE THE FIRST SIGNED RANGE that nothing reads: the header's binary comment, `%` and four high bytes on
      // the second line. The file still opens, and the signature reads as changed.
      const comment = tampered.indexOf('\n%') + 2;
      if (comment < 2 || (tampered[comment] ?? 0) < 0x80) throw new Error('the signed fixture has no binary comment to change');
      tampered[comment] = (tampered[comment] ?? 0) ^ 0x01;
      writeFileSync(signed, tampered);
      await open(signed);
      const asked = performance.now();
      await command('Check signatures');
      await expect(dialog()).toContainText('The document has changed since this signature was made', { timeout: 30_000 });
      const shown = performance.now() - asked;
      await page.waitForTimeout(3000);
      await expect(dialog().getByRole('button', { name: 'Save this signed version…', exact: true })).toHaveCount(0);
      await page.keyboard.press('Escape');
      return { windowShownMs: Math.round(shown) };
    });
    await closeAll();
  }
}

// ——————————————————————————————————————— ai-assistant.md, a locked chat history ———————————————————————————————————————

// HHHHHHHHH-8: *"the AI assistant and History both say chat history cannot be saved, and History lists nothing until
// then"*. A history LOCKED to another account is made the way one arrives: a data key this account's cipher cannot unwrap,
// written into the walk's own profile before the store first reads it. The store reads its key only when first asked.
if (runs('history-locked')) {
  const plain = join(output, 'history-locked.pdf');
  writeFileSync(plain, await plainDocument('A document with a locked history'));
  await step('history locked: History shows the approved locked line, not "No conversations are saved"', async () => {
    const history = join(output, 'app-data', 'history');
    mkdirSync(history, { recursive: true });
    writeFileSync(join(history, 'key'), randomBytes(48).toString('base64'));
    await open(plain);
    await command('Open the AI assistant');
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(page.locator('[data-assistant-history-locked]')).toHaveText(
      'Chat history cannot be saved on this computer, because the history saved here cannot be opened by this Windows account. To start again, choose Clear chat history in Settings › Privacy.',
      { timeout: 30_000 },
    );
    await expect(page.getByText('No conversations are saved for this file.')).toHaveCount(0);
  });
  await closeAll();
}

// ——————————————————————————————————————— open-a-protected-pdf.md ———————————————————————————————————————

if (runs('protected')) {
  const plain = await PDFDocument.create();
  const font = await plain.embedFont(StandardFonts.Helvetica);
  plain.addPage([612, 792]).drawText('A protected page', { x: 72, y: 700, size: 18, font });
  const password = randomBytes(6).toString('base64url');
  plain.encrypt({ userPassword: password, ownerPassword: `${password}-owner` });
  const locked = join(output, 'protected.pdf');
  writeFileSync(locked, await plain.save());
  await step('protected: Cancel at the password keeps the tab open, saying so, with Enter password and Close', async () => {
    await pickFiles([locked]);
    await page.keyboard.press('Control+O');
    const asked = dialog();
    await expect(asked.locator('input[type="password"]')).toBeVisible({ timeout: 30_000 });
    await asked.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText('This document is protected with a password.', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Enter password', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close', exact: true }).first()).toBeVisible();
  });
  await step('protected: Enter password asks again, and the right one opens the page', async () => {
    await page.getByRole('button', { name: 'Enter password', exact: true }).click();
    await dialog().locator('input[type="password"]').fill(password);
    await dialog().locator('.m-button--primary').last().click();
    await page.locator('canvas.m-page:visible').first().waitFor({ state: 'visible', timeout: 30_000 });
  });
  await closeAll();
}

await finish();
