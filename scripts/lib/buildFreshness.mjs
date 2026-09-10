// @ts-check
/**
 * Whether an artefact a proof is about to read was built from the source it
 * claims to be about.
 *
 * ## Why this is a module and not a function in the proof that needed it first
 *
 * A proof that spawns Electron and reads the shipped bundle has no way to tell
 * "the shell behaves like this" from "the shell behaved like this at the last
 * build" — every case passes about whatever `dist/` happens to hold. The guard
 * that separates those two is one rule, and B3a says a rule with more than one
 * caller lives in one place: the second proof to spawn the shell would otherwise
 * write a second opinion about what *stale* means, agreeing with the first most
 * of the time. That is this repository's most expensive recurring shape, and
 * three of its instances were parsers.
 *
 * The rule itself has already been measured twice and both readings are encoded
 * in {@link newestMtime} rather than in prose someone re-derives.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One source-to-artefact edge, and WHO produces the artefact.
 *
 * The producer is declared rather than inferred from the path, because the two
 * kinds answer a staleness question differently and the difference is not
 * visible in a filename. `tsc` does not rewrite an output whose content did not
 * change, so a newer source proves nothing on its own and the compiler has to
 * be asked; esbuild and Vite rewrite theirs on every build, so for a bundled
 * artefact the timestamps are the whole truth.
 *
 * @typedef {[source: string, artefact: string, producer: 'tsc' | 'bundler']} BuildEdge
 */

/**
 * The pairs `rendererPolicy.proof.mjs` reads before believing its own output.
 *
 * Split in two because the proof has two call sites and they run in different
 * worlds: the declaration pair is read on every machine, the runtime pairs only
 * where Electron is provisioned. Calling both early would refuse on a machine
 * that never runs the runtime cases at all.
 *
 * @type {BuildEdge[]}
 */
export const RENDERER_POLICY_DECLARATION = [
  ['apps/desktop/src/windowPolicy.ts', 'apps/desktop/dist/windowPolicy.js', 'tsc'],
];

/** @type {BuildEdge[]} */
export const RENDERER_POLICY_RUNTIME = [
  ['apps/desktop/src/preload.ts', 'apps/desktop/dist/preload.cjs', 'bundler'],
  ['apps/desktop/src/window.ts', 'apps/desktop/dist/window.js', 'tsc'],
  ['apps/desktop/src/rendererHarness.ts', 'apps/desktop/dist/rendererHarness.js', 'tsc'],
  ['apps/desktop/src/rendererHarnessMain.ts', 'apps/desktop/dist/rendererHarnessMain.js', 'tsc'],
  // THE FIFTH, and finding GGGGG-1 (2026-08-29). Two cases there read the Vite
  // bundle — that the React shell mounted, and that its stylesheet applied —
  // and this list did not follow them. Editing `App.tsx`, running `typecheck`
  // rather than `build`, and running that proof reported both about whatever
  // was built last time.
  //
  // Against `index.html` rather than the chunk: the chunk's filename carries a
  // content hash and so is not a fixed path, while the HTML that names the hash
  // is rewritten by the same build. Against the SOURCE TREE rather than one
  // file, because the bundle's inputs are every module reachable from
  // `main.tsx`, and naming one of them would be a guard that passes whenever
  // the edit landed in a sibling.
  ['packages/ui/src', 'apps/desktop/dist/renderer/index.html', 'bundler'],
];

/** @type {BuildEdge[]} */
export const CANVAS_PIXELS_RUNTIME = [
  ['apps/desktop/src/preload.ts', 'apps/desktop/dist/preload.cjs', 'bundler'],
  ['apps/desktop/src/window.ts', 'apps/desktop/dist/window.js', 'tsc'],
  ['apps/desktop/src/composition.ts', 'apps/desktop/dist/composition.js', 'tsc'],
  ['apps/desktop/src/canvasHarness.ts', 'apps/desktop/dist/canvasHarness.js', 'tsc'],
  ['apps/desktop/src/canvasHarnessMain.ts', 'apps/desktop/dist/canvasHarnessMain.js', 'tsc'],
  ['packages/ui/src', 'apps/desktop/dist/renderer/index.html', 'bundler'],
];

