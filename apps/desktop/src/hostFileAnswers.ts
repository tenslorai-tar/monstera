import { randomBytes } from 'node:crypto';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ChannelMap } from '@monstera/contract';
import type { ClientFileAnswers, SessionArea } from '@monstera/kernel';

/**
 * How main takes an engine host's file-routed answers
 * ([ADR-0125](../../../docs/DECISIONS/0125-an-answer-that-grows-with-the-document-crosses-in-a-file.md)).
 *
 * `routed` is the channel map's own declaration — never a guess by size. `take` stats the named file before reading
 * it and refuses one that is not exactly the size the host announced: the announced size is already bounded by the
 * frame schema's ceiling, so a file that disagrees with it is a host writing other than it said, and reading it would
 * let the host choose how much of main's memory it spends. The file is removed whether or not it was taken, because a
 * document's text left in a directory the host may read is a copy nobody holds.
 *
 * @param channels the host's channel map, whose `answer` field declares each route
 * @param areaFor the granted directories of the session a call's params name, or `undefined` for one not held
 */
export function fileAnswersFor(
  channels: ChannelMap,
  areaFor: (params: unknown) => SessionArea | undefined,
): ClientFileAnswers {
  return {
    routed: (channel) => channels[channel]?.answer === 'file',
    // LOWER-CASE HEX, which is what `outputNameSchema` accepts: main mints every name a host writes under.
    mint: () => randomBytes(16).toString('hex'),
    take: async (params, name, bytes) => {
      const area = areaFor(params);
      if (area === undefined) throw new Error('an answer arrived for a session this host is not holding');
      const path = join(area.outputDirectory, name);
      try {
        const size = (await stat(path)).size;
        if (size !== bytes) {
          throw new Error(`the answer file holds ${String(size)} bytes where the host announced ${String(bytes)}`);
        }
        const read = await readFile(path);
        // A VIEW OF THE READ'S OWN BUFFER, never a copy: `readFile` answers an exactly-sized allocation it owns
        // (ADR-0121's addendum).
        return new Uint8Array(read.buffer, read.byteOffset, read.byteLength);
      } finally {
        await rm(path, { force: true });
      }
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
