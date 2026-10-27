/**
 * ONE catalogue page edited as the application edits it: read by PDFium as the editor reads it, grouped by the editor's
 * own grouping (`groupInFrames`, ADR-0273), the manifest's block found among the blocks offered, its words changed as the
 * manifest's edit changes them, written by the operator writer as `main` routes it, and judged by the catalogue's check.
 *
 * The ONE spelling of that path (B3a): the research walk (`editCatalogueWriter.mjs`) runs it over every shape, and
 * `proof:editcatalogue` runs it in CI over the shapes the rebuilt editor must offer. Two copies of it would be two
 * opinions about what *the editor offers this block* means, and the proof would pass a path the walk no longer takes.
 *
 * The caller hands the modules in, each loaded by its own literal specifier so the build-freshness scan reads what it
 * loads; nothing here imports a build.
 */

/**
 * @typedef {{
 *   pdfium: any, mupdfWriter: any, applyEditTextOperators: any, blockEditOf: any, readsUnpacked: any,
 *   groupInFrames: any, inItsFrame: any, blockableOf: any, paragraphsOfLines: any, lineText: any, asDocVersion: any,
 *   fromTextFrame: any, expectEdit: any, engines: any,
 * }} WriteKit
 */

/**
 * The verdict on one shape: `held`, or why not (`NOT SENT`, `NOT MEASURED`, or the check's failures, one per line), and
 * the bytes written where anything was.
 *
 * @param {WriteKit} kit
 * @param {any} shape a catalogue shape (`editCatalogue.mjs`)
 * @param {{ readonly group?: (runs: readonly any[]) => readonly any[] }} [options] `group` replaces the editor's grouping,
 *   for a control that must show what the path does without it
 * @returns {Promise<{ readonly verdict: string, readonly after: Uint8Array | null }>}
 */
export async function writeCatalogueShape(kit, shape, options = {}) {
  const { paragraphsOfLines, lineText, fromTextFrame, expectEdit, engines } = kit;
  const base = await shape.build({});
  const correct = await shape.build({ edit: { block: shape.edit.block, lines: shape.edit.lines } });
  const block = base.blocks.find((/** @type {any} */ each) => each.id === shape.edit.block);
  const expected = /** @type {string} */ (correct.blocks.find((/** @type {any} */ each) => each.id === block.id)?.text);
  if (block.form !== undefined) return { verdict: 'NOT MEASURED: a block inside a form (see the walk’s header)', after: null };
  const { read, runs, grouped: editors } = await readForEdit(kit, base.bytes, base.page);
  const grouped = options.group?.(read.runs) ?? editors;
  /** A grouped block's box on the page: a framed block's corners taken back out of its frame. @param {any} each */
  const onPage = (each) => {
    if (each.frame === undefined) return each.box;
    const corners = [
      [each.box.x0, each.box.y0],
      [each.box.x1, each.box.y0],
      [each.box.x0, each.box.y1],
      [each.box.x1, each.box.y1],
    ].map(([x, y]) => fromTextFrame(each.frame, x, y));
    const xs = corners.map((/** @type {any} */ corner) => corner.x);
    const ys = corners.map((/** @type {any} */ corner) => corner.y);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  };
  // THE MANIFEST'S BLOCK, as the grouping read it: the grouped block whose box holds the most of the manifest's box.
  const overlap = (/** @type {any} */ each) => {
    const box = onPage(each);
    return Math.max(0, Math.min(box.x1, block.box.right) - Math.max(box.x0, block.box.left)) * Math.max(0, Math.min(box.y1, block.box.top) - Math.max(box.y0, block.box.bottom));
  };
  const near = [...grouped].filter((each) => overlap(each) > 0).sort((a, b) => overlap(b) - overlap(a));
  if (near.length === 0) return { verdict: 'NOT SENT: the grouping offers no block where the manifest’s is', after: null };
  /** A grouped block's text as the editor reads it. @param {any} each */
  const textRead = (each) => paragraphsOfLines(each.lines.map((/** @type {any} */ line) => ({ text: lineText(line.runs), soft: line.soft })));
  // THE EDIT'S OWN CHANGE, applied to the block as the grouping reads it: the words the manifest's edit removes and
  // inserts, found by their shared start and end. Rebuilding the text from the manifest's lines instead dropped what the
  // grouping joins to the block — a numbered list's numbers — and failed wherever it splits lines otherwise.
  // THE EDITED BLOCK'S TEXT AS THE CATALOGUE BUILDS IT, not the edit's lines alone: a block's words include what is
  // drawn apart from its lines, such as markers drawn later.
  const was = block.text.split(/\s+/u);
  const becomes = expected.split(/\s+/u);
  let start = 0;
  while (start < was.length && was[start] === becomes[start]) start += 1;
  let end = 0;
  while (end < was.length - start && was[was.length - 1 - end] === becomes[becomes.length - 1 - end]) end += 1;
  const removed = was.slice(start, was.length - end).join(' ');
  const inserted = becomes.slice(start, becomes.length - end).join(' ');
  // OF THE BLOCKS WHERE THE MANIFEST'S IS, the one holding the words the edit changes: a code block groups a line to a
  // block, and the widest line is not the edited one.
  const chosen = near.find((each) => removed !== '' && textRead(each).includes(removed)) ?? near[0];
  const asRead = textRead(chosen);
  if (removed === '' || !asRead.includes(removed)) return { verdict: `NOT SENT: the block as the grouping reads it does not hold “${removed}”`, after: null };
  // THE SAME OCCURRENCE the edit changes: the words before it may hold the phrase too (a list of like lines).
  const occurrence = was.slice(0, start).join(' ').split(removed).length - 1;
  let at = -1;
  for (let k = 0; k <= occurrence; k += 1) at = asRead.indexOf(removed, at + 1);
  if (at < 0) return { verdict: `NOT SENT: the block as the grouping reads it holds “${removed}” fewer times than the catalogue’s`, after: null };
  const text = asRead.slice(0, at) + inserted + asRead.slice(at + removed.length);
  const { after, outcome } = await writeBlockText(kit, base.bytes, base.page, runs, chosen, text);
  const failures = await expectEdit(engines, { before: base.bytes, after, page: base.page, block, expected, outcome });
  return { verdict: failures.length === 0 ? 'held' : failures.join('\n      '), after };
}