/**
 * The adapter `pdfiumAdapter.proof.mjs` and `editFidelity.proof.mjs` drive.
 *
 * One edge, because both proofs import exactly one built module and everything
 * they assert lives in it. A wider list would refuse a stale build over a file
 * neither can observe, which is the direction that gets a guard turned off.
 *
 * @type {BuildEdge[]}
 */
export const PDFIUM_ADAPTER = [
  ['packages/kernel/src/pdfiumFfi.ts', 'packages/kernel/dist/pdfiumFfi.js', 'tsc'],
];

/**
 * The routing a PDFium COMMAND is dispatched through, plus the adapter beneath
 * it.
 *
 * Three edges rather than one, because `pdfiumCommand.proof.mjs`'s subject is
 * the pair: an adapter that edits correctly and an execution that hands it the
 * right session are different facts. A stale `pdfiumSpecs.js` would dispatch
 * yesterday's routing against today's adapter and report it as this diff's
 * answer — which is the shape this whole module exists to refuse, arriving one
 * layer above the boundary rather than at it.
 *
 * `commandDeclarations.js` is here because the proof reads the routing table
 * before it runs anything through it: a case asserting `writer === 'pdfium'`
 * against a stale build is a case asserting what the table used to say.
 *
 * @type {BuildEdge[]}
 */
export const PDFIUM_COMMAND = [
  ['packages/kernel/src/pdfiumFfi.ts', 'packages/kernel/dist/pdfiumFfi.js', 'tsc'],
  ['packages/kernel/src/pdfiumSpecs.ts', 'packages/kernel/dist/pdfiumSpecs.js', 'tsc'],
  ['packages/kernel/src/pdfiumTextEdit.ts', 'packages/kernel/dist/pdfiumTextEdit.js', 'tsc'],
  [
    'packages/kernel/src/commandDeclarations.ts',
    'packages/kernel/dist/commandDeclarations.js',
    'tsc',
  ],
];

/**
 * The substrate `lineAgreement.mjs` scores this application's reading through.
 *
 * The instrument's whole subject is what `textStructure.ts` produces, so a stale
 * build would score the previous parser and attribute the answer to this one.
 *
 * **THE COMMENT HERE USED TO SAY that `textLayerBounds.mjs` imports the same
 * built module and does not guard it, "recorded rather than fixed in passing".**
 * A comment naming a gap is not a mechanism, and this one failed the disclaimer
 * test badly — it could have been written before the change it sat in. Finding
 * CCCCCC-4 closed it: `textLayerBounds.mjs`, `textFrames.mjs` and
 * `textLayerAgreement.mjs` all take this edge now, and
 * `buildFreshness.proof.mjs` derives the requirement from the scripts that
 * IMPORT a build rather than from the scripts that call the guard.
 *
 * @type {BuildEdge[]}
 */
export const TEXT_STRUCTURE = [
  ['packages/kernel/src/textStructure.ts', 'packages/kernel/dist/textStructure.js', 'tsc'],
];

/**
 * The rule that says what a page is made of, beside the parser that reads it.
 *
 * A separate pair rather than a widened `TEXT_STRUCTURE`: every other consumer
 * of that list reads the parser and not this, and adding a source to a shared
 * list makes those callers refuse for a file they never import. The proof that
 * needs both takes both, and its `expected` count says so at the call site.
 *
 * @type {BuildEdge[]}
 */
export const PAGE_KIND = [
  ['packages/kernel/src/pageKind.ts', 'packages/kernel/dist/pageKind.js', 'tsc'],
];

/**
 * The declarations `contract.proof.mjs`' probes are compiled against.
 *
 * Its probes name `ContractHandlers`, `ContractClient`, `Command` and
 * `CommandOfKind`, all of which the barrel re-exports from these two modules —
 * so the pair is what a probe's `import type` actually resolves to, and a `dist`
 * older than either makes the whole file a confident statement about a contract
 * that has been superseded.
 *
 * **The `.d.ts` rather than the `.js`, which is the difference from every other
 * edge here.** Nothing in this proof executes contract code: `tsc` type-checks
 * against declarations and never loads a module. An edge naming the JavaScript
 * would be watching an artefact this proof does not read, which is the shape
 * that reports the reassuring answer.
 *
 * @type {BuildEdge[]}
 */
