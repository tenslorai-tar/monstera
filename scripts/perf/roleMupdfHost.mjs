// @ts-check
/**
 * The `mupdf-host` role, measured — as a MODEL in this process, and as the real
 * host in the process that actually runs the engine.
 *
 * ## Two cells against one budget, which is this repository's existing shape
 *
 * `roleMain.mjs` and `roleMainService.mjs` already stand in exactly this
 * relation: a model whose figures are arithmetic about the workload, beside a
 * cell that drives the shipped code, with a divergence between them treated as
 * the finding. The reason there was LL-4/JJ-1 — ADR-0021 read a model's numbers
 * as though the implementation had been measured — and the reason here is an
 * expiry that has now fired.
 *
 * Both this file and `budgetGate.mjs` carried the same sentence from the day
 * they were written: *"Electron's own baseline is not in these figures, so this
 * must be re-measured when the utility process lands rather than assumed to
 * carry over."* The host landed (ADR-0022, ADR-0023). `--host` is that
 * re-measurement.
 *
 * ## THE TWO CELLS DO NOT RUN THE SAME WORKLOAD, AND THAT IS NOT A DEFECT TO FIX HERE
 *
 * This is the first thing to know before comparing their numbers, because the
 * obvious reading of a divergence is wrong.
 *
 * The model opens the document, walks every page's geometry and renders every
 * page. That workload is deliberate and its argument is below. **The host cannot
 * be asked to do it.** Its channel set is seven channels —
 * `probe-containment`, `open`, `serialise`, `close`, `apply`, `capture`,
 * `invert` (`packages/kernel/src/host/engineChannels.ts`) — and there is no
 * page-walk channel and no render channel. `commandSchema` is a discriminated
 * union of exactly one member, `rotatePages`
 * (`packages/contract/src/commands.ts`).
 *
 * So the real-host workload is everything the shipped surface can express:
 * **open, rotate, serialise, close.** That is genuine engine work — the writer
 * parses the document, the command reaches the page tree, and serialising walks
 * the object graph to produce bytes — and it is *not* a page walk plus a render
 * of every page.
 *
 * Invariant 21 puts numbers on the gap: a full page walk costs **370 MB** where
 * page geometry read from the dictionary costs **10 MB**.
 *
 * **THAT PARAGRAPH USED TO END BY PREDICTING A SMALLER FIGURE FROM THE HOST,
 * AND THE PREDICTION IS FALSIFIED. Measured 2026-08-31, three runs, peak
 * working set read from outside each process:**
 *
 * | shape | the model | the real host |
 * |---|---|---|
 * | image-heavy, 209,105,721 bytes | 316.6 MB | **1336.0 MB** |
 * | object-dense, 26,315,984 bytes | 150.6 MB | **284.1 MB** |
 * | `perf-baseline.pdf`, the fixed cost | 57.2 MB | 87.7 MB |
 *
 * Above each cell's own baseline that is **1.30× against 6.26×** and **3.73×
 * against 7.83×**, so the real host breaches §9.17's 6× on **both** shapes
 * where the model clears it on both. The absolute term is untouched — 1.34 GB
 * and 284 MB against 3 GB — and so is the 128 MB baseline, at 87.7 MB.
 *
 * The prediction was reasoned from the one axis the paragraph above names, and
 * the workloads differ on a second: the host's ends in **serialise**, which
 * produces a full byte image (209,104,828 bytes for the image fixture) that the
 * model never asks for. That is a candidate and it is not the answer — it
 * accounts for 209 MB of a 1248 MB document cost, and what the rest is has not
 * been established.
 *
 * So the difference is not "an artefact of the channel set" in the direction
 * that sentence assumed. It is a reading the `mupdf-host` amendment §9.17's log
 * already says is owed, and it is one day of it.
 *
 * **Adding walk and render channels to close it would be building architecture
 * to serve an instrument**, and the viewer that needs them is Stage 1. Recorded
 * as a limitation with a named cause, which is the honest form.
 *
 * ## Why the model's workload is what it is
 *
 * Walking every page matters: the WASM measurements that produced the withdrawn
 * two-term model failed *inside* `loadPage` during the page walk on the
 * object-dense fixture, never reaching the save, so a workload that opens and
 * stops would report a number for work nobody does.
 *
 * Rendering every page matters for a separate reason and it is measured: a walk
 * of page dictionaries alone does not touch content streams, and bounds-only
 * over the large fixture peaks at 58.9 MB for a 200 MB document — which would
 * pass a 1.2 GB budget with the engine never having read the document.
 *
 * ## Which cell the BUDGET GATE uses, and why it is still the model
 *
 * The model, unchanged. `budgetGate.mjs` invokes this script with a document
 * path and no flags, so `perf:gate` measures exactly what it measured before
 * this file gained a second cell.
 *
 * That is deliberate and it is not timidity. §9.17's `mupdf-host` baseline was
 * derived from the model, and switching the gate's subject to a process with a
 * different fixed cost AND a different workload would silently change what the
 * number means — while the number itself is unamended. The reading comes first
 * and the amendment decides the number; a gate that quietly started measuring
 * something else in between would make both harder to reason about.
 *
 * **THE READING IS NOW TAKEN AND IT SETTLES THE ORDER RATHER THAN THE
 * QUESTION.** Switching the gate's subject to `--host` today makes it **red on
 * both shapes** — 6.26× and 7.83× against a declared 6× — where the model
 * clears both. So the swap is not a wiring job that was merely being deferred
 * for tidiness; it is blocked on the amendment, exactly as this paragraph said,
 * and now with the figure that shows what the amendment has to decide.
 *
 * ## The instrument, in the host cell
 *
 * Peak working set of the HOST process, read from OUTSIDE it while it is still
 * alive, through `reportPeakOf`. Never the role process's own peak: this script
 * is a parent in `--host` mode and its own memory is an artefact of the harness.
 * PPPP-1 is why the quantity is the peak rather than the current set.
 *
 * ## THREE CELLS, AND THE TWO HOST ONES ARE MEANT TO BE SUBTRACTED
 *
 * `--no-document` connects a host and holds nothing. §9.17's multiple is taken
 * *above* a role's own baseline, so the two readings only subtract if they were
 * produced the same way — a baseline measured by a second script would fold
 * every difference between two harnesses into the figure, which is BB-4's axis
 * and the reason that cell lives here.
 *
 * `scripts/research/hostFixedCost.mjs` is not superseded by it and is not a
 * second opinion about it: that instrument answers what the ENGINE's share is,
 * against a bare-runtime control taken in the same run and behind a resolution
 * test. This answers what §9.17 budgets, which is the whole process.
 *
 * Measured 2026-08-28, `perf-baseline.pdf` (62,874 bytes), peak working set
 * read from outside the host, three runs each:
 *
 * | cell | peak |
 * |---|---|
 * | `--no-document` | 86.0 · 86.1 · 86.0 MB |
 * | `--host` | 88.1 · 87.7 · 87.7 MB |
 * | the model, same document | 63.3 MB |
 *
 * The ~24 MB between the model and the host is Electron's Node-mode baseline —
 * the thing the expiry sentence above said would have to be re-measured, now
 * measured. The ~2 MB between the two host cells is what a trivially small
 * document costs, and it is a **baseline** figure rather than a multiple: a
 * small document reports a large ratio however correctly the process behaves,
 * which is why §9.17 measures a baseline this way and a multiple another.
 *
 * `--no-document` takes no path, which is what lets it run in CI: the generated
 * fixture corpus is not tracked, so a runner has none. It is registered on the
 * Windows job after `containedStart.mjs` — which proves a contained host
 * STARTS, where this proves something can then TALK to one. Everything between
 * the two had unit tests over injected surfaces and had never run against a
 * real process off one developer machine, which is the gap YYYY-1 came out of.
 *
 * Usage: node scripts/perf/roleMupdfHost.mjs <document-path>
 *        node scripts/perf/roleMupdfHost.mjs <document-path> --host
 *        node scripts/perf/roleMupdfHost.mjs --no-document
 */

