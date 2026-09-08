/**
 * One subject, one process: import a specifier and report whether MuPDF's WASM
 * engine came with it.
 *
 * Spawned by `engineReach.mjs`, one child per subject, because an engine can
 * only be instantiated once in a process and a second subject in the same world
 * would read the first one's answer.
 *
 * ## Two observables, deliberately independent
 *
 * 1. **The module graph**, from a loader `load` hook: did `mupdf/dist/mupdf.js`
 *    get loaded.
 * 2. **`WebAssembly.instantiate`**, patched on the global: was a module
 *    actually instantiated, and of what size.
 *
 * They answer different questions and can fail in different ways — a graph hit
 * with no instantiation would mean the import was type-erased or lazy, and an
 * instantiation with no graph hit would mean the engine arrived by a route the
 * hook cannot see. **A disagreement is the finding**, so both are printed and
 * neither is derived from the other.
 *
 * ## What it does not observe
 *
 * A module the graph loads but never evaluates because something above it
 * threw. `hostEntry.js` throws in its own body — after every import has
 * evaluated, which is ES module order — so its imports are observed and the
 * throw is reported beside them rather than swallowed.
 */
import { register } from 'node:module';
import { MessageChannel } from 'node:worker_threads';

// THROUGH THE ENVIRONMENT, NOT ARGV, and that is a correction rather than a
// preference. The first run passed the subject as `argv[2]`, and `hostEntry.js`
// reads `argv[2]` as the pipe name it must connect to — so the probe handed its
// own subject to the subject, which dialled it, failed with ENOENT and called
// `process.exit(1)` before anything could be reported. A subject that reads the
// harness's arguments is a harness that is part of what it measures.
const specifier = process.env['MONSTERA_REACH_SUBJECT'];
if (specifier === undefined || specifier.length === 0) {
  throw new Error('engineReachProbe: MONSTERA_REACH_SUBJECT must name the subject to import');
}

const { port1, port2 } = new MessageChannel();
/** @type {string[]} */
const loaded = [];
port1.on('message', (url) => {
  if (typeof url === 'string') loaded.push(url);
});
port1.unref();

register('./engineReachHook.mjs', import.meta.url, { data: { port: port2 }, transferList: [port2] });

/** @type {number[]} */
const instantiated = [];
// REACHED THROUGH `Reflect.get`. `tsconfig.scripts.json` carries no DOM lib, so
// to the checker `WebAssembly` is a namespace rather than a value (TS2708) and
// `globalThis.WebAssembly` has no index signature to read it through (TS7017).
// The runtime object is there either way; this is how a JSDoc-checked script
// names it.
const wasm = /** @type {{ instantiate: (source: unknown, imports: unknown) => unknown }} */ (
  Reflect.get(globalThis, 'WebAssembly')
);
const realInstantiate = wasm.instantiate.bind(wasm);

/**
 * THROUGH `Reflect.set`, and that is not a style choice.
 *
 * Annotating the wrapper `@type {typeof WebAssembly.instantiate}` while
 * assigning it *to* `WebAssembly.instantiate` is circular, and TypeScript
 * 6.0.3 does not report it as one — it overflows its own stack
 * (`RangeError: Maximum call stack size exceeded` in `getResolvedSymbol`),
 * which reads as a broken toolchain rather than as a type error in this file.
 * The same shape as `ReturnType<typeof createRoster>` naming its own callee.
 *
 * `Reflect.set` takes a plain function and no annotation refers to the slot it
 * is written into, so nothing is circular.
 *
 * @param {unknown} source
 * @param {unknown} imports
 * @returns {unknown}
 */
function countingInstantiate(source, imports) {
  if (source instanceof ArrayBuffer) instantiated.push(source.byteLength);
  else if (ArrayBuffer.isView(source)) instantiated.push(source.byteLength);
  else instantiated.push(-1);
  return realInstantiate(source, imports);
}

Reflect.set(wasm, 'instantiate', countingInstantiate);

let threw = '';
const before = process.memoryUsage().rss;
try {
  await import(specifier);
} catch (error) {
  threw = error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error);
}
const after = process.memoryUsage().rss;

// Drain the loader thread's messages. They are posted during resolution, which
// has finished by the time the import settles, but delivery is a task.
for (let turn = 0; turn < 8; turn += 1) await new Promise((done) => setImmediate(done));

const engineModules = loaded.filter((url) => /node_modules\/mupdf\/dist\//.test(url));

process.stdout.write(
  JSON.stringify({
    specifier,
    modulesLoaded: loaded.length,
    engineModules: engineModules.map((url) => url.slice(url.lastIndexOf('/') + 1)).sort(),
    graphReachedEngine: engineModules.length > 0,
    wasmInstantiations: instantiated,
    instantiatedEngine: instantiated.some((size) => size > 1_000_000),
    rssDeltaMb: Number(((after - before) / 1024 / 1024).toFixed(2)),
    threw,
  }) + '\n',
);