export const CONTRACT_TYPES = [
  ['packages/contract/src/channels.ts', 'packages/contract/dist/channels.d.ts', 'tsc'],
  ['packages/contract/src/commands.ts', 'packages/contract/dist/commands.d.ts', 'tsc'],
];

/**
 * `packages/shared`'s barrel, for an instrument that reads geometry through it.
 *
 * A directory source rather than the one module, because the barrel re-exports
 * and an edit two files away is the change a named file would miss.
 *
 * @type {BuildEdge[]}
 */
export const SHARED_INDEX = [
  ['packages/shared/src', 'packages/shared/dist/index.js', 'tsc'],
];

/**
 * Which sources a proof reads **through a build** rather than through an import.
 *
 * ## Why this map exists, and it is not a convenience (finding PPPPP-2)
 *
 * `affectedProofs.mjs` answers *which proofs does this change reach* by walking
 * `import` specifiers. Asked about `packages/ui/src/App.tsx`, about
 * `renderPage.ts`, about `main.tsx` and about `apps/desktop/src/windowPolicy.ts`
 * — the file `proof:rendererpolicy` exists to check — it returned an **empty
 * list for every one**, with its positive control passing and `examined: 90`
 * correct. The instrument could see; it was looking at the wrong kind of edge.
 *
 * A proof that spawns Electron and reads `apps/desktop/dist/` depends on a
 * source tree through the **build**, and a build is not an import. That is X-1's
 * axis again — pattern, root, state — where the root is a *kind of dependency*
 * rather than a directory, and the answer it produced was the reassuring one:
 * an empty list reads as *nothing to run*.
 *
 * ## Why it lives HERE and not in the instrument that consumes it
 *
 * The edges were already written down, twice, as {@link refuseStaleBuild}'s pair
 * lists — which is the same fact, since a proof declares a pair exactly when its
 * output depends on that source. A third copy inside `affectedProofs.mjs` would
 * be a second opinion about what a proof reads, agreeing with these until the day
 * somebody added a pair to one and not the other (B3a).
 *
 * So the pairs are declared once, above; the freshness guard takes the artefact
 * side and the advisor takes the source side. Neither can drift from the other,
 * because there is no other.
 *
 * @type {Record<string, readonly BuildEdge[]>}
 */
