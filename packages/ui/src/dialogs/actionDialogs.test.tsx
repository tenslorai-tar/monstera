// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import AboutBody from './AboutBody.js';
import AiSetupBody from './AiSetupBody.js';
import ComponentsBody from './ComponentsBody.js';
import CloseUnsavedBody from './CloseUnsavedBody.js';
import CloudViewOnlyBody from './CloudViewOnlyBody.js';
import DocusignSendBody from './DocusignSendBody.js';
import DonateBody from './DonateBody.js';
import FormFieldListboxBody from './FormFieldListboxBody.js';
import FormFieldRadioBody from './FormFieldRadioBody.js';
import OpenFromUrlBody from './OpenFromUrlBody.js';
import ReimportExternalEditBody from './ReimportExternalEditBody.js';
import SecurityUpdateBody from './SecurityUpdateBody.js';
import SignatureBreakBody from './SignatureBreakBody.js';
import PendingRedactionsBody from './PendingRedactionsBody.js';
import { PENDING_REDACTION_OCCASIONS } from './pendingRedactions.js';
import ApplyRedactionsBody from './ApplyRedactionsBody.js';
import BatesNumberBody from './BatesNumberBody.js';
import DocumentPasswordBody from './DocumentPasswordBody.js';
import FlatFieldsBody from './FlatFieldsBody.js';
import HeaderFooterBody from './HeaderFooterBody.js';
import { InDialog } from './inDialog.js';
import PageTransitionBody from './PageTransitionBody.js';
import ProtectDocumentBody from './ProtectDocumentBody.js';
import RedactMatchesBody from './RedactMatchesBody.js';
import SanitizeDocumentBody from './SanitizeDocumentBody.js';
import WatermarkPagesBody from './WatermarkPagesBody.js';

/**
 * The dialogs of group 2 in the dialog pattern (2026-10-02) whose own behaviour has no body test: each draws its
 * questions as rows and ends in the footer — Cancel first, its one primary action last. What each answers is unchanged
 * code, proven by its command's cases; this proves the shape every one of them now shares.
 */

const PAGES = [2] as const;
const ignore = (): void => undefined;

const BODIES: readonly { readonly name: string; readonly body: ReactNode; readonly firstRow: string | null }[] = [
  { name: 'Watermark', body: <WatermarkPagesBody pages={PAGES} resolve={ignore} update={ignore} />, firstRow: 'Text' },
  { name: 'Header and footer', body: <HeaderFooterBody pages={PAGES} resolve={ignore} update={ignore} />, firstRow: 'Header' },
  { name: 'Bates numbers', body: <BatesNumberBody pages={PAGES} resolve={ignore} update={ignore} />, firstRow: 'Prefix' },
  { name: 'Page transition', body: <PageTransitionBody pages={PAGES} resolve={ignore} update={ignore} />, firstRow: 'Transition' },
  { name: 'Sanitize', body: <SanitizeDocumentBody resolve={ignore} update={ignore} />, firstRow: '' },
  { name: 'Protect', body: <ProtectDocumentBody resolve={ignore} update={ignore} />, firstRow: '' },
  { name: 'Apply redactions', body: <ApplyRedactionsBody page={0} resolve={ignore} update={ignore} />, firstRow: '' },
  { name: 'Mark matches', body: <RedactMatchesBody page={0} resolve={ignore} update={ignore} />, firstRow: '' },
  {
    name: 'Document password',
    body: <DocumentPasswordBody name="a.pdf" retry={false} resolve={ignore} update={ignore} />,
    firstRow: 'Password',
  },
  {
    name: 'Fields from lines',
    body: <FlatFieldsBody alreadyFields={0} candidates={[{ name: 'name', label: 'Name', kind: 'text' }]} truncated={false} resolve={ignore} update={ignore} />,
    // A LIST TO CONFIRM, not questions: no row, and the footer all the same.
    firstRow: null,
  },
];

