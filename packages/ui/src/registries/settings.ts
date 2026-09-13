import type { MessageKey } from '@monstera/shared';
import { z } from 'zod';

/**
 * The settings registry — §7's third row.
 *
 * Derives *"the entire Settings dialog, persistence, export (secrets
 * excluded)"*. All three from one entry is the point: a setting added to the
 * dialog but not to persistence, or persisted and then leaked into an export,
 * are the two failures a second wiring place produces here.
 */

/** Which group of the Settings dialog a setting appears under. */
export type SettingCategory =
  | 'general'
  | 'appearance'
  // What is drawn OVER the document, as against how the shell is painted:
  // rulers, grid, page layout, dark page mode. `BUILD-PROMPT.md:608-611` groups
  // them this way, and the distinction is one a reader makes — nobody looks for
  // the grid under the theme.
  | 'viewing'
  | 'editing'
  | 'privacy'
  | 'advanced'
  // PART F'S AI GROUP, and a provider's key lives here rather than beside the
  // feature that first needed it: D6's Claude recogniser placed the Anthropic key,
  // and Stage 9's provider registry takes the same entry (ADR-0057 Decision 5).
  | 'ai'
  // PART F'S INTEGRATIONS GROUP — *all secret* — where D7's DocuSign row places its
  // integration key, and where Stage 9's cloud providers join it (ADR-0059).
  | 'integrations';

/**
 * One registered setting.
 *
 * ## `secret` is on the entry, and export derives from it
 *
 * §7 says export excludes secrets. That exclusion is a projection of this flag
 * rather than a list maintained beside the exporter — a list is the second
 * wiring place, and the failure it produces is an API key in a settings file a
 * user attaches to a bug report.
 *
 * Its default is `false` and it is written out at every secret-bearing call
 * site, because the safe value being the one you get by saying nothing is the
 * right default, and the dangerous one should be typed on purpose.
 *
 * ## `migrate` is how a stored value from an older build is read
 *
 * Absent means *the stored shape has never changed*. Present, it receives
 * whatever was on disk — `unknown`, because a previous build's shape is not
 * this build's type — and returns something the schema will accept, or throws
 * to fall back to the default. The default is what a failed migration yields,
 * never a partially-migrated value.
 */
export interface SettingDefinition<Schema extends z.ZodType = z.ZodType> {
  /** `<domain>.<name>`, unique registry-wide. */
  readonly id: string;
  /** The setting's label, as a key. */
  readonly title: MessageKey;
  /** Validates a value from disk or from the dialog, and types it. */
  readonly schema: Schema;
  /** What an unset setting is. Must satisfy `schema` — checked at construction. */
  readonly fallback: z.infer<Schema>;
  /** Which dialog group it appears under. */
  readonly category: SettingCategory;
  /** Excluded from export when true. Defaults to false. */
  readonly secret?: boolean;
  /**
   * A title for each member of an ENUMERATED setting, and absent for every other
   * kind ([ADR-0056](../../../../docs/DECISIONS/0056-the-settings-dialog-derives-a-control-from-a-schema-and-a-secret-is-write-only.md)).
   *
   * An enum's members are values rather than words — `pt`, `system` — so a
   * derived dialog could not show them (B9). Checked at construction in both
   * directions: an enum missing a member's title, a title for a member the enum
   * does not have, and titles on a setting that is not an enum are all refused,
   * naming the setting.
   */
  readonly optionTitles?: Readonly<Record<string, MessageKey>>;
  /** Reads a stored value written by an older build. */
  readonly migrate?: (stored: unknown) => unknown;
}

/**
 * The composed set of settings.
 *
 * ## The fallback is validated at CONSTRUCTION, and that is not belt-and-braces
 *
 * A fallback that its own schema refuses is a setting whose unset state is
 * invalid — so the dialog renders a broken control, or `read` returns something
 * the caller's type says is impossible, on a fresh install only. It is exactly
 * the defect that never appears on a developer machine, which has had every
 * setting written at least once. Checking at construction turns it into a
 * startup crash naming the setting.
 */