export const ARTEFACT_EDGES = {
  'proof:rendererpolicy': [...RENDERER_POLICY_DECLARATION, ...RENDERER_POLICY_RUNTIME],
  'proof:canvaspixels': CANVAS_PIXELS_RUNTIME,
  // THE THIRD, MISSING FOR AS LONG AS `renderGeometry.proof.mjs` HAS EXISTED.
  // It calls `refuseStaleBuild` with `CANVAS_PIXELS_RUNTIME` — the same edges,
  // for the same reason — and had no entry here, so `stepOrder.mjs` could not
  // order it after the build. Measured 2026-09-06 in a full `npm run local`: it
  // ran at 1.2s against a build that finished at 34.0s and refused, correctly,
  // as stale.
  //
  // The map is what the ordering derives from, and this map is HAND-KEPT while
  // the failure it must catch is an OMISSION from it — audit item 4c in the
  // direction the rule warns about, since a derived extent tracks growth and
  // agrees with any shrink. So an entry added here is not the fix; the anchor
  // in `buildFreshness.proof.mjs` is, and it comes from the set of proofs that
  // IMPORT `refuseStaleBuild`, which an omission here cannot reach.
  'proof:rendergeometry': CANVAS_PIXELS_RUNTIME,
  // THE FOURTH, and it is the anchor above working rather than a reader
  // remembering: `proof:pdfiumadapter` was registered with its refuseStaleBuild
  // call and without this entry, and `buildFreshness.proof.mjs` named it on its
  // first run — from the set of proofs that IMPORT the guard, which no omission
  // here can reach.
  'proof:pdfiumadapter': PDFIUM_ADAPTER,
  // The command proof drives the ROUTING above the same adapter, so its edges
  // are the adapter's plus the two modules that dispatch to it and the table
  // that says they should.
  'proof:pdfiumcommand': PDFIUM_COMMAND,
  // The object commands read the same built modules through the same routing,
  // so the same edges: the adapter, the two that dispatch to it, and the table
  // that says they should.
  'proof:pdfiumobject': PDFIUM_COMMAND,
  // The fidelity proof drives the same built adapter, and reads pixels rather
  // than text: it is the guard that an edit does not silently redraw the page.
  'proof:editfidelity': PDFIUM_ADAPTER,
  'proof:lineagreement': TEXT_STRUCTURE,
  // The bounds instrument reads the same built parser and had no edge until
  // CCCCCC-4, which is what made the requirement derive from the scripts that
  // import a build rather than from the ones that already call the guard.
  'proof:textbounds': TEXT_STRUCTURE,
  // THE SIXTH, and the anchor named it on its first run again — registered with
  // its `refuseStaleBuild` call and without this entry, exactly as
  // `proof:pdfiumadapter` was. It reads the built parser AND the built rule
  // that classifies a parsed page — two sources, because a change to the rule
  // alone would otherwise leave the guard quiet about the file the proof is
  // most about.
  'proof:scannedpages': [...TEXT_STRUCTURE, ...PAGE_KIND],
  // THE COMPILE-FAIL PROOF, whose probes `import type … from '@monstera/contract'`
  // and are compiled by a spawned `tsc`. That import resolves to the package's
  // built declarations, so this proof reads the same artefact every other entry
  // here does — it simply reads it through a compiler instead of through
  // `import`.
  //
  // It had NO entry until 2026-09-09 and no `refuseStaleBuild` call either,
  // which cost twice. A stale `dist` made every case assert about a previous
  // contract while reporting on this one; and `affectedProofs.mjs` could not
  // name it for a contract change, because the walk it does is over import
  // specifiers and this script imports nothing from the package it tests. The
  // second cost is the one that was met — a channel added, the proof red, and
  // the sweep's affected list silent.
  'proof:contract': CONTRACT_TYPES,
};

/**
 * The source paths a proof reads through a build, or an empty list.
 *
 * @param {string} proof a `proof:*` script name
 * @returns {readonly string[]} repo-relative, forward slashes
 */
export function builtSourcesFor(proof) {
  return (ARTEFACT_EDGES[proof] ?? []).map(([source]) => source);
}

/**
 * The kernel modules `roleMainService.mjs` measures.
 *
 * Not in {@link ARTEFACT_EDGES}: that map answers *which proof reads which
 * build* for `affectedProofs.mjs`, and these three lists belong to scripts that
 * are not proofs. Same rule, different question.
 *
 * @type {BuildEdge[]}
 */
export const ROLE_MAIN_SERVICE = [
  ['packages/kernel/src/documentService.ts', 'packages/kernel/dist/documentService.js', 'tsc'],
  // The supervisor too: it holds the only mint of the capability this role
  // uses, and a stale build answers confidently about a previous one.
  ['apps/desktop/src/engineSessions.ts', 'apps/desktop/dist/engineSessions.js', 'tsc'],
];

/**
 * The modules `roleMupdfHost.mjs`'s `--host` cell drives.
 *
 * @type {BuildEdge[]}
 */
export const ROLE_MUPDF_HOST = [
  ['packages/kernel/src/host/hostEntry.ts', 'packages/kernel/dist/host/hostEntry.js', 'tsc'],
  [
    'apps/desktop/src/engineHostConnection.ts',
    'apps/desktop/dist/engineHostConnection.js',
    'tsc',
  ],
];

/**
 * The shared contrast formula `tokenContrast.mjs` evaluates the token file with.
 *
 * @type {BuildEdge[]}
 */
export const TOKEN_CONTRAST = [
  ['packages/shared/src/colour.ts', 'packages/shared/dist/colour.js', 'tsc'],
];

