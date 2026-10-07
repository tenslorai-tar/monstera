// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { HELP_ARTICLES, screenshotUrl } from '../help/articles.js';
import { activateCatalogue, i18n } from '../i18n.js';
import { CLOSE_LABEL, EN, HELP_TITLE, ROTATE_PAGE_180_TITLE, ROTATE_PAGE_TITLE, SAVE_TITLE } from '../messages/en.js';
import { Dialog } from '../primitives/Dialog.js';
import type { HelpAnswer } from './help.js';
import HelpBody from './HelpBody.js';

/**
 * The Help centre's body (ADR-0112). The command's half — where F1 opens it and what *Show me* does to the ribbon — is
 * `App.test.tsx`'; this half is what the body draws for the props it is given, and what it answers.
 */

/** IN THE DIALOG, as the registry mounts it: the footer's Close is the popup's own close and exists only inside one. */
function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return (
    <I18nProvider i18n={i18n}>
      <Dialog closeLabel={CLOSE_LABEL} onOpenChange={() => undefined} open title={HELP_TITLE}>
        {children}
      </Dialog>
    </I18nProvider>
  );
}

afterEach(() => {
  cleanup();
});

/** The body, recording what it answers. */
function drawn(props: {
  readonly article?: string | null;
  readonly context?: string | null;
  readonly showable?: readonly { readonly id: string; readonly title: MessageKey }[];
}): HelpAnswer[] {
  const answered: HelpAnswer[] = [];
  render(
    <HelpBody
      article={props.article ?? null}
      context={props.context ?? null}
      showable={props.showable ?? []}
      resolve={(answer) => answered.push(answer)}
      update={() => undefined}
    />,
    { wrapper: Wrapped },
  );
  return answered;
}

const listed = (): (string | null)[] =>
  [...document.querySelectorAll('[data-article]')].map((item) => item.getAttribute('data-article'));

describe('the Help centre’s body', () => {
  it('opens on the list: the context’s articles under their own heading, then every article', () => {
    drawn({ context: 'organize' });
    const here = HELP_ARTICLES.filter((article) => article.contexts.includes('organize')).map((article) => article.id);
    expect(here.length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Suggested for you' })).toBeDefined();
    // THE OLD WORDS ARE GONE, so the heading above is the rename and not an addition beside the old one.
    expect(screen.queryByRole('heading', { name: 'For what you are doing' })).toBeNull();
    expect(listed()).toStrictEqual([...here, ...HELP_ARTICLES.map((article) => article.id)]);
  });

  it('CONTROL: with no context, no *Suggested for you* — only every article', () => {
    drawn({});
    expect(screen.queryByRole('heading', { name: 'Suggested for you' })).toBeNull();
    expect(listed()).toStrictEqual(HELP_ARTICLES.map((article) => article.id));
  });

  it('searches every article, says how many it found, and says so when it found none', () => {
    drawn({ context: 'organize' });
    const field = screen.getByRole('textbox', { name: 'Search help' });
    fireEvent.change(field, { target: { value: 'rotate' } });
    expect(listed()[0]).toBe('rotate-pages');
    expect(screen.getByRole('status').textContent).toMatch(/\d+ articles|One article/u);
    // THE CONTEXT'S LIST GOES while searching: a search answers the words typed, not the place.
    expect(screen.queryByRole('heading', { name: 'Suggested for you' })).toBeNull();

    fireEvent.change(field, { target: { value: 'rotate zzzznotaword' } });
    expect(listed()).toStrictEqual([]);
    expect(screen.getByRole('status').textContent).toBe('No article matches that. Try fewer or different words.');
  });

  it('opens the article it was given, draws its steps, and moves focus between the list and the article', async () => {
    drawn({ article: 'rotate-pages' });
    expect(screen.getByRole('heading', { level: 3, name: 'Rotate pages' })).toBeDefined();
    expect(document.querySelector('.m-help__article ol li')).not.toBeNull();
    // THE DIALOG'S OWN FIRST FOCUS SETTLES FIRST, as it has long before a person presses anything.
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('dialog'));
    });

    // PRESSED FROM THE KEYBOARD: the focused control is the one the change removes, which is the harder case — the
    // dialog's focus manager answers a focused element's removal by focusing the popup when focus is left on the body.
    const back = screen.getByRole('button', { name: 'Back to the list' });
    await act(async () => {
      back.focus();
      back.click();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search help' }));

    const item = document.querySelector<HTMLElement>('[data-article="rotate-pages"]');
    await act(async () => {
      item?.focus();
      item?.click();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 3, name: 'Rotate pages' }));
  });

  it('an id it does not know opens the list rather than an error', () => {
    drawn({ article: 'no-such-article' });
    expect(screen.getByRole('textbox', { name: 'Search help' })).toBeDefined();
  });

  it('draws *Show me* for exactly the article’s commands that are showable, and answers with the one chosen', async () => {
    const answered = drawn({
      article: 'rotate-pages',
      // SAVE IS SHOWABLE AND NOT THIS ARTICLE'S, and the 270 turn is this article's and not showable: only the pair
      // both lists hold may draw.
      showable: [
        { id: 'document.rotate-page', title: ROTATE_PAGE_TITLE },
        { id: 'document.rotate-page-180', title: ROTATE_PAGE_180_TITLE },
        { id: 'document.save', title: SAVE_TITLE },
      ],
    });
    const group = screen.getByRole('group', { name: 'Show me' });
    expect(within(group).getAllByRole('button').map((button) => button.textContent)).toStrictEqual([
      'Rotate page',
      'Rotate page 180°',
    ]);
    await act(async () => {
      within(group).getByRole('button', { name: 'Rotate page 180°' }).click();
      await Promise.resolve();
    });
    expect(answered).toStrictEqual([{ kind: 'show', command: 'document.rotate-page-180' }]);
  });

  it('CONTROL: with nothing showable, no *Show me* at all — a button that rang nothing is the defect', () => {
    drawn({ article: 'rotate-pages', showable: [] });
    expect(screen.queryByRole('group', { name: 'Show me' })).toBeNull();
  });

  it('a screenshot the article names and nobody captured is left out: no figure, no image, no stand-in', () => {
    const naming = HELP_ARTICLES.filter((article) =>
      article.blocks.some((each) => each.kind === 'screenshot' && screenshotUrl(each.id) === undefined),
    );
    // THE PRECONDITION IS THE CONTROL: an article that names an uncaptured screenshot exists, so an empty page below
    // is the branch deciding and not a fixture with no screenshot in it.
    expect(naming.length).toBeGreaterThan(0);
    const article = naming[0];
    if (article === undefined) throw new Error('unreachable: the length was asserted');
    drawn({ article: article.id });
    expect(screen.getByRole('heading', { level: 3 })).toBeDefined();
    expect(document.querySelectorAll('.m-help__screenshot, img')).toHaveLength(0);
  });
});
