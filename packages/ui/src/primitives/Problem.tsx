import { type ReactElement, type RefObject, useEffect, useId } from 'react';

import { Icon } from './Icon.js';

/**
 * What a problem is about: a field by its id, the container whose first field it is (a `DialogRow`'s control) by a ref, or
 * that container by its id (`in`) — for a row of a list, whose containers cannot each hold a ref a render may read.
 */
export type ProblemAbout =
  | { readonly field: string }
  | { readonly within: RefObject<HTMLElement | null> }
  | { readonly in: string };

/**
 * The first field in a container, enabled: something typed into or chosen from. A thing that is a field but none of these
 * (the signature pad, a drawing surface) says so with `data-problem-target`, which wins.
 */
const FIELD_SELECTOR =
  '[data-problem-target], input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), [contenteditable="true"], [role="textbox"], button:not(:disabled)';

/**
 * THE ONE WAY A DIALOG SAYS THAT SOMETHING IS WRONG OR MUST BE DONE FIRST (the owner, 2026-10-08).
 *
 * Before this existed each dialog wrote its own paragraph for it, in the dialog's text colour, so *"Type or draw the
 * signature first"* read as part of the form and not as a warning (Sign with certificate, the owner's video). Now every
 * refusal, in every dialog, is this: a warning icon and the sentence in the problem colour (`--problem-text`, a role the
 * contrast check holds on every surface), announced when it appears (`role="alert"`), placed next to the field it is
 * about — and that field is outlined, marked `aria-invalid`, pointed at by `aria-describedby`, and given the focus when
 * the sentence is the answer to a press (`focusField`).
 *
 * ## The field is marked from here, not by each input
 *
 * The inputs a dialog holds are several primitives and plain elements, and a refusal can be about any of them. Marking
 * them from one place is what makes "every dialog" a single mechanism: the effect finds the field, writes the three
 * attributes while the sentence is shown, and puts the field back as it found it when the sentence goes.
 *
 * ## An absent sentence draws nothing but keeps the live region
 *
 * The element stays so a sentence arriving later is announced as an alert inserted into a region that was already
 * there. `reserve` keeps a line of height for dialogs that held one before, so their size does not jump.
 *
 * `proof:dialogproblems` refuses a dialog body that draws a refusal any other way.
 */
export function Problem({
  message,
  about,
  focusField = false,
  reserve = false,
}: {
  /** Already translated, since a refusal often names the part that was wrong. Empty or absent while nothing is refused. */
  readonly message: string | undefined;
  readonly about?: ProblemAbout | undefined;
  /** Move the focus to the field when the sentence appears — for a sentence that answers a press of the dialog's action. */
  readonly focusField?: boolean;
  /** Keep one line of height while nothing is refused. */
  readonly reserve?: boolean;
}): ReactElement {
  const id = useId();
  const shown = message !== undefined && message !== '';
  const field = about !== undefined && 'field' in about ? about.field : undefined;
  const within = about !== undefined && 'within' in about ? about.within : undefined;
  const container = about !== undefined && 'in' in about ? about.in : undefined;

  useEffect(() => {
    if (!shown) return undefined;
    const target: HTMLElement | null | undefined =
      field !== undefined
        ? document.getElementById(field)
        : (container === undefined ? within?.current : document.getElementById(container))?.querySelector<HTMLElement>(FIELD_SELECTOR);
    if (target === null || target === undefined) return undefined;
    const before = {
      invalid: target.getAttribute('aria-invalid'),
      described: target.getAttribute('aria-describedby'),
      marked: target.getAttribute('data-problem'),
    };
    target.setAttribute('aria-invalid', 'true');
    target.setAttribute('aria-describedby', before.described === null ? id : `${before.described} ${id}`);
    target.setAttribute('data-problem', '');
    if (focusField) target.focus();
    return () => {
      const restore = (name: string, value: string | null): void => {
        if (value === null) target.removeAttribute(name);
        else target.setAttribute(name, value);
      };
      restore('aria-invalid', before.invalid);
      restore('aria-describedby', before.described);
      restore('data-problem', before.marked);
    };
  }, [shown, field, within, container, focusField, id]);

  return (
    <p id={id} className={reserve ? 'm-problem m-problem--reserve' : 'm-problem'} role="alert">
      {shown ? (
        <>
          <Icon name="CircleAlert" size="dense" />
          <span>{message}</span>
        </>
      ) : null}
    </p>
  );
}
