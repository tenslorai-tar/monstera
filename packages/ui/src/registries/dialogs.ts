import type { MessageKey } from '@monstera/shared';
import type { ComponentType, LazyExoticComponent } from 'react';
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
  readonly component: LazyExoticComponent<ComponentType<z.infer<Schema>>>;
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
