/**
 * PDF.js's legacy worker, which ships no declaration of its own. `cmaps.test.ts` puts it on the global as `pdfjsWorker`
 * so PDF.js runs its message handler in the test's thread; the one member PDF.js reads there is declared, and nothing
 * else is, so a use of any other would not compile.
 */
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