import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROLE_MUPDF_HOST, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { requireCurrentShim } from '../lib/shimBinary.mjs';
// STATIC AND NAMED, so the call site below reads `electronBinaryPath()`.
// `check:electronbinary` requires that literal spelling at every
// `executablePath` — a namespaced `electron.electronBinaryPath()` is the same
// function and the scan cannot tell it from any other object's property, which
// makes the site unverifiable rather than wrong. Caught by that check on this
// file's first run, which is what it is for.
import { electronBinaryPath } from '../provision/electron.mjs';
import { peakRssBytes, peakWorkingSetOf, reportPeak, reportPeakOf } from './peakRss.mjs';

const ROOT = repoRoot();

const documentArgument = process.argv[2];
const looksLikeAPath = documentArgument !== undefined && !documentArgument.startsWith('--');
// `--no-document` TAKES NO DOCUMENT, which is what lets it run where there is
// no fixture. The generated corpus is not tracked, so a runner has none unless
// something builds it — and this cell needs none by definition.
if (!looksLikeAPath && !process.argv.includes('--no-document')) {
  process.stderr.write(
    'Usage: roleMupdfHost.mjs <document-path> [--host]\n' +
      '       roleMupdfHost.mjs --no-document\n',
  );
  process.exit(2);
}
// NULL RATHER THAN NARROWED, now that one cell legitimately has no document.
// The two cells that need a path read it through `requireDocument()`, which
// turns "there is none" into a refusal at the point of use rather than a
// non-null assertion that makes it a runtime surprise.
const documentPath = looksLikeAPath ? documentArgument : null;
/** The host's fixed cost: connect, and hold no document. Implies `--host`. */
const NO_DOCUMENT = process.argv.includes('--no-document');
const HOST_MODE = process.argv.includes('--host') || NO_DOCUMENT;

