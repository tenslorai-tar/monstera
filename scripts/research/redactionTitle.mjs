// @ts-check
/**
 * The two halves a live run of *keep the title* needs, in one instrument.
 *
 * ADR-0079's option is answered by the owner and built, and the corpus proves the
 * kernel. What a live run adds is everything between the checkbox and the engine —
 * the dialog's answer, the command, the composition root, the host — which the
 * wired-tools pair cannot cross from either end.
 *
 * That run needs a document that HAS a title, and it has to arrive at a path the
 * application already lists in its recent files, because the only other way in is a
 * native file dialog no instrument here drives.
 *
 *   node scripts/research/redactionTitle.mjs write <path>   a titled, texted page
 *   node scripts/research/redactionTitle.mjs read  <path>   its Info keys and title
 *
 * `read` reports the KEYS as well as the title, for the reason the corpus does: a
 * title that survived beside an author and a subject is a different outcome from a
 * title that survived alone, and only one of them is what the option promises.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { PDFDict, PDFDocument, StandardFonts } from '@cantoo/pdf-lib';

const [verb, path] = process.argv.slice(2);
if (verb === undefined || path === undefined) {
  throw new Error('usage: node scripts/research/redactionTitle.mjs <write|read> <path>');
}

if (verb === 'write') {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([400, 600]);
  // A LINE WORTH REDACTING, and a second that must survive — so a burn-in that
  // removed the page rather than the mark is visible as an absence.
  page.drawText('Salary band G7 confidential', { font, size: 16, x: 40, y: 520 });
  page.drawText('This line is not marked', { font, size: 16, x: 40, y: 480 });
  document.setTitle('The 2026 pay review');
  document.setAuthor('A. Clerk');
  document.setSubject('Salary band G7 confidential');
  document.setKeywords(['confidential']);
  writeFileSync(path, await document.save());
  process.stdout.write(`wrote a titled page to ${path}\n`);
} else if (verb === 'read') {
  const document = await PDFDocument.load(readFileSync(path), { updateMetadata: false });
  const info = document.context.lookup(document.context.trailerInfo.Info);
  const keys = info instanceof PDFDict ? [...info.keys()].map((key) => key.asString()).sort() : [];
  process.stdout.write(
    `${JSON.stringify({ infoKeys: keys, title: document.getTitle() ?? null, author: document.getAuthor() ?? null, subject: document.getSubject() ?? null })}\n`,
  );
} else {
  throw new Error(`unknown verb ${verb}`);
}
