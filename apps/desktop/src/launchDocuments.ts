import { win32 } from 'node:path';

import { MAX_LAUNCH_DOCUMENTS } from '@monstera/contract';

export { MAX_LAUNCH_DOCUMENTS };

/**
 * The documents a launch named on its command line — what a file association, *Open with* and a PDF dropped on the
 * application's icon all arrive as (`docs/ARCHITECTURE.md` §2: argv and file association are among the places *the
 * user or the app produces a path*, and every such path is minted into a handle by main's one open route).
 *
 * ## What counts, and why each rule is here
 *
 * - **Not the executable**, which is always first; and in a development run not the application folder either, which
 *   `scripts/launch.mjs` passes second. A packaged build has no such argument.
 * - **Not a switch.** Chromium and Windows add their own (`--allow-file-access-from-files`,
 *   `--original-process-start-time=…`) to a second instance's arguments, so anything beginning with `-` is theirs.
 * - **An absolute path only.** A relative one would resolve against whatever main's working directory is, which is
 *   nothing a person chose — `document.openDropped`'s rule, for the same reason.
 * - **A `.pdf` only**, matched case-insensitively: the association this build asks for is PDF's, and a launch naming
 *   any other file has not asked this application to open a document.
 * - **At most {@link MAX_LAUNCH_DOCUMENTS}, each once**, in the order given — the contract's bound on what
 *   `document.openWaiting` answers, so main never holds more than the channel can report.
 */
/** @param argv the process's arguments, as `process.argv` or the `second-instance` event gives them */
export function documentPathsIn(argv: readonly string[], packaged: boolean): string[] {
  const given = argv.slice(packaged ? 1 : 2);
  const paths = given.filter(
    (argument) => !argument.startsWith('-') && win32.isAbsolute(argument) && argument.toLowerCase().endsWith('.pdf'),
  );
  return [...new Set(paths)].slice(0, MAX_LAUNCH_DOCUMENTS);
}

/** The paths a launch named that the page has not yet asked main to open. */
export interface LaunchDocuments {
  /** Adds a later launch's paths, after the first launch's. */
  readonly add: (paths: readonly string[]) => void;
  /** Hands over every waiting path, once: a second call answers nothing until another launch adds some. */
  readonly take: () => string[];
}

/** @param first the paths the first launch named */
export function createLaunchDocuments(first: readonly string[]): LaunchDocuments {
  let waiting = [...first];
  return {
    add: (paths) => {
      waiting = [...waiting, ...paths].slice(0, MAX_LAUNCH_DOCUMENTS);
    },
    take: () => {
      const taken = waiting;
      waiting = [];
      return taken;
    },
  };
}
