import type { MenuItemConstructorOptions } from 'electron';

/**
 * What a right-click in an editable field offers (the owner's N8): Cut, Copy, Paste and Select all, each Electron's own
 * ROLE, so its words and its action are the platform's and no field writes a clipboard verb of its own.
 *
 * ## ONE MECHANISM, for every field
 *
 * Electron draws no menu of its own on a right-click; it reports one (`context-menu`), with what Chromium knows of the
 * target: whether it is editable, and which of the four it can do now (`editFlags`). So one listener on the window's
 * contents (`offerEditMenu`) answers every text box, search field, settings field, key field and dialog field alike, and
 * a field added tomorrow has the menu without being told. A surface with a menu of its own (the page's, the in-place
 * editor's) prevents the event in the page, and Chromium then reports nothing, so the two never open together.
 *
 * ## Greyed, never hidden
 *
 * A verb that does not apply now (Paste with an empty clipboard, Cut with nothing selected) is shown disabled, so the
 * menu reads the same in every field and says what it can do.
 *
 * Its own module, with Electron named for its TYPES only, so the decision is tested without importing Electron, whose
 * import is its download (invariant 26).
 */
export function editMenuTemplate(params: {
  readonly isEditable: boolean;
  readonly editFlags: { readonly canCut: boolean; readonly canCopy: boolean; readonly canPaste: boolean; readonly canSelectAll: boolean };
}): MenuItemConstructorOptions[] | null {
  if (!params.isEditable) return null;
  const { canCut, canCopy, canPaste, canSelectAll } = params.editFlags;
  return [
    { role: 'cut', enabled: canCut },
    { role: 'copy', enabled: canCopy },
    { role: 'paste', enabled: canPaste },
    { type: 'separator' },
    { role: 'selectAll', enabled: canSelectAll },
  ];
}
