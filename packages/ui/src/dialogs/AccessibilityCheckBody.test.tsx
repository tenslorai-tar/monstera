// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { ACCESSIBILITY_HUMAN_CHECKS, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { accessibilityCheckCommand } from '../commands/accessibilityCheck.js';
import { activateCatalogue, i18n } from '../i18n.js';
import { EN, GROUP_ACCESSIBILITY } from '../messages/en.js';
import type { CommandContext } from '../registries/commands.js';
import AccessibilityCheckBody from './AccessibilityCheckBody.js';
import { ACCESSIBILITY_DIALOG_ID } from './accessibilityCheck.js';

/**
 * The accessibility check's command and body. The kernel half — that each verdict is the one
 * veraPDF gives — is `accessibilityCheck.test.ts` and the agreement run recorded in ADR-0078.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  cleanup();
});

const DOC = asDocId('00000000-0000-4000-8000-0000000000a1');

describe('the accessibility check command', () => {
  it('shows each rule’s pages as the numbers a person reads', async () => {
    const opened: { id: string; props: unknown }[] = [];
    const client = createClient(channels, () =>
      Promise.resolve(
        ok({
          version: asDocVersion(1),
          rules: [{ clause: '7.3', test: 1, verdict: 'failed' as const, count: 2, pages: [0, 4] }],
          humanChecks: [...ACCESSIBILITY_HUMAN_CHECKS],
        }),
      ),
    );
    await accessibilityCheckCommand({
      client,
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve(undefined);
      },
    }).run({ docId: DOC } as CommandContext);
    expect(opened).toStrictEqual([
      {
        id: ACCESSIBILITY_DIALOG_ID,
        props: {
          kind: 'checked',
          rules: [{ clause: '7.3', test: 1, verdict: 'failed', count: 2, pages: [1, 5] }],
          humanChecks: [...ACCESSIBILITY_HUMAN_CHECKS],
        },
      },
    ]);
  });

  it('a refusal still opens the dialog', async () => {
    const opened: unknown[] = [];
    const client = createClient(channels, () => Promise.resolve(err({ code: 'document-poisoned' })));
    await accessibilityCheckCommand({
      client,
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve(undefined);
      },
    }).run({ docId: DOC } as CommandContext);
    expect(opened).toStrictEqual([{ id: ACCESSIBILITY_DIALOG_ID, props: { kind: 'refused' } }]);
  });

  it('sits in Review › Accessibility after Reading order', () => {
    const client = createClient(channels, () => Promise.reject(new Error('unused')));
    expect(accessibilityCheckCommand({ client, ask: () => Promise.resolve(undefined) }).placements).toStrictEqual([
      { surface: 'ribbon', section: 'review', group: GROUP_ACCESSIBILITY, order: 20 },
    ]);
  });
});

describe('AccessibilityCheckBody', () => {
  it('leads with failures, says what the checks are not, and lists the checks for a person without verdicts', () => {
    render(
      <Wrapped>
        <AccessibilityCheckBody
          kind="checked"
          rules={[
            { clause: '7.1', test: 11, verdict: 'passed', count: 0, pages: [] },
            { clause: '7.3', test: 1, verdict: 'failed', count: 2, pages: [1, 5] },
            { clause: '7.18.1', test: 2, verdict: 'not-determined', count: 1, pages: [] },
            { clause: '9.9', test: 9, verdict: 'failed', count: 1, pages: [] },
          ]}
          humanChecks={[...ACCESSIBILITY_HUMAN_CHECKS]}
        />
      </Wrapped>,
    );
    expect(screen.getByText(/2 automatic checks failed\. One could not be decided\./u)).toBeDefined();
    expect(screen.getByText(/They do not show the document is accessible/u)).toBeDefined();
    const rows = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(rows.slice(0, 4)).toStrictEqual([
      'FailedEvery figure has alternative textPages 1, 5',
      // A RULE THIS BUILD HAS NO WORDS FOR is named by its clause, never dropped.
      'FailedRule 9.9 test 9',
      'Could not be decidedEvery comment and mark has a description',
      'PassedThe file has a tag tree',
    ]);
    expect(rows.slice(4)).toHaveLength(ACCESSIBILITY_HUMAN_CHECKS.length);
    expect(rows.slice(4).every((row) => !/Passed|Failed/u.test(row))).toBe(true);
  });

  it('CONTROL: with nothing failed it still says the document is not shown to be accessible', () => {
    render(
      <Wrapped>
        <AccessibilityCheckBody
          kind="checked"
          rules={[{ clause: '7.1', test: 11, verdict: 'passed', count: 0, pages: [] }]}
          humanChecks={[...ACCESSIBILITY_HUMAN_CHECKS]}
        />
      </Wrapped>,
    );
    expect(screen.getByText(/None of the automatic checks failed\./u)).toBeDefined();
    expect(screen.getByText(/They do not show the document is accessible/u)).toBeDefined();
  });
});
