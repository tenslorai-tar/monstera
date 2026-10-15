import type { ClientApi, CommandOfKind } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import type { EngineChannels } from './engineChannels.js';
import { ProtectionNotReproducible } from '../protectionRefusal.js';
import { createRemoteSessions, remotePdfLibHost, type SessionAssets } from './remoteEngine.js';

/**
 * What a hosted pdf-lib command tells the person beyond its result (ADR-0220): the host's answer carries
 * `permissionPasswordReplaced` only when the owner password was made up, and the remote layer turns exactly that into one
 * notice. The real engine's side of it (when the flag is set) is `proof:pdflibprotected`'s; the host's handler writing it
 * into the answer is `engineProtectedApply.test.ts`'s. This holds the third link, the one between them.
 */

// A PDF-LIB COMMAND: the page background, since the watermark moved to the MuPDF writer (ADR-0235).
// CHECKED AGAINST THE CONTRACT, so the next required field is a compile error here rather than a red suite (DDDDDDDD-5).
const COMMAND = { kind: 'setPageBackground', pages: 'all', red: 1, green: 1, blue: 0.9 } as const satisfies CommandOfKind<'setPageBackground'>;

const ASSETS: SessionAssets = {
  name: () => 'asset',
  write: () => Promise.resolve(),
  remove: () => Promise.resolve(),
};

function hostAnswering(answer: unknown) {
  const sessions = createRemoteSessions();
  const session = sessions.adopt('h1', { snapshotDirectory: 'snapshots', outputDirectory: 'output' });
  const told: string[] = [];
  const client = {
    'engine/applyPdfLib': () => Promise.resolve(answer),
  } as unknown as ClientApi<EngineChannels>;
  const host = remotePdfLibHost(
    client,
    sessions,
    { mintName: () => 'ab12', moveOutput: () => Promise.resolve(3), removeOutput: () => Promise.resolve() },
    ASSETS,
    {
      permissionPasswordReplaced: () => {
        told.push('permission-password-replaced');
      },
    },
  );
  return { run: () => host(session, COMMAND, undefined), told };
}

describe('a hosted pdf-lib command tells the person when the owner password was made up (ADR-0220)', () => {
  it('tells once per answer that says so', async () => {
    const { run, told } = hostAnswering({ ok: true, value: { bytes: 3, permissionPasswordReplaced: true } });
    await run();
    expect(told).toStrictEqual(['permission-password-replaced']);
  });

  it('CONTROL: an answer that does not say so tells nothing', async () => {
    const { run, told } = hostAnswering({ ok: true, value: { bytes: 3 } });
    await run();
    expect(told).toStrictEqual([]);
  });

  it('a refusal the host named comes back as the class it was, and tells nothing', async () => {
    const { run, told } = hostAnswering({ ok: false, error: { code: 'protection-not-reproducible' } });
    await expect(run()).rejects.toBeInstanceOf(ProtectionNotReproducible);
    expect(told).toStrictEqual([]);
  });
});
