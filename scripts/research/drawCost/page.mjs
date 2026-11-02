// @ts-check
/**
 * `drawCost.mjs`' page, served under the renderer's own Content-Security-Policy. It times one page's draw by PDF.js, on
 * the main thread and in a worker, and leaves its readings on `window.drawCost` for the driver.
 *
 * - DISPLAY: the app's draw, which PDF.js runs in 15 ms slices, each started in an animation frame: the wall time a page
 *   takes to appear.
 * - CONTIGUOUS: the same draw with every frame callback answered at once (`withoutFrames`), so its wall time is the
 *   drawing's own cost on the thread. Not the print intent: that builds an operator list of its own on each draw.
 * - WORKER: the draw inside a worker onto an OffscreenCanvas, and then what the main thread pays to show the result
 *   (one `drawImage` of the ImageBitmap).
 *
 * THE PLATFORM THROUGH ONE UNTYPED HANDLE, `browser`: `scripts/` is type-checked as Node code, and the DOM library would
 * retype `fetch` for every script there (`tsconfig.scripts.json`). The served modules are loaded by URL for that reason.
 */

/** @type {any} */
const browser = globalThis;

/** @type {any} */
const pdfjs = await import(new URL('./pdf.mjs', import.meta.url).href);
/** @type {{ FIXTURES: { name: string, base64: string }[], ROUNDS: number, SCALES: number[], WARMUP: number }} */
const { FIXTURES, ROUNDS, SCALES, WARMUP } = await import(new URL('./fixtures.mjs', import.meta.url).href);

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.mjs', import.meta.url).href;

/** @param {string} base64 */
const bytesOf = (base64) => Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));

/** @param {number[]} values */
function summary(values) {
  const kept = values.slice(WARMUP).sort((a, b) => a - b);
  const median = kept[Math.floor(kept.length / 2)] ?? Number.NaN;
  return { median: Math.round(median * 10) / 10, min: Math.round((kept[0] ?? Number.NaN) * 10) / 10, max: Math.round((kept.at(-1) ?? Number.NaN) * 10) / 10 };
}

/**
 * WITH NO FRAME WAITED FOR: PDF.js starts each 15 ms slice of a display draw in an animation frame, through
 * `window.requestAnimationFrame` read at each call, so while `fn` runs every frame callback is answered at once, in a
 * task of its own, and the draw's wall time is its own cost on the thread. The app's own intent and its cached operator
 * list, so nothing but the drawing differs from the display reading.
 *
 * @template T @param {() => Promise<T>} fn
 */
async function withoutFrames(fn) {
  const real = browser.requestAnimationFrame;
  const channel = new MessageChannel();
  /** @type {((time: number) => void)[]} */
  const queued = [];
  /** @type {any} */ (channel.port1).onmessage = () => queued.shift()?.(performance.now());
  browser.requestAnimationFrame = (/** @type {(time: number) => void} */ callback) => {
    queued.push(callback);
    channel.port2.postMessage(0);
    return 0;
  };
  try {
    return await fn();
  } finally {
    browser.requestAnimationFrame = real;
    channel.port1.close();
  }
}

/** The page's own canvas and its 2d context, sized. @param {number} width @param {number} height */
function shownCanvas(width, height) {
  const canvas = browser.document.getElementById('shown');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('no 2d context');
  return { canvas, context };
}

/**
 * @param {Uint8Array} bytes
 * @param {number} scale
 * @param {'display' | 'contiguous'} how
 */
async function mainThread(bytes, scale, how) {
  const task = pdfjs.getDocument({ data: bytes.slice(), useWorkerFetch: false, useWasm: false });
  const document = await task.promise;
  const page = await document.getPage(1);
  const viewport = page.getViewport({ scale });
  const { canvas, context } = shownCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  /** @type {number[]} */
  const times = [];
  for (let round = 0; round < ROUNDS + WARMUP; round += 1) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    const draw = () => page.render({ canvas, canvasContext: context, viewport }).promise;
    const began = performance.now();
    await (how === 'contiguous' ? withoutFrames(draw) : draw());
    times.push(performance.now() - began);
  }
  await task.destroy();
  return summary(times);
}

/**
 * @param {Uint8Array} bytes
 * @param {number} scale
 */
async function inWorker(bytes, scale) {
  const worker = new browser.Worker(new URL('./drawWorker.mjs', import.meta.url), { type: 'module' });
  try {
    /** @type {any} */
    const answer = await new Promise((resolve) => {
      // OURS ONLY: PDF.js's own messages from the worker carry no `drawCost` (`drawWorker.mjs`).
      worker.onmessage = (/** @type {any} */ event) => {
        if (event.data?.drawCost === true) resolve(event.data);
      };
      // A WORKER THAT CANNOT START answers a bare event: no message and no file, which is said as such.
      worker.onerror = (/** @type {any} */ event) =>
        resolve({ ok: false, stage: 'worker start', error: event.message === undefined ? `the worker did not start (${String(event.type)})` : `${String(event.message)} (${String(event.filename)}:${String(event.lineno)})` });
      worker.onmessageerror = () => resolve({ ok: false, stage: 'message', error: 'the answer could not be read' });
      const copy = bytes.slice().buffer;
      worker.postMessage({ drawCost: true, bytes: copy, scale, rounds: ROUNDS + WARMUP }, [copy]);
    });
    if (answer.ok !== true) return { ok: false, stage: answer.stage, error: answer.error };
    // THE HAND-OVER: what the main thread pays to show the finished image, timed as one drawImage of it.
    const { context } = shownCanvas(answer.bitmap.width, answer.bitmap.height);
    /** @type {number[]} */
    const shown = [];
    for (let round = 0; round < ROUNDS + WARMUP; round += 1) {
      const began = performance.now();
      context.drawImage(answer.bitmap, 0, 0);
      // READ ONE PIXEL BACK, so the copy is done and not only queued.
      context.getImageData(0, 0, 1, 1);
      shown.push(performance.now() - began);
    }
    answer.bitmap.close();
    return { ok: true, draw: summary(answer.times), handover: summary(shown) };
  } finally {
    worker.terminate();
  }
}

async function main() {
  /** @type {Record<string, unknown>} */
  const readings = {};
  for (const fixture of FIXTURES) {
    const bytes = bytesOf(fixture.base64);
    for (const scale of SCALES) {
      // WHERE IT IS, for a driver that gives up waiting to say where it stopped.
      browser.drawCostAt = `${fixture.name}@${String(scale)}`;
      readings[`${fixture.name}@${String(scale)}`] = {
        display: await mainThread(bytes, scale, 'display'),
        contiguous: await mainThread(bytes, scale, 'contiguous'),
        worker: await inWorker(bytes, scale),
      };
    }
  }
  return readings;
}

main().then(
  (readings) => {
    browser.drawCost = { ok: true, readings, userAgent: browser.navigator.userAgent };
  },
  async (error) => {
    /** @type {{ formatError: (thrown: unknown) => string }} */
    const { formatError } = await import(new URL('./reportError.mjs', import.meta.url).href);
    browser.drawCost = { ok: false, error: formatError(error) };
  },
);
