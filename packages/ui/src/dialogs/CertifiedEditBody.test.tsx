// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import CertifiedEditBody from './CertifiedEditBody.js';
import { InDialog } from './inDialog.js';
import SignedEditBody from './SignedEditBody.js';

afterEach(() => {
  cleanup();
});

describe('CertifiedEditBody (ADR-0291 Decision 4)', () => {
  it('says what the certifier allows and who they are, offers the copy, and offers no Change this document', () => {
    const answers: string[] = [];
    render(
      <InDialog>
        <CertifiedEditBody level="form-fill" signer="Grace Hopper" resolve={(answer) => answers.push(answer)} update={() => undefined} />
      </InDialog>,
    );
    expect(screen.getByText(/allows only filling in its form and signing it/u)).toBeTruthy();
    expect(screen.getByText('Grace Hopper')).toBeTruthy();
    expect(screen.getByText(/no longer carries the certification/u)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change this document' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Work on a copy' }));
    expect(answers).toStrictEqual(['copy']);
  });

  it('a certification naming nobody says its sentence alone, with no empty label', () => {
    render(
      <InDialog>
        <CertifiedEditBody level="no-changes" signer="" resolve={() => undefined} update={() => undefined} />
      </InDialog>,
    );
    expect(screen.getByText(/allows no changes to it/u)).toBeTruthy();
    expect(screen.queryByText('Certified by')).toBeNull();
  });

  it('CONTROL: the signed-edit window offers Change this document, so its absence above is the certified window’s own', () => {
    render(
      <InDialog>
        <SignedEditBody resolve={() => undefined} update={() => undefined} />
      </InDialog>,
    );
    expect(screen.getByRole('button', { name: 'Change this document' })).toBeTruthy();
  });
});
