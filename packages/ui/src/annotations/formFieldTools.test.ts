import type { DispatchableCommand } from '@monstera/contract';
import { createFormFieldSchema } from '@monstera/contract';
import { viewportPoint } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { localDatePattern } from '../forms/datePattern.js';
import { overlayTransform } from './annotationSpace.js';
import { PLAIN_STYLE } from './annotationStyle.js';
import type { KnownField } from './fieldNameCheck.js';
import {
  FORM_FIELD_BUTTON_TOOL_ID,
  FORM_FIELD_CHECKBOX_TOOL_ID,
  FORM_FIELD_DATE_TOOL_ID,
  FORM_FIELD_DROPDOWN_TOOL_ID,
  FORM_FIELD_LISTBOX_TOOL_ID,
  FORM_FIELD_RADIO_TOOL_ID,
  FORM_FIELD_SIGNATURE_TOOL_ID,
  FORM_FIELD_TEXT_TOOL_ID,
  formFieldTools,
} from './formFieldTools.js';

/**
 * The create-field controllers, driven without a DOM: a click places the kind's own size, a drag places the box, and
 * the name is the next free one (ADR-0226 Decisions 11 to 13).
 *
 * This is the UI half of the wired-tools pair: `formFieldNew.test.ts` and `formFieldCreate.test.ts` prove the command
 * puts the field in the document, and this proves the control dispatches **that** command.
 *
 * ## And the pair's blind spot is closed by a THIRD assertion here
 *
 * The frames are the overlay's CSS pixels and the payload's PDF user space, and the cases below assert the **converted
 * numbers** against a fixture whose crop origin is not zero and whose zoom is not 1 — so a controller that passed pixels
 * straight through fails rather than coincides.
 */

const PAGE: Parameters<typeof overlayTransform>[0] = {
  crop: [50, 100, 250, 400],
  rotation: 0,
  zoom: 2,
};

/** The tools over a form holding `has`, with every ask and every page write recorded: neither may happen. */
function toolsOver(has: readonly KnownField[] = []): {
  readonly tools: ReturnType<typeof formFieldTools>;
  readonly asked: unknown[];
} {
  const asked: unknown[] = [];
  const tools = formFieldTools({
    ask: (id) => {
      asked.push(id);
      return Promise.resolve(undefined);
    },
    write: (request) => {
      asked.push(request);
      return Promise.resolve(undefined);
    },
    fields: () => Promise.resolve(has),
    style: PLAIN_STYLE,
  });
  return { tools, asked };
}

function toolWithId(tools: ReturnType<typeof formFieldTools>, id: string) {
  const found = tools.find((tool) => tool.id === id);
  if (found === undefined) throw new Error(`no tool registered as ${id}`);
  return found;
}

/** Drives a whole gesture and returns whatever `commit` decided. */
async function press(
  tool: ReturnType<typeof formFieldTools>[number],
  from: readonly [number, number],
  to: readonly [number, number] = from,
  page = 3,
): Promise<DispatchableCommand | undefined> {
  const { controller } = tool;
  const started = controller.begin(viewportPoint(from[0], from[1]));
  const moved = controller.update(started, viewportPoint(to[0], to[1]));
  return controller.commit(moved, page, overlayTransform(PAGE));
}

describe('formFieldTools — a click places the kind’s own size, named without asking', () => {
  it('a click with the text tool places 180 by 20 points opening down and right of it, named Text1', async () => {
    const { tools, asked } = toolsOver();

    const command = await press(toolWithId(tools, FORM_FIELD_TEXT_TOOL_ID), [20, 20]);

    expect(asked).toStrictEqual([]);
    expect(command).toStrictEqual({
      kind: 'createFormField',
      page: 3,
      fields: [
        {
          // THE THIRD NUMBER. (20, 20) at zoom 2 on a crop starting at (50, 100) is (60, 390) in user space; 180 by 20
          // points is 360 by 40 pixels at that zoom, so the far corner is (240, 370). A controller that sized in pixels
          // would answer a box half that, and one that passed pixels through would answer (20, 20).
          rect: { x0: 60, y0: 390, x1: 240, y1: 370 },
          name: 'Text1',
          field: { type: 'text' },
        },
      ],
    });
  });

  it('each kind places its own size and builds its own member', async () => {
    const { tools } = toolsOver();
    const sizes: [string, number, number, unknown][] = [
      [FORM_FIELD_CHECKBOX_TOOL_ID, 12, 12, { type: 'checkbox' }],
      [FORM_FIELD_DROPDOWN_TOOL_ID, 150, 20, { type: 'dropdown', options: ['Choice1', 'Choice2', 'Choice3'] }],
      [FORM_FIELD_LISTBOX_TOOL_ID, 150, 60, { type: 'listbox', options: ['Choice1', 'Choice2', 'Choice3'] }],
      [FORM_FIELD_BUTTON_TOOL_ID, 80, 24, { type: 'button', label: 'Button' }],
      [FORM_FIELD_SIGNATURE_TOOL_ID, 180, 40, { type: 'signature' }],
      [FORM_FIELD_DATE_TOOL_ID, 100, 20, { type: 'date', pattern: localDatePattern() }],
    ];
    for (const [id, width, height, field] of sizes) {
      const command = await press(toolWithId(tools, id), [0, 0]);
      expect(command, id).toMatchObject({ fields: [{ rect: { x0: 50, y0: 400, x1: 50 + width, y1: 400 - height }, field }] });
    }
  });

  it('a click near the page’s far corner is moved back so the whole field is on the page', async () => {
    const { tools } = toolsOver();
    // The page is 200 by 300 points, 400 by 600 pixels at zoom 2; a text field clicked at (390, 590) would run off.
    const command = await press(toolWithId(tools, FORM_FIELD_TEXT_TOOL_ID), [390, 590]);
    expect(command).toMatchObject({ fields: [{ rect: { x0: 70, y0: 120, x1: 250, y1: 100 } }] });
  });

  it('the name is the next one the form does not hold, by the writer’s own rule', async () => {
    const { tools } = toolsOver([
      { name: 'Text1', kind: 'text', options: [] },
      { name: 'Text2.inner', kind: 'text', options: [] },
    ]);
    expect(await press(toolWithId(tools, FORM_FIELD_TEXT_TOOL_ID), [20, 20])).toMatchObject({ fields: [{ name: 'Text3' }] });
  });

  it('every command it builds is one the contract accepts', async () => {
    const { tools } = toolsOver();
    for (const tool of tools) {
      expect(createFormFieldSchema.safeParse(await press(tool, [20, 20])).success, tool.id).toBe(true);
      expect(createFormFieldSchema.safeParse(await press(tool, [20, 20], [120, 80])).success, tool.id).toBe(true);
      tool.ended?.();
    }
  });
});

