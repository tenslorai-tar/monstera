import { describe, expect, it } from 'vitest';

import { GROUP_DISPLAY } from '../messages/en.js';
import type { ZoomMode } from '../zoom.js';
import { fitCommand } from './documentCommands.js';

/** The two fits, each recording the mode it asks for. */
function fits(): { asked: ZoomMode[]; width: ReturnType<typeof fitCommand>; page: ReturnType<typeof fitCommand> } {
  const asked: ZoomMode[] = [];
  const onZoom = (next: (shown: number) => ZoomMode): void => {
    asked.push(next(1));
  };
  return { asked, width: fitCommand('width', { onZoom }), page: fitCommand('page', { onZoom }) };
}

describe('the two fits on Home › Display (ADR-0107’s 2026-10-02 correction)', () => {
  it('Fit page sits on Home › Display RIGHT AFTER Fit width', () => {
    const { width, page } = fits();
    const home = (command: typeof width): { order: number } | undefined => {
      const placement = command.placements.find(
        (each) => each.surface === 'ribbon' && each.section === 'home' && each.group === GROUP_DISPLAY,
      );
      return placement?.surface === 'ribbon' ? { order: placement.order } : undefined;
    };
    expect(home(width)).toStrictEqual({ order: 200 });
    expect(home(page)).toStrictEqual({ order: 202 });
    // NOTHING ELSE ON HOME › DISPLAY SITS BETWEEN THEM: the registry's next Home › Display tool is at 204 (Dim pages).
  });

  it('it keeps its Tools › Display, View › Zoom and status-bar places', () => {
    // THE MENU-BAR PLACEMENT is what Decision 3 requires of a Home tool; `CommandRegistry` refuses one without it, and
    // every App case builds the application's registry, so that refusal runs there over the whole set.
    expect(
      fits().page.placements.map((each) => (each.surface === 'ribbon' ? `ribbon:${each.section}` : each.surface)),
    ).toStrictEqual(['ribbon:tools', 'ribbon:home', 'menu-bar', 'status-bar']);
  });

  it('each sets its fit as a MODE, never a number', async () => {
    const { asked, width, page } = fits();
    await width.run({ selectedPages: [], docId: undefined, version: undefined, hasSelection: false, dirty: false, page: undefined, pageCount: undefined, openDocuments: [] });
    await page.run({ selectedPages: [], docId: undefined, version: undefined, hasSelection: false, dirty: false, page: undefined, pageCount: undefined, openDocuments: [] });
    expect(asked).toStrictEqual([{ kind: 'fit-width' }, { kind: 'fit-page' }]);
  });
});
