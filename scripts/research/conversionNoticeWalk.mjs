// @ts-check
/**
 * Every conversion's notice is SEEN while it runs (R28, the owner's review of 0.1.17.0, 2026-10-21): From Office, From
 * Markdown, Insert from Markdown, From CSV and From images, each on a file large enough to take seconds.
 *
 *   node scripts/research/conversionNoticeWalk.mjs [--app-root <checkout> | --executable <Monstera.exe>] [--only <name,...>]
 *
 * ## Seen, not mounted
 *
 * The notice the owner saw missing was mounted, placed, and hidden: the toast strip anchored to a page area kept behind,
 * which Chromium hides a box for. Every DOM signal said it was there, and so did `toBeVisible`. So at every animation frame
 * this reads the element ON TOP at the notice's centre, and counts the notice seen only when that element is the notice.
 *
 * ## In the shape that hid it
 *
 * Three documents are open and the SECOND is on show, as in the owner's recording: the hidden anchor was the last tab's
 * page area, so with one document, or the last tab on show, every reading passed while the notice was invisible.
 *
 * ## Asserted per conversion
 *
 * - the work ran for at least `MIN_WORK_MS` with the notice mounted, or the fixture is too small to tell anything;
 * - the notice was first seen within `FIRST_SEEN_MS` of the input that started the work;
 * - from then on it was seen in every frame it was mounted.
 *
 * ## The control reproduces the defect inside the app
 *
 * Before any conversion, the old anchor rule — every page pane naming it — is put back on each pane's own style, and a
 * Markdown conversion must then be mounted and NEVER seen. A reader that counted a mounted notice as seen would pass every
 * step below and fail here. Measured 2026-10-21: mounted 5.7 s, seen in 0 frames. A `<style>` element cannot be the
 * route: the renderer's pinned policy refuses one, and the first control built that way saw the notice in every frame.
 *
 * Every document has a change, so none is parked: a clean document behind for a minute mounts nothing, and with the
 * last one parked the hiding shape is gone and every step passes for that reason (the same first control, measured).
 * Each reading checks that a document behind, with its page area, sits after the one on show.
 *
 * ## Readings, 2026-10-21
 *
 * Against 0.1.17.0 unpacked and run where it lies (the release the owner recorded): from Markdown mounted 7.5 s and seen
 * in 0 frames, from a `.doc` mounted 4.7 s and seen in 0, both red. Against the fix (b4696406): all seven seen within
 * 83-188 ms of the input and in every frame they were mounted.
 *
 * Office's samples (`.doc`, `.xls`, `.ppt`) are read from `_review/samples/old-office/`, `commentsWalk`'s N6 folder:
 * nothing in this repository can make one and B10 keeps a binary fixture out of the commit, so a step whose sample is
 * missing fails saying so.
 */
import { existsSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { root, startWalk, writesDone, writesLanded } from './liveWalk.mjs';

/** The shortest work that can tell a notice that follows it from one that does not. */
const MIN_WORK_MS = 1500;
/** From the input that starts the work to the notice on top: the renderer asks main every 200 ms until the work begins. */
const FIRST_SEEN_MS = 1500;

const argv = process.argv.slice(2);
/** @param {string} name */
const option = (name) => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};
const appRoot = option('--app-root');
const executable = option('--executable');
const only = option('--only')?.split(',');
/** @param {string} name */
const wanted = (name) => only === undefined || only.includes(name);

// A WINDOW THAT PAINTS WHILE COVERED, `markLatencyWalk`'s reason: the reading is per frame.
const switches = ['--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows'];
const walk = await startWalk(
  'conversionNotice',
  executable !== undefined ? { executable: resolve(executable), switches } : appRoot === undefined ? { switches } : { appRoot: resolve(appRoot), switches },
);
const { page, output, command, pickFiles, saveTo, step, finish } = walk;

/** A one-page document of its own name. @param {string} name */
async function onePage(name) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([612, 792]).drawText(name, { x: 72, y: 700, size: 24, font });
  return document.save();
}

/** Puts the second tab on show: the shape that hid the notice. */
async function secondOnShow() {
  await page.locator('.m-tab').nth(1).click();
  await page.locator('[data-document-layer="active"] canvas.m-page').first().waitFor({ timeout: 30_000 });
}

