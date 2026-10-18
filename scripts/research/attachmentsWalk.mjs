// @ts-check
/**
 * The attachments walk (FFFFFFF-1, GGGGGGG-4): five files attached to a question in the running app on Windows, each read
 * by its own contained reader — pdftotext for a PDF, x2t for an Office file, the compose host's picture size for a
 * picture — and each file's outcome read from the ask's own answer.
 *
 *   node scripts/research/attachmentsWalk.mjs
 *
 * ## No question leaves the machine
 *
 * The walk's application has its own empty user data, so no provider has a key. `main` reads every attached file BEFORE
 * it asks the provider (`contractHandlers.ts`' `ai.ask`), and with no key `streamChat` refuses as `no-key` before any
 * request is made (`aiChat.ts`). So the readers run for real and nothing is sent anywhere. The ask is made through the
 * page's own bridge, as the Assistant pane makes it, with the files picked through `ai.attach` and the platform picker
 * answered.
 *
 * ## The five files, made here
 *
 * a UTF-8 text file; a 2 x 2 PNG built from its chunks; `_review/test-files/sample5.pdf`; a minimal `.docx` written with
 * fflate from the parts the format requires (`officeLive.mjs`' shape); and eight bytes holding a NUL under a `.txt` name,
 * which no reader may take for text — the control, a file that must be refused, so a reader that answered "sent" for
 * everything cannot pass.
 */
import { copyFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

import { expect } from '@playwright/test';

import { root, startWalk } from './liveWalk.mjs';

const walk = await startWalk('attachments');
const { page, output, pickFiles, step, finish } = walk;

const require = createRequire(join(root, 'packages', 'kernel', 'package.json'));
/** @type {{ zipSync: (files: Record<string, Uint8Array>) => Uint8Array, strToU8: (text: string) => Uint8Array }} */
const { zipSync, strToU8 } = require('fflate');

/** A PNG chunk: length, type, data, and the CRC over type and data. @param {string} type @param {Uint8Array} data */
function chunk(type, data) {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, sum]);
}

/** A 2 x 2 RGB PNG, red, built from its chunks. */
function picture() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // RGB
  const rows = Buffer.from([0, 200, 0, 0, 200, 0, 0, 0, 200, 0, 0, 200, 0, 0]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', new Uint8Array()),
  ]);
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** A minimal `.docx` carrying one sentence. */
function office() {
  const parts = {
    '[Content_Types].xml':
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': `${XML}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml':
      `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      '<w:p><w:r><w:t>MONSTERA ATTACHMENT OFFICE</w:t></w:r></w:p></w:body></w:document>',
  };
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, text]) => [name, strToU8(text)])));
}

const files = {
  text: join(output, 'notes.txt'),
  picture: join(output, 'red.png'),
  pdf: join(output, 'sample5.pdf'),
  office: join(output, 'letter.docx'),
  unreadable: join(output, 'binary.txt'),
};
await writeFile(files.text, 'MONSTERA ATTACHMENT TEXT, a plain line of words.\n');
await writeFile(files.picture, picture());
await copyFile(join(root, '_review/test-files/sample5.pdf'), files.pdf);
await writeFile(files.office, office());
await writeFile(files.unreadable, Buffer.from([0x4d, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06]));

await step('FFFFFFF-1 / GGGGGGG-4: five attached files, each read by its own reader on Windows, the binary refused', async () => {
  await pickFiles(Object.values(files));
  const bridge = 'monstera';
  const attached = /** @type {{ ok: boolean; value?: { files: { handle: string; name: string }[]; dropped: number } }} */ (
    await page.evaluate((name) => /** @type {{ invoke: (c: string, p: unknown) => Promise<unknown> }} */ (Reflect.get(globalThis, name)).invoke('ai.attach', {}), bridge)
  );
  expect(attached.ok, JSON.stringify(attached)).toBe(true);
  const handles = attached.value?.files ?? [];
  expect(handles.map((file) => file.name)).toStrictEqual(['notes.txt', 'red.png', 'sample5.pdf', 'letter.docx', 'binary.txt']);

  const asked = /** @type {{ ok: boolean; value?: { started: boolean; files?: Record<string, unknown>[] }; error?: unknown }} */ (
    await page.evaluate(
      ({ name, attachments }) =>
        /** @type {{ invoke: (c: string, p: unknown) => Promise<unknown> }} */ (Reflect.get(globalThis, name)).invoke('ai.ask', {
          subscription: 'walk-attachments-1',
          provider: 'anthropic',
          model: 'claude-haiku-4-5',
          messages: [{ role: 'user', text: 'What do these files say?' }],
          web: false,
          attachments,
        }),
      { name: bridge, attachments: handles.map((file) => file.handle) },
    )
  );
  expect(asked.ok, JSON.stringify(asked)).toBe(true);
  const outcomes = asked.value?.files ?? [];
  const kinds = outcomes.map((outcome) => Object.keys(outcome)[0]);
  // TEXT, PDF AND OFFICE SENT, THE PICTURE PICTURED, THE BINARY REFUSED: each reader ran, and the control was refused.
  expect(kinds).toStrictEqual(['sent', 'pictured', 'sent', 'sent', 'unread']);
  // NOT-SUPPORTED, the contract's word for a kind this build does not read (`ASK_FILE_UNREAD`): bytes holding a NUL are
  // not text, where `unreadable` is a reader that refused a file of a kind it reads.
  expect(outcomes[4]).toStrictEqual({ unread: 'not-supported' });
  return { outcomes };
});

await finish();
