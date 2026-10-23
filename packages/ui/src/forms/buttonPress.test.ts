import type { ButtonStep, ContractClient } from '@monstera/contract';
import { type DocVersion, type MessageKey, asDocId, asDocVersion, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { FOLLOW_LINK_DIALOG_ID } from '../dialogs/followLink.js';
import { OPEN_BUTTON_FILE_DIALOG_ID } from '../dialogs/openButtonFile.js';
import { SUBMIT_FORM_DIALOG_ID } from '../dialogs/submitForm.js';
import {
  BUTTON_PRESS_UNREAD,
  BUTTON_SUBMIT_BLOCKED,
  BUTTON_SUBMIT_MAIL_WITHOUT_DATA,
  BUTTON_SUBMIT_SENT,
  BUTTON_SUBMIT_SHARED,
  BUTTON_SUBMIT_SHARE_FAILED,
  BUTTON_SUBMIT_SHARE_UNAVAILABLE,
  TOAST_COPIED,
} from '../messages/en.js';
import type { ZoomMode } from '../zoom.js';
import { type ButtonStepCommand, pressButton } from './buttonPress.js';

/**
 * A press, carried out step by step (ADR-0259 Decision 3).
 *
 * What these read is what was SENT, and at which version: a step that names the wrong place or an old version is
 * refused by the kernel, and a renderer that sent nothing ends in the same document as one that sent and was refused.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000bb');
const READ_AT = asDocVersion(7);
const BUTTON = { page: 1, index: 4, name: 'go' };

function pressing(
  steps: readonly ButtonStep[] | null,
  lands: (sent: number) => boolean = () => true,
  /** What the person answers each question: agreeing, unless a case says otherwise. */
  answer: unknown = { open: true },
  /** What `main` answers a submission: sent, unless a case says otherwise. */
  submitted: SubmitOutcome = { kind: 'sent' },
  /** What the question REPORTS before it answers (ADR-0094): a submission's Copy. */
  reports: readonly unknown[] = [],
) {
  const sent: ButtonStepCommand[] = [];
  const said: MessageKey[] = [];
  /** Every route a step took, in the order it took it. */
  const routes: unknown[] = [];
  /** The document's version as `main` holds it: an import moves it by a route the press does not hold. */
  let current = READ_AT;
  const deps = {
    client: {
      'document.buttonActions': () => Promise.resolve(ok({ version: current, steps })),
      'document.openButtonLink': (params: unknown) => {
        routes.push({ open: params });
        return Promise.resolve(ok({ kind: 'opened' as const }));
      },
      'document.submitButtonForm': (params: unknown) => {
        routes.push({ submit: params });
        return Promise.resolve(ok(submitted));
      },
      'document.openButtonFile': (params: unknown) => {
        routes.push({ openFile: params });
        return Promise.resolve(ok({ kind: 'absent' as const }));
      },
      'window.copyText': (params: unknown) => {
        routes.push({ copy: params });
        return Promise.resolve(ok({ copied: true }));
      },
    } as Pick<
      ContractClient,
      'document.buttonActions' | 'document.openButtonLink' | 'document.submitButtonForm' | 'document.openButtonFile' | 'window.copyText'
    >,
    // WHAT SETTLING SAW, for the open's own route: `settleButtonFileOpen` is `openDocument.test.ts`' to prove.
    settleFileOpen: (answer: unknown) => {
      routes.push({ settled: answer });
      return undefined;
    },
    ask: (id: string, props: unknown, onUpdate?: (result: unknown, reply: (props: unknown) => void) => void) => {
      routes.push({ ask: id, props });
      for (const report of reports) onUpdate?.(report, () => undefined);
      return Promise.resolve(answer);
    },
    apply: (command: ButtonStepCommand): Promise<DocVersion | undefined> => {
      sent.push(command);
      routes.push({ apply: command.step });
      return Promise.resolve(lands(sent.length) ? asDocVersion(command.version + 1) : undefined);
    },
    show: (page: number, zoom: ZoomMode | undefined) => {
      routes.push({ show: page, zoom });
    },
    run: (id: string) => {
      routes.push({ run: id });
      if (id === 'document.import-form-data-fdf') current = asDocVersion(40);
      return Promise.resolve();
    },
    toast: (_kind: 'done' | 'problem', message: MessageKey) => {
      said.push(message);
    },
  };
  return { deps, sent, said, routes };
}

