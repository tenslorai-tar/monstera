// @ts-check
/**
 * Cloud run 19's live checks (the owner's of 2026-10-24), on the editor-fidelity page in the running app:
 *
 * 1. **nothing changes on open**: each block opened and left with no key pressed writes nothing and moves no block;
 * 2. **typing moves only that paragraph**: a word added to the justified paragraph leaves every other block's outline
 *    where it was (within a pixel);
 * 3. **code stays one command per line**: a character added to the code block's first command, written and saved, and
 *    every command is still a line of its own in the saved file (MuPDF's reading, whitespace as written);
 * 4. **a highlight dragged across whole lines**: the not-embedded Times paragraph's two lines selected by a mouse drag from
 *    the first word to the last — the selection checked to be every character of it — highlighted, written and saved:
 *    one marked highlight per line, each read with its width.
 *
 * The page is the committed fixture (`editorFidelityFixture.mjs`); its words are this repository's, so they may be named.
 *
 *   node scripts/research/editorFidelityWalk.mjs
 */
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';

import { FIXTURE_PDF } from './editorFidelityFixture.mjs';
import { startWalk, writesDone, writesIdle, writesLanded } from './liveWalk.mjs';
import { savedContent, savedTextKeepingSpaces } from './savedPdf.mjs';
import { textSteps } from './textWalkSteps.mjs';

const CODE = [
  'git clone https://github.com/explodinggradients/ragas.git',
  '# 2. Install uv (if not already installed)',
  'curl -LsSf https://astral.sh/uv/install.sh | sh',
  'uv sync --all-extras',
];

const walk = await startWalk('editor-fidelity');
const { page, open, section, step, finish, output } = walk;
const { editor, panel, ensureEditText, pressAway, savedCopy } = textSteps(walk);
const copy = join(output, 'editor-fidelity.pdf');
await copyFile(FIXTURE_PDF, copy);
await open(copy);
await section('Edit');
await ensureEditText();
const blocks = page.locator('[data-text-block]');
await blocks.first().waitFor({ timeout: 60_000 });

/** Every block's outline on screen, in order. */
const outlines = async () =>
  (await blocks.evaluateAll((each) => each.map((node) => node.getBoundingClientRect()))).map((box) => ({
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  }));

/** The block whose editor's words begin `start`, by opening each in turn: its index. @param {string} start */
async function blockStarting(start) {
  await ensureEditText();
  await blocks.first().waitFor({ timeout: 60_000 });
  const count = await blocks.count();
  /** @type {string[]} */
  const seen = [];
  for (let at = 0; at < count; at += 1) {
    await blocks.nth(at).click();
    await editor().waitFor();
    const words = ((await editor().textContent()) ?? '').trimStart();
    seen.push(words.slice(0, 16));
    await page.keyboard.press('Escape');
    await editor().waitFor({ state: 'detached' });
    await ensureEditText();
    if (words.startsWith(start)) return at;
  }
  throw new Error(`no block begins "${start}" among ${String(count)}: ${JSON.stringify(seen)}`);
}

await step('cloud-19 1: each block opened and left with no key pressed writes nothing and moves no block', async () => {
  await writesIdle(page);
  const before = await outlines();
  const written = await writesDone(page);
  const count = await blocks.count();
  for (let at = 0; at < count; at += 1) {
    await blocks.nth(at).click();
    await editor().waitFor();
    const said = await pressAway(10, 10);
    if (said.length > 0) throw new Error(`block ${String(at)}: ${JSON.stringify(said)}`);
    await editor().waitFor({ state: 'detached' });
    await ensureEditText();
  }
  await page.waitForTimeout(1500);
  const after = await outlines();
  const writes = (await writesDone(page)) - written;
  if (writes !== 0 || JSON.stringify(after) !== JSON.stringify(before)) throw new Error(JSON.stringify({ writes, before, after }));
  return { blocks: count, writes };
});

await step('cloud-19 2: a word changed in the justified paragraph, the same length, moves no other block', async () => {
  // THE SAME LENGTH, so the paragraph keeps its lines: one that grows a line pushes the blocks below by its pitch, which is
  // ADR-0249's rule and not this check's question (measured here 2026-10-25: ` Typed` at its end, every block below 14 px).
  const at = await blockStarting('The committee met');
  const before = await outlines();
  await blocks.nth(at).click();
  await editor().waitFor();
  await editor().evaluate((element) => {
    const walker = element.ownerDocument.createTreeWalker(element, 4);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const found = (node.textContent ?? '').indexOf('first');
      if (found === -1) continue;
      const range = element.ownerDocument.createRange();
      range.setStart(node, found);
      range.setEnd(node, found + 'first'.length);
      element.ownerDocument.getSelection()?.removeAllRanges();
      element.ownerDocument.getSelection()?.addRange(range);
      return;
    }
    throw new Error('no "first" in the paragraph');
  });
  const written = await writesDone(page);
  await page.keyboard.type('final');
  const said = await pressAway(10, 10);
  if (said.length > 0) throw new Error(JSON.stringify(said));
  await writesLanded(page, written);
  await ensureEditText();
  const after = await outlines();
  const moved = after
    .map((box, index) => ({ index, box, was: before[index] }))
    .filter(({ index, box, was }) => index !== at && (was === undefined || Math.abs(box.y - was.y) > 1 || Math.abs(box.x - was.x) > 1 || Math.abs(box.height - was.height) > 1));
  if (after.length !== before.length || moved.length > 0) throw new Error(JSON.stringify({ blocks: [before.length, after.length], moved }));
  return { block: at, othersMoved: 0 };
});

