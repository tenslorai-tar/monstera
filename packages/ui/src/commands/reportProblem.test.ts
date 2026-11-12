import { DOCUMENT_CLOSED_HERE } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { COMMAND_PROBLEM_DIALOG_ID } from '../dialogs/commandProblem.js';
import { reportProblem } from './documentCommands.js';

/**
 * The one door every report goes through (ADR-0294): a refusal for a document this window closed opens nothing, and
 * every other refusal still opens the problem dialog with what it was handed.
 */
function door() {
  const asked: { id: string; props: unknown }[] = [];
  const deps = {
    ask: (id: string, props: unknown) => {
      asked.push({ id, props });
      return Promise.resolve(undefined);
    },
  };
  return { deps, asked };
}

describe('reportProblem, the one door (ADR-0294)', () => {
  it('a refusal for a document this window closed opens nothing', () => {
    const { deps, asked } = door();
    reportProblem(deps, { code: DOCUMENT_CLOSED_HERE });
    expect(asked).toStrictEqual([]);
  });

  it('CONTROL: a document main lost, refused as not open, still opens the problem dialog', () => {
    const { deps, asked } = door();
    reportProblem(deps, { code: 'document-not-open' });
    expect(asked).toStrictEqual([{ id: COMMAND_PROBLEM_DIALOG_ID, props: { code: 'document-not-open' } }]);
  });
});