type SubmitOutcome = Extract<Awaited<ReturnType<ContractClient['document.submitButtonForm']>>, { ok: true }>['value'];

const reset = (trigger: ButtonStep['trigger'], step: number, fields: readonly string[] | null = null): ButtonStep => ({
  trigger,
  step,
  action: { kind: 'reset', fields },
});

describe('pressing a push button', () => {
  it('runs the pressed trigger’s steps in order, each at the version the one before produced, and no other trigger’s', async () => {
    const { deps, sent, said } = pressing([reset('up', 0, ['a']), reset('up', 1), reset('down', 0), reset('up', 2)]);
    await pressButton(deps, DOC, { ...BUTTON, trigger: 'up' });
    expect(sent).toStrictEqual([
      { kind: 'resetForm', ...BUTTON_PLACE, trigger: 'up', step: 0, version: READ_AT },
      { kind: 'resetForm', ...BUTTON_PLACE, trigger: 'up', step: 1, version: asDocVersion(8) },
      { kind: 'resetForm', ...BUTTON_PLACE, trigger: 'up', step: 2, version: asDocVersion(9) },
    ]);
    expect(said).toStrictEqual([]);
  });

  it('skips a step the document keeps, and runs a kept one that runs as a kind it knows, by its own place', async () => {
    const { deps, sent } = pressing([
      { trigger: 'up', step: 0, action: { kind: 'kept', subtype: 'JavaScript', runsAs: null } },
      { trigger: 'up', step: 1, action: { kind: 'kept', subtype: 'ResetForm', runsAs: 'reset' } },
    ]);
    await pressButton(deps, DOC, { ...BUTTON, trigger: 'up' });
    expect(sent.map((command) => command.step)).toStrictEqual([1]);
  });

  it('shows the page a go-to names, at its view, in its place among the other steps', async () => {
    const { deps, routes } = pressing([
      { trigger: 'up', step: 0, action: { kind: 'goTo', page: 3, view: 'fit', at: null } },
      reset('up', 1),
      { trigger: 'up', step: 2, action: { kind: 'goTo', page: 0, view: 'keep', at: { left: 10, top: 700, zoom: 9 } } },
      { trigger: 'up', step: 3, action: { kind: 'goTo', page: 1, view: 'keep', at: null } },
    ]);
    await pressButton(deps, DOC, { ...BUTTON, trigger: 'up' });
    expect(routes).toStrictEqual([
      { show: 3, zoom: { kind: 'fit-page' } },
      { apply: 1 },
      // A ZOOM PAST THE LADDER is the ladder's end, as every other zoom is.
      { show: 0, zoom: { kind: 'scale', scale: 4 } },
      // NONE NAMED keeps the reader's.
      { show: 1, zoom: undefined },
    ]);
  });

  it('asks before a link, naming its address, and on yes asks main to open THE STEP, never the address', async () => {
    const { deps, routes } = pressing([{ trigger: 'up', step: 0, action: { kind: 'link', address: 'https://example.org/a' } }]);
    await pressButton(deps, DOC, { ...BUTTON, trigger: 'up' });
    expect(routes).toStrictEqual([
      { ask: FOLLOW_LINK_DIALOG_ID, props: { address: 'https://example.org/a', followable: true, scheme: 'https:' } },
      { open: { docId: DOC, version: READ_AT, field: BUTTON, trigger: 'up', step: 0 } },
    ]);
  });

  it('CONTROL: a link the person declines opens nothing', async () => {
    const { deps, routes } = pressing([{ trigger: 'up', step: 0, action: { kind: 'link', address: 'https://example.org/a' } }], () => true, null);
    await pressButton(deps, DOC, { ...BUTTON, trigger: 'up' });
    expect(routes.filter((route) => typeof route === 'object' && route !== null && 'open' in route)).toStrictEqual([]);
  });

  it('prints by running the application’s own Print, after the reset before it, in order', async () => {
    const { deps, routes } = pressing([reset('up', 0), { trigger: 'up', step: 1, action: { kind: 'print' } }]);
    await pressButton(deps, DOC, { ...BUTTON, trigger: 'up' });
    expect(routes).toStrictEqual([{ apply: 0 }, { run: 'document.print' }]);
  });

  it('shows or hides by sending showHideFields naming THE STEP, at the version the step before produced', async () => {
    const { deps, sent } = pressing([
      reset('up', 0),
      { trigger: 'up', step: 1, action: { kind: 'showHide', fields: ['a'], hide: true } },
      { trigger: 'up', step: 2, action: { kind: 'kept', subtype: 'Hide', runsAs: 'showHide' } },
    ]);
    await pressButton(deps, DOC, { ...BUTTON, trigger: 'up' });
    expect(sent).toStrictEqual([
      { kind: 'resetForm', ...BUTTON_PLACE, trigger: 'up', step: 0, version: READ_AT },
      // CONTROL of the kind: a show or hide is never sent as a reset, which the kernel would refuse for this step.
      { kind: 'showHideFields', ...BUTTON_PLACE, trigger: 'up', step: 1, version: asDocVersion(8) },
      { kind: 'showHideFields', ...BUTTON_PLACE, trigger: 'up', step: 2, version: asDocVersion(9) },
    ]);
  });

  describe('a submission (ADR-0259 Decision 6)', () => {
    const SUBMIT: ButtonStep = {
      trigger: 'up',
      step: 0,
      action: { kind: 'submit', address: 'https://forms.example/take', format: 'html', fields: ['a'] },
    };

    it('asks first, naming where, how and what, and on Send asks main to send THE STEP, then says it was sent', async () => {
      const { deps, routes, said } = pressing([SUBMIT], () => true, { send: true, route: 'post' });
      await pressButton(deps, DOC, { ...BUTTON, trigger: 'up' });
      expect(routes).toStrictEqual([
        { ask: SUBMIT_FORM_DIALOG_ID, props: { address: 'https://forms.example/take', format: 'html', fields: ['a'], mail: false } },
        { submit: { docId: DOC, version: READ_AT, field: BUTTON, trigger: 'up', step: 0, route: 'post' } },
      ]);
      expect(said).toStrictEqual([BUTTON_SUBMIT_SENT]);
    });

    it('CONTROL: closing the question sends nothing, where the same press answered Send above', async () => {
      const { deps, routes, said } = pressing([SUBMIT], () => true, null);
      await pressButton(deps, DOC, { ...BUTTON, trigger: 'up' });
      expect(routes.filter((route) => typeof route === 'object' && route !== null && 'submit' in route)).toStrictEqual([]);
      expect(said).toStrictEqual([]);
    });

    it('says the guard’s reason, and where the data did not fit a message runs Export form data in its encoding', async () => {
      const refused = pressing([SUBMIT], () => true, { send: true, route: 'post' }, { kind: 'refused', reason: 'blocked-address' });
      await pressButton(refused.deps, DOC, { ...BUTTON, trigger: 'up' });
      expect(refused.said).toStrictEqual([BUTTON_SUBMIT_BLOCKED]);
      const mail: ButtonStep = { ...SUBMIT, action: { kind: 'submit', address: 'mailto:forms@example.org', format: 'xfdf', fields: null } };
      const long = pressing([mail], () => true, { send: true, route: 'mail-app' }, { kind: 'mail-opened-without-data' });
      await pressButton(long.deps, DOC, { ...BUTTON, trigger: 'up' });
      expect(long.routes.at(0)).toMatchObject({ props: { mail: true } });
      expect(long.routes.at(-1)).toStrictEqual({ run: 'document.export-form-data-xfdf' });
      expect(long.said).toStrictEqual([BUTTON_SUBMIT_MAIL_WITHOUT_DATA]);
    });

    describe('to a mail address, by the route chosen (ADR-0263 Decision 3)', () => {
      const MAIL: ButtonStep = {
        ...SUBMIT,
        action: { kind: 'submit', address: 'mailto:forms%40example.org?subject=Application', format: 'fdf', fields: null },
      };
      const submits = (routes: unknown[]): unknown[] =>
        routes.flatMap((route) => (typeof route === 'object' && route !== null && 'submit' in route ? [route.submit] : []));

      it('Share sends THE STEP by the share route, and says to choose the mail app; CONTROL: Open in my mail app sends the other', async () => {
        const shared = pressing([MAIL], () => true, { send: true, route: 'share' }, { kind: 'shared' });
        await pressButton(shared.deps, DOC, { ...BUTTON, trigger: 'up' });
        expect(submits(shared.routes)).toStrictEqual([{ docId: DOC, version: READ_AT, field: BUTTON, trigger: 'up', step: 0, route: 'share' }]);
        expect(shared.said).toStrictEqual([BUTTON_SUBMIT_SHARED]);
        const opened = pressing([MAIL], () => true, { send: true, route: 'mail-app' }, { kind: 'mail-opened' });
        await pressButton(opened.deps, DOC, { ...BUTTON, trigger: 'up' });
        expect(submits(opened.routes)).toMatchObject([{ route: 'mail-app' }]);
      });

      it('no Share sheet, or one that refused, is said with the other route to take', async () => {
        for (const [outcome, sentence] of [
          [{ kind: 'share-unavailable' }, BUTTON_SUBMIT_SHARE_UNAVAILABLE],
          [{ kind: 'share-failed' }, BUTTON_SUBMIT_SHARE_FAILED],
        ] as const) {
          const { deps, said } = pressing([MAIL], () => true, { send: true, route: 'share' }, outcome);
          await pressButton(deps, DOC, { ...BUTTON, trigger: 'up' });
          expect(said).toStrictEqual([sentence]);
        }
      });

      it('COPY copies who the message is to, through main, and sends nothing; CONTROL: closing after it still sends nothing', async () => {
        const { deps, routes, said } = pressing([MAIL], () => true, null, { kind: 'sent' }, [{ copy: true }]);
        await pressButton(deps, DOC, { ...BUTTON, trigger: 'up' });
        await Promise.resolve();
        expect(routes.filter((route) => typeof route === 'object' && route !== null && 'copy' in route)).toStrictEqual([
          { copy: { text: 'forms@example.org' } },
        ]);
        expect(submits(routes)).toStrictEqual([]);
        expect(said).toStrictEqual([TOAST_COPIED]);
      });
    });
  });

  it('opens a file by asking first, naming it, then asking main to open THE STEP and settling what it answered', async () => {
    const step: ButtonStep = { trigger: 'up', step: 0, action: { kind: 'openFile', file: 'guide.pdf' } };
    const agreed = pressing([step]);
    await pressButton(agreed.deps, DOC, { ...BUTTON, trigger: 'up' });
    expect(agreed.routes).toStrictEqual([
      { ask: OPEN_BUTTON_FILE_DIALOG_ID, props: { file: 'guide.pdf' } },
      { openFile: { docId: DOC, version: READ_AT, field: BUTTON, trigger: 'up', step: 0 } },
      { settled: { ok: true, value: { kind: 'absent' } } },
    ]);
    // CONTROL: closing the question opens nothing, where the same press agreed above.
    const declined = pressing([step], () => true, null);
    await pressButton(declined.deps, DOC, { ...BUTTON, trigger: 'up' });
    expect(declined.routes).toStrictEqual([{ ask: OPEN_BUTTON_FILE_DIALOG_ID, props: { file: 'guide.pdf' } }]);
  });

  it('imports by running the application’s own Import form data, and sends the next step at the version the import made', async () => {
    const { deps, routes, sent } = pressing([{ trigger: 'up', step: 0, action: { kind: 'importData', file: 'answers.fdf' } }, reset('up', 1)]);
    await pressButton(deps, DOC, { ...BUTTON, trigger: 'up' });
    expect(routes).toStrictEqual([{ run: 'document.import-form-data-fdf' }, { apply: 1 }]);
    // CONTROL of the reading: the reset is not sent at the version read before the import, which `main` would refuse.
    expect(sent.map((command) => command.version)).toStrictEqual([asDocVersion(40)]);
  });

  it('stops at a step that did not land, since what follows was written to follow it', async () => {
    const { deps, sent } = pressing([reset('up', 0), reset('up', 1)], () => false);
    await pressButton(deps, DOC, { ...BUTTON, trigger: 'up' });
    expect(sent).toHaveLength(1);
  });

  it('CONTROL: a button that no longer reads as one sends nothing and says so', async () => {
    const { deps, sent, said } = pressing(null);
    await pressButton(deps, DOC, { ...BUTTON, trigger: 'up' });
    expect(sent).toStrictEqual([]);
    expect(said).toStrictEqual([BUTTON_PRESS_UNREAD]);
  });
});

const BUTTON_PLACE = { page: BUTTON.page, index: BUTTON.index };
