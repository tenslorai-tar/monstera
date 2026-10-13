// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import ImportAnnotationsProblemBody from './ImportAnnotationsProblemBody.js';
import ImportFormDataProblemBody from './ImportFormDataProblemBody.js';
import InsertImageProblemBody from './InsertImageProblemBody.js';
import MarkdownImportProblemBody from './MarkdownImportProblemBody.js';
import SignatureProblemBody from './SignatureProblemBody.js';
import { type FileTooLargeProps, fileTooLargeProblem } from './fileTooLarge.js';

/**
 * EVERY dialog that refuses a file by its size names the file's size beside the bound (the owner's O10) — the class, not
 * the one dialog the owner met. A body that went on rendering the bound alone would pass any case written for another.
 */
const BODIES: Readonly<Record<string, (props: FileTooLargeProps) => ReactElement>> = {
  'insert image': (props) => <InsertImageProblemBody {...props} />,
  'import form data': (props) => <ImportFormDataProblemBody {...props} />,
  'import comments': (props) => <ImportAnnotationsProblemBody {...props} />,
  'import a file': (props) => <MarkdownImportProblemBody {...props} />,
  signature: (props) => <SignatureProblemBody {...props} />,
};

describe('each refusal by size, as a person reads it', () => {
  activateCatalogue('en', EN);
  const props = fileTooLargeProblem({ limitBytes: 4 * 1024 * 1024, fileBytes: 9_437_184 });

  it.each(Object.keys(BODIES))('%s names the file’s size and the bound', (name) => {
    const body = BODIES[name];
    if (body === undefined) throw new Error(`no body named ${name}`);
    const text = render(<I18nProvider i18n={i18n}>{body(props)}</I18nProvider>).container.textContent;
    expect(text).toContain('9 MB');
    expect(text).toContain('4 MB');
  });

  it('CONTROL: five bodies, so a sixth that is added without a case here is visible in this list', () => {
    expect(Object.keys(BODIES)).toHaveLength(5);
  });
});