/** Group 3: the shared text forms and the dialogs whose answers are buttons. Same shape, same assertion. */
const GROUP_3: readonly { readonly name: string; readonly body: ReactNode; readonly firstRow: string | null }[] = [
  { name: 'Radio button', body: <FormFieldRadioBody known={[]} resolve={ignore} update={ignore} />, firstRow: '' },
  { name: 'List box', body: <FormFieldListboxBody known={[]} resolve={ignore} update={ignore} />, firstRow: '' },
  { name: 'Open from a URL', body: <OpenFromUrlBody resolve={ignore} update={ignore} />, firstRow: '' },
  { name: 'Send to DocuSign', body: <DocusignSendBody resolve={ignore} update={ignore} />, firstRow: 'Email subject' },
  { name: 'Close with changes', body: <CloseUnsavedBody name="a.pdf" resolve={ignore} update={ignore} />, firstRow: null },
  { name: 'Re-import an edit', body: <ReimportExternalEditBody page={0} resolve={ignore} update={ignore} />, firstRow: null },
  { name: 'Signature will break', body: <SignatureBreakBody signatures={1} resolve={ignore} update={ignore} />, firstRow: null },
  {
    name: 'Redactions not applied',
    body: <PendingRedactionsBody count={2} occasion="save" resolve={ignore} update={ignore} />,
    firstRow: null,
  },
  {
    name: 'View only',
    body: <CloudViewOnlyBody provider="onedrive" moment="opened" resolve={ignore} update={ignore} />,
    firstRow: null,
  },
];

afterEach(() => {
  cleanup();
});

describe('the text forms and button dialogs in the dialog pattern', () => {
  for (const { name, body, firstRow } of GROUP_3) {
    it(`${name}: ends in the footer — Cancel first, its primary action last`, () => {
      render(<InDialog>{body}</InDialog>);
      const rows = [...document.querySelectorAll('.m-dialog-row .m-dialog-row__label')].map((label) => label.textContent);
      if (firstRow !== null) expect(rows.length).toBeGreaterThan(0);
      if (firstRow !== null && firstRow !== '') expect(rows[0]).toBe(firstRow);
      const buttons = [...(document.querySelector('.m-dialog-footer')?.querySelectorAll('button') ?? [])];
      expect(buttons[0]?.textContent).toBe('Cancel');
      expect(buttons.at(-1)?.classList.contains('m-button--primary')).toBe(true);
    });
  }

  it('Close with changes: Cancel, Don’t save, Save — its own Cancel is gone, and the popup’s close answers cancel', () => {
    render(<InDialog><CloseUnsavedBody name="a.pdf" resolve={ignore} update={ignore} /></InDialog>);
    const buttons = [...(document.querySelector('.m-dialog-footer')?.querySelectorAll('button') ?? [])];
    expect(buttons.map((button) => button.textContent)).toStrictEqual(['Cancel', 'Don’t save', 'Save']);
  });

  it('Redactions not applied: the owner’s sentence with the count, and Cancel, the action without applying, Apply', () => {
    // ONE ROW PER OCCASION, so a middle label copied from Save onto Close — the label that needs the question read to
    // be safe — fails by name.
    const middle: Record<string, string> = {
      save: 'Save without applying',
      close: 'Close without applying',
      export: 'Export without applying',
      print: 'Print without applying',
      send: 'Send without applying',
    };
    for (const occasion of PENDING_REDACTION_OCCASIONS) {
      cleanup();
      const answers: unknown[] = [];
      render(
        <InDialog>
          <PendingRedactionsBody
            count={3}
            occasion={occasion}
            resolve={(answer) => answers.push(answer)}
            update={ignore}
          />
        </InDialog>,
      );
      expect(document.body.textContent).toContain(
        '3 parts of this document are marked for redaction, but they have not been removed yet.',
      );
      const buttons = [...(document.querySelector('.m-dialog-footer')?.querySelectorAll('button') ?? [])];
      expect(buttons.map((button) => button.textContent)).toStrictEqual(['Cancel', middle[occasion], 'Apply']);
      // EACH BUTTON ANSWERS WHAT IT SAYS — the two that go ahead are not interchangeable.
      buttons[1]?.click();
      buttons[2]?.click();
      expect(answers).toStrictEqual(['without', 'apply']);
    }
    cleanup();
    render(<InDialog><PendingRedactionsBody count={1} occasion="save" resolve={ignore} update={ignore} /></InDialog>);
    expect(document.body.textContent).toContain(
      'One part of this document is marked for redaction, but it has not been removed yet.',
    );
  });

  it('a notice whose own button IS its dismissal draws no Cancel beside it — and CONTROL: one without does', () => {
    render(<InDialog><SecurityUpdateBody version="1.2.3.0" resolve={ignore} update={ignore} /></InDialog>);
    const notice = [...(document.querySelector('.m-dialog-footer')?.querySelectorAll('button') ?? [])];
    expect(notice.map((button) => button.textContent)).toStrictEqual(['I understand', 'Open Microsoft Store']);
    cleanup();
    render(<InDialog><DonateBody resolve={ignore} update={ignore} /></InDialog>);
    const donate = [...(document.querySelector('.m-dialog-footer')?.querySelectorAll('button') ?? [])];
    expect(donate.map((button) => button.textContent)).toStrictEqual(['Not now', 'Open the donation page']);
  });
});

