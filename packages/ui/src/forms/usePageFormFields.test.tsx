// @vitest-environment happy-dom
import { type ChannelResult, type ContractClient, channels, createClient } from '@monstera/contract';
import { type DocId, type DocVersion, asDocId, asDocVersion, ok } from '@monstera/shared';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useFormFieldList } from './useFormFieldList.js';
import { usePageFormFields } from './usePageFormFields.js';

type ChannelField = ChannelResult<'document.formFields'>['fields'][number];

function field(over: Partial<ChannelField>): ChannelField {
  return {
    page: 0,
    index: 0,
    kind: 'checkbox',
    name: 'newsletter',
    values: [],
    on: false,
    options: [],
    readOnly: false,
    multiline: false,
    rect: null,
    required: false,
    maxLength: null,
    comb: false,
    masked: false,
    multiSelect: false,
    editable: false,
    calculated: false,
    format: null,
    ...over,
  };
}

/**
 * A client whose field-list reads are answered BY THE CASE, one at a time, so a case can hold a read in flight: the
 * moment between a write and its re-read that the hook exists for.
 */
function heldClient(): { client: ContractClient; answer: (version: number, fields: readonly ChannelField[]) => Promise<void> } {
  const waiting: ((value: unknown) => void)[] = [];
  const client = createClient(channels, (id) => {
    if (id !== 'document.formFields') throw new Error(`unexpected channel ${id}`);
    return new Promise((resolve) => {
      waiting.push(resolve);
    });
  });
  return {
    client,
    answer: async (version, fields) => {
      const next = waiting.shift();
      if (next === undefined) throw new Error('no read is waiting');
      await act(async () => {
        next(ok({ version: asDocVersion(version), fields, next: null, truncated: false }));
        await Promise.resolve();
      });
    },
  };
}

const DOC = asDocId('form');
const VISIBLE = new Set([0]);

describe('the fields on the page between a write and its re-read', () => {
  it('stay the last list read, WITH that list’s version, until the next answer lands', async () => {
    const { client, answer } = heldClient();
    const { result, rerender } = renderHook(
      ({ version }: { version: DocVersion }) => usePageFormFields(client, DOC, version, VISIBLE),
      { initialProps: { version: asDocVersion(1) } },
    );
    await answer(1, [field({ on: false })]);
    const first = result.current.byPage.get(0);
    expect(first?.map((each) => each.on)).toStrictEqual([false]);
    expect(result.current.version).toBe(asDocVersion(1));

    // A WRITE MOVED THE DOCUMENT TO 2, and its re-read has not answered: the page still has its control, named at 1.
    rerender({ version: asDocVersion(2) });
    expect(result.current.byPage.get(0)).toBe(first);
    expect(result.current.version).toBe(asDocVersion(1));

    await answer(2, [field({ on: true })]);
    expect(result.current.byPage.get(0)?.map((each) => each.on)).toStrictEqual([true]);
    expect(result.current.version).toBe(asDocVersion(2));
  });

  it('CONTROL: the exact answer, which the Properties pane composes from, is still no fields while the read is in flight', async () => {
    const { client, answer } = heldClient();
    const { result, rerender } = renderHook(
      ({ version }: { version: DocVersion }) => useFormFieldList(client, DOC, version),
      { initialProps: { version: asDocVersion(1) } },
    );
    await answer(1, [field({})]);
    expect(result.current.fields).toHaveLength(1);
    rerender({ version: asDocVersion(2) });
    expect(result.current.fields).toStrictEqual([]);
    expect(result.current.held?.version).toBe(asDocVersion(1));
  });

  it('CONTROL: another document’s list is held by nobody, at any version', async () => {
    const { client, answer } = heldClient();
    const { result, rerender } = renderHook(
      ({ docId }: { docId: DocId }) => usePageFormFields(client, docId, asDocVersion(1), VISIBLE),
      { initialProps: { docId: DOC } },
    );
    await answer(1, [field({})]);
    expect(result.current.byPage.get(0)).toHaveLength(1);
    rerender({ docId: asDocId('other') });
    expect(result.current.byPage.size).toBe(0);
    expect(result.current.version).toBeUndefined();
  });
});
