/**
 * The module-graph half of {@link ./engineReach.mjs}'s observation.
 *
 * A `load` hook runs on the loader thread and sees every module the graph
 * actually pulls in, by resolved URL, at the moment it is pulled. That is the
 * observation the question needs: not *does a path exist through the imports*,
 * which reading the source answers, but *did this process load that module*.
 *
 * It posts URLs and never decides anything. The driver owns the verdict, and
 * the probe owns the second observable — one of these two could be blind
 * without the other being, which is why there are two.
 */

/** @type {import('node:worker_threads').MessagePort | undefined} */
let sink;

/** @param {{ port: import('node:worker_threads').MessagePort }} data */
export function initialize(data) {
  sink = data.port;
}

/**
 * @param {string} url
 * @param {unknown} context
 * @param {(url: string, context: unknown) => unknown} nextLoad
 */
export function load(url, context, nextLoad) {
  sink?.postMessage(url);
  return nextLoad(url, context);
}