describe('the footers the owner chose for three dialogs (2026-10-02)', () => {
  const footer = (): (string | null)[] =>
    [...(document.querySelector('.m-dialog-footer')?.querySelectorAll('button') ?? [])].map((button) => button.textContent);

  it('Set up AI: Skip is the only dismissal — no Cancel beside it', () => {
    render(<InDialog><AiSetupBody secretsAvailable resolve={ignore} update={ignore} /></InDialog>);
    expect(footer()).toStrictEqual(['Skip', 'Check and save']);
  });

  it('About: Close first, then its two buttons, in the footer', () => {
    render(
      <InDialog>
        <AboutBody version="1.2.3.0" installChannel="store" checksForUpdates={false} resolve={ignore} update={ignore} />
      </InDialog>,
    );
    expect(footer()).toStrictEqual(['Close', 'Source code', 'Third-party licences']);
  });

  it('Components: a report — Close first, then Verify files', () => {
    render(<InDialog><ComponentsBody components={[]} verified={false} resolve={ignore} update={ignore} /></InDialog>);
    expect(footer()).toStrictEqual(['Close', 'Verify files']);
  });
});

describe('the action dialogs in the dialog pattern', () => {
  for (const { name, body, firstRow } of BODIES) {
    it(`${name}: questions are rows, and it ends in the footer — Cancel first, its primary action last`, () => {
      render(<InDialog>{body}</InDialog>);
      const rows = [...document.querySelectorAll('.m-dialog-row .m-dialog-row__label')].map((label) => label.textContent);
      if (firstRow !== null) expect(rows.length).toBeGreaterThan(0);
      // WHERE A FIRST ROW IS NAMED, it is that one: the conversion kept the dialog's own first question first.
      if (firstRow !== null && firstRow !== '') expect(rows[0]).toBe(firstRow);
      const footer = document.querySelector('.m-dialog-footer');
      expect(footer).not.toBeNull();
      const buttons = [...(footer?.querySelectorAll('button') ?? [])];
      expect(buttons[0]?.textContent).toBe('Cancel');
      expect(buttons.at(-1)?.classList.contains('m-button--primary')).toBe(true);
    });
  }
});

describe('Apply redactions says the bookmarks go, and offers no keeping them (the owner, 2026-10-05)', () => {
  it('names the bookmarks among what is removed, and the one thing a person may keep is the title', () => {
    render(<InDialog><ApplyRedactionsBody page={0} resolve={ignore} update={ignore} /></InDialog>);
    expect(document.body.textContent).toContain('The document’s bookmarks, author, subject and other properties are removed too.');
    // NO OPTION, by the owner's ruling: the title's box is the dialog's only one. A box added for the bookmarks fails
    // here, where a case reading the sentence alone would not see it.
    const boxes = [...document.querySelectorAll('input[type="checkbox"]')].map((box) => box.getAttribute('aria-label'));
    expect(boxes).toStrictEqual(['Keep the document’s title']);
  });
});
