// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import SaveProblemBody from './SaveProblemBody.js';

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  cleanup();
});

describe('SaveProblemBody: a copy onto the document it came from (the owner, 2026-11-10)', () => {
  it('says a copy cannot replace the document it came from, and to choose another name', () => {
    const { container } = render(
      <Wrapped>
        <SaveProblemBody outcome="onto-source" />
      </Wrapped>,
    );
    expect(container.textContent).toContain('A copy can’t replace the document it came from. Choose another name.');
    expect(container.textContent).not.toContain('Another open document');
  });

  it('CONTROL: a destination another open document reaches still says so', () => {
    const { container } = render(
      <Wrapped>
        <SaveProblemBody outcome="contested" />
      </Wrapped>,
    );
    expect(container.textContent).toContain('Another open document is writing to this file. Close it and try again.');
  });
});
