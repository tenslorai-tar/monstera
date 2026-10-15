import { serveApart } from './apartThread.js';
import { COMPOSITION, type ComposeOutcome } from './composeApart.js';

/**
 * The thread a text source is composed in ({@link composerApart}).
 *
 * ## This file is a worker ENTRY POINT
 *
 * Loaded by `apartEntry.ts` in the thread it starts, never imported by the host. It ends when the composition has been
 * posted, and every HarfBuzz instance, subset and pdf-lib buffer the composition made ends with it. A failure to load
 * this file or anything it imports is answered there.
 */

await serveApart(COMPOSITION, async (request): Promise<ComposeOutcome> => {
  const [{ ComposeRefused }, { faceSourceFrom }] = await Promise.all([import('./composeOutcome.js'), import('./fontCatalogue.js')]);
  const composer =
    request.kind === 'markdown' ? (await import('./markdownCompose.js')).composeMarkdown : (await import('./csvCompose.js')).composeCsv;
  try {
    return { kind: 'composed', composed: await composer(request.source, request.page, faceSourceFrom(request.faces), request.family) };
  } catch (error) {
    if (!(error instanceof ComposeRefused)) throw error;
    return { kind: 'refused', reason: error.reason, line: error.line, item: error.item, message: error.message };
  }
});