/**
 * What `scripts/launch.mjs` hands Electron, and where each half comes from.
 *
 * ## Why the launcher takes this guard at all
 *
 * Every other caller here is an instrument, and the argument for them is that a
 * stale artefact answers a probe confidently about the previous build. The
 * launcher's version of that is worse rather than milder: a person runs it,
 * sees the last build's behaviour, and has no probe output to compare against —
 * the only observable is a window, which looks identical either way. A
 * developer who edits a file and reaches for the run command is the exact HH-6
 * shape with the diagnostic removed.
 *
 * ## The sources are TREES, and that is the difference from the proof lists
 *
 * A proof reads a named artefact and declares the one or two files it is about.
 * The launcher loads the whole application, so naming `entry.ts` would be a
 * guard that passes whenever the edit landed in a sibling — which is nearly
 * always. The tsc pairs are therefore package source trees, and the compiler
 * arbitrates whenever a timestamp moved without content changing.
 *
 * Five projects, not one: `tsc --build --dry` is only consulted for a pair
 * whose mtime comparison already failed, so a stale `shared` build is invisible
 * to a pair anchored on `apps/desktop/src`. One pair per project is what makes
 * the compiler reachable from wherever the edit landed.
 *
 * ## The stated limit
 *
 * `packages/shared` and `packages/contract` are inputs to the **renderer
 * bundle** as well, and the bundled pair below is anchored on `packages/ui/src`
 * alone. Editing shared and rebuilding nothing is caught by shared's own tsc
 * pair, so the launch still refuses — but it refuses naming tsc, and the
 * renderer bundle is stale for a reason this list does not say out loud. The
 * existing renderer pair lists have the same shape, and widening them is one
 * change across all of them rather than a special case here.
 *
 * @type {BuildEdge[]}
 */
export const SHELL_LAUNCH = [
  ['apps/desktop/src', 'apps/desktop/dist/entry.js', 'tsc'],
  ['packages/kernel/src', 'packages/kernel/dist/index.js', 'tsc'],
  ['packages/contract/src', 'packages/contract/dist/index.js', 'tsc'],
  ['packages/shared/src', 'packages/shared/dist/index.js', 'tsc'],
  ['packages/nodemode/src', 'packages/nodemode/dist/index.js', 'tsc'],
  ['apps/desktop/src/preload.ts', 'apps/desktop/dist/preload.cjs', 'bundler'],
  ['packages/ui/src', 'apps/desktop/dist/renderer/index.html', 'bundler'],
];

/**
 * The newest mtime at `path`, walking it if it is a directory.
 *
 * `dist` and `node_modules` are skipped: the first is the artefact side of the
 * comparison and would make every tree newer than its own output, and the
 * second is not source.
 *
 * @param {string} path
 * @returns {number}
 */
export function newestMtime(path) {
  const entry = statSync(path);
  if (!entry.isDirectory()) return entry.mtimeMs;

  // FILES ONLY — a directory's own mtime is not seeded here, and it is a second
  // route to the same false alarm rather than the same one. A directory's
  // timestamp moves when a file is CREATED IN or REMOVED FROM it, so a new test
  // bumps the tree even with the test itself excluded below; editing one does
  // not. Measured 2026-08-29 by restoring the seed: `touch` on an existing test
  // passes, and creating `__scratch_probe.test.ts` stops the proof dead.
  let newest = 0;
  for (const name of readdirSync(path)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    // A TEST IS NOT AN INPUT TO THE BUNDLE, and including one makes this guard
    // fire for an edit that cannot change the artefact. Measured 2026-08-29 by
    // disabling this line: build, `touch renderPage.test.ts`, and the proof
    // stops dead on a build that is current. A guard that cries wolf is one
    // somebody turns off, which would cost the real staleness it was added for.
    if (/\.test\.tsx?$/u.test(name)) continue;
    const at = newestMtime(join(path, name));
    if (at > newest) newest = at;
  }

  // AN EMPTY WALK IS A BROKEN LOOKUP, NOT A FRESH BUILD (finding KKKKK-2).
  //
  // `statSync` above is loud about a path that does not exist. What is silent is
  // a directory that EXISTS and yields nothing — every entry skipped as
  // `node_modules`, `dist`, `.git` or a test, or simply empty. This used to
  // return 0, and 0 never exceeds an artefact's timestamp, so the pair passed.
  // The reassuring answer here is *the build is current*, and an exclusion list
  // that grew until it swallowed a whole tree would produce it on every run
  // while the guard reported nothing wrong.
  //
  // Latent when it was found — `packages/ui/src` holds plenty of ordinary files
  // — and closed anyway, because the skip list is the thing that gets widened
  // and this is the check two proofs now trust before reading a bundle.
  if (newest === 0) {
    throw new Error(
      `${path} contains no file this walk can date. Everything under it was skipped as ` +
        `node_modules, dist, .git or a test, or the directory is empty.\n` +
        `That is a broken lookup, not a current build: a walk returning nothing compares as ` +
        `"not newer than the artefact", so the freshness check would pass without having ` +
        `looked at anything. Point it at a directory that holds source, or narrow the skip ` +
        `list back.`,
    );
  }
  return newest;
}