describe('formFieldTools — a drag places the box', () => {
  it('a drag places the dragged box, converted to user space', async () => {
    const { tools } = toolsOver();
    expect(await press(toolWithId(tools, FORM_FIELD_TEXT_TOOL_ID), [20, 20], [120, 80])).toMatchObject({
      fields: [{ rect: { x0: 60, y0: 390, x1: 110, y1: 360 } }],
    });
  });

  it('a drag smaller than the kind’s minimum is grown to it, so the field can be clicked', async () => {
    const { tools } = toolsOver();
    // 100 by 6 pixels at zoom 2 is 50 by 3 points: a text field's height grows to 12 points, 24 pixels.
    expect(await press(toolWithId(tools, FORM_FIELD_TEXT_TOOL_ID), [20, 20], [120, 26])).toMatchObject({
      fields: [{ rect: { x0: 60, y0: 390, x1: 110, y1: 378 } }],
    });
    // A tick box's minimum is 8 points: 6 by 6 pixels is 3 by 3 points, grown to 8 by 8.
    expect(await press(toolWithId(tools, FORM_FIELD_CHECKBOX_TOOL_ID), [20, 20], [26, 26])).toMatchObject({
      fields: [{ rect: { x0: 60, y0: 390, x1: 68, y1: 382 } }],
    });
  });

  it('CONTROL: a press that wobbles less than the drag distance is a click, and places the kind’s size', async () => {
    const { tools } = toolsOver();
    expect(await press(toolWithId(tools, FORM_FIELD_TEXT_TOOL_ID), [20, 20], [22, 21])).toMatchObject({
      fields: [{ rect: { x0: 60, y0: 390, x1: 240, y1: 370 } }],
    });
  });
});

describe('formFieldTools — a radio group is one run of the tool (K6)', () => {
  it('the first press starts Group1 with Choice1, the next joins it with Choice2, and Esc starts a new group', async () => {
    const { tools } = toolsOver([{ name: 'Group1', kind: 'radio', options: ['Choice1'] }]);
    const tool = toolWithId(tools, FORM_FIELD_RADIO_TOOL_ID);

    const first = await press(tool, [20, 20]);
    const second = await press(tool, [60, 20]);
    expect([first, second]).toMatchObject([
      { fields: [{ name: 'Group2', field: { type: 'radio', option: 'Choice1' } }] },
      { fields: [{ name: 'Group2', field: { type: 'radio', option: 'Choice2' } }] },
    ]);

    tool.ended?.();
    expect(await press(tool, [20, 60])).toMatchObject({ fields: [{ name: 'Group2', field: { option: 'Choice1' } }] });
    tool.ended?.();
  });

  it('CONTROL: only the radio tool stays on after a field is placed, every other is spent by one', () => {
    const { tools } = toolsOver();
    expect(tools.map((tool) => [tool.id, tool.endsAfterOne === true])).toStrictEqual([
      [FORM_FIELD_TEXT_TOOL_ID, true],
      [FORM_FIELD_CHECKBOX_TOOL_ID, true],
      [FORM_FIELD_RADIO_TOOL_ID, false],
      [FORM_FIELD_DROPDOWN_TOOL_ID, true],
      [FORM_FIELD_LISTBOX_TOOL_ID, true],
      [FORM_FIELD_BUTTON_TOOL_ID, true],
      [FORM_FIELD_SIGNATURE_TOOL_ID, true],
      [FORM_FIELD_DATE_TOOL_ID, true],
    ]);
  });
});
