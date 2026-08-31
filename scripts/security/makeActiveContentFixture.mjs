// @ts-check
/**
 * Generates the fixture for invariant 24: a PDF whose active content is
 * OBSERVABLE WHEN IT FIRES.
 *
 * SELF-GENERATED, and therefore allowed under the fixture provenance rule. It
 * is built at test time rather than committed, because a PDF carrying working
 * `app.alert` payloads is exactly the artefact this repository should not be
 * shipping in its tree.
 *
 * ## Why every payload announces itself
 *
 * The row this fixture serves states the trap in its own words: a proof that
 * the JavaScript did not run is worthless if the same result appears when the
 * JavaScript is absent. So none of these are inert markers — each one, when
 * executed by an engine that runs it, produces a document event the harness
 * receives and prints. An empty fixture and a contained one look identical
 * otherwise.
 *
 * Four carriers, which are the four things invariant 24 names:
 *
 * | carrier | fires as | invariant 24's clause |
 * |---|---|---|
 * | `/Names /JavaScript` | ALERT, during `pdf_enable_js` | no embedded JavaScript executes |
 * | `/OpenAction` | ALERT, on open | no automatic action runs |
 * | `/Annots` link with `/URI` | LAUNCH_URL | no external reference is fetched |
 * | `/Names /EmbeddedFiles` | nothing on its own | no embedded file reaches disk |
 *
 * The last one is deliberately not an event: an embedded file cannot announce
 * itself, and its clause is checked by looking at the filesystem instead. Saying
 * so here rather than leaving a reader to notice one row of four behaves
 * differently.
 *
 * ## Hex strings, not literals
 *
 * Every string is written `<hex>` rather than `(text)`. A PDF literal string
 * needs its parentheses and backslashes escaped, and a JavaScript payload is
 * mostly parentheses — so the literal form puts an escaping rule between the
 * fixture and the thing it is meant to test, and a fixture that fails to parse
 * reports as a document with no active content. That is the reassuring answer
 * again, arriving through an encoding.
 *
 * Usage: imported by `scripts/security/activeContentProof.mjs`.
 */

/** The alert text the document-level JavaScript raises when it executes. */
export const DOC_LEVEL_MARKER = 'MONSTERA-DOCLEVEL-JS-FIRED';

/** The alert text the `/OpenAction` raises when it executes. */
export const OPEN_ACTION_MARKER = 'MONSTERA-OPENACTION-FIRED';

/** The name of the embedded file, which must never appear on disk. */
export const EMBEDDED_FILE_NAME = 'monstera-embedded-payload.txt';

/** The embedded file's content, so a stray copy on disk is identifiable. */
export const EMBEDDED_FILE_BODY = 'MONSTERA-EMBEDDED-FILE-REACHED-DISK';

/**
 * The URL the link annotation points at.
 *
 * A host that does not exist rather than one that does: this string is only
 * ever compared, never dialled, and pointing a fixture at a real address is how
 * a proof acquires a network dependency nobody declared.
 */
export const EXTERNAL_URL = 'https://monstera-invariant-24.invalid/fetched';

/** @param {string} text @returns {string} */
function hex(text) {
  return `<${Buffer.from(text, 'ascii').toString('hex').toUpperCase()}>`;
}

/**
 * Builds the fixture.
 *
 * The xref offsets are computed from the bytes actually emitted rather than
 * tracked alongside them. A hand-maintained offset table is a second opinion
 * about where the objects are, and MuPDF repairs a broken xref silently — so a
 * wrong table would not fail, it would just mean the file was reconstructed
 * rather than read, and every later assertion would be about a different
 * document.
 *
 * @returns {Buffer}
 */
export function activeContentPdf() {
  const docLevelJs = `app.alert("${DOC_LEVEL_MARKER}");`;
  const openActionJs = `app.alert("${OPEN_ACTION_MARKER}");`;

  /** @type {string[]} */
  const objects = [
    // 1: catalog. Carries every carrier the invariant names.
    `<< /Type /Catalog /Pages 2 0 R /OpenAction 5 0 R ` +
      `/Names << /JavaScript << /Names [ ${hex('doclevel')} 4 0 R ] >> ` +
      `/EmbeddedFiles << /Names [ ${hex(EMBEDDED_FILE_NAME)} 7 0 R ] >> >> >>`,
    // 2: page tree.
    `<< /Type /Pages /Kids [ 3 0 R ] /Count 1 >>`,
    // 3: one page, carrying the link annotation.
    `<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 200 200 ] /Annots [ 6 0 R ] >>`,
    // 4: document-level JavaScript, run by pdf_enable_js.
    `<< /S /JavaScript /JS ${hex(docLevelJs)} >>`,
    // 5: the open action.
    `<< /S /JavaScript /JS ${hex(openActionJs)} >>`,
    // 6: the external reference.
    `<< /Type /Annot /Subtype /Link /Rect [ 0 0 10 10 ] ` +
      `/A << /S /URI /URI ${hex(EXTERNAL_URL)} >> >>`,
    // 7: the embedded file specification.
    `<< /Type /Filespec /F ${hex(EMBEDDED_FILE_NAME)} /EF << /F 8 0 R >> >>`,
    // 8: the embedded file's stream.
    `<< /Length ${String(EMBEDDED_FILE_BODY.length)} >>\nstream\n${EMBEDDED_FILE_BODY}\nendstream`,
  ];

  /** @type {number[]} */
  const offsets = [];
  let body = '%PDF-1.7\n';
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  });

  const xrefAt = body.length;
  let xref = `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  const trailer =
    `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\n` +
    `startxref\n${String(xrefAt)}\n%%EOF\n`;

  return Buffer.from(`${body}${xref}${trailer}`, 'ascii');
}
