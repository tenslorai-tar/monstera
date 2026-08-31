import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { EngineHostPlatform } from './composition.js';
import { createReaderHostSurface } from './readerHostSurface.js';
import { sweepSessionDirectories } from './sessionDirectories.js';
import { createWin32DirectorySurface } from './win32DirectorySurface.js';
import {
  createWin32HostSurface,
  electronBinaryOfThisProcess,
} from './win32HostSurface.js';
import {
  createWin32PipeSurface,
  createWin32WriteSurface,
  currentUserSid,
  hostContainerSid,
} from './win32PipeSurface.js';

/**
 * The Win32 half of the engine host, assembled — and the only reason this file
 * is separate from the composition root.
 *
 * ## Why it is not in `composition.ts`
 *
 * Every import below binds Win32 through `koffi` at module scope. The
 * composition root's stated property is that the whole object graph can be
 * built and inspected in a plain Node test on any platform, and a native
 * binding at the top of it would end that — including for `perf:gate`'s
 * main-service role, whose entire subject is what `main` costs before anything
 * happens.
 *
 * So the root imports `createEngineHostConnection`, whose own graph is free of
 * both Electron and `koffi`, and takes these four objects as a value. The
 * ORDERING is assembled where it can be read; only the foreign calls come from
 * here.
 *
 * ## Nothing here decides anything
 *
 * The surface shapes come from `scripts/research/lowboxSpike.mjs`, which made
 * these calls in this order against real processes long before this file
 * existed, and the sequence they are driven in is
 * [ADR-0023](../../../docs/DECISIONS/0023-how-the-contained-engine-host-is-built.md)
 * Decision 8's, implemented in `engineHostFactory.ts`. This file resolves four
 * values — a SID, a SID, a directory and a path — and hands over four objects.
 */

/** The AppContainer profile the engine hosts run inside. */
const CONTAINER = 'monstera-engine-host';

/**
 * Where the host's entry script sits, resolved THROUGH THE PACKAGE.
 *
 * The same idiom `readerEntryPath` uses, and for the same reason: a path built
 * by walking up from `__dirname` is one that breaks silently the day the build
 * layout moves, whereas a resolution failure names the package it could not
 * find.
 */
function hostEntryPath(): string {
  const entry = createRequire(import.meta.url).resolve('@monstera/kernel');
  return join(dirname(entry), 'host', 'hostEntry.js');
}

/**
 * @param sessionRoot where session directory pairs are created — a directory
 *   this process owns, whose children are each given their own DACL naming the
 *   container and nothing else. Passed in rather than resolved here because
 *   *where the app may write* is Electron's answer (`app.getPath`), and this
 *   file may not import Electron any more than the root may.
 * @returns the platform, or `null` where it cannot exist.
 */
export function createEngineHostPlatform(sessionRoot: string): EngineHostPlatform | null {
  // NOT A CAPABILITY CHECK WEARING A PLATFORM CHECK'S CLOTHES. The engine host
  // is a Win32 AppContainer process by ADR-0022, so on any other platform there
  // is nothing degraded to fall back to — `null` is what the root is built to
  // receive, and a document opened without one is poisoned rather than left
  // sessionless.
  if (process.platform !== 'win32') return null;

  const user = currentUserSid();
  if (!user.ok) return null;
  const container = hostContainerSid(CONTAINER);
  if (!container.ok) return null;

  const entry = hostEntryPath();
  const binary = electronBinaryOfThisProcess();
  mkdirSync(sessionRoot, { recursive: true });

  const directories = createWin32DirectorySurface();

  // THE PAIRS A DEAD RUN LEFT BEHIND, removed here because this is the moment
  // the root is established and there is exactly one instance to establish it.
  //
  // A pair is removed on close and on every failure path out of an open, so a
  // survivor means main died without unwinding. Nothing swept them, so one
  // granted pair accumulated per abnormal exit — each carrying a DACL naming
  // the AppContainer, each possibly holding a copy of a document.
  //
  // SAFE HERE ONLY BECAUSE OF THE ORDERING `startShell` NOW ENFORCES. This runs
  // inside the factory `startShell` calls after `requestSingleInstanceLock()`,
  // so the process running it owns every directory under the root. Called from
  // where this used to be constructed — as an argument, before the lock — a
  // second launch would have deleted the open documents of the first.
  //
  // The outcome is not reported anywhere yet: there is no incident sink at this
  // point in the graph, since this platform is one of the things the sink's
  // owner is built from. What a failed sweep costs is a directory that stays,
  // which is the state before this existed.
  sweepSessionDirectories(directories, sessionRoot);

  // THE NEGATIVE TARGET, written here rather than chosen from what happens to
  // exist. It sits directly in the session root, whose children are granted one
  // at a time and which is itself granted to nothing — so a host that reads it
  // has reach beyond what it was handed, which is invariant 25(d) failing.
  //
  // Written every launch, and its CONTENT is what makes the check work: main
  // reads this file immediately before asking, and a zero-byte negative makes
  // the classifier answer `unreadable` rather than `contained`. A file with
  // nothing in it would turn the whole check into the reassuring answer.
  const negative = join(sessionRoot, 'containment-negative');
  writeFileSync(negative, 'This file exists so that a host which can read it has been caught.\n');

  const pipes = createWin32PipeSurface();

  return {
    surfaces: {
      pipes,
      reader: createReaderHostSurface(),
      writesFor: createWin32WriteSurface,
      hostFor: (pipeName) =>
        createWin32HostSurface({
          executablePath: binary,
          commandArguments: [entry, pipeName],
          // Inside the grant set, for the reason the acceptance test's is: a
          // working directory of our own would be a path whose rights differ
          // from everything else the host can reach, and a difference nobody
          // chose is one nobody checks.
          workingDirectory: dirname(binary),
          containerName: CONTAINER,
          diagnosticPath: null,
        }),
    },
    user: user.value,
    container: container.value,
    sessionRoot,
    directories,
    probe: {
      // The host's own entry script: it is executing this file, so a refusal
      // here is premise P1 being false rather than a bug — which is exactly the
      // branch `install-root` selects, and why the origin is not decoration.
      positive: { path: entry, origin: 'install-root' },
      negative: { path: negative, origin: 'app-created' },
    },
  };
}
