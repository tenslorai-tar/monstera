import type { SettingsRegistry } from './registries/settings.js';

/**
 * The renderer's live settings values.
 *
 * ## Why this exists rather than components reading the registry
 *
 * The registry holds *definitions* — schema, fallback, category, secrecy. It
 * holds no values, deliberately: a registry that also held state would be two
 * concerns with one owner, and the settings dialog and the persistence layer
 * would both be writing it. This holds values, reads them **through** the
 * registry so migration and validation happen in one place, and notifies.
 *
 * ## What it does NOT do, and the reason is a channel that does not exist
 *
 * It does not persist. §7 says the registry derives *"the Settings dialog,
 * persistence, export"*, and persistence lives in main — the renderer holds no
 * filesystem path (invariant 2), so writing a settings file from here is
 * unrepresentable rather than merely discouraged. `hydrate` takes whatever main
 * sends and `changes` is what a caller forwards back; the channel between them
 * is owed, and this store is the half that needs no channel to be finished.
 *
 * A single instance per application rather than per document: a setting is the
 * user's, not a document's, which is the one place §6's per-document rule does
 * not apply and is worth saying because every other store here is per document.
 */
export class SettingsStore {
  readonly #registry: SettingsRegistry;
  readonly #values = new Map<string, unknown>();
  readonly #listeners = new Set<(id: string) => void>();

  constructor(registry: SettingsRegistry) {
    this.#registry = registry;
  }

  /**
   * Loads whatever was stored, running each value through its registration.
   *
   * Takes the **whole** stored object rather than one id at a time, because a
   * partial hydrate is indistinguishable from a user who has changed nothing —
   * and this is called once at startup, when telling those apart is the only
   * thing that matters.
   */
  hydrate(stored: Readonly<Record<string, unknown>>): void {
    for (const [id, value] of Object.entries(stored)) {
      // An id the registry does not know is DROPPED rather than kept. It is a
      // setting an older build wrote and this one removed; keeping it would
      // make `all()` answer with keys no schema governs, and re-exporting it
      // would carry a removed setting forward for ever.
      if (this.#registry.get(id) === undefined) continue;
      this.#values.set(id, this.#registry.read(id, value));
    }
    for (const listener of this.#listeners) listener('*');
  }

  /**
   * One setting's current value.
   *
   * Goes through `read` even for an unset setting, so the fallback comes from
   * the registry rather than from a second answer here about what unset means.
   */
  get(id: string): unknown {
    return this.#registry.read(id, this.#values.get(id));
  }

  /**
   * Changes one setting.
   *
   * **Validates before storing**, so an invalid write is refused at the door
   * rather than becoming a value `get` has to cope with. The alternative —
   * storing anything and validating on read — makes every reader carry the
   * question, and makes the dialog's own display of the value depend on which
   * path it took.
   */
  set(id: string, value: unknown): void {
    const definition = this.#registry.get(id);
    if (definition === undefined) {
      throw new Error(
        `No setting is registered as "${id}". Writing an unregistered id means the caller and ` +
          `the registry disagree about what exists, and the value would be dropped on the next ` +
          `hydrate with nothing said.`,
      );
    }
    const parsed = definition.schema.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `Setting "${id}" refused a value its schema does not accept: ` +
          `${parsed.error.issues.map((issue) => issue.message).join('; ')}.`,
      );
    }
    this.#values.set(id, parsed.data);
    for (const listener of this.#listeners) listener(id);
  }

  /**
   * Everything currently set, for the layer that persists it.
   *
   * **Includes secrets.** The exclusion §7 assigns to `secret` is EXPORT's, and
   * export is a different operation from persistence — a user who set an API
   * key expects it to survive a restart. Conflating the two would either leak
   * the key into a shared file or forget it every launch, and which of those
   * you get would depend on which caller reached for this first.
   */
  all(): Readonly<Record<string, unknown>> {
    return Object.fromEntries(this.#values);
  }

  /**
   * What an export may carry: the non-secret settings that are actually set.
   *
   * Derived from the registry's `exportable()` rather than filtered here, so
   * the secrecy rule has one owner (B3).
   */
  exportable(): Readonly<Record<string, unknown>> {
    const allowed = new Set(this.#registry.exportable().map((setting) => setting.id));
    return Object.fromEntries([...this.#values].filter(([id]) => allowed.has(id)));
  }

  /**
   * Subscribes to changes. Returns the unsubscribe.
   *
   * The listener receives the id that changed, or `'*'` after a hydrate. A
   * hydrate is not a list of ids because it may change any number of them at
   * once and a component that re-read on each would render once per setting.
   */
  subscribe(listener: (id: string) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