export class SettingsRegistry {
  readonly #byId = new Map<string, SettingDefinition>();

  constructor(settings: readonly SettingDefinition[]) {
    for (const setting of settings) {
      if (this.#byId.has(setting.id)) {
        throw new Error(
          `Two settings claim the id "${setting.id}". One would silently replace the other, and ` +
            `whichever lost would read as its own default for ever (ADR-0029 Decision 3).`,
        );
      }
      const check = setting.schema.safeParse(setting.fallback);
      if (!check.success) {
        throw new Error(
          `Setting "${setting.id}" has a fallback its own schema refuses: ` +
            `${check.error.issues.map((issue) => issue.message).join('; ')}. An unset setting ` +
            `would then be invalid — which happens on a fresh install and on no machine that has ` +
            `ever written this value.`,
        );
      }
      // AN ENUM'S MEMBERS ARE VALUES, NOT WORDS (ADR-0056), so an enumerated
      // setting must title exactly its members and nothing else may carry
      // titles. Both directions are checked, because iterating either set alone
      // makes it the universe: the titles alone pass a missing member, and the
      // members alone pass a title for one that does not exist.
      const members = setting.schema instanceof z.ZodEnum ? setting.schema.options.map(String) : null;
      const titled = setting.optionTitles === undefined ? null : Object.keys(setting.optionTitles);
      if (members === null && titled !== null) {
        throw new Error(
          `Setting "${setting.id}" titles ${titled.join(', ')} and is not an enumerated setting, so ` +
            'there is nothing for those titles to name (ADR-0056).',
        );
      }
      if (members !== null) {
        const missing = members.filter((member) => !(titled ?? []).includes(member));
        const extra = (titled ?? []).filter((member) => !members.includes(member));
        if (missing.length > 0 || extra.length > 0) {
          throw new Error(
            `Setting "${setting.id}" is enumerated and its titles do not match its members` +
              (missing.length > 0 ? `: no title for ${missing.join(', ')}` : '') +
              (extra.length > 0 ? `; a title for ${extra.join(', ')}, which it does not have` : '') +
              '. A derived dialog cannot show a value as a word (ADR-0056).',
          );
        }
      }
      this.#byId.set(setting.id, setting);
    }
  }

  /**
   * The value to use, given whatever is on disk.
   *
   * Migration runs first, then validation, then the fallback. **A migration
   * that throws yields the fallback rather than propagating**, because the
   * alternative is a settings file from an older build preventing the
   * application from starting — and a setting is by definition something the
   * user can set again.
   */
  read(id: string, stored: unknown): unknown {
    const setting = this.#byId.get(id);
    if (setting === undefined) {
      throw new Error(
        `No setting is registered as "${id}". Settings are composed at the composition point; ` +
          `reading an unregistered id means the caller and the registry disagree about what ` +
          `exists, which the fallback would hide.`,
      );
    }
    if (stored === undefined) return setting.fallback;

    let candidate: unknown = stored;
    if (setting.migrate !== undefined) {
      try {
        candidate = setting.migrate(stored);
      } catch {
        return setting.fallback;
      }
    }
    const parsed = setting.schema.safeParse(candidate);
    return parsed.success ? parsed.data : setting.fallback;
  }

  /**
   * The settings an export may carry: everything not marked secret.
   *
   * Derived rather than listed. §7 assigns export's exclusion to this flag, and
   * a list beside the exporter is the second wiring place — the one whose
   * failure is an API key in a file a user attaches to a bug report.
   */
  exportable(): readonly SettingDefinition[] {
    return [...this.#byId.values()].filter((setting) => setting.secret !== true);
  }

  /** The settings in one dialog group. The Settings dialog is a projection of this. */
  inCategory(category: SettingCategory): readonly SettingDefinition[] {
    return [...this.#byId.values()].filter((setting) => setting.category === category);
  }

  /** One entry by id, or `undefined`. */
  get(id: string): SettingDefinition | undefined {
    return this.#byId.get(id);
  }

  /** How many settings are registered. */
  get size(): number {
    return this.#byId.size;
  }
}
