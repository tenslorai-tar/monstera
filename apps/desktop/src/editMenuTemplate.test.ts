import { describe, expect, it } from 'vitest';

import { editMenuTemplate } from './editMenuTemplate.js';

/**
 * The right-click menu of an editable field (the owner's N8): Electron's four roles, each enabled exactly as Chromium
 * said it can be done now. Each flag is false in turn so a template that ignored any one of them fails its own case.
 */
const ALL = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true } as const;

/** Each role's enabled state, by role, the separator left out. */
const enabled = (template: ReturnType<typeof editMenuTemplate>): Record<string, boolean | undefined> =>
  Object.fromEntries((template ?? []).filter((item) => item.role !== undefined).map((item) => [String(item.role), item.enabled]));

describe('editMenuTemplate', () => {
  it('offers Cut, Copy, Paste and Select all in an editable field, in that order, each the platform’s own role', () => {
    const template = editMenuTemplate({ isEditable: true, editFlags: ALL });
    expect(template?.map((item) => item.role ?? item.type)).toStrictEqual(['cut', 'copy', 'paste', 'separator', 'selectAll']);
    // NO LABELS OF OUR OWN: the role gives the words.
    expect(template?.every((item) => item.label === undefined)).toBe(true);
  });

  it('greys each verb Chromium says cannot be done now, and only that one', () => {
    for (const flag of ['canCut', 'canCopy', 'canPaste', 'canSelectAll'] as const) {
      const states = enabled(editMenuTemplate({ isEditable: true, editFlags: { ...ALL, [flag]: false } }));
      const role = { canCut: 'cut', canCopy: 'copy', canPaste: 'paste', canSelectAll: 'selectAll' }[flag];
      expect(states[role], flag).toBe(false);
      expect(Object.values(states).filter((state) => state === false), flag).toHaveLength(1);
    }
  });

  it('CONTROL: a right-click that is not in an editable field offers nothing, so the page’s own menus stand alone', () => {
    expect(editMenuTemplate({ isEditable: false, editFlags: ALL })).toBeNull();
  });
});
