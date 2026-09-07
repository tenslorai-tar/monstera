import type { RenderableCommand } from '@monstera/contract';
import { createFormFieldSchema } from '@monstera/contract';
import { viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import {
  FORM_FIELD_CHECKBOX_DIALOG_ID,
  FORM_FIELD_DROPDOWN_DIALOG_ID,
  FORM_FIELD_LISTBOX_DIALOG_ID,
  FORM_FIELD_RADIO_DIALOG_ID,
  FORM_FIELD_TEXT_DIALOG_ID,
} from '../dialogs/formField.js';
import { overlayTransform } from './annotationSpace.js';
import { PLAIN_STYLE } from './annotationStyle.js';
import {
  FORM_FIELD_CHECKBOX_TOOL_ID,
  FORM_FIELD_DROPDOWN_TOOL_ID,
  FORM_FIELD_LISTBOX_TOOL_ID,
  FORM_FIELD_RADIO_TOOL_ID,
  FORM_FIELD_TEXT_TOOL_ID,
  formFieldTools,
} from './formFieldTools.js';

/**
 * The five create-field controllers, driven without a DOM.
 *
 * This is the UI half of the wired-tools pair: `formFieldCreate.test.ts` proves
 * the command puts a field in the document, and this proves the control
 * dispatches **that** command. Neither alone counts — a kernel proof alone
 * covers a button that dispatches into the void, and a UI test alone covers a
 * command nothing implements.
 *
 * ## And the pair's blind spot is closed by a THIRD assertion here
 *
 * `CLAUDE.md`: where the two halves speak different coordinate systems the pair
 * proves nothing, because each is correct in its own frame for ever. The frames
 * here are the overlay's CSS pixels and the payload's PDF user space, and the
 * cases below assert the **converted numbers** against a fixture whose crop
 * origin is not zero and whose zoom is not 1 — so a controller that passed
 * pixels straight through fails rather than coincides.
 */

const PAGE: Parameters<typeof overlayTransform>[0] = {
  crop: [50, 100, 250, 400],
  rotation: 0,
  zoom: 2,
};

/** The five tools, each with a dialog answering `answer`, and what was asked. */
function toolsAnswering(answer: unknown): {
  readonly tools: ReturnType<typeof formFieldTools>;
  readonly asked: { id: string; props: unknown }[];
} {
  const asked: { id: string; props: unknown }[] = [];
  const tools = formFieldTools({
    ask: (id, props) => {
      asked.push({ id, props });
      return Promise.resolve(answer);
    },
    style: PLAIN_STYLE,
  });
  return { tools, asked };
}

function toolWithId(tools: ReturnType<typeof formFieldTools>, id: string) {
  const found = tools.find((tool) => tool.id === id);
  if (found === undefined) throw new Error(`no tool registered as ${id}`);
  return found;
}

/** Drives a whole drag and returns whatever `commit` decided. */
async function drag(
  tool: { readonly controller: { begin: never } } | ReturnType<typeof formFieldTools>[number],
  from: readonly [number, number],
  to: readonly [number, number],
  page = 3,
): Promise<RenderableCommand | undefined> {
  const { controller } = tool as ReturnType<typeof formFieldTools>[number];
  const started = controller.begin(viewportPoint(from[0], from[1]));
  const moved = controller.update(started, viewportPoint(to[0], to[1]));
  return controller.commit(moved, page, overlayTransform(PAGE));
}

describe('formFieldTools — each asks its own dialog and builds its own kind', () => {
  it('the text tool dispatches createFormField with the converted rectangle', async () => {
    const { tools, asked } = toolsAnswering({ name: 'applicant.name' });

    const command = await drag(toolWithId(tools, FORM_FIELD_TEXT_TOOL_ID), [20, 20], [120, 80]);

    // BOTH HALVES. The id says it opened its own dialog rather than any other;
    // the command says the answer reached the payload. Either alone passes for
    // an implementation that asked and ignored, or built and never asked.
    expect(asked).toStrictEqual([{ id: FORM_FIELD_TEXT_DIALOG_ID, props: {} }]);
    expect(command).toStrictEqual({
      kind: 'createFormField',
      page: 3,
      // THE THIRD NUMBER. (20, 20) at zoom 2 on a crop starting at (50, 100) is
      // (60, 390) in user space, and (120, 80) is (110, 360). A controller that
      // passed pixels through would answer (20, 20) and (120, 80), which is a
      // different rectangle on a different part of the page.
      rect: { x0: 60, y0: 390, x1: 110, y1: 360 },
      name: 'applicant.name',
      field: { type: 'text' },
    });
  });

  it('the checkbox tool builds a checkbox', async () => {
    const { tools, asked } = toolsAnswering({ name: 'applicant.agrees' });

    const command = await drag(toolWithId(tools, FORM_FIELD_CHECKBOX_TOOL_ID), [20, 20], [40, 40]);

    expect(asked.map((entry) => entry.id)).toStrictEqual([FORM_FIELD_CHECKBOX_DIALOG_ID]);
    expect(command).toMatchObject({ kind: 'createFormField', field: { type: 'checkbox' } });
  });

  it('the radio tool carries the option, and the name is the GROUP’s', async () => {
    const { tools, asked } = toolsAnswering({ name: 'applicant.post', option: 'first' });

    const command = await drag(toolWithId(tools, FORM_FIELD_RADIO_TOOL_ID), [20, 20], [40, 40]);

    expect(asked.map((entry) => entry.id)).toStrictEqual([FORM_FIELD_RADIO_DIALOG_ID]);
    expect(command).toMatchObject({
      kind: 'createFormField',
      name: 'applicant.post',
      field: { type: 'radio', option: 'first' },
    });
  });

  it('the dropdown and list-box tools carry their options', async () => {
    const answer = { name: 'applicant.title', options: ['Dr', 'Mr'] };

    const dropdown = toolsAnswering(answer);
    expect(
      await drag(toolWithId(dropdown.tools, FORM_FIELD_DROPDOWN_TOOL_ID), [20, 20], [120, 60]),
    ).toMatchObject({ field: { type: 'dropdown', options: ['Dr', 'Mr'] } });
    expect(dropdown.asked.map((entry) => entry.id)).toStrictEqual([FORM_FIELD_DROPDOWN_DIALOG_ID]);

    const listbox = toolsAnswering(answer);
    expect(
      await drag(toolWithId(listbox.tools, FORM_FIELD_LISTBOX_TOOL_ID), [20, 20], [120, 60]),
    ).toMatchObject({ field: { type: 'listbox', options: ['Dr', 'Mr'] } });
    expect(listbox.asked.map((entry) => entry.id)).toStrictEqual([FORM_FIELD_LISTBOX_DIALOG_ID]);
  });

  it('every command it builds is one the contract accepts', async () => {
    // The join the two halves cannot make between them: a tool may build a
    // well-shaped object that the schema refuses, and the kernel cases construct
    // their own payloads rather than taking one from here.
    const { tools } = toolsAnswering({ name: 'a.b', option: 'one', options: ['one', 'two'] });

    for (const tool of tools) {
      const command = await drag(tool, [20, 20], [120, 80]);
      expect(createFormFieldSchema.safeParse(command).success).toBe(true);
    }
  });
});

describe('formFieldTools — when it builds nothing', () => {
  it('a click that did not drag opens no dialog at all', async () => {
    const { tools, asked } = toolsAnswering({ name: 'applicant.name' });

    const command = await drag(toolWithId(tools, FORM_FIELD_TEXT_TOOL_ID), [20, 20], [22, 21]);

    // THE DIALOG IS THE ASSERTION, not just the absent command. A tool that
    // asked and then discarded the answer would produce the same `undefined`
    // while putting a modal in front of somebody who clicked by accident.
    expect(command).toBeUndefined();
    expect(asked).toStrictEqual([]);
  });

  it('a drag that is long but not tall is a sliver, not a field', async () => {
    const { tools, asked } = toolsAnswering({ name: 'applicant.name' });

    // BOTH AXES. A distance test accepts 100 by 1, which is a control nobody
    // can click and — unlike an annotation — one no eraser can find again.
    expect(await drag(toolWithId(tools, FORM_FIELD_TEXT_TOOL_ID), [20, 20], [120, 21])).toBeUndefined();
    expect(asked).toStrictEqual([]);
  });

  it('a dismissed dialog builds nothing', async () => {
    const { tools, asked } = toolsAnswering(undefined);

    expect(await drag(toolWithId(tools, FORM_FIELD_TEXT_TOOL_ID), [20, 20], [120, 80])).toBeUndefined();
    // It DID ask — which is what separates a dismissal from a gesture too small
    // to have opened anything.
    expect(asked).toHaveLength(1);
  });

  it('a radio answer with no option builds nothing rather than a broken command', async () => {
    // One result schema serves five dialogs, so `option` is optional there. The
    // tool is what narrows it, and this is the case that says a missing member
    // stops the command rather than travelling as `undefined`.
    const { tools } = toolsAnswering({ name: 'applicant.post' });

    expect(await drag(toolWithId(tools, FORM_FIELD_RADIO_TOOL_ID), [20, 20], [40, 40])).toBeUndefined();
  });

  it('a choice answer with an empty list builds nothing', async () => {
    const { tools } = toolsAnswering({ name: 'applicant.title', options: [] });

    expect(
      await drag(toolWithId(tools, FORM_FIELD_DROPDOWN_TOOL_ID), [20, 20], [120, 60]),
    ).toBeUndefined();
  });

  it('CONTROL: the same drag with a usable answer DOES build a command', async () => {
    // Without this, every case above passes for a tool that builds nothing ever.
    const { tools } = toolsAnswering({ name: 'applicant.title', options: ['Dr'] });

    expect(
      await drag(toolWithId(tools, FORM_FIELD_DROPDOWN_TOOL_ID), [20, 20], [120, 60]),
    ).toMatchObject({ kind: 'createFormField' });
  });
});
