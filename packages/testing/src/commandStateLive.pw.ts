import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { asDocId, asDocVersion } from '@monstera/shared';
import { type Locator, type Page, expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { bridge } from './pageBridge.js';

/**
 * EVERY COMMAND'S STATE IS DRAWN THE MOMENT IT MOVES, in every surface that draws it (ADR-0258's correction of
 * 2026-10-26, the owner's second video of that day): Loupe on the Tools tab, pressed once, turned the loupe on and its
 * button stayed unpressed until the person switched tabs and back.
 *
 * ## The list, and its anchor
 *
 * `fixtures/stateful-commands.json` is every registered command that has a state (`checked`), with every surface that
 * draws it: its ribbon section (and the ribbon menu holding it), the quick toolbar, the status bar, the rail, and every
 * menu of the bar. It is generated from the registry and the menu bar's own model by `App.test.tsx`, which also holds
 * the command ids against a list written out by name, so a command that left the registry or lost its state is named
 * there rather than dropped here in silence.
 *
 * ## What each case does
 *
 * Opens a document, then for each surface that draws the command: reads the state it draws, presses the command THERE,
 * and reads it again with nothing else done — no tab switched, no surface remounted. A button is held as one element
 * across the presses and must still be the same element; a menu is opened again to be read, which is how a person
 * reads one. The state must move, and a second press must move it back. A command that only chooses (a theme, a
 * layout, the panel shown, the default tool) is moved away by choosing its sibling and back by choosing it.
 *
 * ## The control
 *
 * Run 2026-10-26 on Chromium 151 against this tree with `App` handing the surfaces the context without its answers:
 * nine of the 75 red — Loupe, the rulers, the grid, the dark page, split view, field highlight, the quick toolbar's
 * switch, and the ribbon's Comments and Fields panel buttons — every one a state read from the settings. The theme, the
 * layout and the panel choices in the menus stayed green there: something else renders the menu bar when they move,
 * which is luck the answers no longer depend on. With the answers, 75 of 75.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000c4');
const FIXTURES = join(dirname(createRequire(import.meta.url).resolve('../package.json')), 'fixtures');

interface Where {
  readonly surface: 'ribbon' | 'menu-bar' | 'quick-toolbar' | 'status-bar' | 'rail';
  readonly section?: string;
  readonly menu?: string;
}
interface Stateful {
  readonly id: string;
  readonly title: string;
  readonly where: readonly Where[];
}
const LIST = JSON.parse(readFileSync(join(FIXTURES, 'stateful-commands.json'), 'utf8')) as readonly Stateful[];
const byId = new Map(LIST.map((command) => [command.id, command]));

/**
 * A command that only CHOOSES: pressed again it stays chosen, so it is moved away by choosing the sibling named here,
 * from the same surface. Every other command toggles: a second press takes back the first.
 */
const CHOOSES: Readonly<Record<string, string>> = {
  'view.theme-system': 'view.theme-light',
  'view.theme-light': 'view.theme-dark',
  'view.theme-dark': 'view.theme-light',
  'view.layout-ribbon': 'view.layout-studio',
  'view.layout-studio': 'view.layout-ribbon',
  'view.layout-focus': 'view.layout-ribbon',
  'view.show-pages': 'view.show-bookmarks',
  'view.show-bookmarks': 'view.show-pages',
  'view.show-layers': 'view.show-pages',
  'view.show-search': 'view.show-pages',
  'view.show-comments': 'view.show-pages',
  'view.show-fields': 'view.show-pages',
  // PROPERTIES IS THE OTHER PANEL'S TAB, and the tabs beside it are no commands: it is moved away by hiding that panel.
  'view.show-properties': 'view.toggle-context-panel',
  // THE DEFAULT TOOL: pressed again it stays the tool. The hand beside it TOGGLES, pressed again it is put down.
  'view.select-text': 'view.hand',
};

/** Commands that ask something before their state can be on, answered as a person does (`markLook.pw.ts`'s way). */
const ANSWERS: Readonly<Record<string, (page: Page) => Promise<void>>> = {
  'annotate.signature': async (page) => {
    const chooser = page.getByRole('dialog', { name: 'Signature' });
    // ASKED ONLY WHEN TAKEN UP: pressed while it is the tool, it is put down and nothing is asked. The dialog opens a
    // task after the press, so it is waited for rather than counted at once.
    const asked = await chooser.waitFor({ state: 'visible', timeout: 1500 }).then(
      () => true,
      () => false,
    );
    if (!asked) return;
    await chooser.getByRole('button', { name: 'Type' }).click();
    await chooser.getByRole('textbox', { name: 'Your name' }).fill('Ada Lovelace');
    await chooser.getByRole('button', { name: 'Use Signature' }).click();
    await expect(chooser).toBeHidden();
    await expect(page.locator('[data-annotation-overlay][data-tool="annotate.signature"]').first()).toBeAttached();
  },
};

/**
 * How long a state may take to be drawn after its press: a render or two, as a tool armed after a dialog's answer is.
 * The defect is a state that is NEVER drawn until something remounts the surface, which no wait shortens.
 */
const SETTLES = 2000;

/** Commands no surface draws, which `App.test.tsx` lists with an empty `where` and this file therefore cannot press. */
const DRAWN_NOWHERE = ['text.format.bold', 'text.format.italic', 'text.format.underline', 'text.format.strike', 'text.format.superscript', 'text.format.subscript'];

/** Opens the document; `times` is how many opens the shim answers, for a case that closes it and opens it again. */
async function open(page: Page, times = 1): Promise<void> {
  await page.setViewportSize({ width: 2000, height: 1000 });
  const bytes = await blockedPages([612, 792], 1);
  await bridge(page, {
    // THE REGION TOOLS ARE OFFERED once their service is set up: an address and a key for one, a key for the other.
    // Placeholders, never a real key: nothing here reaches a service.
    settings: { 'appearance.quick-toolbar-open': true, 'editing.azure-di-endpoint': 'https://example.cognitiveservices.azure.com/' },
    secrets: { 'editing.azure-di-key': 'placeholder', 'ai.anthropic-key': 'placeholder' },
    // AN ENGINE THAT ANSWERS, so Edit text and Edit object start: a page with no blocks and no objects.
    textBlocks: [],
    pageObjects: [],
    opens: Array.from({ length: times }, () => ({ kind: 'opened' as const, docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'one.pdf' })),
    documentBytes: new Map([[DOC, bytes]]),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await page.locator('.m-page-slot').first().waitFor();
}

/** How one surface's control for a command is read and pressed. */
interface Control {
  readonly read: () => Promise<string>;
  readonly press: () => Promise<void>;
}

/** Closes what a press opened — a dialog, a menu — by its own control, never by a key the page would also hear. */
async function settle(page: Page): Promise<void> {
  for (let at = 0; at < 3 && (await page.locator('[role="dialog"], [role="alertdialog"]').count()) > 0; at += 1) {
    await page.keyboard.press('Escape');
  }
}

async function controlOf(page: Page, command: Stateful, where: Where): Promise<Control> {
  const { id, title } = command;
  const button = async (locator: Locator): Promise<Control> => {
    await expect(locator, `${id} drawn in ${JSON.stringify(where)}`).toHaveCount(1);
    const handle = await locator.elementHandle();
    return {
      // THE SAME ELEMENT as before the press: a state that shows only on a remount is the defect.
      read: async () => ((await handle.evaluate((element) => element.isConnected)) ? String(await handle.getAttribute('aria-pressed')) : 'remounted'),
      press: async () => {
        await handle.click();
        await ANSWERS[id]?.(page);
        await settle(page);
      },
    };
  };
  const menuItem = (trigger: () => Promise<Locator>): Control => {
    const item = page.locator(`[role="menuitemcheckbox"][data-command="${id}"]`);
    const opened = async (): Promise<Locator> => {
      const opener = await trigger();
      await opener.click();
      await expect(item, `${id} in its menu, ${JSON.stringify(where)}`).toHaveCount(1);
      return opener;
    };
    return {
      read: async () => {
        const opener = await opened();
        const value = String(await item.getAttribute('aria-checked'));
        // CLOSED BY ITS OWN TRIGGER: an Escape reaches the page too, and puts down the tool being read.
        await opener.click();
        await expect(item).toHaveCount(0);
        return value;
      },
      // BY THE KEYBOARD: a long menu scrolls under a pointer that crosses its scroll arrows, so a click can land on the
      // item beside the one aimed at.
      press: async () => {
        await opened();
        await item.press('Enter');
        await expect(item).toHaveCount(0);
        await ANSWERS[id]?.(page);
        await settle(page);
      },
    };
  };
  if (where.surface === 'ribbon') {
    const section = page.locator(`.m-ribbon__rail [data-ribbon-section="${String(where.section)}"]`);
    await section.click();
    if (where.menu === undefined) return button(page.locator(`.m-ribbon [data-command="${id}"][aria-pressed]`));
    return menuItem(async () => {
      if ((await section.getAttribute('aria-current')) !== 'true') await section.click();
      return page.locator(`.m-ribbon [data-holds~="${id}"]:not([aria-hidden="true"])`).first();
    });
  }
  if (where.surface === 'menu-bar') return menuItem(() => Promise.resolve(page.locator(`[data-menu="${String(where.menu)}"]`)));
  // BY ITS NAME where the surface draws a command as an icon button, which carries no `data-command`.
  if (where.surface === 'quick-toolbar') return button(page.locator('.m-quick-toolbar').getByRole('button', { name: title, exact: true }));
  if (where.surface === 'status-bar') return button(page.locator('.m-status-bar').getByRole('button', { name: title, exact: true }));
  return button(page.locator(`.m-ribbon__rail [data-command="${id}"]`));
}

test('the list holds every stateful command, and the ones this file cannot press say why', () => {
  // NOT A COPY OF THE ANCHOR (that is `App.test.tsx`'s): a list that reads empty or lost its surfaces would make every
  // case below vacuous, so it must name commands, and each must be drawn somewhere or be said to be drawn nowhere.
  expect(LIST.length).toBeGreaterThan(0);
  for (const command of LIST) {
    expect(command.where.length > 0 || DRAWN_NOWHERE.includes(command.id), `${command.id} is drawn nowhere and not said to be`).toBe(true);
  }
  for (const [id, sibling] of Object.entries(CHOOSES)) expect(byId.has(id) && byId.has(sibling), `${id} → ${sibling}`).toBe(true);
});

for (const command of LIST.filter((each) => each.where.length > 0)) {
  test(`${command.id}: its state is drawn at once in every surface that draws it`, async ({ page }) => {
    await open(page);
    for (const where of command.where) {
      const control = await controlOf(page, command, where);
      const sibling = CHOOSES[command.id];
      const facts = `${command.id} in ${JSON.stringify(where)}`;
      if (sibling === undefined) {
        const before = await control.read();
        expect(['true', 'false'], `${facts} draws a state`).toContain(before);
        await control.press();
        await expect.poll(() => control.read(), { message: `${facts}, pressed once`, timeout: SETTLES }).toBe(before === 'true' ? 'false' : 'true');
        await control.press();
        await expect.poll(() => control.read(), { message: `${facts}, pressed again`, timeout: SETTLES }).toBe(before);
        continue;
      }
      // A CHOICE: chosen here, moved away by its sibling — from beside it where the sibling is drawn there, else from
      // wherever it is — and chosen back, read here after each.
      const other = byId.get(sibling);
      const beside = other?.where.find((place) => place.surface === where.surface && place.menu === where.menu && place.section === where.section);
      const there = beside ?? other?.where[0];
      if (other === undefined || there === undefined) throw new Error(`${sibling} is drawn nowhere, so ${facts} cannot be moved away`);
      const mine = await controlOf(page, command, where);
      await mine.press();
      await expect.poll(() => mine.read(), { message: `${facts}, chosen`, timeout: SETTLES }).toBe('true');
      await (await controlOf(page, other, there)).press();
      // THE SAME ELEMENT where the sibling sits beside it; found again only where reaching the sibling moved the view.
      const back = beside === undefined ? await controlOf(page, command, where) : mine;
      await expect.poll(() => back.read(), { message: `${facts}, after its sibling ${sibling} was pressed`, timeout: SETTLES }).toBe('false');
      await back.press();
      await expect.poll(() => back.read(), { message: `${facts}, chosen again`, timeout: SETTLES }).toBe('true');
    }
  });
}

/*
 * A SAMPLE OF `when`: a control that exists only in some states appears and goes the moment the state moves. The first
 * reads the settings, as `checked`'s nine did; the second reads the shell's own state, which the registry is rebuilt
 * from, and is here so the sample holds both kinds. Control, the same run as above: the first red — the focus layout's
 * hint naming its way out was NEVER drawn, since `FocusHint` asks `view.leave-focus`'s `when` in render with nothing it
 * is given having moved — and the second green, as a state the shell holds should be.
 */

test('when: the focus layout’s way out is offered the moment focus is chosen, and goes when it is left', async ({ page }) => {
  await open(page);
  const hint = page.locator('.m-focus-hint');
  await expect(hint).toHaveCount(0);
  const focus = await controlOf(page, byId.get('view.layout-focus') ?? LIST[0] ?? { id: '', title: '', where: [] }, { surface: 'menu-bar', menu: 'view' });
  await focus.press();
  await expect(hint, 'view.leave-focus, offered once focus is chosen').toHaveCount(1, { timeout: SETTLES });
  await page.keyboard.press('Escape');
  await expect(hint, 'view.leave-focus, gone once focus is left').toHaveCount(0, { timeout: SETTLES });
});

test('when: a document’s tools go with the document and come back with the next', async ({ page }) => {
  await open(page, 2);
  await page.locator('.m-ribbon__rail [data-ribbon-section="tools"]').click();
  const loupe = page.locator('.m-ribbon [data-command="view.toggle-loupe"]');
  await expect(loupe).toHaveCount(1);
  await page.keyboard.press('Control+W');
  await expect(loupe, 'view.toggle-loupe, with no document').toHaveCount(0, { timeout: SETTLES });
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await page.locator('.m-page-slot').first().waitFor();
  await page.locator('.m-ribbon__rail [data-ribbon-section="tools"]').click();
  await expect(loupe, 'view.toggle-loupe, with a document again').toHaveCount(1, { timeout: SETTLES });
});
