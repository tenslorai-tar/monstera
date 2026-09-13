import type { Handlers } from '@monstera/contract';

import { type ComposePageSize, MarkdownComposeRefused } from '../markdownCompose.js';
import type { ComposeChannels } from './composeChannels.js';
import type { ContainmentProbePaths, ContainmentReport } from './containment.js';
import type { HostArea, HostFilesystem, HostSessions } from './engineHandlers.js';

/**
 * The compose host's handlers
 * ([ADR-0060](../../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
 *
 * ## The probe and the area are PDFium's handlers, line for line
 *
 * `pdfiumHandlers.ts` records that `engine/probe-containment` is the one handler
 * literally identical between hosts, and that a shared module holding one function
 * would be an abstraction with a copy on either side of it. `open` and `close` are
 * the byte-image shape — register an area, forget it — for the same reason.
 *
 * ## The composer is INJECTED
 *
 * A handler proof must be able to drive this channel without laying out a page,
 * and a composer that throws something other than a refusal must be reachable by a
 * case. So the entry hands in `composeMarkdown`, as PDFium's entry hands in its
 * readers.
 */

/** How this process sets a Markdown source as PDF bytes. `composeMarkdown` in the host. */
export type MarkdownComposer = (source: Uint8Array, page: ComposePageSize) => Promise<Uint8Array>;

/** What the compose host's handlers are built from. */
export interface ComposeHandlerParts {
  /** The granted areas this host holds. It holds no parse, so areas and nothing else. */
  readonly areas: HostSessions<HostArea>;
  /** How this process reads and writes inside the directories it was granted. */
  readonly files: HostFilesystem;
  /** How this process attempts the two paths ADR-0023 §5's check names. */
  readonly probe: (paths: ContainmentProbePaths) => Promise<ContainmentReport>;
  /** How this process composes a Markdown source. */
  readonly composeMarkdown: MarkdownComposer;
}

export function createComposeHandlers({
  areas,
  composeMarkdown,
  files,
  probe,
}: ComposeHandlerParts): Handlers<ComposeChannels> {
  // THE MISS IS RETURNED, NEVER THROWN — `engineHandlers.ts`' rule: a throw
  // crossing this boundary becomes `internal` with its diagnostic withheld, and a
  // missing area is a code main can act on.
  const gone = { ok: false, error: { code: 'no-such-session' } } as const;

  return {
    // NO try/catch, for `pdfiumHandlers.ts`' reason: every outcome is already one
    // of `ProbeOutcome`'s states, and a catch could only turn an observation into
    // `internal`.
    'engine/probe-containment': async ({ positive, negative, loopbackPort }) => ({
      ok: true,
      value: await probe({ positive, negative, loopbackPort }),
    }),

    // AN AREA AND NOTHING ELSE, `pdfiumHandlers.ts`' open: there is no document at
    // this moment, so there is nothing that can fail.
    'engine/open': ({ snapshotDirectory, outputDirectory }) =>
      Promise.resolve({
        ok: true,
        value: { session: areas.issue({ outputDirectory, snapshotDirectory }) },
      }),

    'engine/close': ({ session }) => {
      if (areas.lookup(session) === undefined) return Promise.resolve(gone);
      areas.forget(session);
      return Promise.resolve({ ok: true, value: {} });
    },

    'engine/compose-markdown': async ({ session, from, into, page }) => {
      const held = areas.lookup(session);
      if (held === undefined) return gone;

      let source: Uint8Array;
      try {
        source = await files.readSnapshot(held.snapshotDirectory, from);
      } catch {
        // OURS, NOT THE FILE'S: main wrote the source and it went, or main did
        // not write it. A person's Markdown cannot produce this code.
        return { ok: false, error: { code: 'asset-missing' } };
      }

      let pdf: Uint8Array;
      try {
        pdf = await composeMarkdown(source, page);
      } catch (error) {
        // ONLY A NAMED REFUSAL IS AN ANSWER. Anything else is a defect in this
        // build, and it propagates so the body reports `internal` rather than
        // dressing a fault up as a fact about the person's file.
        if (error instanceof MarkdownComposeRefused) {
          return { ok: true, value: { kind: 'refused', reason: error.reason, line: error.line } };
        }
        throw error;
      }

      const bytes = await files.writeOutput(held.outputDirectory, into, pdf);
      return { ok: true, value: { kind: 'composed', bytes } };
    },
  };
}
