import { Menu, type WebContents } from 'electron';

import { editMenuTemplate } from './editMenuTemplate.js';

/** Offers `editMenuTemplate`'s menu on every right-click in an editable field of `contents` (the owner's N8). */
export function offerEditMenu(contents: WebContents): void {
  contents.on('context-menu', (_event, params) => {
    const template = editMenuTemplate(params);
    if (template === null) return;
    Menu.buildFromTemplate(template).popup();
  });
}