/**
 * The document path, or a refusal naming which cell asked for it.
 *
 * @returns {string}
 */
function requireDocument() {
  if (documentPath === null) {
    process.stderr.write('roleMupdfHost: this cell needs a document path.\n');
    process.exit(2);
  }
  return documentPath;
}

/**
 * The model: the engine in THIS process, through the shim.
 *
 * Kept because it is the cheapest description of what holding a document costs
 * an engine, and because it is the only cell that can walk and render.
 */
async function measureModel() {
  const koffi = (await import('koffi')).default;

  // Refuses a DLL built from older source. A stale binary still runs and still
  // prints plausible numbers, and this workload touches little enough of the
  // shim that a rebuild that never happened would produce a believable figure.
  const lib = koffi.load(requireCurrentShim({ root: ROOT }));

  const mz_init = lib.func('int mz_init(_Out_ void **out)');
  const mz_drop = lib.func('void mz_drop(void *c)');
  const mz_open = lib.func('int mz_open(void *c, const char *path, _Out_ void **out)');
  const mz_close = lib.func('int mz_close(void *c, void *d)');
  const mz_last_error = lib.func('const char *mz_last_error(void *c)');
  const mz_page_count = lib.func('int mz_page_count(void *c, void *d, _Out_ int *out)');
  const mz_page_bounds = lib.func(
    'int mz_page_bounds(void *c, void *d, int number, _Out_ float *x0, _Out_ float *y0, _Out_ float *x1, _Out_ float *y1)',
  );
  const mz_render_page = lib.func(
    'int mz_render_page(void *c, void *d, int number, float dpi, _Out_ void **samples, _Out_ int *w, _Out_ int *h, _Out_ int *stride, _Out_ void **pixmap)',
  );
  const mz_free_pixmap = lib.func('void mz_free_pixmap(void *c, void *pixmap)');
  const mz_alloc_stats = lib.func(
    'int mz_alloc_stats(void *c, _Out_ double *live, _Out_ double *peak, _Out_ double *blocks, _Out_ int *invalid)',
  );

  /** @returns {[number]} */
  const num = () => [0];
  /** @returns {[unknown]} */
  const ptr = () => [null];

  const ctxOut = ptr();
  if (mz_init(ctxOut) !== 0) throw new Error('mz_init failed');
  const ctx = ctxOut[0];

  /** @param {string} what */
  const fail = (what) => {
    throw new Error(`${what}: ${String(mz_last_error(ctx))}`);
  };

  const document = requireDocument();
  const docOut = ptr();
  if (mz_open(ctx, document, docOut) !== 0) fail('mz_open');
  const doc = docOut[0];

  const count = num();
  if (mz_page_count(ctx, doc, count) !== 0) fail('mz_page_count');

  // Every page, not the first: the page walk is where the engine actually
  // materialises per-page structures, and it is where the earlier
  // investigation's object-dense fixture died.
  let widest = 0;
  for (let page = 0; page < count[0]; page += 1) {
    const x0 = num();
    const y0 = num();
    const x1 = num();
    const y1 = num();
    if (mz_page_bounds(ctx, doc, page, x0, y0, x1, y1) !== 0) {
      fail(`mz_page_bounds(${String(page)})`);
    }
    widest = Math.max(widest, x1[0] - x0[0]);
  }

  // Every page is rendered, not the first. Rendering is what forces the engine
  // to parse a content stream, and a walk of page dictionaries alone does not
  // touch them: measured, bounds-only over this fixture peaks at 58.9 MB for a
  // 200 MB document, which would pass a 1.2 GB budget without the engine having
  // read the document at all. A gate that cannot fail is not a gate.
  const dpi = Number(process.env['MONSTERA_PERF_DPI'] ?? '110');
  let renderedPixels = 0;
  for (let page = 0; page < count[0]; page += 1) {
    const samples = ptr();
    const width = num();
    const height = num();
    const stride = num();
    const pixmap = ptr();
    if (mz_render_page(ctx, doc, page, dpi, samples, width, height, stride, pixmap) !== 0) {
      fail(`mz_render_page(${String(page)})`);
    }
    renderedPixels += width[0] * height[0];
    mz_free_pixmap(ctx, pixmap[0]);
  }

  // The engine's own counters alongside the OS figure. RSS cannot separate what
  // the engine retains from what the allocator is sitting on; these can, and
  // reporting both means a budget breach can be diagnosed rather than merely
  // noticed.
  const live = num();
  const allocPeak = num();
  const blocks = num();
  const invalid = num();
  if (mz_alloc_stats(ctx, live, allocPeak, blocks, invalid) !== 0) fail('mz_alloc_stats');

  const engine = {
    liveBytes: live[0],
    peakBytes: allocPeak[0],
    blocks: blocks[0],
    countersInvalid: invalid[0] === 1,
  };

  mz_close(ctx, doc);
  mz_drop(ctx);

  reportPeak({
    role: 'mupdf-host',
    cell: 'model',
    document,
    pages: count[0],
    widestPage: widest,
    dpi,
    renderedPixels,
    engine,
    rssAtEnd: peakRssBytes(),
  });
}