/**
 * Refuses to run against a build older than the source it was made from.
 *
 * ## The one failure a positive control cannot catch
 *
 * A proof that drives the running shell produces the strongest evidence this
 * repository has. It is also evidence about **whatever was built**, and a stale
 * artefact answers every probe confidently and correctly about the previous
 * version. `CLAUDE.md` names this exactly: a stale answer contains the
 * known-present anchor too, so no amount of "locate something you know is there"
 * separates it.
 *
 * The gap is not hypothetical and it has a specific shape. `npm run build` is
 * `typecheck` **plus** `build:preload` **plus** `build:renderer`; `npm run
 * typecheck` alone is what the Commands section shows and what habit reaches
 * for. Editing `preload.ts` and running only `typecheck` leaves `preload.cjs`
 * untouched — the bridge still loads, every case still passes, and they pass
 * about the old preload (finding HH-6).
 *
 * ## Freshness, compared the only way that means anything
 *
 * Source must not be **strictly newer** than the artefact built from it. Ties
 * pass: a build completing inside one filesystem timestamp tick is not evidence
 * of staleness, and a check that fails on granularity is a check someone turns
 * off.
 *
 * A missing artefact is reported as missing rather than as fresh — "could not
 * compare" must not read as "compared and agreed".
 *
 * ## A source may be a DIRECTORY, and the renderer bundle is why
 *
 * `preload.cjs` has one source file. The Vite bundle has a tree — every module
 * reachable from `main.tsx` — so its freshness is decided by the newest file
 * under it, not by one path somebody picked. Naming a single file there would be
 * a guard that passes whenever the edit happened to land in a sibling.
 *
 * ## `expected` is an anchor, and it is per CALL SITE rather than per caller
 *
 * `rendererPolicy.proof.mjs` alone has two, and that is deliberate: its string
 * half runs on every machine and reads `windowPolicy.js` alone, so demanding a
 * preload there would fail every runner that installs nothing. A single count
 * inside this function would therefore be wrong for one of them.
 *
 * The literal exists because the list is **hand-kept and the danger runs toward
 * growth** (rule 4c): the failure is an artefact arriving with nobody adding a
 * row, which is finding GGGGG-1 — two cases began reading the Vite bundle and
 * the list did not follow. A count derived from `pairs.length` agrees with any
 * list, including the one that is missing an entry.
 *
 * @param {string} repoRoot absolute path to the repository root
 * @param {readonly BuildEdge[]} pairs `[source, artefact, producer]`,
 *   both repo-relative. A directory source is walked; a file source is read.
 * @param {number} expected how many pairs this call site declares.
 * @param {{ compilerSaysCurrent?: (repoRoot: string) => boolean }} [options]
 *   `compilerSaysCurrent` is injected so the escape hatch can be exercised in
 *   both directions. A fixture tree is not a TypeScript solution, so the real
 *   one answers *no* there for a reason that has nothing to do with the case —
 *   which would leave the hatch untested rather than tested.
 * @returns {void}
 */
