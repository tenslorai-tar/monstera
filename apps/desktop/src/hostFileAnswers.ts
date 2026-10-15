import { randomBytes } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ChannelMap } from '@monstera/contract';
import { type ClientFileAnswers, type SessionArea, readAnnounced } from '@monstera/kernel';

/**
 * How main takes an engine host's file-routed answers
 * ([ADR-0125](../../../docs/DECISIONS/0125-an-answer-that-grows-with-the-document-crosses-in-a-file.md)).
 *
 * `routed` is the channel map's own declaration — never a guess by size. `take` reads the named file by
 * `readAnnounced`, the one reader of a host's output (B3a): one open, the size read from THAT handle and held to the
 * announced count, a read of exactly that many bytes, and a probe for one more. The announced size is already bounded
 * by the frame schema's ceiling, so a file that disagrees with it is a host writing other than it said. Reading by path
 * after a `stat` let the host grow or replace the file between the two and choose how much of `main`'s memory the read
 * spent (addendum 5's X1, a sibling of CR-SEC-08). The file is removed whether or not it was taken, because a
 * document's text left in a directory the host may read is a copy nobody holds.
 *
 * @param channels the host's channel map, whose `answer` field declares each route
 * @param areaFor the granted directories of the session a call's params name, or `undefined` for one not held
 * @param files the reader's file calls, so a case can stage the race; the application passes none
 */
export function fileAnswersFor(
  channels: ChannelMap,
  areaFor: (params: unknown) => SessionArea | undefined,
  files?: Parameters<typeof readAnnounced>[2],
): ClientFileAnswers {
  return {
    routed: (channel) => channels[channel]?.answer === 'file',
    // LOWER-CASE HEX, which is what `outputNameSchema` accepts: main mints every name a host writes under.
    mint: () => randomBytes(16).toString('hex'),
    take: async (params, name, bytes) => {
      const area = areaFor(params);
      if (area === undefined) throw new Error('an answer arrived for a session this host is not holding');
      // AN EXACTLY-SIZED ALLOCATION OF ITS OWN, so no copy is made of it (ADR-0121's addendum); removed on every path.
      return readAnnounced(join(area.outputDirectory, name), bytes, files);
    },
    requested: (channel) => channels[channel]?.request === 'file',
    // THE SNAPSHOT DIRECTORY, which the host may only read (ADR-0125's addendum): prior state going back to be
    // restored arrives by the door the document and an asset arrive by (ADR-0044).
    put: async (params, name, bytes) => {
      const area = areaFor(params);
      if (area === undefined) throw new Error('params for a session this host is not holding');
      await writeFile(join(area.snapshotDirectory, name), bytes);
    },
    drop: async (params, name) => {
      const area = areaFor(params);
      if (area !== undefined) await rm(join(area.snapshotDirectory, name), { force: true });
    },
  };
}
