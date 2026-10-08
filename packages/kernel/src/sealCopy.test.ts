import type { CommandOfKind } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { type SealEngine, sealCopy } from './sealCopy.js';

/**
 * The one rule for sealing a copy a protect leaves behind (ADR-0171 Decision 8), against an engine that records what
 * it was asked. The rule's subject is which calls are made, so that is what each case asserts: a copy left alone and a
 * copy rewritten with the same bytes look alike on disk.
 */
function recording(access: number | 'locked'): { readonly engine: SealEngine<string>; readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    engine: {
      open: () => {
        calls.push('open');
        return Promise.resolve(access === 'locked' ? 'locked' : { session: 's', access });
      },
      protect: (_session, command) => {
        calls.push(`protect:${command.encryption}`);
        return Promise.resolve();
      },
      writeOver: () => {
        calls.push('writeOver');
        return Promise.resolve(1234);
      },
      close: () => {
        calls.push('close');
        return Promise.resolve();
      },
    },
  };
}

function protect(encryption: CommandOfKind<'setDocumentProtection'>['encryption']): CommandOfKind<'setDocumentProtection'> {
  return encryption === 'none'
    ? { kind: 'setDocumentProtection', encryption }
    : { kind: 'setDocumentProtection', encryption, userPassword: 'sample-only-seal' };
}

describe('sealCopy', () => {
  it('seals a plain copy under a protect that encrypts: protected, written over, and closed', async () => {
    const { engine, calls } = recording(1);
    await expect(sealCopy(protect('aes-256'), engine)).resolves.toBe(1234);
    expect(calls).toStrictEqual(['open', 'protect:aes-256', 'writeOver', 'close']);
  });

  it('leaves a copy that is encrypted already, needing a key or owner-only', async () => {
    for (const access of ['locked', 2] as const) {
      const { engine, calls } = recording(access);
      await expect(sealCopy(protect('aes-256'), engine)).resolves.toBeUndefined();
      expect(calls).not.toContain('writeOver');
    }
  });

  /**
   * RRRRRRR-7: a protect that removes encryption has nothing to seal, and rewriting a copy anyway is a whole save that
   * protects nothing and takes a signed backup's incremental structure with it. The copy is not even opened; the case
   * above is the control, the same plain copy rewritten under a protect that encrypts.
   */
  it('seals nothing, and opens nothing, under a protect that removes encryption', async () => {
    const { engine, calls } = recording(1);
    await expect(sealCopy(protect('none'), engine)).resolves.toBeUndefined();
    expect(calls).toStrictEqual([]);
  });
});