/**
 * The AppContainer profile this cell runs its host in.
 *
 * Its own name rather than the acceptance test's: two instruments sharing a
 * profile share whatever state either leaves, and a container is exactly the
 * kind of durable object where that stops being visible.
 */
const CONTAINER = 'monstera-role-mupdf-host';

/**
 * The names inside the handed pair, in the alphabet the contract allows.
 *
 * `outputNameSchema` is `/^[0-9a-f-]+$/u` — lower-case hex digits and hyphens —
 * for the same reason `sessionDirectoryName` is: these strings are concatenated
 * into paths, and in the shipped design the host, hostile by invariant 25, is
 * what supplies one. An allowlist is the answer, so a readable word like
 * `image` is refused. Found by running it: the host answered `internal` and its
 * own stderr carried the zod failure.
 */
const SNAPSHOT_NAME = 'ad-0';
const OUTPUT_NAME = 'ad-1';

/**
 * The real host: the process the engine actually runs in, driven over the pipe.
 *
 * Assembled from the four shipped surfaces rather than from anything written
 * here. That is not only correctness — it is the same assembly
 * `composition.ts` has to make when the host is wired, so this cell is the
 * first caller of `createEngineHostConnection` and exercises the composition
 * before a feature depends on it.
 */
async function measureHost() {
  if (process.platform !== 'win32') {
    process.stderr.write(
      `roleMupdfHost --host: the engine host is a Win32 AppContainer process (ADR-0022), so ` +
        `this cell has no meaning on ${process.platform}. The model cell runs anywhere the ` +
        `shim does.\n`,
    );
    process.exit(2);
  }

  // THROUGH THE OWNER (B3a). This was one of three private copies of the same
  // rule, none of which carried the exclusions `buildFreshness.mjs` had already
  // measured into it — a directory walk, tests skipped, an empty walk refused.
  refuseStaleBuild(ROOT, ROLE_MUPDF_HOST, 2);

  // NOT ANNOTATED, deliberately. A dynamic import of a computed path is `any`,
  // which is what lets these modules be reached by property name; annotating the
  // result as `Record<string, any>` turns every one of them into an
  // index-signature access under `noPropertyAccessFromIndexSignature` and buys
  // no type safety at all, since the value type is still `any`.
  //
  // The real check is not a type here — it is that these paths exist, which
  // `requireFreshBuild` establishes above and `check:docs` establishes for every
  // `scripts/` path this file names in prose.
  /** @param {string} relative */
  const built = async (relative) => import(pathToFileURL(join(ROOT, relative)).href);

  const pipes = await built('apps/desktop/dist/win32PipeSurface.js');
  const readerSurface = await built('apps/desktop/dist/readerHostSurface.js');
  const hostSurface = await built('apps/desktop/dist/win32HostSurface.js');
  const directorySurface = await built('apps/desktop/dist/win32DirectorySurface.js');
  const sessionDirectories = await built('apps/desktop/dist/sessionDirectories.js');
  const connection = await built('apps/desktop/dist/engineHostConnection.js');
  const budget = await built('apps/desktop/dist/budget.js');
  const contract = await built('packages/contract/dist/index.js');

  const user = pipes.currentUserSid();
  if (!user.ok) throw new Error(`could not resolve this process's user SID: ${user.error}`);
  const container = pipes.hostContainerSid(CONTAINER);
  if (!container.ok) throw new Error(`could not resolve the container SID: ${container.error}`);

  // Under the system temp directory rather than the repository, because the
  // handed pair gets its own DACL naming the container and nothing else here
  // should inherit that.
  const root = join(tmpdir(), `monstera-role-host-${String(process.pid)}`);
  mkdirSync(root, { recursive: true });
  const hostLogPath = join(root, 'host.log');

  // LOWER-CASE HEX AND HYPHENS ONLY. The name is concatenated into a path and
  // the type's minter is an allowlist, because the host — hostile by invariant
  // 25 — is what normally supplies one. A decimal pid is refused; the hex of the
  // same pid is not, and `ad` is a prefix inside the same alphabet.
  const name = sessionDirectories.sessionDirectoryName(`ad-${process.pid.toString(16)}`);
  if (!name.ok) throw new Error(`the session directory name was refused: ${name.error}`);
  const paths = sessionDirectories.sessionDirectoryPaths(root, name.value);

  const made = sessionDirectories.createSessionDirectories(
    directorySurface.createWin32DirectorySurface(),
    paths,
    user.value,
    container.value,
  );
  if (!made.ok) {
    throw new Error(`the handed pair was not created: ${made.error.stage}: ${made.error.detail}`);
  }

  // The document goes into the directory the host was GRANTED, under the name
  // `engine/open` is told. This is what main does with the canonical image.
  //
  // Skipped for `--no-document`, which opens nothing. The handed pair is still
  // created, so the two host cells differ by the DOCUMENT rather than by how
  // much work the parent did — and in any case these are parent-side calls that
  // cannot move the host's peak, which is the figure being subtracted.
  if (!NO_DOCUMENT) copyFileSync(requireDocument(), join(paths.snapshot, SNAPSHOT_NAME));

  // HELD ON AN OBJECT rather than in a `let`, for the reason
  // `engineHostConnection.ts` states about its own state: the sink assigns
  // inside a closure, so the compiler narrows the `let` to `null` at its single
  // visible assignment and calls every later read `never`.
  /** @type {{ reason: { code: string, detail: string } | null }} */
  const ending = { reason: null };
  let calls = 0;

  const startedAt = process.hrtime.bigint();
  const live = await connection.createEngineHostConnection(
    {
      pipes: pipes.createWin32PipeSurface(),
      reader: readerSurface.createReaderHostSurface(),
      writesFor: pipes.createWin32WriteSurface,
      /** @param {string} pipeName */
      hostFor: (pipeName) =>
        hostSurface.createWin32HostSurface({
          executablePath: electronBinaryPath(),
          commandArguments: [join(ROOT, 'packages', 'kernel', 'dist', 'host', 'hostEntry.js'), pipeName],
          // Inside the grant set, as the acceptance test's is and for the same
          // reason: a working directory of our own would be a path whose rights
          // differ from everything else the host reaches.
          workingDirectory: dirname(electronBinaryPath()),
          containerName: CONTAINER,
          diagnosticPath: hostLogPath,
        }),
    },
    {
      pipeName: `\\\\.\\pipe\\monstera-role-mupdf-host-${String(process.pid)}`,
      user: user.value,
      container: container.value,
      readBytes: 64 * 1024,
      maxOutstandingWrites: 16,
      maxInFlight: contract.ENGINE_HOST_MAX_IN_FLIGHT,
      processMemoryLimitBytes: budget.ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES,
      correlate: () => `role-${String(calls++)}`,
      onEnded: (/** @type {{ code: string, detail: string }} */ reason) => {
        ending.reason = reason;
      },
    },
  );
  if (!live.ok) {
    throw new Error(`the host connection was refused at ${live.error.stage}: ${live.error.detail}`);
  }
  // AFTER the factory resolves, which is after the peer has connected — that is
  // what makes this a connect time rather than a process-creation time.
  const connectedAt = process.hrtime.bigint();

  const { client: transport, pid, close } = live.value;

  // THE TYPED SURFACE, DERIVED FROM THE CHANNEL DECLARATIONS. `HostClient` is
  // one `invoke(channel, params)` function; `createClient` is what turns the
  // declarations into per-channel calls that validate the envelope coming back.
  // That is the same construction `remoteEngine.ts` consumes, so this cell
  // speaks the shipped protocol rather than a hand-rolled spelling of it (B3a) —
  // and a channel name this file gets wrong is a missing function here rather
  // than a frame the host silently refuses.
  const kernelHost = await built('packages/kernel/dist/host/engineChannels.js');
  const client = contract.createClient(kernelHost.engineChannels, transport.invoke);
  try {
    /** Everything the two cells report identically, so a difference between them is the document. */
    const common = {
      role: 'mupdf-host',
      hostPid: pid,
      // How long the host took to create AND reach the pipe, which is the
      // figure HOST_CONNECT_TIMEOUT_MS is bounded against. Reported on every
      // run rather than measured once: a bound justified by a number nobody
      // re-reads is the shape B6 exists for.
      connectMs: Number(connectedAt - startedAt) / 1e6,
    };

    if (NO_DOCUMENT) {
      // THE HOST'S FIXED COST, THROUGH THE SAME PATH AS THE FIGURE IT IS
      // SUBTRACTED FROM.
      //
      // §9.17's multiple is taken *above* a role's own baseline, so the two
      // readings only subtract if they were produced the same way. Measuring the
      // baseline in a second script would make the difference between them
      // include every way the two harnesses differ — which is BB-4's axis, and
      // the reason this cell lives here rather than beside the other one.
      //
      // `scripts/research/hostFixedCost.mjs` is NOT superseded and is not a
      // second opinion about this: it answers a different question — the
      // ENGINE's share, against a bare-runtime control taken in the same run,
      // with a resolution test before any reading. This answers what §9.17
      // budgets, which is the whole process.
      reportPeakOf(pid, { ...common, cell: 'host', workload: 'connect+close', document: null });
      return;
    }

    const opened = await client['engine/open']({
      snapshotDirectory: paths.snapshot,
      snapshotName: SNAPSHOT_NAME,
      outputDirectory: paths.output,
    });
    if (!opened.ok) throw new Error(`engine/open answered ${opened.error.code}`);
    const session = opened.value.session;

    // THE ONLY DECLARED COMMAND. `commandSchema` is a discriminated union of one
    // member, so this is not a representative sample of engine work — it is the
    // whole of what the shipped surface can be asked to do. See the header.
    const applied = await client['engine/apply']({
      session,
      command: { kind: 'rotatePages', pages: [0], quarterTurns: 1 },
    });
    if (!applied.ok) throw new Error(`engine/apply answered ${applied.error.code}`);

    // Serialising is the heaviest thing the channel set can ask for: the writer
    // walks the object graph to produce bytes.
    const written = await client['engine/serialise']({ session, into: OUTPUT_NAME });
    if (!written.ok) throw new Error(`engine/serialise answered ${written.error.code}`);

    // READ WHILE IT IS STILL ALIVE, and before the close below. `hostEntry.js`
    // exits on every ending, so a peak read after `close()` is a peak read of a
    // process that is gone — which `reportPeakOf` refuses rather than reporting
    // as a cheap host.
    const detail = {
      ...common,
      cell: 'host',
      workload: 'open+rotate+serialise+close',
      document: requireDocument(),
      documentBytes: statSync(requireDocument()).size,
      serialisedBytes: written.value.bytes,
      harnessPeakBytes: peakRssBytes(),
    };
    reportPeakOf(pid, detail);

    const closed = await client['engine/close']({ session });
    if (!closed.ok) throw new Error(`engine/close answered ${closed.error.code}`);
  } catch (cause) {
    // THE HOST'S OWN DIAGNOSTIC, BEFORE THE CLEANUP DELETES IT.
    //
    // A handler that throws answers `internal` and withholds the text — by
    // design, since the diagnostic stays on the host's side and only an id
    // crosses. That side is the inherited stderr handle, which this instrument
    // pointed at a file inside the directory the `finally` below removes. So
    // the one place the reason exists was being deleted a millisecond after it
    // was written, and every failure here read as a bare `internal`.
    try {
      const log = readFileSync(hostLogPath, 'utf8').trim();
      if (log.length > 0) process.stderr.write(`--- host stderr ---\n${log}\n--- end ---\n`);
    } catch {
      // No log to show. The thrown cause below is still the report.
    }
    throw cause;
  } finally {
    close();
    // THE SHIPPED REMOVAL, not an `rmSync` written here. How a handed pair goes
    // away is a question `sessionDirectories.ts` owns — its `removeTree` uses
    // `rmSync` precisely because the host holds modify on the output directory
    // and what is in there is not limited to the one file this design asked
    // for — so a second spelling here would be a second opinion about it (B3a).
    sessionDirectories.removeSessionDirectories(
      directorySurface.createWin32DirectorySurface(),
      paths,
    );
    // AND THE ROOT, WHICH CAN LOSE A RACE RATHER THAN A PERMISSION CHECK.
    // `close()` returns before the host process has finished exiting, so a
    // handle it still holds refuses the removal with EPERM. Retried briefly
    // rather than either ignored or thrown: ignoring leaks a directory per run,
    // which is the class two call sites in this repository were already fixed
    // for, and throwing from a `finally` would replace a real diagnosis with a
    // cleanup failure.
    // WAIT FOR THE HOST TO BE GONE, WHICH IS THE ACTUAL DEPENDENCY.
    //
    // `host.log` is the diagnostic file, and `win32HostSurface` hands the CHILD
    // an inherited handle to it — the parent closes its own copy at creation, so
    // the last holder is the host process itself. Until it exits, the file
    // cannot be deleted and neither can the directory containing it.
    //
    // Retrying the removal was the first version and it is the wrong shape: it
    // waits on a symptom, and every failure then reads as a permissions problem.
    // Measured — the leaked directory removed instantly by hand a minute later,
    // which is what said the lock was transient rather than a DACL.
    //
    // `peakWorkingSetOf` returns null for a process that is gone, which is
    // already this repository's answer to *is that pid still there*; a second
    // spelling here would be a second opinion about it (B3a).
    for (let attempt = 0; attempt < 50 && peakWorkingSetOf(pid) !== null; attempt += 1) {
      await new Promise((settle) => setTimeout(settle, 100));
    }

    let removed = true;
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      removed = false;
    }
    if (!removed) {
      process.stderr.write(
        `roleMupdfHost --host: could not remove ${root}. Reported rather than swallowed — a ` +
          `harness that leaks one directory per run is how a temp directory acquires ` +
          `thousands.\n`,
      );
    }
  }

  const ended = ending.reason;
  if (ended !== null && ended.code !== 'shutdown') {
    // Reported after the measurement rather than instead of it: the figure is
    // sound and the ending is news about the host, and swallowing it would hide
    // a host that died during the workload it was being measured on.
    process.stderr.write(`roleMupdfHost --host: the connection ended as ${ended.code}: ${ended.detail}\n`);
  }
}

// `--no-document` implies `--host`, because the model has no such cell: it
// measures the engine in THIS process, where "no document" is a bare Node
// process and answers nothing §9.17 asks.
await (HOST_MODE || NO_DOCUMENT ? measureHost() : measureModel());
