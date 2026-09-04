import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  HEADER_FOOTER_ALL,
  HEADER_FOOTER_APPLY,
  HEADER_FOOTER_CENTRE,
  HEADER_FOOTER_EMPTY,
  HEADER_FOOTER_FOOTER,
  HEADER_FOOTER_HEADER,
  HEADER_FOOTER_LEFT,
  HEADER_FOOTER_MARGIN,
  HEADER_FOOTER_NOT_A_NUMBER,
  HEADER_FOOTER_RIGHT,
  HEADER_FOOTER_SIZE,
  HEADER_FOOTER_THIS,
  HEADER_FOOTER_TOKENS,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { HeaderFooterAnswer } from './headerFooterResult.js';

/** The two edges, in the order a page has them. */
const EDGES = [
  { key: 'header', label: HEADER_FOOTER_HEADER },
  { key: 'footer', label: HEADER_FOOTER_FOOTER },
] as const;

/** The three slots, in reading order. */
const SLOTS = [
  { key: 'left', label: HEADER_FOOTER_LEFT },
  { key: 'centre', label: HEADER_FOOTER_CENTRE },
  { key: 'right', label: HEADER_FOOTER_RIGHT },
] as const;

type Edge = (typeof EDGES)[number]['key'];
type Slot = (typeof SLOTS)[number]['key'];

/** Every slot's text while it is being typed. */
type Slots = Readonly<Record<Edge, Readonly<Record<Slot, string>>>>;

const EMPTY_SLOTS: Slots = {
  header: { left: '', centre: '', right: '' },
  footer: { left: '', centre: '', right: '' },
};

/**
 * The size and margin a person gets without typing anything.
 *
 * 10pt at a 36pt margin is a half-inch inset at a readable size, which is what
 * every word processor defaults to. Defaults for a control rather than tokens —
 * this is content written into a document another reader opens.
 */
const DEFAULT_SIZE = '10';
const DEFAULT_MARGIN = '36';

/**
 * The header-and-footer dialog's body.
 *
 * ## Six inputs, and the layout is the information
 *
 * The slots are laid out as two rows of three in the order they appear on the
 * page, so the control's shape says where the text will land. A person reading
 * it does not have to hold *left, centre, right* in their head — which is the
 * difference between a form and a form somebody can use without the manual.
 *
 * ## The token hint is shown, not documented elsewhere
 *
 * `{n}` and `{N}` are the whole template language, and a feature nobody can
 * discover is one nobody uses. The hint sits under the fields rather than in a
 * tooltip, because a tooltip is a thing you have to already suspect exists.
 *
 * ## At least one slot must be filled
 *
 * A command that draws nothing still writes a new document, bumps the version,
 * and marks the file dirty — so *apply* with six empty fields would cost the
 * user a change they cannot see and an undo they did not ask for. The control
 * is disabled and says why.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function HeaderFooterBody({
  page,
  resolve,
}: {
  readonly page: number;
} & DialogAnswering<HeaderFooterAnswer>): ReactElement {
  const { _ } = useLingui();
  const [slots, setSlots] = useState<Slots>(EMPTY_SLOTS);
  const [fontSize, setFontSize] = useState(DEFAULT_SIZE);
  const [margin, setMargin] = useState(DEFAULT_MARGIN);
  const [everyPage, setEveryPage] = useState(true);

  const size = readNumber(fontSize, DEFAULT_SIZE);
  const inset = readNumber(margin, DEFAULT_MARGIN);
  const anySlot = EDGES.some(({ key: edge }) =>
    SLOTS.some(({ key: slot }) => slots[edge][slot].trim().length > 0),
  );
  const numbersOk = size !== null && size > 0 && size <= 1000 && inset !== null && inset <= 500;
  const ready = anySlot && numbersOk;

  return (
    <div className="m-header-footer">
      {EDGES.map(({ key: edge, label: edgeLabel }) => (
        <fieldset key={edge} className="m-header-footer__edge">
          <legend>{_(edgeLabel)}</legend>
          {SLOTS.map(({ key: slot, label }) => (
            <Input
              key={slot}
              label={label}
              value={slots[edge][slot]}
              onValueChange={(next) => {
                setSlots({ ...slots, [edge]: { ...slots[edge], [slot]: next } });
              }}
            />
          ))}
        </fieldset>
      ))}
      <p className="m-header-footer__tokens">{_(HEADER_FOOTER_TOKENS)}</p>
      <Input
        label={HEADER_FOOTER_SIZE}
        value={fontSize}
        onValueChange={(next) => {
          setFontSize(next);
        }}
      />
      <Input
        label={HEADER_FOOTER_MARGIN}
        value={margin}
        onValueChange={(next) => {
          setMargin(next);
        }}
      />
      <fieldset className="m-header-footer__scope">
        {/* TWO BUTTONS RATHER THAN A CHECKBOX, for `CropPagesBody`'s reason. */}
        <Button
          label={HEADER_FOOTER_THIS}
          variant={everyPage ? 'default' : 'primary'}
          onClick={() => {
            setEveryPage(false);
          }}
        />
        <Button
          label={HEADER_FOOTER_ALL}
          variant={everyPage ? 'primary' : 'default'}
          onClick={() => {
            setEveryPage(true);
          }}
        />
      </fieldset>
      <p className="m-header-footer__problem" role="status">
        {ready ? '' : _(problemOf(anySlot))}
      </p>
      <Button
        label={HEADER_FOOTER_APPLY}
        variant="primary"
        disabled={!ready}
        onClick={() => {
          // GUARDED AGAIN rather than trusting the disabled attribute, for
          // `CropPagesBody`'s reason: the schema behind `resolve` refuses a
          // margin over 500, and a mismatch would be a thrown
          // `DialogResultRejected` over the user's document.
          if (size === null || inset === null || !ready) return;
          resolve({
            pages: everyPage ? 'all' : [page],
            // TRIMMED HERE, once. A slot of spaces is a slot the person left
            // empty, and the kernel's *empty means unused* test is
            // `length === 0` — so untrimmed whitespace would draw an invisible
            // text object the kernel has no reason to skip.
            header: trimmed(slots.header),
            footer: trimmed(slots.footer),
            fontSize: size,
            marginPoints: inset,
          });
        }}
      />
    </div>
  );
}

/** One edge's slots with their whitespace removed. */
function trimmed(edge: Readonly<Record<Slot, string>>): Record<Slot, string> {
  return { left: edge.left.trim(), centre: edge.centre.trim(), right: edge.right.trim() };
}

/**
 * One field's number, falling back to its default when empty.
 *
 * A PATTERN, not `parseFloat`, for `CropPagesBody`'s reason: `parseFloat` reads
 * `12abc` as 12, which is the quiet-drop failure `parsePageRanges` refuses.
 */
function readNumber(text: string, fallback: string): number | null {
  const value = text.trim().length === 0 ? fallback : text.trim();
  if (!/^\d+(?:\.\d+)?$/u.test(value)) return null;
  return Number(value);
}

/** Which sentence a refusal deserves — the empty form, or a bad number. */
function problemOf(anySlot: boolean): MessageKey {
  return anySlot ? HEADER_FOOTER_NOT_A_NUMBER : HEADER_FOOTER_EMPTY;
}
