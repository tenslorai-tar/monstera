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

/** A stored colour: six lower-case hex digits, which is the spelling a colour input answers. */
const COLOUR_PATTERN = /^#[0-9a-f]{6}$/u;

/** What the colour constructor recorded about a schema it built. */
export interface ColourKind {
  /** The stored value that means *no colour was chosen*. */
  readonly unset: string;
  /** The `#rrggbb` a colour input offers when a person moves off `unset`. */
  readonly starting: string;
}

const COLOUR_KINDS = new WeakMap<z.ZodType, ColourKind>();

/**
 * A colour setting's schema: its no-choice value, or `#rrggbb`
 * ([ADR-0056](../../../../docs/DECISIONS/0056-the-settings-dialog-derives-a-control-from-a-schema-and-a-secret-is-write-only.md),
 * corrected 2026-09-15).
 *
 * ## Recognised because it was BUILT here, never by its shape
 *
 * A union of a literal and a pattern is not always a colour — the next one may be
 * a literal beside an id pattern — so the Settings dialog asks
 * {@link colourKindOf} rather than inspecting the union. Deciding from the shape
 * would be a second opinion about what a colour setting is, and one that agrees
 * with this until the day it does not (B3a).
 *
 * ## The starting colour travels with the schema
 *
 * A colour input cannot show *no colour*, so every surface of a colour setting has
 * to offer something when a person moves off `unset`. Holding it here is what keeps
 * two surfaces of one setting offering the same first colour.
 */
export function colourSchema<Unset extends string>(kind: {
  readonly unset: Unset;
  readonly starting: string;
}): z.ZodUnion<readonly [z.ZodLiteral<Unset>, z.ZodString]> {
  if (!COLOUR_PATTERN.test(kind.starting)) {
    throw new Error(
      `A colour setting's starting colour must be #rrggbb in lower case; "${kind.starting}" is not, ` +
        'and a colour input handed it would show black.',
    );
  }
  if (COLOUR_PATTERN.test(kind.unset)) {
    throw new Error(
      `A colour setting's no-choice value "${kind.unset}" is itself a colour, so a stored value could ` +
        'not say whether a person chose it.',
    );
  }
  const schema = z.union([z.literal(kind.unset), z.string().regex(COLOUR_PATTERN)]);
  COLOUR_KINDS.set(schema, { unset: kind.unset, starting: kind.starting });
  return schema;
}

/** The colour constructor's record for `schema`, or `undefined` for a schema it did not build. */
export function colourKindOf(schema: z.ZodType): ColourKind | undefined {
  return COLOUR_KINDS.get(schema);
}

/**
 * Which page of the Settings dialog a setting appears under — the owner's design of 2026-09-22 names
 * the pages and their order, and `SETTINGS_PAGES` in `settings/pages.ts` holds that order once.
 *
 * A page with no setting of its own is not necessarily empty: *Keyboard* is the shortcut map,
 * *Updates* says where updates come from, and *Privacy* carries an action. A page with nothing at
 * all is not drawn, because an empty page explaining that it is empty is the defect the owner named.
 */
export type SettingCategory =
  | 'general'
  | 'appearance'
  /** How the page itself is drawn — the second renderer, image handling. */
  | 'rendering'
  /** What a save does, and what is kept beside the document. */
  | 'saving'
  /** Recognition: languages, and the services that read a scan. */
  | 'ocr'
  /** The shortcut map. No setting of its own yet; the page is the map. */
  | 'keyboard'
  /** Where updates come from. No setting of its own: Windows updates Store apps (ADR-0018). */
  | 'updates'
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
  /**
   * One plain line under the label, saying what the setting does — the owner's design of
   * 2026-09-22 gives every row a bold label and a description beneath it.
   *
   * Optional, and a row without one draws no second line: a description that restated its label
   * would be noise in the place a reader looks for the thing the label could not say.
   */
  readonly description?: MessageKey;
  /** Validates a value from disk or from the dialog, and types it. */
  readonly schema: Schema;
  /** What an unset setting is. Must satisfy `schema` — checked at construction. */
  readonly fallback: z.infer<Schema>;
  /** Which dialog group it appears under. */
  readonly category: SettingCategory;
  /** Excluded from export when true. Defaults to false. */
  readonly secret?: boolean;
  /**
   * State the application remembers FOR a person rather than a choice they come here to make: how
   * wide they dragged a panel, which tab was open, whether the rulers are showing.
   *
   * Stored and exported like any other setting; simply never a row in the Settings dialog. Before
   * this flag every one of them was a row, so *Settings* offered a number box for the document
   * panel's width beside the theme — the shape the owner's design pass called out. The control for
   * these is the thing itself: the splitter, the tab, the ribbon button that toggles them.
   */
  readonly remembered?: boolean;
  /**
   * Whether this setting needs the OS credential store, without being a secret itself.
   *
   * *Save chat history* is the first: the conversations are encrypted with the keys' own cipher, so
   * on a machine with no keyring `main` refuses every save. The renderer drops that refusal, which
   * leaves a switch reading ON while nothing is saved — an honest-state gap found by the audit of
   * `57de0e0..d2989fc`. Marked here, the dialog disables the control and says why, which is the same
   * answer a key field already gives on such a machine.
   */
  readonly needsSecureStorage?: boolean;
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
  /**
   * What *no choice* means for a COLOUR setting, and absent for every other kind
   * (ADR-0056, corrected 2026-09-15).
   *
   * A colour setting's no-choice value is a value — `'auto'` is *each tool's own* —
   * and what it means differs per setting, so no generic label can name it. Checked
   * at construction in both directions, as `optionTitles` is.
   */
  readonly unsetTitle?: MessageKey;
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
      // A COLOUR'S NO-CHOICE VALUE NEEDS A WORD, and nothing else may carry one:
      // both directions, for the reason the enum check above gives.
      const colour = colourKindOf(setting.schema);
      if (colour !== undefined && setting.unsetTitle === undefined) {
        throw new Error(
          `Setting "${setting.id}" is a colour setting with no unset title, so the Settings dialog ` +
            `could not say what "${colour.unset}" means (ADR-0056).`,
        );
      }
      if (colour === undefined && setting.unsetTitle !== undefined) {
        throw new Error(
          `Setting "${setting.id}" has an unset title and is not a colour setting built by ` +
            'colourSchema, so there is no no-choice state for it to name (ADR-0056).',
        );
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
