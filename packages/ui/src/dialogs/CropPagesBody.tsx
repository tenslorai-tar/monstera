import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  CROP_PAGES_ALL,
  CROP_PAGES_APPLY,
  CROP_PAGES_BOTTOM,
  CROP_PAGES_LEFT,
  CROP_PAGES_NEGATIVE,
  CROP_PAGES_NOT_A_NUMBER,
  CROP_PAGES_RIGHT,
  CROP_PAGES_THIS,
  CROP_PAGES_TOP,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { CropPagesAnswer } from './cropPagesResult.js';

/** The four edges, in the order a person reads a margin control. */
const EDGES = [
  { key: 'top', label: CROP_PAGES_TOP },
  { key: 'bottom', label: CROP_PAGES_BOTTOM },
  { key: 'left', label: CROP_PAGES_LEFT },
  { key: 'right', label: CROP_PAGES_RIGHT },
] as const;

/** What each field holds while it is being typed. */
type Edges = Readonly<Record<(typeof EDGES)[number]['key'], string>>;

const EMPTY: Edges = { top: '', bottom: '', left: '', right: '' };

/**
 * The crop dialog's body — margins in points, and a scope.
 *
 * ## An empty field is ZERO, and a wrong one is not
 *
 * Nobody crops all four edges, so requiring four numbers would make the common
 * case four keystrokes of ceremony. An empty field means *do not crop this
 * edge*; text that is not a number is a mistake and is named. The two are
 * different states and only one of them disables the control.
 *
 * ## The margins are POINTS, and the label says so
 *
 * The command's unit is PDF user space, and this dialog does not convert. The
 * app has a display-unit setting and using it here is a real improvement that
 * needs the setting threaded into a dialog body — which nothing does yet, and
 * inventing a second route to it for one dialog is the second wiring place the
 * registries exist to forbid. Named on the row rather than done quietly.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function CropPagesBody({
  page,
  resolve,
}: {
  readonly page: number;
} & DialogAnswering<CropPagesAnswer>): ReactElement {
  const { _ } = useLingui();
  const [edges, setEdges] = useState<Edges>(EMPTY);
  const [everyPage, setEveryPage] = useState(true);

  const parsed = readEdges(edges);

  return (
    <div className="m-crop-pages">
      {EDGES.map(({ key, label }) => (
        <Input
          key={key}
          label={label}
          value={edges[key]}
          onValueChange={(next) => {
            setEdges({ ...edges, [key]: next });
          }}
        />
      ))}
      <fieldset className="m-crop-pages__scope">
        {/* TWO BUTTONS RATHER THAN A CHECKBOX, because the choice is between
            two named things and a checkbox makes one of them the absence of the
            other — which reads as *all pages, unless* rather than as a choice. */}
        <Button
          label={CROP_PAGES_THIS}
          variant={everyPage ? 'default' : 'primary'}
          onClick={() => {
            setEveryPage(false);
          }}
        />
        <Button
          label={CROP_PAGES_ALL}
          variant={everyPage ? 'primary' : 'default'}
          onClick={() => {
            setEveryPage(true);
          }}
        />
      </fieldset>
      <p className="m-crop-pages__problem" role="status">
        {parsed === null ? _(problemOf(edges)) : ''}
      </p>
      <Button
        label={CROP_PAGES_APPLY}
        variant="primary"
        disabled={parsed === null}
        onClick={() => {
          // GUARDED AGAIN rather than trusting the disabled attribute, for
          // `DeletePagesBody`'s reason: the schema behind `resolve` refuses a
          // negative margin, and a mismatch would be a thrown
          // `DialogResultRejected` over the user's document.
          if (parsed === null) return;
          resolve({ pages: everyPage ? 'all' : [page], margins: parsed });
        }}
      />
    </div>
  );
}

/** The four margins, or `null` if any field is text that is not a margin. */
function readEdges(edges: Edges): CropPagesAnswer['margins'] | null {
  const values: Record<string, number> = {};
  for (const { key } of EDGES) {
    const text = edges[key].trim();
    // EMPTY IS ZERO. Cropping one edge is the common case, and demanding four
    // numbers for it is ceremony that teaches nothing.
    if (text.length === 0) {
      values[key] = 0;
      continue;
    }
    // A PATTERN, not `parseFloat`, which reads `12abc` as 12 — the quiet-drop
    // failure `parsePageRanges` refuses for the same reason.
    if (!/^\d+(?:\.\d+)?$/u.test(text)) return null;
    values[key] = Number(text);
  }
  return {
    top: values['top'] ?? 0,
    bottom: values['bottom'] ?? 0,
    left: values['left'] ?? 0,
    right: values['right'] ?? 0,
  };
}

/**
 * Which sentence a failed read deserves.
 *
 * A leading `-` is the mistake worth naming separately: the pattern refuses it
 * along with everything else, and *that is not a number* is unhelpful about a
 * string that plainly is one. Cropping by a negative margin is growing the
 * page, which is a different operation and not this one.
 */
function problemOf(edges: Edges): MessageKey {
  const negative = EDGES.some(({ key }) => edges[key].trim().startsWith('-'));
  return negative ? CROP_PAGES_NEGATIVE : CROP_PAGES_NOT_A_NUMBER;
}