await step('cloud-19 3: a character added to the first command, written and saved, and every command is still its own line', async () => {
  const at = await blockStarting('git clone');
  await blocks.nth(at).click();
  await editor().waitFor();
  // THE CARET AFTER THE FIRST COMMAND by its own text: End goes to the end of a VISUAL line, and a long command wraps.
  await editor().evaluate((element, command) => {
    const walker = element.ownerDocument.createTreeWalker(element, 4);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const found = (node.textContent ?? '').indexOf('ragas.git');
      if (found === -1) continue;
      const range = element.ownerDocument.createRange();
      range.setStart(node, found + 'ragas.git'.length);
      range.collapse(true);
      element.ownerDocument.getSelection()?.removeAllRanges();
      element.ownerDocument.getSelection()?.addRange(range);
      return;
    }
    throw new Error(`no "${command}" in the block`);
  }, CODE[0] ?? '');
  const written = await writesDone(page);
  await page.keyboard.type('x');
  const said = await pressAway(10, 10);
  if (said.length > 0) throw new Error(JSON.stringify(said));
  await writesLanded(page, written);
  const saved = await savedCopy('code.pdf');
  const lines = (await savedTextKeepingSpaces(saved)).split('\n').map((line) => line.trim());
  const wanted = [`${CODE[0] ?? ''}x`, ...CODE.slice(1)];
  const missing = wanted.filter((command) => !lines.includes(command));
  const near = lines.filter((line) => /git|uv|curl|Install/u.test(line));
  if (missing.length > 0) throw new Error(`not a line of its own: ${JSON.stringify(missing)}; the saved lines: ${JSON.stringify(near)}`);
  return { commands: wanted.length, eachItsOwnLine: true };
});

await step('cloud-19 4: a highlight dragged across the Times paragraph’s two whole lines is one marked highlight per line', async () => {
  await ensureEditText();
  const at = await blockStarting('This paragraph is set in Times');
  await blocks.nth(at).click();
  await editor().waitFor();
  const box = await editor().boundingBox();
  if (box === null) throw new Error('no editor box');
  // FROM BEFORE THE FIRST WORD TO PAST THE LAST, as a hand drags: the first line's left at its middle, the last's right.
  const lineHeight = box.height / 2;
  await page.mouse.move(box.x + 1, box.y + lineHeight / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + lineHeight, { steps: 6 });
  await page.mouse.move(box.x + box.width - 1, box.y + box.height - lineHeight / 2, { steps: 6 });
  await page.mouse.up();
  const selected = await editor().evaluate((element) => element.ownerDocument.getSelection()?.toString() ?? '');
  // THE DRAG TOOK BOTH LINES WHOLE: the selection is every character the editor holds, white space aside.
  const whole = ((await editor().textContent()) ?? '').replace(/\s/gu, '');
  if (selected.replace(/\s/gu, '') !== whole) throw new Error(`the drag selected ${String(selected.length)} characters, not the paragraph's`);
  const written = await writesDone(page);
  await panel().getByRole('group', { name: 'Highlight' }).getByRole('button', { name: 'Yellow highlight' }).click();
  const said = await pressAway(10, 10);
  if (said.length > 0) throw new Error(JSON.stringify(said));
  await writesLanded(page, written);
  const saved = await savedCopy('highlight.pdf');
  const content = await savedContent(saved);
  const behind = (content.match(/\/MonsteraDecoration\s*\(behind\)/gu) ?? []).length;
  // THE RECTANGLES' WIDTHS, read from the marked sequences: reported, and found for every one counted, so the reading of
  // them is not blind. Whether each spans its line is not asserted here — the selection above is what covers the lines.
  const widths = [...content.matchAll(/\/MonsteraDecoration\s*\(behind\)>>\s*BDC\s*q[^Q]*?(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+re\s+f/gu)].map((match) => Number(match[3]));
  if (behind !== 2 || widths.length !== behind || widths.some((width) => !(width > 0))) {
    throw new Error(JSON.stringify({ selectedCharacters: selected.length, behind, widths }));
  }
  return { selectedCharacters: selected.length, highlights: behind, widths };
});

await finish();
