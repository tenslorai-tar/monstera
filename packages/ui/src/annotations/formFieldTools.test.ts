import type { DispatchableCommand } from '@monstera/contract';
import { createFormFieldSchema } from '@monstera/contract';
import { viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import {
  FORM_FIELD_DROPDOWN_DIALOG_ID,
  FORM_FIELD_LISTBOX_DIALOG_ID,
  FORM_FIELD_RADIO_DIALOG_ID,
} from '../dialogs/formField.js';
import { FORM_FIELD_NAME_LABEL, FORM_FIELD_NAME_SEGMENT } from '../messages/en.js';
import type { WriteRequest } from '../pageWriting.js';
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
 * The five create-field controllers, driven without a DOM: a text field and a checkbox named in a line on the page
 * (ADR-0154), a radio button, a dropdown and a list box through their dialogs.
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

/**
 * The five tools, each with a dialog answering `answer` and the page answering `typed`, and what was asked of each.
 * A name typed on the page is answered as the line answers it: the words, or `undefined` for none.
 */
function toolsAnswering(
  answer: unknown,
  typed?: string,
): {
  readonly tools: ReturnType<typeof formFieldTools>;
  readonly asked: { id: string; props: unknown }[];
  readonly written: WriteRequest[];
} {
  const asked: { id: string; props: unknown }[] = [];
  const written: WriteRequest[] = [];
  const tools = formFieldTools({
    ask: (id, props) => {
      asked.push({ id, props });
      return Promise.resolve(answer);
    },
    write: (request) => {
      written.push(request);
      return Promise.resolve(typed);
    },
    style: PLAIN_STYLE,
  });
  return { tools, asked, written };
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
): Promise<DispatchableCommand | undefined> {
  const { controller } = tool as ReturnType<typeof formFieldTools>[number];
  const started = controller.begin(viewportPoint(from[0], from[1]));
  const moved = controller.update(started, viewportPoint(to[0], to[1]));
  return controller.commit(moved, page, overlayTransform(PAGE));
}

describe('formFieldTools — each asks for its own name and builds its own kind', () => {
  it('the text tool asks the page for the NAME in a line beside the box, and dispatches createFormField with it', async () => {
    const { tools, asked, written } = toolsAnswering(undefined, 'applicant.name');

    const command = await drag(toolWithId(tools, FORM_FIELD_TEXT_TOOL_ID), [20, 20], [120, 80]);

    // BOTH HALVES. The request says it asked the page for a field name beside the box drawn, and no dialog; the
    // command says the answer reached the payload. Either alone passes for an implementation that asked and ignored,
    // or built and never asked.
    expect(asked).toStrictEqual([]);
    expect(written.map(({ check: _rule, ...request }) => request)).toStrictEqual([
      { page: 3, box: { x0: 60, y0: 390, x1: 110, y1: 360 }, shape: 'line', initial: '', label: FORM_FIELD_NAME_LABEL },
    ]);
    // AND THE NAME'S RULE, the one the field dialogs take: a dot with nothing after it is a parent with no name.
    expect([written[0]?.check?.('applicant.name'), written[0]?.check?.('applicant.')]).toStrictEqual([undefined, FORM_FIELD_NAME_SEGMENT]);
    expect(command).toStrictEqual({
      kind: 'createFormField',
      page: 3,
      // ONE FIELD IN A LIST. The payload became plural on 2026-09-08 for
      // flat-field detection, where accepting a page of candidates is one
      // decision; a drag is one field, and this asserts the tool sends exactly
      // one rather than however many the list would accept.
      fields: [
        {
          // THE THIRD NUMBER. (20, 20) at zoom 2 on a crop starting at (50, 100)
          // is (60, 390) in user space, and (120, 80) is (110, 360). A
          // controller that passed pixels through would answer (20, 20) and
          // (120, 80), which is a different rectangle on a different part of
          // the page.
          rect: { x0: 60, y0: 390, x1: 110, y1: 360 },
          name: 'applicant.name',
          field: { type: 'text' },
        },
      ],
    });
  });

  it('the checkbox tool is named on the page too, and builds a checkbox', async () => {
    const { tools, asked, written } = toolsAnswering(undefined, '  applicant.agrees  ');

    const command = await drag(toolWithId(tools, FORM_FIELD_CHECKBOX_TOOL_ID), [20, 20], [40, 40]);

    expect([asked.length, written.length]).toStrictEqual([0, 1]);
    // TRIMMED by the result schema the dialogs answer with, so a name reaches the command one way.
    expect(command).toMatchObject({
      kind: 'createFormField',
      fields: [{ name: 'applicant.agrees', field: { type: 'checkbox' } }],
    });
  });

  it('the radio tool carries the option, and the name is the GROUP’s', async () => {
    const { tools, asked } = toolsAnswering({ name: 'applicant.post', option: 'first' });

    const command = await drag(toolWithId(tools, FORM_FIELD_RADIO_TOOL_ID), [20, 20], [40, 40]);

    expect(asked.map((entry) => entry.id)).toStrictEqual([FORM_FIELD_RADIO_DIALOG_ID]);
    expect(command).toMatchObject({
      kind: 'createFormField',
      fields: [{ name: 'applicant.post', field: { type: 'radio', option: 'first' } }],
    });
  });

  it('the dropdown and list-box tools carry their options', async () => {
    const answer = { name: 'applicant.title', options: ['Dr', 'Mr'] };

    const dropdown = toolsAnswering(answer);
    expect(
      await drag(toolWithId(dropdown.tools, FORM_FIELD_DROPDOWN_TOOL_ID), [20, 20], [120, 60]),
    ).toMatchObject({ fields: [{ field: { type: 'dropdown', options: ['Dr', 'Mr'] } }] });
    expect(dropdown.asked.map((entry) => entry.id)).toStrictEqual([FORM_FIELD_DROPDOWN_DIALOG_ID]);

    const listbox = toolsAnswering(answer);
    expect(
      await drag(toolWithId(listbox.tools, FORM_FIELD_LISTBOX_TOOL_ID), [20, 20], [120, 60]),
    ).toMatchObject({ fields: [{ field: { type: 'listbox', options: ['Dr', 'Mr'] } }] });
    expect(listbox.asked.map((entry) => entry.id)).toStrictEqual([FORM_FIELD_LISTBOX_DIALOG_ID]);
  });

  it('every command it builds is one the contract accepts', async () => {
    // The join the two halves cannot make between them: a tool may build a
    // well-shaped object that the schema refuses, and the kernel cases construct
    // their own payloads rather than taking one from here.
    const { tools } = toolsAnswering({ name: 'a.b', option: 'one', options: ['one', 'two'] }, 'a.b');

    for (const tool of tools) {
      const command = await drag(tool, [20, 20], [120, 80]);
      expect(createFormFieldSchema.safeParse(command).success).toBe(true);
    }
  });
});

describe('formFieldTools — when it builds nothing', () => {
  it('a click that did not drag asks for nothing at all', async () => {
    const { tools, asked, written } = toolsAnswering({ name: 'applicant.name' }, 'applicant.name');

    const command = await drag(toolWithId(tools, FORM_FIELD_TEXT_TOOL_ID), [20, 20], [22, 21]);

    // THE ASK IS THE ASSERTION, not just the absent command. A tool that asked and then discarded the answer would
    // produce the same `undefined` while putting a field in front of somebody who clicked by accident.
    expect(command).toBeUndefined();
    expect([asked, written]).toStrictEqual([[], []]);
  });

  it('a drag that is long but not tall is a sliver, not a field', async () => {
    const { tools, asked, written } = toolsAnswering({ name: 'applicant.name' }, 'applicant.name');

    // BOTH AXES. A distance test accepts 100 by 1, which is a control nobody
    // can click and — unlike an annotation — one no eraser can find again.
    expect(await drag(toolWithId(tools, FORM_FIELD_TEXT_TOOL_ID), [20, 20], [120, 21])).toBeUndefined();
    expect([asked, written]).toStrictEqual([[], []]);
  });

  it('nothing typed builds nothing, and a dismissed dialog builds nothing', async () => {
    const named = toolsAnswering(undefined, undefined);
    expect(await drag(toolWithId(named.tools, FORM_FIELD_TEXT_TOOL_ID), [20, 20], [120, 80])).toBeUndefined();
    // It DID ask — which is what separates nothing typed from a gesture too small to have asked anything.
    expect(named.written).toHaveLength(1);

    const dismissed = toolsAnswering(undefined);
    expect(await drag(toolWithId(dismissed.tools, FORM_FIELD_RADIO_TOOL_ID), [20, 20], [120, 80])).toBeUndefined();
    expect(dismissed.asked).toHaveLength(1);
  });

  it('a radio answer with no option builds nothing rather than a broken command', async () => {
    // One result schema serves every way a field is named, so `option` is optional there. The
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