/** Starts reading, every frame, whether the notice is mounted and whether it is the element on top at its centre. */
async function watchNotice() {
  await page.evaluate(() => {
    /** @typedef {{ x: number, y: number, width: number, height: number }} Box */
    /** @typedef {{ getBoundingClientRect: () => Box, contains: (other: unknown) => boolean }} Found */
    const doc = /** @type {{ querySelector: (selector: string) => Found | null, elementFromPoint: (x: number, y: number) => unknown }} */ (Reflect.get(globalThis, 'document'));
    const nextFrame = /** @type {(callback: () => void) => number} */ (Reflect.get(globalThis, 'requestAnimationFrame'));
    const state = { running: true, frames: /** @type {{ t: number, mounted: boolean, seen: boolean }[]} */ ([]) };
    const tick = () => {
      if (!state.running) return;
      const notice = doc.querySelector('[data-task-notice]');
      let seen = false;
      if (notice !== null) {
        const box = notice.getBoundingClientRect();
        seen = notice.contains(doc.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      }
      state.frames.push({ t: performance.now(), mounted: notice !== null, seen });
      nextFrame(tick);
    };
    nextFrame(tick);
    Reflect.set(globalThis, 'noticeWatch', state);
  });
}

/** @returns {Promise<{ t: number, mounted: boolean, seen: boolean }[]>} */
async function stopWatching() {
  return page.evaluate(() => {
    const state = /** @type {{ running: boolean, frames: { t: number, mounted: boolean, seen: boolean }[] }} */ (Reflect.get(globalThis, 'noticeWatch'));
    state.running = false;
    return state.frames;
  });
}

/**
 * Runs one conversion from `act` and reads its notice from the input to the end of the work.
 * @param {() => Promise<void>} act ends with the input that starts the work
 */
async function readNotice(act) {
  const layers = await hidingShape();
  if (!layers.shaped) {
    throw new Error(`no document behind with its page area after the one on show: the shape that hid the notice is not on screen (layers: ${JSON.stringify(layers.seen)})`);
  }
  const works = await writesDone(page, 'works');
  await watchNotice();
  const started = await page.evaluate(() => performance.now());
  await act();
  const input = await page.evaluate(() => performance.now());
  await writesLanded(page, works, 1, 'works');
  const frames = await stopWatching();
  const mounted = frames.filter((frame) => frame.mounted);
  const seen = frames.filter((frame) => frame.seen);
  const firstMounted = mounted[0]?.t;
  const lastMounted = mounted.at(-1)?.t;
  const firstSeen = seen[0]?.t;
  return {
    actMs: Math.round(input - started),
    mountedMs: firstMounted === undefined || lastMounted === undefined ? 0 : Math.round(lastMounted - firstMounted),
    mountedFrames: mounted.length,
    seenFrames: seen.length,
    // FROM THE INPUT, which the act ends with: a dialog or a palette before it is not the work.
    firstSeenMs: firstSeen === undefined ? null : Math.round(firstSeen - input),
    // MOUNTED AND NOT SEEN, once it had been seen: the notice going under something while the work ran.
    lostAfterSeen: firstSeen === undefined ? 0 : mounted.filter((frame) => frame.t >= firstSeen && !frame.seen).length,
  };
}

/** @param {Awaited<ReturnType<typeof readNotice>>} reading */
function assertSeen(reading) {
  if (reading.mountedMs < MIN_WORK_MS) {
    throw new Error(`the notice was mounted for ${String(reading.mountedMs)} ms, under ${String(MIN_WORK_MS)}: the fixture is too small to tell anything (${JSON.stringify(reading)})`);
  }
  if (reading.firstSeenMs === null) throw new Error(`the notice was mounted for ${String(reading.mountedMs)} ms and never seen: ${JSON.stringify(reading)}`);
  if (reading.firstSeenMs > FIRST_SEEN_MS) throw new Error(`the notice was first seen ${String(reading.firstSeenMs)} ms after the input, past ${String(FIRST_SEEN_MS)}: ${JSON.stringify(reading)}`);
  if (reading.lostAfterSeen > 0) throw new Error(`the notice went unseen for ${String(reading.lostAfterSeen)} frames while mounted: ${JSON.stringify(reading)}`);
}

/** A Markdown file long enough to take seconds to compose. @param {string} name @param {number} parts */
async function longMarkdown(name, parts) {
  const path = join(output, name);
  const paragraph = 'A paragraph of plain words that the composer sets as prose, again and again. ';
  await writeFile(path, Array.from({ length: parts }, (_, at) => `## Part ${String(at + 1)}\n\n${paragraph.repeat(6)}\n`).join('\n'));
  return path;
}

for (const name of ['first', 'second', 'third']) {
  const path = join(output, `${name}.pdf`);
  await writeFile(path, await onePage(name));
  await walk.open(path);
  // A CHANGE IN EVERY DOCUMENT, so none is parked: a clean document behind for a minute mounts nothing, and with the
  // third parked the last page area left is the one on show, where the hidden anchor cannot happen (measured: the
  // control saw the notice in every frame).
  await command('Rotate page');
}
await secondOnShow();

/** Whether the shape that hid the notice is on screen: a document kept behind, with its page area, after the one on show. */
async function hidingShape() {
  return page.evaluate(() => {
    const doc = /** @type {{ querySelectorAll: (selector: string) => Iterable<{ getAttribute: (name: string) => string | null, querySelector: (selector: string) => unknown }> }} */ (Reflect.get(globalThis, 'document'));
    const layers = [...doc.querySelectorAll('[data-document-layer]')].map((layer) => ({
      state: layer.getAttribute('data-document-layer'),
      pane: layer.querySelector('.m-page-pane') !== null,
    }));
    const active = layers.findIndex((layer) => layer.state === 'active');
    return { shaped: active >= 0 && layers.slice(active + 1).some((layer) => layer.state === 'background' && layer.pane), seen: layers };
  });
}

/** The Markdown and CSV routes ask the font first; the work starts at Choose file. */
const chooseFile = async () => {
  await page.getByRole('dialog', { name: 'New PDF' }).getByRole('button', { name: 'Choose file…' }).click();
};

// THE CONTROL: the old rule, every page pane naming the anchor, put back in the running app. The notice is then mounted
// for the whole work and never on top, and a reader that cannot tell those apart passes everything else.
await step('CONTROL: with every page pane naming the anchor again, a Markdown conversion is mounted and never seen', async () => {
  // ON EACH PANE'S OWN STYLE, from script: the renderer's pinned policy refuses a `<style>` element (measured: the panes
  // behind kept no name), and a property set through the style object is not markup.
  const nameEveryPane = (/** @type {boolean} */ on) =>
    page.evaluate((named) => {
      const doc = /** @type {{ querySelectorAll: (selector: string) => Iterable<{ style: { setProperty: (name: string, value: string) => void, removeProperty: (name: string) => void } }> }} */ (Reflect.get(globalThis, 'document'));
      for (const pane of doc.querySelectorAll('.m-page-pane')) {
        if (named) pane.style.setProperty('anchor-name', '--m-page-area');
        else pane.style.removeProperty('anchor-name');
      }
    }, on);
  await nameEveryPane(true);
  /** The panes and the anchor name each carries while the notice is mounted, for the failure's message. */
  let named = /** @type {string[]} */ ([]);
  const source = await longMarkdown('control.md', 2000);
  // THE OLD RULE TAKEN OFF AGAIN HOWEVER THE CONTROL ENDS: left on, every conversion after it reads the defect this walk
  // put back, and all of them fail for the control's sake (2026-10-22: the shape check threw first, 7 steps red).
  let reading;
  try {
    reading = await readNotice(async () => {
      await pickFiles([source]);
      await saveTo(join(output, 'control.pdf'));
      await command('New PDF from Markdown…');
      await chooseFile();
      await page.locator('[data-task-notice]').waitFor({ state: 'attached', timeout: 15_000 });
      named = await page.evaluate(() => {
        const doc = /** @type {{ querySelectorAll: (selector: string) => Iterable<{ closest: (selector: string) => { getAttribute: (name: string) => string | null } | null }> }} */ (Reflect.get(globalThis, 'document'));
        const style = /** @type {(element: unknown) => { anchorName: string }} */ (Reflect.get(globalThis, 'getComputedStyle'));
        return [...doc.querySelectorAll('.m-page-pane')].map((pane) => `${pane.closest('[data-document-layer]')?.getAttribute('data-document-layer') ?? 'none'}:${style(pane).anchorName}`);
      });
    });
  } finally {
    await nameEveryPane(false);
  }
  await secondOnShow();
  process.stdout.write(`      control: ${JSON.stringify(reading)}\n`);
  if (reading.mountedMs < MIN_WORK_MS) throw new Error(`the control's notice was mounted for ${String(reading.mountedMs)} ms: too short to be a control`);
  if (reading.seenFrames > 0) throw new Error(`the reader saw a notice the old rule hides, in ${String(reading.seenFrames)} frames: it cannot tell mounted from seen (panes: ${named.join(', ')})`);
  return { ...reading, named };
});

/**
 * One conversion's step.
 * @param {string} name @param {() => Promise<void>} prepare answers the pickers @param {() => Promise<void>} act
 */
async function conversion(name, prepare, act) {
  if (!wanted(name)) return;
  await step(`${name}: the notice is on top from the chosen input until the work ends, with the second of three tabs on show`, async () => {
    // THE PICKERS ANSWERED INSIDE THE READING, after its shape check: answers queued before a check that throws are taken
    // by the next step's picker, which then converts the wrong file.
    const reading = await readNotice(async () => {
      await prepare();
      await act();
    });
    await secondOnShow();
    process.stdout.write(`      ${name}: ${JSON.stringify(reading)}\n`);
    assertSeen(reading);
    return reading;
  });
}

await conversion(
  'from markdown',
  async () => {
    await pickFiles([await longMarkdown('from.md', 2000)]);
    await saveTo(join(output, 'from-markdown.pdf'));
  },
  async () => {
    await command('New PDF from Markdown…');
    await chooseFile();
  },
);

await conversion(
  'insert from markdown',
  async () => {
    await pickFiles([await longMarkdown('insert.md', 2000)]);
    await saveTo(join(output, 'inserted-pages.pdf'));
  },
  async () => {
    await command('Insert from Markdown…');
    await page.getByRole('button', { name: 'Choose file…' }).click();
  },
);

await conversion(
  'from csv',
  async () => {
    const path = join(output, 'table.csv');
    const rows = Array.from({ length: 20_000 }, (_, at) => `${String(at + 1)},Item ${String(at + 1)},${String((at * 7) % 1000)},A note on row ${String(at + 1)}`);
    await writeFile(path, ['Number,Name,Amount,Note', ...rows].join('\n'));
    await pickFiles([path]);
    await saveTo(join(output, 'from-csv.pdf'));
  },
  async () => {
    await command('New PDF table from CSV…');
    await chooseFile();
  },
);

await conversion(
  'from images',
  async () => {
    // PICTURES OF THE WINDOW ITSELF, each its own page: many, so the work takes seconds.
    const pictures = [];
    for (let at = 0; at < 40; at += 1) {
      const path = join(output, `picture-${String(at + 1).padStart(2, '0')}.png`);
      await writeFile(path, await page.screenshot());
      pictures.push(path);
    }
    await pickFiles(pictures);
    await saveTo(join(output, 'from-images.pdf'));
  },
  () => command('New PDF from images…'),
);

const OLD_OFFICE = join(root, '_review', 'samples', 'old-office');
for (const extension of ['.doc', '.xls', '.ppt']) {
  const file = (existsSync(OLD_OFFICE) ? readdirSync(OLD_OFFICE) : []).find((each) => each.toLowerCase().endsWith(extension));
  await conversion(
    `from office ${extension}`,
    async () => {
      if (file === undefined) throw new Error(`no ${extension} sample in ${OLD_OFFICE}: put one there and run the walk again`);
      await pickFiles([join(OLD_OFFICE, file)]);
      await saveTo(join(output, `${file}.pdf`));
    },
    () => command('New PDF from Word, Excel or PowerPoint…'),
  );
}

await finish();
