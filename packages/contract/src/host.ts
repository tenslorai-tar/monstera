/**
 * The contract as an ENGINE HOST takes it: everything except the renderer's surfaces.
 *
 * ## What is left out, and why a host must not load it
 *
 * `channels.ts` builds the renderer's whole channel map at module scope — every params
 * and result schema of every renderer-facing channel — and `events.ts` the second
 * direction's. No engine host serves either: a host speaks its own channel set over its
 * pipe (`engineChannels.ts`, `pdfiumChannels.ts`, `composeChannels.ts` in the kernel) and
 * takes command schemas, the frame, the host protocol and the boundary discipline.
 *
 * Measured 2026-09-19, a bare Node process importing one built module (fresh process,
 * after a forced collection): `channels.js` **+33.2 MB** of resident set and `commands.js`
 * **+19.1 MB**, the difference being the renderer map. zod builds each schema instance with
 * its own method closures, so the cost is per schema and grows with every channel added:
 * the package root read **10.3 MB** at `f6eddab` (2026-09-01), **30.9 MB** at `1586ffd`
 * (2026-09-13) and **33.3 MB** at `55216b4`. Every host paid it through the root, and the
 * contained MuPDF host's fixed cost went from 85–90 MB on `windows-latest` (2026-09-01) to
 * 124.6–129.0 MB (CI at `55216b4`), past §9.17's `base 128 MB`.
 *
 * With this entry and `mupdfSpecs.ts` (the host's other route), `npm run perf:gate` on the
 * build machine, 2026-09-19, fresh build each side: `mupdf-host-real`'s baseline
 * **126.9 / 125.8 MB** at `55216b4` → **110.4 / 110.8 MB** after, on the two fixtures.
 *
 * ## The rule this entry makes checkable
 *
 * A module an engine host loads takes its contract VALUES from here and never from the
 * package root. `proof:hostload` walks each host entry's emitted graph and fails when any
 * module in it names `@monstera/contract` bare — `import { type X }` included, since that
 * spelling keeps the statement in the emit and loads the root (ADR-0026). `import type`
 * from the root is erased and stays legal.
 *
 * `export *` rather than a list, so that a symbol added to one of these modules is
 * reachable here without a second edit: the boundary is WHICH MODULES, and a list would
 * make it which names, which is a second declaration of the same fact.
 */
export * from './aiProviders.js';
export * from './boundary.js';
export * from './channel.js';
export * from './commands.js';
export * from './frame.js';
export * from './hostProtocol.js';
export * from './incident.js';
export * from './schemas.js';
