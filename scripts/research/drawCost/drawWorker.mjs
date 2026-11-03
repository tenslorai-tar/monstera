// @ts-check
/**
 * `drawCost.mjs`' worker: draws one page with PDF.js INSIDE A WORKER onto an OffscreenCanvas, and hands the finished
 * image back as an ImageBitmap. Every failure is answered with its own message and stack, since whether this works at
 * all under the renderer's policy is the question.
 *
 * THE PLATFORM THROUGH ONE UNTYPED HANDLE: `scripts/` is type-checked as Node code, and the DOM library would retype
 * `fetch` for every script there (`tsconfig.scripts.json`), so this file reaches the worker's globals through `scope`.
 *
 * THE ANSWER CARRIES `drawCost: true`: inside a worker PDF.js cannot start a worker of its own, falls back to its "fake
 * worker" and imports `pdf.worker.mjs` into this one, which then posts PDF.js's own messages to the page as well.
 */

/** @type {any} */
const scope = globalThis;

/** @type {any} */
let pdfjs;

scope.addEventListener('message', async (/** @type {any} */ event) => {
  if (event.data?.drawCost !== true) return;
  const stage = { at: 'import' };
  try {
    // BY URL, the file the server answers beside this one.
    pdfjs ??= await import(new URL('./pdf.mjs', import.meta.url).href);
    stage.at = 'workerSrc';
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.mjs', import.meta.url).href;
    stage.at = 'getDocument';
    const task = pdfjs.getDocument({ data: new Uint8Array(event.data.bytes), useWorkerFetch: false, useWasm: false });
    const document = await task.promise;
    stage.at = 'getPage';
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: event.data.scale });
    /** @type {number[]} */
    const times = [];
    /** @type {any} */
    let bitmap;
    for (let round = 0; round < event.data.rounds; round += 1) {
      stage.at = 'OffscreenCanvas';
      const canvas = new scope.OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('an OffscreenCanvas in a worker gave no 2d context');
      stage.at = 'render';
      const began = performance.now();
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      times.push(performance.now() - began);
      stage.at = 'transferToImageBitmap';
      bitmap?.close();
      bitmap = canvas.transferToImageBitmap();
    }
    await task.destroy();
    scope.postMessage({ drawCost: true, ok: true, times, bitmap }, bitmap === undefined ? [] : [bitmap]);
  } catch (error) {
    /** @type {{ formatError: (thrown: unknown) => string }} */
    const { formatError } = await import(new URL('./reportError.mjs', import.meta.url).href);
    scope.postMessage({ drawCost: true, ok: false, stage: stage.at, error: formatError(error) });
  }
});
