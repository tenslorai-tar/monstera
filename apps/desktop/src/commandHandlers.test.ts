import { HostConnectionLost } from '@monstera/kernel';
import { asDocId } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { executeCommandHandler } from './commandHandlers.js';
import type { DocumentCommands } from './documentCommands.js';

/**
 * `document.execute`'s answer when the engine host's call ends (ADR-0253): a memory kill is the declared `out-of-memory`
 * with the computer's figures; any other ending is rethrown, which the boundary answers as `internal` with a reference.
 */
function endingWith(termination: ConstructorParameters<typeof HostConnectionLost>[0]): DocumentCommands {
  // ONE METHOD IS THE SURFACE these cases reach; the rest of the class is not called.
  const commands: Pick<DocumentCommands, 'execute'> = { execute: () => Promise.reject(new HostConnectionLost(termination)) };
  return commands as DocumentCommands;
}

const request = { docId: asDocId('doc-a'), command: { kind: 'rotatePages' as const, pages: [0], quarterTurns: 1 as const } };

describe('a host that ends during a command', () => {
  it('killed at its memory budget, the command answers out-of-memory with the computer’s figures', async () => {
    const answer = await executeCommandHandler(endingWith({ code: 'memory-budget', detail: 'the sampler killed it' }))(request);
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.error.code).toBe('out-of-memory');
    expect('detail' in answer.error && answer.error.code === 'out-of-memory' ? answer.error.detail.totalBytes : 0).toBeGreaterThan(0);
  });

  it('CONTROL: ended for any other reason, the failure is rethrown, which the boundary answers as internal', async () => {
    await expect(
      executeCommandHandler(endingWith({ code: 'connection-lost', detail: 'the pipe closed' }))(request),
    ).rejects.toBeInstanceOf(HostConnectionLost);
  });
});
