// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { act, render, screen, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { AccessibilityPanel } from './AccessibilityPanel.js';
import { closeTool, openTool, showSection } from './accessibility/run.js';
import { createDocumentStore } from './documentStores.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';

/**
 * The accessibility tools (ADR-0183, ADR-0189): the UI half of the wired pair. The kernel's cases prove the check places each failure
 * and the reading order boxes each element; these prove what the panel SHOWS of it — plain names, one line saying what a
 * failure means and what to do, and that choosing a result marks exactly the place the channel gave.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000a11y0');
const LINK_BOX = { x0: 100, y0: 370, x1: 160, y1: 390 };

const RULES = [
  { clause: '7.1', test: 8, verdict: 'passed', count: 0, pages: [], spots: [] },
  // A LINK WITH NO DESCRIPTION, on page 3 (index 2), at a box the engine placed.
  { clause: '7.18.5', test: 2, verdict: 'failed', count: 2, pages: [2], spots: [{ page: 2, box: LINK_BOX }, { page: 2, box: null }] },
  // ABOUT THE WHOLE FILE: nothing to point to.
  { clause: '6.2', test: 1, verdict: 'failed', count: 1, pages: [], spots: [] },
  { clause: '7.18.1', test: 2, verdict: 'not-determined', count: 1, pages: [0], spots: [] },
];

const NODES = [
  { role: 'Document', depth: 0, lines: 0, box: { x0: 10, y0: 10, x1: 300, y1: 200 } },
  { role: 'H1', depth: 1, lines: 1, box: { x0: 10, y0: 10, x1: 200, y1: 30 } },
  { role: 'Lbl', depth: 1, lines: 1, box: { x0: 10, y0: 40, x1: 30, y1: 52 } },
  { role: 'NonStruct', depth: 1, lines: 0, box: null },
  // A TYPE THE TABLE DOES NOT KNOW — an engine's own string, or a document's invention.
  { role: 'NonDtruct', depth: 2, lines: 2, box: { x0: 10, y0: 60, x1: 100, y1: 90 } },
];

function Wrapped({ children }: { readonly children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

function drawn(version = 1): { readonly store: ReturnType<typeof createDocumentStore> } {
  const store = createDocumentStore(DOC, asDocVersion(version), 2);
  const client = createClient(channels, (id) => {
    if (id === 'document.accessibilityCheck') {
      return Promise.resolve(ok({ version: asDocVersion(version), rules: RULES, humanChecks: ['reading-order'] }));
    }
    if (id === 'document.pageStructure') {
      return Promise.resolve(
        ok({ version: asDocVersion(version), nodes: NODES, truncated: false, untaggedLines: 0, images: 0 }),
      );
    }
    throw new Error(`unexpected channel ${id}`);
  });
  render(
    <Wrapped>
      <AccessibilityPanel deps={{ client }} store={store} />
    </Wrapped>,
  );
  return { store };
}

async function check(): Promise<void> {
  await act(async () => {
    screen.getByRole('button', { name: 'Check this document' }).click();
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe('the Accessibility tab — the check', () => {
  it('says in one line what each failure means and what to do, and lists what passed apart', async () => {
    drawn();
    await check();

    expect(screen.getByText('Needs fixing')).toBeDefined();
    // THE OWNER'S OWN EXAMPLE, in the words the panel uses.
    expect(screen.getByText('A link has no description: screen readers can’t say where it goes. Give each link a short description in the program that made the file.')).toBeDefined();
    expect(screen.getByText('2 problems')).toBeDefined();
    // WHAT PASSED IS COUNTED, not listed among the problems.
    expect(screen.getByText('1 check passed')).toBeDefined();
    expect(screen.getByText('Needs a person to check')).toBeDefined();
  });

  it('choosing a problem marks exactly the box the channel gave, and a problem with no box marks the page', async () => {
    const { store } = drawn();
    await check();

    await act(async () => {
      screen.getByRole('button', { name: 'Show problem 1 of 2, on page 3' }).click();
      await Promise.resolve();
    });
    expect(store.getState().accessibility?.marked?.spot).toStrictEqual({ page: 2, box: LINK_BOX });

    await act(async () => {
      screen.getByRole('button', { name: 'Show problem 2 of 2, on page 3' }).click();
      await Promise.resolve();
    });
    expect(store.getState().accessibility?.marked?.spot).toStrictEqual({ page: 2, box: null });
    expect(screen.getByText('Marked on page 3.')).toBeDefined();

    await act(async () => {
      screen.getByRole('button', { name: 'Clear the mark on the page' }).click();
      await Promise.resolve();
    });
    expect(store.getState().accessibility?.marked).toBeUndefined();
  });

  it('a problem about the WHOLE FILE says so and offers nothing to press', async () => {
    drawn();
    await check();
    const rule = screen.getByText('The file is marked as tagged').closest('li');
    if (rule === null) throw new Error('the rule is listed');
    expect(within(rule).getByText('This is about the whole file, so there is nothing to point to on a page.')).toBeDefined();
    // CONTROL: the rule beside it HAS places, so its buttons exist — a panel that drew none anywhere would pass the line above.
    expect(within(rule).queryAllByRole('button')).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: /^Show problem/u }).length).toBeGreaterThan(0);
  });

  it('says the result is older when the document has changed since the check', async () => {
    const { store } = drawn(1);
    await check();
    expect(screen.queryByText(/changed since this check/u)).toBeNull();
    await act(async () => {
      store.getState().observed(asDocVersion(2));
      await Promise.resolve();
    });
    expect(screen.getByText(/changed since this check/u)).toBeDefined();
  });
});

describe('the Accessibility tab — the reading order', () => {
  async function openOrder(): Promise<ReturnType<typeof createDocumentStore>> {
    const { store } = drawn();
    await act(async () => {
      showSection(store, 'order');
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    return store;
  }

  it('shows PLAIN NAMES, and no engine or tag name reaches the screen', async () => {
    await openOrder();
    for (const shown of ['Document', 'Heading 1', 'List label', 'Container']) expect(screen.getAllByText(shown).length).toBeGreaterThan(0);
    // THE ENGINE'S MISSPELLING, and any name the table lacks, is a word of ours.
    expect(screen.getByText('Other element')).toBeDefined();
    const body = document.body.textContent;
    for (const raw of ['NonDtruct', 'NonStruct', 'Lbl', 'H1']) expect(body).not.toContain(raw);
    // AND "0 lines" IS NOT SAID: an element holding only other elements says nothing about lines.
    expect(body).not.toMatch(/\b0 lines/u);
    expect(screen.getByText('2 lines of text')).toBeDefined();
    expect(screen.getByText('No text')).toBeDefined();
  });

  it('choosing an item marks the text it covers; an item with no text is read and not pressed', async () => {
    const store = await openOrder();
    await act(async () => {
      screen.getByRole('button', { name: 'Show Heading 1 on the page' }).click();
      await Promise.resolve();
    });
    expect(store.getState().accessibility?.marked?.spot).toStrictEqual({ page: 2, box: NODES[1]?.box });
    // THE CONTAINER HAS NO BOX: no button, so no control that marks nothing.
    expect(screen.queryByRole('button', { name: 'Show Container on the page' })).toBeNull();
  });
});

describe('the Accessibility tool — open and closed (ADR-0189)', () => {
  it('is CLOSED until opened, opening it names its section, and closing it takes the mark off but keeps what was read', async () => {
    const { store } = drawn();
    // CONTROL: a document that never opened the tool draws and marks nothing.
    expect(store.getState().accessibility?.open ?? false).toBe(false);

    await act(async () => {
      openTool(store, 'order');
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(store.getState().accessibility).toMatchObject({ open: true, section: 'order' });

    await act(async () => {
      screen.getByRole('button', { name: 'Show Heading 1 on the page' }).click();
      await Promise.resolve();
    });
    expect(store.getState().accessibility?.marked).toBeDefined();
    const read = store.getState().accessibility?.order;
    expect(read?.phase).toBe('done');

    closeTool(store);
    const closed = store.getState().accessibility;
    expect(closed?.open).toBe(false);
    // THE MARK GOES WITH THE TOOL, so the page carries nothing for a tool nobody can see.
    expect(closed?.marked).toBeUndefined();
    // WHAT IT READ STAYS, so opening it again shows the answer rather than asking again.
    expect(closed?.order).toStrictEqual(read);
  });
});
