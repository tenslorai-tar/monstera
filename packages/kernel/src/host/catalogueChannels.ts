import { z } from 'zod';
import { channel } from '@monstera/contract/host';

import { byteImageWire, hostAreaChannels, sessionSchema } from './engineChannels.js';

/**
 * The catalogue host's channels ([ADR-0293](../../../../docs/DECISIONS/0293-the-font-catalogue-is-read-once-by-a-host-that-holds-no-document-and-kept.md)):
 * ADR-0060 Decision 3's set one host further on. The probe and a granted area's `open` and `close` are the definitions
 * every host takes (`hostAreaChannels`, the byte-image wire's open); none of `apply`, `capture` or `invert`, since this
 * host changes no document; and its one channel of its own.
 */
export const catalogueChannels = {
  ...hostAreaChannels(byteImageWire),

  /**
   * Reads the font folders this host was started with and writes the catalogue into the area's output directory, named
   * by the fingerprint (`keptCatalogueName`), as one file written whole. `main` copies it from there by that name and
   * never reads the answer's count as anything but a count.
   *
   * ## The fingerprint is a name, so it is bounded to what names one
   *
   * SHA-256 hex, ADR-0237's: the file's name is built from it, so nothing else may reach a path.
   *
   * ## `no-faces` is an answer
   *
   * Folders that could not be read, or held no font, leave nothing worth keeping: a kept catalogue of no face would leave
   * every host choosing among nothing. Nothing is written, and the hosts read the folders as they do today.
   */
  'engine/keep-catalogue': channel(
    'Reads the font folders and writes their catalogue into the area, named by the fingerprint.',
    // `length` AS WELL AS THE PATTERN: the frame's bound is read from a schema's lengths, which a pattern does not state.
    z.object({ session: sessionSchema, fingerprint: z.string().length(64).regex(/^[0-9a-f]{64}$/u) }).strict(),
    z.object({ faces: z.number().int().min(1) }).strict(),
    ['no-such-session', 'no-faces'],
  ),
};

/** The catalogue host's channel map. */
export type CatalogueChannels = typeof catalogueChannels;
