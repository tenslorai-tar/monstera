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
export interface DialogEntry<
  Schema extends z.ZodType = z.ZodType,
  Result extends z.ZodType = z.ZodNever,
> {
  /** `<domain>.<name>`, unique registry-wide. */
  readonly id: string;
  /** The dialog's accessible title, as a key. */
  readonly title: MessageKey;
  /** Validates the props at the open call, and types them. */
  readonly props: Schema;
  /**
   * Validates what the dialog **answers with**, and types `resolve`
   * ([ADR-0038](../../../../docs/DECISIONS/0038-a-dialog-answers-the-command-that-opened-it.md)).
   *
   * Absent for an informational dialog, whose promise settles `undefined` on
   * dismissal and never any other way. The default `z.ZodNever` is what makes
   * that structural: `z.infer<z.ZodNever>` is `never`, so a body with no result
   * schema has a `resolve` it **cannot construct an argument for**, and the
   * gate is a type rather than a rule.
   *
   * Validated for `props`' reason, in the other direction: a dialog is the one
   * surface with no other error path, and a value crossing back out of it
   * reaches a command that mutates the document.
   */
  readonly result?: Result | undefined;
  /**
   * The lazily-loaded body. `<Dialog>` supplies the chrome.
   *
   * Its props are the schema's output **plus `resolve`**, which is deliberately
   * not in the schema: props keep meaning *the data this dialog was opened
   * with*, and a function inside a `.strict()` validator would be a hole in the
   * one place this project chose to close.
   */
  readonly component: LazyExoticComponent<
    FunctionComponent<z.infer<Schema> & DialogAnswering<z.infer<Result>>>
  >;
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
  readonly mount: (props: unknown, resolve: (result: unknown) => void) => ReactElement;
}

/**
 * What every dialog body receives beside its props.
 *
 * One member, named rather than inlined, so the two type positions that must
 * agree — the entry's `component` and `declareDialog`'s cast — say the same
 * thing in one place.
 */
export interface DialogAnswering<Result> {
  /**
   * Answers the opener, closing the dialog.
   *
   * For a dialog with no `result` schema this is `(r: never) => void`: there is
   * no argument to construct, so an informational body cannot answer at all.
   */
  readonly resolve: (result: Result) => void;
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
export function declareDialog<
  Schema extends z.ZodType<object>,
  Result extends z.ZodType = z.ZodNever,
>(entry: Omit<DialogEntry<Schema, Result>, 'mount'>): DialogEntry<Schema, Result> {
  return {
    ...entry,
    mount: (props, resolve) => {
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
      //
      // `resolve` RIDES WITH THE PROPS because React components take one
      // object. It is still not a *prop* in the registry's sense: the schema
      // never sees it, `openWith` never validates it, and it comes from the
      // host rather than from the opener — which is what keeps a function out
      // of the validator.
      const Body = entry.component as unknown as FunctionComponent<
        z.infer<Schema> & DialogAnswering<z.infer<Result>>
      >;
      // `resolve` NEEDS NO CAST and lint says so: it is declared
      // `(result: unknown) => void`, and a function accepting `unknown` is
      // assignable to one accepting this schema's output — contravariance
      // working in the safe direction, unlike the two casts above it.
      return createElement(Body, { ...(props as z.infer<Schema>), resolve });
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

/**
 * An entry as the **registry** holds it, with both schema types erased.
 *
 * ## Why the registry cannot store `DialogEntry` any more
 *
 * A registry holds entries whose schemas differ, so its element type has to be
 * one of them widened — and widening `Result` is not free, because
 * {@link DialogAnswering} is **contravariant** in it: `(r: never) => void` is
 * not assignable to `(r: unknown) => void`, so an informational entry stops
 * fitting the moment one entry declares a result. That is the compiler telling
 * the truth: a component taking `never` genuinely cannot receive an arbitrary
 * value.
 *
 * The erasure is safe for the same reason `mount` exists at all (finding
 * EEEEE-2): the registry never touches `component`. It reads the id and title,
 * validates through `props` and `result`, and calls `mount` — the closure
 * `declareDialog` built where both types were still in scope. So the property
 * that could be lost here is one nothing here uses.
 */
export type RegisteredDialog = Pick<DialogEntry, 'id' | 'title' | 'mount'> & {
  readonly props: z.ZodType;
  readonly result?: z.ZodType | undefined;
};

/** A dialog answered with something its result schema refuses. */
export class DialogResultRejected extends Error {
  override readonly name = 'DialogResultRejected';

  constructor(id: string, detail: string) {
    super(
      `Dialog "${id}" answered with a value its result schema refuses: ${detail}. This is caught ` +
        `on the way out because the value becomes a command's argument — the same reason props ` +
        `are checked on the way in (ADR-0038).`,
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
  readonly #byId = new Map<string, RegisteredDialog>();

  constructor(dialogs: readonly RegisteredDialog[]) {
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
  openWith(
    id: string,
    props: unknown,
  ): { readonly entry: RegisteredDialog; readonly props: unknown } {
    const entry = this.#byId.get(id);
    if (entry === undefined) throw new DialogNotRegistered(id, [...this.#byId.keys()]);

    const parsed = entry.props.safeParse(props);
    if (!parsed.success) {
      throw new DialogPropsRejected(id, parsed.error.issues.map((issue) => issue.message).join('; '));
    }
    return { entry, props: parsed.data };
  }

  /**
   * Validates what a dialog answered with, on its way back to the opener.
   *
   * Here for `openWith`'s reason and it is the same rule in the other
   * direction: this is the only place holding both the schema and the value,
   * and the value is about to become a command's argument.
   *
   * A dialog that declares no `result` **cannot answer** — its `resolve` takes
   * `never` — so reaching this without one is a defect in the host rather than
   * a body misbehaving, and it is refused by name rather than passed through.
   *
   * @throws DialogNotRegistered when nothing claims the id
   * @throws DialogResultRejected when the schema refuses, or there is none
   */
  answerOf(id: string, result: unknown): unknown {
    const entry = this.#byId.get(id);
    if (entry === undefined) throw new DialogNotRegistered(id, [...this.#byId.keys()]);

    if (entry.result === undefined) {
      throw new DialogResultRejected(
        id,
        'it declares no result schema, so its body has no argument it can answer with',
      );
    }
    const parsed = entry.result.safeParse(result);
    if (!parsed.success) {
      throw new DialogResultRejected(
        id,
        parsed.error.issues.map((issue) => issue.message).join('; '),
      );
    }
    return parsed.data;
  }

  /** One entry by id, or `undefined`. For a surface that needs the title before opening. */
  get(id: string): RegisteredDialog | undefined {
    return this.#byId.get(id);
  }

  /** How many dialogs are registered. */
  get size(): number {
    return this.#byId.size;
  }
}
