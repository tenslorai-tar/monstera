// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { ASSISTANT_ABOUT_LABEL, ASSISTANT_CHIP_DOCUMENT, ASSISTANT_CHIP_NOTHING, ASSISTANT_CHIP_PAGE, EN } from '../messages/en.js';
import { ChoiceMenu } from './ChoiceMenu.js';

function Messages({ children }: { children: ReactNode }): ReactElement {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

/**
 * A choice whose closed face reads only its NAME. The value has to reach a screen reader some other way; these cases
 * hold that the accessible name carries it, that the open menu is headed by the name, that choosing reports it, and
 * that a disabled value cannot be chosen.
 */
type Scope = 'page' | 'document' | 'nothing';

function drawn(value: Scope = 'page', onChange = vi.fn()): { onChange: ReturnType<typeof vi.fn> } {
  activateCatalogue('en', EN);
  render(
    <ChoiceMenu<Scope>
      label={ASSISTANT_ABOUT_LABEL}
      onChange={onChange}
      options={[
        { value: 'page', label: ASSISTANT_CHIP_PAGE, values: { page: 7 } },
        { value: 'document', label: ASSISTANT_CHIP_DOCUMENT },
        { value: 'nothing', label: ASSISTANT_CHIP_NOTHING, disabled: true },
      ]}
      value={value}
    />,
    { wrapper: Messages },
  );
  return { onChange };
}

describe('ChoiceMenu', () => {
  it('shows what is chosen closed, and its name STARTS with what is shown and carries the value', () => {
    drawn();
    const face = screen.getByRole('button', { name: 'Context: Page 7' });
    // THE FACE IS THE NAME (the owner's review of 0.1.9.0), and the accessible name starts with it (WCAG 2.5.3), so a
    // person who says what they see reaches the control by voice, and a screen reader hears the value unopened.
    expect(face.textContent).toBe('Context');
    expect(face.getAttribute('aria-label')?.startsWith(face.textContent)).toBe(true);
  });

  it('opens to a heading and its values as radio items, the chosen one checked, and reports the one chosen', async () => {
    const { onChange } = drawn();
    fireEvent.click(screen.getByRole('button', { name: 'Context: Page 7' }));
    const values = await screen.findAllByRole('menuitemradio');
    // THE VALUES ARE THE CONTEXT GROUP'S: the heading names the group they are announced in.
    expect(screen.getByRole('group', { name: 'Context' }).contains(values[0] ?? null)).toBe(true);
    expect(values.map((value) => value.textContent)).toStrictEqual(['Page 7', 'Document', 'None']);
    expect(values[0]?.getAttribute('aria-checked')).toBe('true');
    const document = values[1];
    if (document === undefined) throw new Error('the menu offers Document');
    fireEvent.click(document);
    await act(async () => {
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledWith('document');
  });

  it('CONTROL: a disabled value is shown and cannot be chosen', async () => {
    const { onChange } = drawn();
    fireEvent.click(screen.getByRole('button', { name: 'Context: Page 7' }));
    const none = (await screen.findAllByRole('menuitemradio')).find((value) => value.textContent === 'None');
    if (none === undefined) throw new Error('the menu offers None, disabled');
    expect(none.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(none);
    await act(async () => {
      await Promise.resolve();
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
