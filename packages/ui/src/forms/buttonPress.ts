import {
  type CommandOfKind,
  type ContractClient,
  type FieldAction,
  type FieldActionTrigger,
  stepRunsAs,
} from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';

import { askThenOpen } from '../commands/followLink.js';
import { BUTTON_PRESS_UNREAD } from '../messages/en.js';
import type { ShowToast } from '../toasts.js';
import { ZOOM_STEPS, type ZoomMode } from '../zoom.js';

/** What a press needs: the button's steps, the one place a command is sent, the way a page is shown, and a sentence. */
export interface ButtonPressDeps {
  readonly client: Pick<ContractClient, 'document.buttonActions' | 'document.openButtonLink'>;
  /** Opens a registered dialog and answers what it resolved: the question every address a document holds is asked. */
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
  /** Sends a command naming one step; resolves with the version it produced, or `undefined` where it did not land. */
  readonly apply: (command: ButtonStepCommand) => Promise<DocVersion | undefined>;
  /** Shows a zero-based page, at a zoom where the action names one: every other way of going to a page's route. */
  readonly show: (page: number, zoom: ZoomMode | undefined) => void;
  /** Runs one of the application's own registered commands, as its ribbon button does, to its end. */
  readonly run: (id: ButtonCommandId) => Promise<void>;
  readonly toast: ShowToast;
}

/** The commands a press sends, each naming one step of the button: the kernel reads what the step does. */
export type ButtonStepCommand = CommandOfKind<'resetForm'> | CommandOfKind<'showHideFields'>;

/**
 * The application's own commands a button's action is (ADR-0259 Decision 2): what a press does is what the person would
 * do from the ribbon, with the same dialogs, so the action never prints or imports by a second route.
 */
export type ButtonCommandId = 'document.print' | 'document.import-form-data-fdf';

/**
 * The zoom a go-to asks for (ISO 32000-1, table 151): the whole page, the page's width, or an `/XYZ`'s own zoom, kept
 * inside the zoom ladder's ends as every other zoom is; `undefined` keeps the reader's.
 */
export function zoomOfGoTo(action: Extract<FieldAction, { kind: 'goTo' }>): ZoomMode | undefined {
  if (action.view === 'fit') return { kind: 'fit-page' };
  if (action.view === 'fit-width') return { kind: 'fit-width' };
  const zoom = action.at?.zoom ?? null;
  if (zoom === null) return undefined;
  const least = ZOOM_STEPS[0];
  const most = ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? least;
  return { kind: 'scale', scale: Math.min(most, Math.max(least, zoom)) };
}

/** The button pressed: its place, its name, and the trigger the press was. */
export interface ButtonPressed {
  readonly page: number;
  readonly index: number;
  readonly name: string;
  readonly trigger: FieldActionTrigger;
}

/**
 * Carries out a push button's actions on one trigger, IN ORDER (ADR-0259 Decision 3).
 *
 * The steps are read from the document when the button is pressed, never from a listing made earlier, so what runs is
 * what the document holds now. Each step is carried out by the route that owns what it does and is AWAITED before the
 * next: a print after a reset must print the form reset. A step that changes the document moves its version, and the
 * next is sent at the version that one produced; one that does not land ends the press, since the rest was written to
 * follow it.
 *
 * What is sent names the step, never what it does: the kernel reads the action again (`resetForm`'s reason).
 */
export async function pressButton(deps: ButtonPressDeps, docId: DocId, pressed: ButtonPressed): Promise<void> {
  const field = { page: pressed.page, index: pressed.index, name: pressed.name };
  const read = await deps.client['document.buttonActions']({ docId, field });
  if (!read.ok || read.value.steps === null) {
    deps.toast('problem', BUTTON_PRESS_UNREAD);
    return;
  }
  let version = read.value.version;
  for (const each of read.value.steps) {
    if (each.trigger !== pressed.trigger) continue;
    const runsAs = stepRunsAs(each.action);
    if (runsAs === null) continue;
    const at = { page: pressed.page, index: pressed.index, trigger: pressed.trigger, step: each.step, version };
    switch (runsAs) {
      case 'goTo':
        // THE PAGE THE DOCUMENT NAMES, read with the step: a kept go-to carries none and the kernel never lists one as
        // running, so only this build's own reading of a destination is shown.
        if (each.action.kind === 'goTo') deps.show(each.action.page, zoomOfGoTo(each.action));
        break;
      case 'link':
        // ASKED FIRST, by the one question every address a document holds is asked (ADR-0167); `main` opens what it
        // reads at this step and version, so the address shown is the only thing the renderer holds of it.
        if (each.action.kind === 'link') {
          await askThenOpen(deps, each.action.address, () =>
            deps.client['document.openButtonLink']({ docId, version, field, trigger: pressed.trigger, step: each.step }),
          );
        }
        break;
      case 'print':
        // THE APPLICATION'S PRINT, whose resolution dialog and the system's print dialog are the question: nothing is
        // printed without the person choosing Print there.
        await deps.run('document.print');
        break;
      case 'importData': {
        // THE APPLICATION'S IMPORT, whose file picker is the question: the file the document names is never opened, and
        // nothing is filled until the person picks one. A fill moves the version through a route this press does not
        // hold, so the button is read again and the next step is sent at what the document is now.
        await deps.run('document.import-form-data-fdf');
        const again = await deps.client['document.buttonActions']({ docId, field });
        if (!again.ok) return;
        version = again.value.version;
        break;
      }
      case 'reset':
      case 'showHide': {
        const next = await deps.apply({ kind: runsAs === 'reset' ? 'resetForm' : 'showHideFields', ...at });
        if (next === undefined) return;
        version = next;
        break;
      }
    }
  }
}
