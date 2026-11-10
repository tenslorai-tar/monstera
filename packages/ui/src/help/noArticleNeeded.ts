/**
 * What the Help centre deliberately does not teach, each with its reason
 * ([ADR-0290](../../../../docs/DECISIONS/0290-a-feature-is-not-finished-until-an-article-teaches-it.md)).
 *
 * `articleCoverage.ts` reads these. An entry that has stopped being true fails the same case as a command with no
 * article, so these lists cannot quietly outlive what they excuse.
 */
import { UPDATE_MANIFEST, type UpdateManifestAddress } from '@monstera/contract';

/**
 * Commands with no article, for a build whose update check is in `manifest`'s state: the id, and why a person does not
 * need one.
 *
 * THE UPDATE BUTTON'S EXEMPTION EXISTS ONLY WHILE THE CHECK IS DORMANT, read from the one value that switches it on
 * (`UPDATE_MANIFEST`, ADR-0110), the same value that brings the update setting's row (`settings/updates.ts`). It used to be
 * a sentence saying it owed an article the day the check went live, and nothing would have noticed that day (FFFFFFFFF-11,
 * the audit of 0a5262ba..01d02a84). Going live now removes the excuse in the same one-line change, and the case that
 * every command is taught fails until an article teaches the button.
 */
export function commandsNoArticle(manifest: UpdateManifestAddress): Readonly<Record<string, string>> {
  return {
    'edit.cut': 'The standard Windows Edit menu item, acting on whichever box has the focus. It does nothing specific to Monstera.',
    'edit.paste': 'The standard Windows Edit menu item, acting on whichever box has the focus. Pasting marks is taught by "Select, move, resize and delete annotations".',
    'edit.select-all': 'The standard Windows Edit menu item, acting on whichever box has the focus. It does nothing specific to Monstera.',
    'app.exit': 'Closes the application, as every Windows program does. What happens to unsaved work is taught by "Close a document that has unsaved changes".',
    ...(manifest.state === 'live'
      ? {}
      : {
          'app.update-available':
            'Drawn only when the update check offers a version, and that check is dormant by the owner’s decision of 2026-10-14 (ADR-0110’s note). An article would describe a button nobody can see.',
        }),
  };
}

/** This build's: the update check as `UPDATE_MANIFEST` has it. */
export const COMMANDS_NO_ARTICLE: Readonly<Record<string, string>> = commandsNoArticle(UPDATE_MANIFEST);

/**
 * Where an article teaches a command in other words than its title: `article: command`, and the words it uses. The
 * listing is what F1 and *Show me* read, so it stays, and the reason says why the title is not in the body.
 */
export const TAUGHT_IN_OTHER_WORDS: Readonly<Record<string, string>> = {
  'layout-modes: view.layout-ribbon': 'The article names the layout, Ribbon, where the View menu reads Ribbon layout.',
  'layout-modes: view.layout-studio': 'The article names the layout, Studio, where the View menu reads Studio layout.',
  'layout-modes: view.layout-focus': 'The article names the layout, Focus, where the View menu reads Focus layout.',
  'close-with-unsaved-changes: document.close-tab': 'The article is about closing a tab, by its X and its key, rather than the menu item.',
  'ai-keys-and-pricing: ai.open-assistant': 'The article says where the keys are used, the AI assistant, rather than the command that opens it.',
  'make-scanned-pages-searchable: start.ocr': 'The start screen’s card is a route to this article’s tool, named in the article by the tool.',
  'password-and-permissions: start.encrypt-sign': 'The start screen’s card is a route to this article’s tool, named in the article by the tool.',
  'status-bar: view.zoom-in': 'The article calls these the zoom buttons, which is how they look in the bar.',
  'status-bar: view.zoom-out': 'The article calls these the zoom buttons, which is how they look in the bar.',
  'float-bar: view.zoom-out': 'The article describes the bar’s buttons by what they do.',
  'float-bar: view.select-text': 'The article describes the bar’s buttons by what they do.',
  'float-bar: document.crop-pages': 'The article describes the bar’s buttons by what they do.',
  'select-annotations: annotate.delete-selection': 'Taught as the Delete key, which is how a person does it.',
  'select-annotations: annotate.nudge-left': 'Taught as the arrow keys, which is the only way to reach it.',
  'select-annotations: annotate.nudge-right': 'Taught as the arrow keys, which is the only way to reach it.',
  'select-annotations: annotate.nudge-up': 'Taught as the arrow keys, which is the only way to reach it.',
  'select-annotations: annotate.nudge-down': 'Taught as the arrow keys, which is the only way to reach it.',
  'select-annotations: annotate.nudge-left-far': 'Taught as Shift and the arrow keys, which is the only way to reach it.',
  'select-annotations: annotate.nudge-right-far': 'Taught as Shift and the arrow keys, which is the only way to reach it.',
  'select-annotations: annotate.nudge-up-far': 'Taught as Shift and the arrow keys, which is the only way to reach it.',
  'select-annotations: annotate.nudge-down-far': 'Taught as Shift and the arrow keys, which is the only way to reach it.',
  'find-any-tool: view.command-palette': 'The article names it as a person sees it, the Search commands box in the title bar.',
  'move-between-pages: view.go-to': 'Taught as its key and the page field, which is how a person reaches it.',
  'move-between-pages: view.page-first': 'Taught as its key, Ctrl+Home.',
  'move-between-pages: view.page-next': 'Taught as its key, Page Down.',
  'move-between-pages: view.page-previous': 'Taught as its key, Page Up.',
  'document-panel: view.toggle-panel': 'The article names its two states, collapse and show, where the command names the panel.',
  'properties-panel: view.toggle-context-panel': 'The article names its two states, collapse and show, where the command names the panel.',
};

/** Settings the dialog shows that no article names. */
export const SETTINGS_NO_ARTICLE: Readonly<Record<string, string>> = {};
