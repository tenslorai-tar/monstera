// @ts-check
/**
 * No tracked file names another PDF product or its maker: the owner's rule of 2026-10-25 (*"I dont want to invite
 * trouble"*), made a check so it cannot come back.
 *
 * ## The names are not here
 *
 * A denylist of names would put them back in the repository the rule clears. So it holds the SHA-256 of each
 * spelling, lower case with its words separated by one space, and the scan hashes every word, and every pair of
 * neighbouring words, of every file and compares. A pair is hashed because some names are two words; neighbours are
 * taken across line breaks and comment markers alike, because this repository hard-wraps prose and a name broken across
 * a line would otherwise pass (the lesson `withdrawnPhrases.mjs` records as its third false negative). Its `normalise`
 * is the one rule for what "the same words" means, and it is taken from there (B3a).
 *
 * ## What stays
 *
 * Names the PDF format, a registry or a shipped library defines — a CMap or a CID registry's name, the registry value
 * written into a font, a signature filter, a registered media type and namespace, a Type 1 file's header, MuPDF's own
 * constants, the PDF libraries' bundled font files, a rich-text convention's own attribute value — are masked before the
 * scan by {@link IDENTIFIERS}. Licence texts stay word for word and are not read ({@link EXEMPT}), nor are this module
 * and its proof, whose identifier patterns necessarily spell what they mask.
 *
 * ## It refuses to answer blind
 *
 * A search reports "found nothing" whether it looked or not. So it first runs on a control text built here, with a
 * control phrase that is a two-word pair split across a line break, and refuses to report when that is not found, when
 * its denylist is empty, or when it read no file.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { changedPaths, filesInCommit, readStagedBlobs, repoRoot } from './gitScope.mjs';
import { isMain } from './isMain.mjs';
import { normalise } from './withdrawnPhrases.mjs';

/** The SHA-256 of each spelling refused: one word, or two separated by one space. Never the spellings themselves. */
export const DENIED = new Set([
  'ee9021c84f33366bde80b75efa132836e47afa18b9ce58e8077f4c25d039666c',
  'bd4bdbe846085acf409dbb100caaacdd633a395725b9e1d3a4866b664219d4aa',
  'f5ba3e6bd94dfa01508227eb2c4f108f7a0df4cb37f938299c3e4312c855fc57',
  '80dc3ccbc1cf997b7fddba375c1ee52f4cb46744e91097ff0642245d343a20c9',
  'c6846fa94a231dbb1865e1b8fec625e9e9ab03acb719087c67a5b9990301eb1b',
  '60ebc04e3067c27ea22bd59d99433d373526092aabba7315ce54000ed0b6a8c9',
  '45a5228a1dff9cf91975187ae187f0c3d074500995d043abedf430345e343600',
  '7b0aaacd69a8b83a07fe186dbef1c704a3ca72e72eb8a03b0389eae32ed45c3f',
  '81a4475d0192a383f248f2a1e321b08d013039e6e768083118436bf2a01ee97e',
  '15d6af39d0223a05a8fb56fb023c6ba69f266107ead871182179b7cb239f9559',
  '98f431b060cb497e92e91dc55e0a163bdfb66ee72de36e7f4bf10bbe0396dd83',
  '2be2c358304866be2c628d52651bee2f700e5021ec026b0065654ee69d307bb8',
  '6a1492e15aff00ff0093661691ba7042e87b4e791f05a992f253223fbeb1e219',
  '8c62a63b5cb29d0ba9acc694b31b84e7a653463d23c747aee005f7ff9a2775b8',
  '3b02382e76bc5ed943aa0e023901f300ac2454385e9e702a437bfc2229b90ffc',
  'fb8717677ac7b5a29fee7439741c818a9e6f505aa6fcb89bb90163a172f88261',
  '8ae56be495a96f1f31eabe97921415525913c2985c70b473631f52dee05c25be',
  '9fed30b374547f5b95ffd4a59e309e7083fa572116048cfc9bfb5809afaba4e2',
  'a6fa23508a2c2ef3003bf4760dbfc0b8e4bbe9bac6b3697ac139f43fe759cb25',
  '07666505c2779eef074c17725c88f8cf69186c0d5bbbed2765522c83d34a8359',
  '5319085cc20962dbd978b56b5711f7f4399d09c3fdeb6e1d386de5e83ba0eb7a',
  '3730d4ecb1d9cb50c51d7504346c203ba1cbe09d8cc2efa40a5e4c19014a47f1',
  '3a7d2355e5696cb663663127265045a7b95f57aedd93304182e7b361e35d1766',
  'b747f4908697b2b8a68937d9b65376d678d1bca61d87123757e832e1d7166401',
  'c5bac8b58f5e689f2b33fac0b1a638c8920f17bc080ce8faf8b59e0ba02ce378',
]);

