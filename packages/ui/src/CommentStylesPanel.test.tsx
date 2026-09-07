// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { asDocVersion } from '@monstera/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { PLAIN_STYLE } from './annotations/annotationStyle.js';
import type { AnnotationSelection } from './annotations/selectTool.js';
import { CommentStylesPanel } from './CommentStylesPanel.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';

/**
 * The comment styles panel.
 *
 * Its whole job is to say what the selected annotations look like NOW and to
 * hand the selection over. So the cases are about what it shows for a style it
 * did not choose, and what it passes on — never about the controls above it,
 * which are `StylePanel`'s.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

/** One selected annotation, blue at half opacity with a 3-point border. */
const ITEM = {
  index: 1,
  rect: { x0: 0, y0: 0, x1: 10, y1: 10 },
  style: { colour: [0, 0, 1], opacity: 0.5, borderWidth: 3 },
} as const;

const BLUE: AnnotationSelection = { page: 2, version: asDocVersion(7), items: [ITEM] };

function mounted(selection: AnnotationSelection | undefined): { applied: unknown[] } {
  const applied: unknown[] = [];
  render(
    <Wrapped>
      <CommentStylesPanel
        onApply={(chosen) => {
          applied.push(chosen);
        }}
        selection={selection}
        style={PLAIN_STYLE}
      />
    </Wrapped>,
  );
  return { applied };
}

describe('CommentStylesPanel', () => {
  it('says so when nothing is selected, and offers no control', () => {
    // *Apply* with nothing to apply to is a button that does nothing, which is
    // the display-only sin; the panel says what to do instead.
    mounted(undefined);
    expect(screen.getByText(/Select annotations/u)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the style the annotation ALREADY has, not the one about to be applied', () => {
    // The two are deliberately different in this fixture: the selection is blue
    // at half opacity and `PLAIN_STYLE` is neither. A panel that rendered the
    // pending style twice would pass a case where they agreed.
    const { container } = render(
      <Wrapped>
        <CommentStylesPanel onApply={() => undefined} selection={BLUE} style={PLAIN_STYLE} />
      </Wrapped>,
    );
    const swatch = container.querySelector('[data-current-colour]');
    expect(swatch?.getAttribute('data-current-colour')).toBe('#0000ff');
    expect(swatch?.getAttribute('data-current-opacity')).toBe('0.5');
    expect(swatch?.getAttribute('data-current-width')).toBe('3');
  });

  it('SAYS a kind has no line width rather than showing zero', () => {
    // Six subtypes have no `/BS` at all. A `0` reads as *no border* rather than
    // *no such property*, which is what a person would then try to set.
    const noWidth: AnnotationSelection = {
      ...BLUE,
      items: [{ ...ITEM, style: { colour: [0, 0, 1], opacity: 1, borderWidth: null } }],
    };
    const { container } = render(
      <Wrapped>
        <CommentStylesPanel onApply={() => undefined} selection={noWidth} style={PLAIN_STYLE} />
      </Wrapped>,
    );
    expect(container.querySelector('[data-current-width]')?.getAttribute('data-current-width')).toBe(
      '',
    );
    expect(screen.getByText(/no line width/u)).toBeTruthy();
  });

  it('names the count when several are selected, because the swatch shows one', () => {
    // A panel showing one style as though it were all is the compound claim
    // this project keeps paying for. The heading is what keeps it honest.
    mounted({ ...BLUE, items: [ITEM, { ...ITEM, index: 4 }] });
    expect(screen.getByText(/2 annotations selected/u)).toBeTruthy();
  });

  it('hands the WHOLE selection over, version and all', () => {
    // One decision is one command: the dispatcher builds a single
    // `styleAnnotation` from this, and the version it carries is the one the
    // walk was read at — which is what makes the kernel's refusal reachable.
    const { applied } = mounted(BLUE);
    fireEvent.click(screen.getByRole('button'));
    expect(applied).toStrictEqual([BLUE]);
  });
});
