// @ts-check
/**
 * Edit object in the LIVE app (ADR-0264, the owner's round 2 item 1b and 1c, 2026-10-23), timed as a hand meets it, on
 * the brochure and on a long document built from it. The successor to the object-click walk, which left with Edit object.
 *
 * What each step reads, in the page's own clock (`performance.now()`), never a sleep standing for a time:
 *
 * - OUTLINES: the press on *Edit object* to the first outline drawn, cold (the editing engine's first start in this app)
 *   and warm (the mode turned off and on again). Target about 1 s, cold included.
 * - PRESS TO SELECTED: `pointerdown` on an object to its handles drawn. Target about 150 ms.
 * - THE DRAG: every frame's interval and every long task while the object follows the pointer. Target: no task over
 *   50 ms.
 * - THE RELEASE: the lifted look's place at `pointerup` against the outline's place once the page has drawn the result —
 *   no jump — and the PAPER PATCH: how long the paper laid over the place the object left stays on the page, which on a
 *   photograph is a flat patch where the picture was (ADR-0264's correction, *"not timed yet"*).
 *
 * Every figure is printed; the walk fails only where the thing itself failed (no outline, no selection, the move not
 * written), so a target missed is reported with its number rather than hidden in a red step.
 *
 * ## Measured, 2026-10-24, development build of a0271a08, `_review/walks/objectEdit/2026-10-24T04-40-30`
 *
 * | | brochure | 60 pages |
 * |---|---|---|
 * | outlines, cold / warm median | 1512 / 165 ms | 517 / 390 ms |
 * | press to selected, median | 71 ms | 69 ms |
 * | drag: worst long task | 60 ms | 81 ms |
 * | jump on release | 0 px | 0 px |
 * | paper patch (write landed) | 1145 (807) ms | 1273 (379) ms |
 *
 * The 60-page patch was 6759 ms at 894fb825 (`2026-10-24T04-27-45`): the text block's command declared every page
 * changed, so every page and thumbnail redrew before page 1 (a0271a08).
 *
 *   node scripts/research/objectEditWalk.mjs [--runs <n>]
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PDFDocument } from '@cantoo/pdf-lib';

import { brochure } from './brochureFixture.mjs';
import { startWalk, writesDone, writesLanded } from './liveWalk.mjs';

const argv = process.argv.slice(2);
const runs = Number(argv[argv.indexOf('--runs') + 1] ?? '3') || 3;

/** The brochure's first page, and a long document of its three pages twenty times over. */
async function documents(/** @type {string} */ output) {
  const one = join(output, 'brochure.pdf');
  await writeFile(one, await brochure(1));
  const long = await PDFDocument.create({ updateMetadata: false });
  for (let copy = 0; copy < 20; copy += 1) {
    for (let page = 1; page <= 3; page += 1) {
      const source = await PDFDocument.load(await brochure(page));
      const [taken] = await long.copyPages(source, [0]);
      if (taken !== undefined) long.addPage(taken);
    }
  }
  const sixty = join(output, 'brochure-60.pdf');
  await writeFile(sixty, await long.save());
  return { one, sixty };
}

const walk = await startWalk('objectEdit');
const { page, output, open, section, step, finish } = walk;
const { one, sixty } = await documents(output);
const face = () => page.getByRole('toolbar', { name: 'Tools', exact: true }).getByRole('button', { name: 'Edit object', exact: true });
const layer = () => page.getByRole('group', { name: 'Objects on page 1' });

/** The press on Edit object to its first outline, in the page's clock. */
async function outlinesAfterPress() {
  const button = await face().elementHandle();
  if (button === null) throw new Error('no Edit object button');
  return page.evaluate(
    (element) =>
      new Promise((done) => {
        const t0 = performance.now();
        /** @type {any} */ (element).click();
        const look = () => {
          if (/** @type {any} */ (globalThis).document.querySelector('[aria-label="Objects on page 1"] .m-object') !== null) done(Math.round(performance.now() - t0));
          else if (performance.now() - t0 > 30_000) done(-1);
          else /** @type {any} */ (globalThis).requestAnimationFrame(look);
        };
        /** @type {any} */ (globalThis).requestAnimationFrame(look);
      }),
    button,
  );
}

/** Edit object turned off: the button pressed while on, and the outlines gone. */
async function modeOff() {
  if ((await face().getAttribute('aria-pressed')) === 'true') await face().click();
  await page.locator('[aria-label="Objects on page 1"] .m-object').first().waitFor({ state: 'detached', timeout: 10_000 });
}

/** The figures of one list: min, median, max. @param {number[]} values */
const spread = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1), n: sorted.length };
};

