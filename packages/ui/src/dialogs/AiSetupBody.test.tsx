// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AiSetupBody from './AiSetupBody.js';
import { InDialog } from './inDialog.js';

/**
 * The AI setup window's body (ADR-0184): it starts on *Choose a provider* with nothing chosen, says which key the
 * chosen provider needs, and offers a link to where it is got — as a REPORT, so the window stays open.
 */

afterEach(cleanup);

function drawn(): { readonly resolve: ReturnType<typeof vi.fn>; readonly update: ReturnType<typeof vi.fn> } {
  const resolve = vi.fn();
  const update = vi.fn();
  render(
    <InDialog>
      <AiSetupBody resolve={resolve} secretsAvailable update={update} />
    </InDialog>,
  );
  return { resolve, update };
}

const providerList = (): HTMLSelectElement => screen.getByRole('combobox', { name: 'Provider' });

describe('Set up AI — the provider', () => {
  it('opens on “Choose a provider”, with NO provider chosen and no key help shown', () => {
    drawn();
    expect(providerList().value).toBe('');
    expect(providerList().selectedOptions[0]?.textContent).toBe('Choose a provider');
    expect(document.querySelector('[data-ai-setup-key-help]')).toBeNull();
    // CONTROL: the real providers are still all offered after the placeholder, so the list was not emptied to get here.
    expect(providerList().options.length).toBe(11);
  });

  it('a key typed with NO provider chosen cannot be checked', () => {
    drawn();
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-test' } });
    expect(screen.getByRole('button', { name: 'Check and save' }).hasAttribute('disabled')).toBe(true);
    // CONTROL: choosing one makes the same key checkable, so the button was held by the missing provider and not by the key.
    fireEvent.change(providerList(), { target: { value: 'groq' } });
    expect(screen.getByRole('button', { name: 'Check and save' }).hasAttribute('disabled')).toBe(false);
  });

  it('says which key the chosen provider needs, and its link REPORTS the provider without closing the window', () => {
    const { resolve, update } = drawn();
    fireEvent.change(providerList(), { target: { value: 'groq' } });
    expect(screen.getByText('Groq needs an API key. You get one by signing in to your Groq account on its website.')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Get a Groq key' }));
    expect(update).toHaveBeenCalledWith({ kind: 'key-page', provider: 'groq' });
    // THE WINDOW STAYS OPEN: nothing was answered.
    expect(resolve).not.toHaveBeenCalled();
  });

  it('names the provider CHOSEN, not a neighbour, and only Azure carries the portal note', () => {
    drawn();
    fireEvent.change(providerList(), { target: { value: 'openai' } });
    expect(screen.getByRole('button', { name: 'Get a OpenAI key' })).toBeDefined();
    expect(screen.queryByText(/Keys and Endpoint/u)).toBeNull();
    fireEvent.change(providerList(), { target: { value: 'azure-openai' } });
    expect(screen.getByText(/Keys and Endpoint/u)).toBeDefined();
  });

  it('the provider list takes the key field’s own width class, so the two read as one column', () => {
    drawn();
    expect(providerList().className).toContain('m-ai-setup__provider');
  });
});
