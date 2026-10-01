import * as splitter from '@zag-js/splitter';

/**
 * Zag's splitter machine WITHOUT its drag cursor, which cost every drag a whole-document restyle per pointer move and
 * drew nothing.
 *
 * `@zag-js/splitter` (1.43.3, and 1.44.0 changes nothing here) runs `setGlobalCursor` on EVERY `POINTER_MOVE`: it
 * writes `* { cursor: col-resize !important; }` into a `<style>` in the document head, rewriting its text each time. A
 * stylesheet whose rule matches every element is a whole-document style recalculation per move. Measured 2026-10-01
 * with `scripts/research/frameTimes.mjs` on the panel-edge drag: in a development build of this code, 3,398 ms of style
 * recalculation in a 9.4 s drag, and 405 ms once the sheet was kept out; in the packaged 0.1.6.0, 3,783 ms of style and
 * layout together in 10.3 s. And it drew nothing: the renderer's CSP pins `style-src` to hashes (§9.27), so the sheet is
 * refused every time.
 *
 * The cause is the library's, outside this repository, with no switch to turn it off — its one other route, a
 * registry, rewrites the same sheet on every pointer move anywhere in the document — so the response is these two
 * actions, emptied by name.
 *
 * KEYED ON THE LIBRARY'S ACTION NAMES, which is the risk, and `Splitter.test.tsx` holds it: the stock machine must
 * still implement both and run the cursor one on every move, so a rename turns that case red instead of leaving the
 * override emptying names nothing calls. The behaviour itself is `splitterDrag.pw.ts`', in a real browser.
 */
export const SPLITTER_MACHINE: typeof splitter.machine = {
  ...splitter.machine,
  implementations: {
    ...splitter.machine.implementations,
    actions: {
      ...splitter.machine.implementations?.actions,
      setGlobalCursor: () => undefined,
      clearGlobalCursor: () => undefined,
    },
  },
};
