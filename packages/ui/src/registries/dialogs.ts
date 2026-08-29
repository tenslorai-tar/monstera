import type { MessageKey } from '@monstera/shared';
import { createElement } from 'react';
// `FunctionComponent` rather than `ComponentType`, which is B7 stated in the
// type: *React function components only*. A class component would also have made
// `createElement` unresolvable here for a generic props type, so the rule and
// the compiler want the same thing.
import type { FunctionComponent, LazyExoticComponent, ReactElement } from 'react';
import type { z } from 'zod';

/**
 * The dialog registry — §7's second row.
 *
 * Derives *"one mount point, one focus trap, one Escape/backdrop handler"*, so
 * §10.4's accessibility obligations are met once in `<Dialog>` rather than per
 * dialog. A dialog that mounted itself would be a second focus trap, which is
 * the accessibility defect nobody notices until two are open.
 */

/**
 * One registered dialog.
 *
 * ## The props schema is required, and that is Decision 7
 *
 * *"A dialog opened with the wrong props is a runtime failure in the one
 * surface that has no other error path, and validating at the open call is the
 * only place both sides exist."* An optional schema would be omitted by whoever
 * is in a hurry, which is whoever is writing the dialog that most needs it.
 *
 * The schema is also what types `Props`, so the declaration and the validation
 * cannot disagree — one writer for the shape (B3). Declaring the type
 * separately and validating with a hand-written guard is the second opinion
 * that shape exists to prevent.
 *
 * ## Lazy by construction
 *
 * `component` is a `lazy(() => import(...))` value rather than a component, so
 * a dialog's code is not in the initial bundle by default. Typing it as the
 * lazy wrapper rather than as a component makes eager the thing you have to
 * write on purpose.
 */
export interface DialogEntry<Schema extends z.ZodType = z.ZodType> {
  /** `<domain>.<name>`, unique registry-wide. */
  readonly id: string;
  /** The dialog's accessible title, as a key. */
  readonly title: MessageKey;
  /** Validates the props at the open call, and types them. */
  readonly props: Schema;
  /** The lazily-loaded body. `<Dialog>` supplies the chrome. */
  readonly component: LazyExoticComponent<FunctionComponent<z.infer<Schema>>>;
  /**
   * Mounts this dialog's body with props its schema has already accepted.
   *
   * **The one place the type is erased, and the only place it is provably safe**
   * (finding EEEEE-2). A registry holds entries with different schemas, so it
   * must store `DialogEntry<z.ZodType>` — which severs the tie between `props`
   * and `component` that is real at every declaration site. The mount point
   * used to reattach it with two `as never` casts, which is the strongest
   * erasure the language has, in the one file whose whole subject is validated
   * props, and at the exact point where nothing can check it.
   *
   * {@link declareDialog} builds this closure where both types are still in
   * scope. The cast is therefore made once, against a value the compiler has
   * just checked, instead of once per mount against a value nobody has.
   */
  readonly mount: (props: unknown) => ReactElement;
}

/**
 * Declares a dialog. **The only way to build a {@link DialogEntry}.**
 *
 * The `mount` closure is created here because here — and nowhere downstream —
 * the schema and the component are the same `Schema`, so handing the parsed
 * props to the component is a fact rather than an assertion. `openWith` returns
 * exactly what `props.safeParse` produced, so the value this receives has been
 * checked by the schema that types the component.
 *
 * @param entry everything but `mount`, which is derived from it
 */
export function declareDialog<Schema extends z.ZodType<object>>(
  entry: Omit<DialogEntry<Schema>, 'mount'>,
): DialogEntry<Schema> {
  return {
    ...entry,
    mount: (props) => {
      // TWO NARROW CASTS, AND WHAT MAKES THEM SAFE IS ABOVE THEM RATHER THAN
      // INSIDE THEM. `Schema` is inferred from `props`, and `component` is
      // declared as `FunctionComponent<z.infer<Schema>>` — so a component that does
      // not take this schema's output fails at the CALL to this function, in
      // the feature's own diff. By the time either line runs, the compiler has
      // already checked the thing the casts assert.
      //
      // The first unwraps React's lazy wrapper, which `createElement` accepts at
      // run time and cannot express in a generic signature. The second restates
      // what `openWith` guarantees: the value reaching here is what
      // `props.safeParse` returned, parsed by this very schema.
      const Body = entry.component as unknown as FunctionComponent<z.infer<Schema>>;
      return createElement(Body, props as z.infer<Schema>);
    },
  };
}

/** What an open call was refused for. */
export class DialogPropsRejected extends Error {
  override readonly name = 'DialogPropsRejected';

  constructor(id: string, detail: string) {
    super(
      `Dialog "${id}" was opened with props its schema refuses: ${detail}. This is caught at the ` +
        `open call because a dialog is the one surface with no other error path — a mis-typed ` +
        `prop reaching the body renders a broken dialog over the user's document.`,
    );
  }
}

/** Asked for a dialog nobody registered. */
export class DialogNotRegistered extends Error {
  override readonly name = 'DialogNotRegistered';

  constructor(id: string, known: readonly string[]) {
    super(
      `No dialog is registered as "${id}". Registered: ${known.join(', ') || '(none)'}. A dialog ` +
        `is a registry entry composed at the composition point, never a component that mounts ` +
        `itself (ADR-0029 Decision 1).`,
    );
  }
}

/**
 * The composed set of dialogs.
 *
 * Refuses a duplicate id for Decision 3's reason, unchanged by the entry being
 * a dialog rather than a command: the second silently replacing the first opens
 * the wrong dialog with nothing red.
 */
export class DialogRegistry {
  readonly #byId = new Map<string, DialogEntry>();

  constructor(dialogs: readonly DialogEntry[]) {
    for (const dialog of dialogs) {
      if (this.#byId.has(dialog.id)) {
        throw new Error(
          `Two dialogs claim the id "${dialog.id}". One would silently replace the other and the ` +
            `wrong dialog would open with nothing red (ADR-0029 Decision 3). Rename one of them.`,
        );
      }
      this.#byId.set(dialog.id, dialog);
    }
  }

  /**
   * Validates props against the registered schema, ready to mount.
   *
   * **The validation is here rather than at the mount point**, because this is
   * the only place that holds both the schema and the caller's object. A mount
   * point receiving already-typed props has nothing left to check, and a caller
   * checking its own props is every caller reimplementing one rule (B3a).
   *
   * @throws DialogNotRegistered when nothing claims the id
   * @throws DialogPropsRejected when the schema refuses
   */
  openWith(id: string, props: unknown): { readonly entry: DialogEntry; readonly props: unknown } {
    const entry = this.#byId.get(id);
    if (entry === undefined) throw new DialogNotRegistered(id, [...this.#byId.keys()]);

    const parsed = entry.props.safeParse(props);
    if (!parsed.success) {
      throw new DialogPropsRejected(id, parsed.error.issues.map((issue) => issue.message).join('; '));
    }
    return { entry, props: parsed.data };
  }

  /** One entry by id, or `undefined`. For a surface that needs the title before opening. */
  get(id: string): DialogEntry | undefined {
    return this.#byId.get(id);
  }

  /** How many dialogs are registered. */
  get size(): number {
    return this.#byId.size;
  }
}
