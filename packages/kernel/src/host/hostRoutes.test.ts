import {
  ENGINE_HOST_FRAME_MAX_BYTES,
  commandSchema,
  hostRouteViolations,
  maxEncodedBytes,
  unboundedMembers,
} from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { composeChannels } from './composeChannels.js';
import { engineChannels } from './engineChannels.js';
import { pdfiumChannels } from './pdfiumChannels.js';

/**
 * EVERY CONTAINED HOST'S CHANNELS ARE ON A ROUTE THAT CAN CARRY WHAT THEIR SCHEMAS ADMIT (ADR-0125).
 *
 * The owner's install of 0.1.5.0 ended the PDFium host on Edit text because `engine/text-runs`' schema admitted far more
 * than a frame and a real page produced it. A channel added tomorrow with an unbounded result, framed, is the same
 * defect waiting for its document; this is the line that goes red the day it is declared rather than the day a person's
 * file finds it.
 */
const HOSTS = { 'MuPDF host': engineChannels, 'PDFium host': pdfiumChannels, 'compose host': composeChannels };

/**
 * THE ONE REQUEST-DIRECTION BOUND THAT STAYS, and it is not ADR-0125's to remove: the channels whose params carry a
 * COMMAND. A command is intent, and every member of the union is bounded except a page list, which scales with the
 * selection — so a whole-document selection meets the frame at about 43,600 pages, the bound `hostProtocol.ts` states
 * and finding AAA-1 decided against raising (a page-set encoding is the named remedy). Pinned by exact set, per host, so
 * a channel that joins this list is red and one that leaves it has to be taken off; and the case below holds the reason
 * true, so an unbounded TEXT field in a command cannot hide behind an entry written for page lists.
 */
const COMMAND_CARRYING: Readonly<Record<keyof typeof HOSTS, readonly string[]>> = {
  'MuPDF host': ['engine/apply', 'engine/capture', 'engine/applyPdfLib'],
  'PDFium host': ['engine/apply', 'engine/capture'],
  'compose host': [],
};

describe('the engine hosts’ declared routes', () => {
  for (const [host, channels] of Object.entries(HOSTS)) {
    it(`${host}: every answer's route carries what its schema admits`, () => {
      expect(hostRouteViolations(channels, ENGINE_HOST_FRAME_MAX_BYTES).filter((found) => found.direction === 'answer')).toStrictEqual([]);
    });

    it(`${host}: the only framed params that can outgrow a frame are the ones carrying a command`, () => {
      const requests = hostRouteViolations(channels, ENGINE_HOST_FRAME_MAX_BYTES)
        .filter((found) => found.direction === 'request')
        .map((found) => found.channel);
      expect(requests.sort()).toStrictEqual([...COMMAND_CARRYING[host as keyof typeof HOSTS]].sort());
    });
  }

  /** The anchor under {@link COMMAND_CARRYING}: its reason is a page list, and nothing else in a command is unbounded. */
  it('every unbounded member of the command union is a page list', () => {
    const unbounded = unboundedMembers(commandSchema, 'command');
    // THE CONTROL IS THE LIST ITSELF: fifteen commands take a page list, so an empty result is a blind read, not a pass.
    expect(unbounded.length).toBeGreaterThan(0);
    expect(unbounded.filter((path) => !/\.properties\.pages(\.anyOf\.\d+)?$/u.test(path))).toStrictEqual([]);
  });

  /**
   * THE WALK CAN SEE THE CHANNEL THE OWNER HIT. An empty list above is the reassuring answer, and a walk that answered
   * small for everything would print it too.
   */
  it('CONTROL: engine/text-runs admits more than a frame, so the empty lists above are the routes and not a blind walk', () => {
    expect(maxEncodedBytes(pdfiumChannels['engine/text-runs'].result, 1)).toBeGreaterThan(ENGINE_HOST_FRAME_MAX_BYTES);
  });

  /** The owner's defect, re-declared: the same channel framed, as it was in 0.1.5.0, is reported. */
  it('CONTROL: and engine/text-runs declared in the frame, as 0.1.5.0 shipped it, is reported', () => {
    const shipped = { 'engine/text-runs': { ...pdfiumChannels['engine/text-runs'], answer: 'frame' as const } };
    expect(hostRouteViolations(shipped, ENGINE_HOST_FRAME_MAX_BYTES)).toMatchObject([
      { channel: 'engine/text-runs', direction: 'answer' },
    ]);
  });

  /** Undo's pair, re-declared before its addendum: the prior framed back as invert's params is reported. */
  it('CONTROL: engine/invert with its params framed, as before the addendum, is reported', () => {
    const framed = { 'engine/invert': { ...engineChannels['engine/invert'], request: 'frame' as const } };
    expect(hostRouteViolations(framed, ENGINE_HOST_FRAME_MAX_BYTES)).toMatchObject([
      { channel: 'engine/invert', direction: 'request' },
    ]);
  });
});
