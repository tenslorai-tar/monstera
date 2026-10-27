// @ts-check
/**
 * Edit text on a document SHAPED LIKE A DESIGN TOOL'S BROCHURE (the owner's R20 of 2026-10-21): how often an edit is
 * refused, and with what words. The owner's own brochure refused Edit object's colour change and every move; this asks
 * the same of Edit text, on a document built here — never the owner's file.
 *
 *   node scripts/research/brochureEditWalk.mjs [--pages <n>]
 *
 * ## The fixture
 *
 * `brochureFixture.mjs`' `brochure`, which says what makes it a design tool's; Edit object's kernel check
 * (`editObject.proof.mjs`) reads the same one.
 *
 * ## What is tried, on every page
 *
 * 1. a heading's words replaced;
 * 2. a heading's colour changed (all its words, the panel's Red);
 * 3. the heading over a picture edited;
 * 4. a justified line edited;
 * 5. the pull quote in its form XObject edited;
 * 6. a body line edited (words added at its end).
 *
 * Each try is ended by the walks' one press away (`textSteps`), which answers what the editor said, if anything. The
 * record is every try with its words; the last line counts the refusals, so nothing is concluded from one.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brochure } from './brochureFixture.mjs';
import { startWalk } from './liveWalk.mjs';
import { textSteps } from './textWalkSteps.mjs';

const argv = process.argv.slice(2);
const pagesAt = argv.indexOf('--pages');
const PAGES = pagesAt === -1 ? 3 : Number(argv[pagesAt + 1]);

const walk = await startWalk('brochureEdit');
const { page, output, section, step, finish } = walk;
const text = textSteps(walk);

/** @type {{ page: number, try: string, said: string[] }[]} */
const tries = [];

/**
 * Opens the block of words at (x, y) in PDF points from the page's top left: a press there with Edit text on, and the
 * editor waited for. Aimed by place rather than by order, so each try is on the object it names.
 * @param {number} x @param {number} y
 */
async function openAt(x, y) {
  const box = await page.locator('canvas.m-page:visible').first().boundingBox();
  if (box === null) throw new Error('the page is not on screen');
  const scale = box.width / 595;
  const point = { x: box.x + x * scale, y: box.y + y * scale };
  // THE BLOCK THAT HOLDS THE POINT, pressed as a block: a bare press at the point opened nothing while a stale editor
  // element satisfied the wait (the 3-page run of 2026-10-21, every heading unchanged and "Saved").
  const blocks = page.locator('[data-text-edit-layer]:visible [data-text-block]');
  await blocks.first().waitFor({ timeout: 60_000 });
  for (let at = 0; at < (await blocks.count()); at += 1) {
    const area = await blocks.nth(at).boundingBox();
    if (area === null || point.x < area.x || point.x > area.x + area.width || point.y < area.y || point.y > area.y + area.height) continue;
    // IN TWO STEPS (ADR-0271 section 3): the box selected, then the caret put in its words.
    await text.openBlock(blocks.nth(at), 'middle');
    return;
  }
  throw new Error(`no block of words holds the point (${String(x)}, ${String(y)}) on the page`);
}

/** @param {number} pageNumber @param {string} name @param {() => Promise<void>} edit */
async function attempt(pageNumber, name, edit) {
  await step(`page ${String(pageNumber)}: ${name}`, async () => {
    await text.ensureEditText();
    await edit();
    try {
      const said = await text.pressAway();
      tries.push({ page: pageNumber, try: name, said });
      return { said };
    } catch (error) {
      // AN EDIT THAT NEITHER ENDED NOR SAID WHY in 120 s: what the editor and the writes were doing then, so the record
      // says whether it hung, was busy, or was never what the press took.
      const editors = text.editor();
      const state = {
        editors: await editors.count(),
        busy: (await editors.count()) > 0 ? await editors.first().getAttribute('aria-busy') : null,
        words: (await editors.count()) > 0 ? ((await editors.first().textContent()) ?? '').slice(0, 80) : null,
        writesInFlight: await page.locator('html').getAttribute('data-writes'),
        problems: await text.problems(),
      };
      tries.push({ page: pageNumber, try: name, said: [`NOT ENDED: ${JSON.stringify(state)}`] });
      throw new Error(`the edit neither ended nor said why: ${JSON.stringify(state)}`, { cause: error });
    }
  });
}

// EACH PAGE ITS OWN DOCUMENT, opened in turn: the walk then needs no page navigation, and every try starts on a page no
// earlier try has changed.
for (let pageNumber = 1; pageNumber <= PAGES; pageNumber += 1) {
  const path = join(output, `brochure-${String(pageNumber)}.pdf`);
  await writeFile(path, await brochure(pageNumber));
  await walk.open(path);
  await section('Edit');
  // THE TOP HEADING LAST: replaced by longer words it wraps to a second line, and that line pushes everything below it
  // down (ADR-0249), so a press aimed afterwards at a fixed place below misses (the run of 2026-10-25, two misses a page).
  await attempt(pageNumber, 'edit a heading laid over a picture', async () => {
    await openAt(90, 234);
    await page.keyboard.press('End');
    await page.keyboard.type(' festival');
  });
  // THE JUSTIFIED LINE AND THE QUOTE BEFORE THE BODY LINE: a body line that grows pushes the paragraphs below it down
  // (ADR-0249), and the justified one was then no longer where the press aimed (run of 2026-10-21).
  await attempt(pageNumber, 'edit a justified line', async () => {
    // THE JUSTIFIED PARAGRAPH'S FIRST LINE as the fixture draws it now, read off the walk's own screenshot (2026-10-25):
    // 507 pointed into the space above it.
    await openAt(100, 540);
    await page.keyboard.press('End');
    await page.keyboard.type(' now');
  });
  await attempt(pageNumber, 'edit the pull quote in its form XObject', async () => {
    await openAt(340, 516);
    await page.keyboard.press('End');
    await page.keyboard.type(' again');
  });
  await attempt(pageNumber, 'add words to a body line', async () => {
    await openAt(100, 342);
    await page.keyboard.press('End');
    await page.keyboard.type(' too');
  });
  // THE COLOUR BEFORE THE WORDS, so it is asked of the heading as the page has it.
  await attempt(pageNumber, 'change a heading’s colour', async () => {
    await openAt(120, 70);
    await page.keyboard.press('Control+A');
    await text.panel().getByRole('button', { name: 'Red', exact: true }).first().click();
  });
  await attempt(pageNumber, 'replace a heading’s words', async () => {
    await openAt(120, 70);
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Summer at the garden');
  });
}

const refused = tries.filter((each) => each.said.length > 0);
await writeFile(join(output, 'tries.json'), `${JSON.stringify({ pages: PAGES, tries }, null, 2)}\n`);
process.stdout.write(`\nBROCHURE: ${String(refused.length)} of ${String(tries.length)} edits were refused or warned\n`);
for (const each of refused) process.stdout.write(`  page ${String(each.page)}, ${each.try}: ${each.said.join(' / ')}\n`);
await finish();