for (const [label, file] of /** @type {const} */ ([['the brochure', one], ['a 60-page document', sixty]])) {
  await step(`Edit object on ${label}: outlines after the press, cold then warm`, async () => {
    await open(file);
    await section('Edit');
    // OFF FIRST: the mode is the application's, not the document's, so on the second document it is already on and a
    // press would turn it off. "Cold" on that document is the first outline drawn on it, not the engine's first start.
    await modeOff();
    const cold = await outlinesAfterPress();
    /** @type {number[]} */
    const warm = [];
    for (let run = 0; run < runs; run += 1) {
      await modeOff();
      warm.push(/** @type {number} */ (await outlinesAfterPress()));
    }
    if (cold === -1 || warm.includes(-1)) throw new Error(`no outline within 30 s: cold ${String(cold)}, warm ${JSON.stringify(warm)}`);
    return { coldMs: cold, warmMs: spread(warm), targetMs: 1000, meets: /** @type {number} */ (cold) <= 1000 && Math.max(...warm) <= 1000 };
  });

  await step(`Edit object on ${label}: press to selected, the drag, the release and the paper patch`, async () => {
    // THE HEADING OVER THE PICTURE: a text block whose box overlaps an image's, so the place it leaves is a photograph.
    const target = await page.evaluate(() => {
      const boxes = [.../** @type {any} */ (globalThis).document.querySelectorAll('[aria-label="Objects on page 1"] .m-object')].map((element) => ({
        id: element.getAttribute('data-object') ?? '',
        kind: element.getAttribute('data-object-kind') ?? '',
        box: element.getBoundingClientRect(),
      }));
      const pictures = boxes.filter((each) => each.kind === 'image');
      const over = boxes.find(
        (each) =>
          each.id.startsWith('text:') &&
          pictures.some((picture) => each.box.left < picture.box.right && each.box.right > picture.box.left && each.box.top < picture.box.bottom && each.box.bottom > picture.box.top),
      );
      return { id: over === undefined ? null : over.id, kinds: boxes.map((each) => each.kind) };
    }).then((found) => {
      if (found.id === null) throw new Error(`no text block over a picture on page 1; outlines drawn: ${JSON.stringify(found.kinds)}`);
      return found.id;
    });
    const outline = layer().locator(`[data-object="${target}"]`);
    const box = await outline.boundingBox();
    if (box === null) throw new Error('the outline is not on screen');
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    /** @type {number[]} */
    const pressToSelected = [];
    for (let run = 0; run < runs; run += 1) {
      // THE SELECTION CLEARED, AND ONLY IT: Escape with nothing selected ends Edit object itself.
      if ((await page.locator('[data-object-handle]').count()) > 0) {
        await page.keyboard.press('Escape');
        await page.locator('[data-object-handle]').first().waitFor({ state: 'detached', timeout: 10_000 });
      }
      await page.evaluate(() => {
        const holder = /** @type {any} */ (globalThis);
        holder.monsteraPress = undefined;
        /** @type {any} */ (globalThis).addEventListener('pointerdown', () => {
          holder.monsteraPress = performance.now();
        }, { once: true, capture: true });
      });
      await page.mouse.click(at.x, at.y);
      const ms = await page.evaluate(
        () =>
          new Promise((done) => {
            const look = () => {
              const pressed = /** @type {any} */ (globalThis).monsteraPress;
              if (pressed !== undefined && /** @type {any} */ (globalThis).document.querySelector('[data-object-handle]') !== null) done(Math.round(performance.now() - pressed));
              // BOUNDED: a press that selects nothing is a failure to report, never a wait for ever.
              else if (pressed !== undefined && performance.now() - pressed > 15_000) done(-1);
              else /** @type {any} */ (globalThis).requestAnimationFrame(look);
            };
            /** @type {any} */ (globalThis).requestAnimationFrame(look);
          }),
      );
      if (ms === -1) throw new Error(`run ${String(run + 1)}: the press selected nothing within 15 s`);
      pressToSelected.push(/** @type {number} */ (ms));
    }

    // THE DRAG, with every frame and every long task recorded in the page.
    await page.evaluate(() => {
      const holder = /** @type {any} */ (globalThis);
      holder.monsteraDrag = { frames: [], tasks: [], stop: false };
      // `longtask` IS CHROMIUM'S entry type and not in Node's typings, which this file is checked against.
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) holder.monsteraDrag.tasks.push(Math.round(entry.duration));
      }).observe(/** @type {any} */ ({ type: 'longtask', buffered: false }));
      let last = performance.now();
      const tick = () => {
        const now = performance.now();
        holder.monsteraDrag.frames.push(now - last);
        last = now;
        if (!holder.monsteraDrag.stop) /** @type {any} */ (globalThis).requestAnimationFrame(tick);
      };
      /** @type {any} */ (globalThis).requestAnimationFrame(tick);
    });
    const writing = await writesDone(page);
    // INTO BLANK PAPER: the gap under the left column's body text, so the block lands where no other block's lines
    // are. Dropped onto a paragraph, the page reads it back as part of that paragraph and its own outline is gone,
    // which no jump measure can tell from a jump.
    const gap = await layer().evaluate((element) => {
      const rects = [...element.querySelectorAll('.m-object')].map((each) => each.getBoundingClientRect());
      const body = rects.filter((rect) => rect.height > 60 && rect.width < 260).sort((a, b) => a.top - b.top)[0];
      const below = body === undefined ? undefined : rects.filter((rect) => rect.top > body.bottom && rect.left < body.right).sort((a, b) => a.top - b.top)[0];
      return body === undefined || below === undefined ? null : { x: body.left + body.width / 2, y: (body.bottom + below.top) / 2 };
    });
    if (gap === null) throw new Error('no blank paper under the left column to drop the block on');
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let move = 1; move <= 20; move += 1) {
      await page.mouse.move(at.x + ((gap.x - at.x) * move) / 20, at.y + ((gap.y - at.y) * move) / 20);
      await page.waitForTimeout(16);
    }
    const liftedAtRelease = await layer().locator('[data-object-lifted]').boundingBox();
    // THE RELEASE, and the paper patch timed from it in the page's clock until the page drew the result.
    await page.evaluate(() => {
      /** @type {any} */ (globalThis).monsteraRelease = undefined;
      /** @type {any} */ (globalThis).addEventListener('pointerup', () => {
        /** @type {any} */ (globalThis).monsteraRelease = performance.now();
      }, { once: true, capture: true });
    });
    await page.mouse.up();
    // THE PAPER IS TWO ELEMENTS IN TURN: the drag's (`data-object-left`) until the release, then the held look's
    // (`data-mark-look="paper"`, ADR-0257) until the page draws the result. Timing the first alone reads the handover
    // as the end. And the held one must be SEEN before its absence counts, or a look never shown reads as one gone.
    // AND WHERE THE TIME GOES: the moment the write landed (the root's finished count past the one noted, none in
    // flight), so the patch splits into the write and the page's redraw after it.
    const patch = /** @type {{ ms: number, heldSeen: boolean, landedMs: number }} */ (await page.evaluate(
      (before) =>
        new Promise((done) => {
          const doc = /** @type {any} */ (globalThis).document;
          let seen = false;
          let landed = -1;
          const look = () => {
            const released = /** @type {any} */ (globalThis).monsteraRelease;
            const held = doc.querySelector('[data-mark-look="paper"]') !== null;
            seen ||= held;
            const root = doc.documentElement;
            if (released !== undefined && landed === -1 && Number(root.getAttribute('data-writes-done') ?? '0') > before && (root.getAttribute('data-writes') ?? '0') === '0') {
              landed = Math.round(performance.now() - released);
            }
            if (released !== undefined && !held && doc.querySelector('[data-object-left]') === null) done({ ms: Math.round(performance.now() - released), heldSeen: seen, landedMs: landed });
            else if (released !== undefined && performance.now() - released > 30_000) done({ ms: -1, heldSeen: seen, landedMs: landed });
            else /** @type {any} */ (globalThis).requestAnimationFrame(look);
          };
          /** @type {any} */ (globalThis).requestAnimationFrame(look);
        }),
      writing,
    ));
    const patchMs = patch.ms;
    const heldSeen = patch.heldSeen;
    if (patchMs === -1) throw new Error('the paper over the place the block left was still on the page 30 s after the release');
    await writesLanded(page, writing);
    const drag = await page.evaluate(() => {
      const holder = /** @type {any} */ (globalThis);
      holder.monsteraDrag.stop = true;
      const frames = /** @type {number[]} */ (holder.monsteraDrag.frames).slice(1);
      return { worstFrameMs: Math.round(Math.max(...frames)), frames: frames.length, longTasks: holder.monsteraDrag.tasks };
    });
    await page.waitForTimeout(500);
    // THE OUTLINE NEAREST THE LIFTED LOOK, never the same id: an object's id is its place in the page's drawing order,
    // which a move can renumber, so the id read before the release may name a different block after it.
    const finals = await layer().locator('.m-object').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y };
    }));
    const jump = liftedAtRelease === null || finals.length === 0
      ? null
      : Math.round(Math.min(...finals.map((each) => Math.hypot(each.x - liftedAtRelease.x, each.y - liftedAtRelease.y))));
    const worstTask = drag.longTasks.length === 0 ? 0 : Math.max(...drag.longTasks);
    return {
      pressToSelectedMs: spread(pressToSelected),
      drag: { ...drag, worstLongTaskMs: worstTask, meets: worstTask <= 50 },
      releaseJumpPx: jump,
      paperPatchMs: patchMs,
      heldPaperSeen: heldSeen,
      writeLandedMs: patch.landedMs,
    };
  });
}

await finish();