/** Identifiers the format, a registry or a library defines, masked before the scan (the owner's "stays" list). */
export const IDENTIFIERS = [
  /Adobe-(?:Japan1|GB1|CNS1|Korea1|Identity|UCS)[\w-]*/gu,
  /\(Adobe\)/gu,
  /(['"`])Adobe\1/gu,
  /AdobeStandardEncoding/gu,
  /Adobe\.PPK\w*/gu,
  /\bADOBE_(?:CNS|GB|JAPAN|KOREA|PPKLITE)\b/gu,
  /PS-AdobeFont/gu,
  /vnd\.adobe\.[\w.+-]*/gu,
  /ns\.adobe\.com\/[\w/.-]*/gu,
  /Foxit(?:Sans|Serif|Fixed|Dingbats|Symbol)[\w-]*(?:\.pfb)?/gu,
  /LICENSE_FOXIT/gu,
  /APIVersion="Acrobat:[\d.]+"/gu,
];

/** Files not read: licence texts, word for word, and this module and its proof. */
const EXEMPT = [
  /^NOTICE$/u,
  /^scripts\/release\/licences\//u,
  /(?:^|\/)(?:LICEN[CS]E|COPYING)[^/]*$/iu,
  /^scripts\/lib\/productNames\.mjs$/u,
  /^scripts\/proofs\/productNames\.proof\.mjs$/u,
];

/** @param {string} text */
const sha = (text) => createHash('sha256').update(text).digest('hex');

/**
 * Every line of `text` that holds a denied word or pair, by its line number: identifiers masked first, then words of
 * letters and digits, a pair taken across a line break.
 * @param {string} text @param {ReadonlySet<string>} [denied] @returns {number[]}
 */
export function namedLines(text, denied = DENIED) {
  let masked = text;
  for (const pattern of IDENTIFIERS) masked = masked.replace(pattern, (match) => match.replace(/[^\n]/gu, ' '));
  /** @type {{ word: string, line: number }[]} */
  const words = [];
  masked.split('\n').forEach((line, at) => {
    for (const word of normalise(line).split(/[^a-z0-9]+/u)) if (word !== '') words.push({ word, line: at + 1 });
  });
  const lines = new Set();
  for (const [at, { word, line }] of words.entries()) {
    if (denied.has(sha(word))) lines.add(line);
    const next = words[at + 1];
    // A PAIR JOINED BY A SPACE ONLY: joined with none, neighbours make words nobody wrote (a line ending in an animal and
    // the next beginning with a pronoun made a maker's name on its first run). A name written as one word is a single.
    if (next !== undefined && denied.has(sha(`${word} ${next.word}`))) lines.add(line);
  }
  return [...lines].sort((a, b) => a - b);
}

/** The control: a pair denied by its hash alone, split across a line break, on line 2 of a text built here. */
const CONTROL_PAIR = ['monstera', 'controlword'];
const CONTROL_TEXT = `nothing on this line\na line that ends in ${CONTROL_PAIR[0] ?? ''}\n${CONTROL_PAIR[1] ?? ''} begins this one\n`;

/**
 * The files the scan reads, licence texts and this module and its proof aside: every tracked file for the tree, and for
 * the index the files this commit stages, since a commit can only bring a name in through a file it changes.
 * @param {'tree' | 'staged'} source @returns {string[]}
 */
export function scannedFiles(source) {
  const files =
    source === 'staged'
      ? changedPaths(['--cached'])
          .filter((entry) => entry.state !== 'D')
          .map((entry) => entry.path)
      : filesInCommit();
  return files.filter((file) => !EXEMPT.some((exempt) => exempt.test(file)));
}

/**
 * A tracked file's bytes from the working copy, or `null` where the index knows it and the disk does not (deleted, not
 * yet committed as such).
 * @param {string} path @returns {Buffer | null}
 */
function readTracked(path) {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

/**
 * Runs the scan, control first.
 * @param {{ source?: 'tree' | 'staged' }} [options] the working copy, or the index for the pre-commit gate
 * @returns {number} the process exit code
 */
export function scan({ source = 'tree' } = {}) {
  const control = namedLines(CONTROL_TEXT, new Set([sha(CONTROL_PAIR.join(' '))]));
  if (control.length !== 1 || control[0] !== 2 || DENIED.size === 0) {
    process.stdout.write(
      `  FAIL  the product-name scan could not find its own control (found on ${JSON.stringify(control)}, denylist ${String(DENIED.size)}).\n` +
        `        A blind search reports a clean tree, so this refuses to report a result.\n`,
    );
    return 1;
  }
  const root = repoRoot();
  const files = scannedFiles(source);
  // A COMMIT THAT STAGES NOTHING SCANNABLE has nothing to bring a name in: said so, and not a blind result.
  if (source === 'staged' && files.length === 0) {
    process.stdout.write('  ok  this commit stages no file the product-name scan reads\n');
    return 0;
  }
  const staged = source === 'staged' ? readStagedBlobs(files) : undefined;
  let read = 0;
  let offending = 0;
  for (const file of files) {
    const bytes = staged === undefined ? readTracked(`${root}/${file}`) : (staged.get(file) ?? null);
    // A BINARY FILE (a NUL in its first bytes) is never edited, and is not read: the owner's binary fixtures stay.
    if (bytes === null || bytes.subarray(0, 8000).includes(0)) continue;
    read += 1;
    for (const line of namedLines(bytes.toString('utf8'))) {
      offending += 1;
      process.stdout.write(`  FAIL  ${file}:${String(line)} names another PDF product or its maker\n`);
    }
  }
  if (read === 0) {
    process.stdout.write('  FAIL  the product-name scan read no file, so it refuses to report a result.\n');
    return 1;
  }
  if (offending > 0) {
    process.stdout.write(
      `\n${String(offending)} line(s) name another PDF product or its maker (the owner's rule of 2026-10-25).\n` +
        `Use generic words: "another PDF editor", "widely used PDF editors", "professional standards".\n`,
    );
    return 1;
  }
  process.stdout.write(
    `  ok  ${String(read)} tracked text file(s) name no other PDF product or maker\n` +
      `  ok  and the scan found its control pair across a line break, so that result means something\n`,
  );
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = scan({ source: process.argv.includes('--staged') ? 'staged' : 'tree' });