/**
 * A page read as the editor reads it: PDFium's runs (read again unpacked where the read asks it), the page's operator
 * runs the writer takes, and the runs grouped by the editor's own grouping, frame by frame (ADR-0273).
 *
 * @param {WriteKit} kit @param {Uint8Array} bytes @param {number} page
 * @returns {Promise<{ readonly read: any, readonly runs: any, readonly grouped: readonly any[] }>}
 */
export async function readForEdit(kit, bytes, page) {
  const { pdfium, readsUnpacked, groupInFrames, inItsFrame, blockableOf } = kit;
  const session = await pdfium.pdfiumWriter.open(bytes);
  try {
    const plain = await pdfium.textRuns(session, page);
    const unpacked = readsUnpacked(plain.unaddressable, 'operators');
    if (unpacked) await pdfium.unpackedIfAsked(session, page, true);
    const read = unpacked ? await pdfium.textRuns(session, page) : plain;
    const runs = await pdfium.pageRuns(session, page);
    const grouped = groupInFrames(
      read.runs.map((/** @type {any} */ run) => blockableOf(inItsFrame(run))),
      (/** @type {any} */ run) => run.frame?.matrix,
    );
    return { read, runs, grouped };
  } finally {
    await pdfium.pdfiumWriter.close(session);
  }
}

/**
 * One grouped block given new words, written by the operator writer as `main` routes it: the bytes it left, and what it
 * said (its notes, or its refusal).
 *
 * @param {WriteKit} kit @param {Uint8Array} bytes @param {number} page @param {any} runs @param {any} block @param {string} text
 * @returns {Promise<{ readonly after: Uint8Array | null, readonly outcome: any }>}
 */
export async function writeBlockText(kit, bytes, page, runs, block, text) {
  const { mupdfWriter, applyEditTextOperators, blockEditOf, asDocVersion } = kit;
  const entry = {
    lines: block.lines.map((/** @type {any} */ line) => line.runs.map((/** @type {any} */ run) => run.index)),
    soft: block.lines.map((/** @type {any} */ line) => line.soft),
    text,
  };
  const copy = await mupdfWriter.open(bytes);
  try {
    const { noted } = await applyEditTextOperators(copy, { kind: 'editTextOperators', page, ...blockEditOf([entry]), fit: 'reflow', version: asDocVersion(1) }, runs);
    return { after: await mupdfWriter.serialise(copy), outcome: { noted } };
  } catch (error) {
    return { after: null, outcome: { refused: error } };
  } finally {
    await mupdfWriter.close(copy);
  }
}