export function refuseStaleBuild(repoRoot, pairs, expected, options = {}) {
  const askCompiler = options.compilerSaysCurrent ?? typescriptSaysCurrent;
  if (pairs.length !== expected) {
    throw new Error(
      `refuseStaleBuild received ${String(pairs.length)} pair(s) where the call site declares ` +
        `${String(expected)}. Raise the literal in the same edit that adds a pair; if you are ` +
        `removing one, say why in the commit.`,
    );
  }
  for (const [source, artefact, producer] of pairs) {
    const sourcePath = join(repoRoot, source);
    const artefactPath = join(repoRoot, artefact);
    if (!existsSync(artefactPath)) {
      throw new Error(
        `${artefact} does not exist. Run \`npm run build\` — which is \`typecheck\` plus ` +
          `\`build:preload\` plus \`build:renderer\`, and not \`typecheck\` alone.`,
      );
    }
    const sourceAt = newestMtime(sourcePath);
    const artefactAt = statSync(artefactPath).mtimeMs;
    if (sourceAt <= artefactAt) continue;

    // THE MTIME SAID STALE. ASK WHETHER IT IS.
    //
    // A newer source is not evidence that the output is old. A checkout, a
    // `git stash pop` and a formatter rewriting a file identically all move a
    // timestamp without changing content, and `tsc --build` correctly leaves
    // the output alone — after which this comparison reddens on a tree that is
    // current, and the documented answer was `--force`, which is a rebuild
    // somebody performs to satisfy a check rather than to fix anything.
    //
    // **The authority on whether tsc's output is current is tsc** (B3a). It is
    // asked once per process and only when the cheap comparison has already
    // said no, so the ordinary path costs nothing.
    //
    // Only for `tsc` pairs, and the producer is DECLARED rather than inferred
    // from the extension: esbuild and Vite rewrite their outputs on every run,
    // so for a bundled pair the timestamps are the whole truth and tsc's answer
    // is about a different build.
    if (producer === 'tsc' && askCompiler(repoRoot)) continue;

    throw new Error(
      // "This proof" until 2026-09-08, when the launcher became a caller and
      // the noun stopped being true: a person reading this is not running a
      // proof, and being told their cases would pass is one more thing to
      // decode before the instruction. The sentence says what happens instead.
      `${artefact} is OLDER than ${source}, so what runs next would be the PREVIOUS build — ` +
        `every check passing, and every window showing, the shell as it was.\n  ` +
        `${source}: ${new Date(sourceAt).toISOString()}\n  ` +
        `${artefact}: ${new Date(artefactAt).toISOString()}\n` +
        `Run \`npm run build\` — \`npm run typecheck\` produces neither the preload bundle nor ` +
        `the renderer bundle, and those are ${producer === 'tsc' ? 'not' : ''} what this pair ` +
        `is.\n` +
        `${
          producer === 'tsc'
            ? 'tsc was asked directly and says a build IS owed, so this is real staleness ' +
              'rather than a timestamp that moved on its own.'
            : 'A bundled artefact is rewritten on every build, so its timestamp is the whole ' +
              'truth and there is nothing else to consult.'
        }`,
    );
  }
}

/**
 * Whether `tsc --build` would rebuild anything, memoised per process.
 *
 * `--dry` reports one line per project and never writes. Current means **every**
 * project says so: a single line that does not is a project that would be
 * built, and treating a partially-stale solution as fresh is the reassuring
 * answer this whole module exists to refuse.
 *
 * A failure to run it is NOT fresh. `npx` missing, a config error, a non-zero
 * exit — every one of them means the question was not answered, and the caller
 * falls back to the timestamp comparison it already made, which is the
 * conservative direction.
 *
 * @param {string} repoRoot
 * @returns {boolean}
 */
function typescriptSaysCurrent(repoRoot) {
  if (tscCurrent !== null) return tscCurrent;
  // THE PINNED COMPILER BY PATH, not `npx tsc` through a shell. Two reasons and
  // both are this repository's own rules: PATH deciding which binary answers a
  // question is invariant 23's objection to a filename selecting native code,
  // one domain over; and `shell: true` is what Node deprecates for argument
  // escaping (DEP0190), printed on every run of three proofs.
  const compiler = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(compiler)) {
    tscCurrent = false;
    return tscCurrent;
  }
  const run = spawnSync(process.execPath, [compiler, '--build', '--dry'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120_000,
  });
  const lines = `${run.stdout ?? ''}`
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  tscCurrent =
    run.status === 0 && lines.length > 0 && lines.every((line) => line.includes('is up to date'));
  return tscCurrent;
}

/** @type {boolean | null} */
let tscCurrent = null;
