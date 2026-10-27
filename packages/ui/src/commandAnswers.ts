import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';

import { onEditorChange } from './editorKit/openEditor.js';
import type { CommandContext, CommandRegistry, UiCommand } from './registries/commands.js';
import type { SurfaceId } from './registries/placement.js';
import type { SettingsStore } from './settingsStore.js';

/**
 * The commands' answers, which each surface subscribes to for the commands it places
 * ([ADR-0272](../../../docs/DECISIONS/0272-each-surface-subscribes-to-the-answers-of-the-commands-it-places.md)).
 *
 * ## Why a store, and not the shell's state
 *
 * A predicate is handed only the context, and many read a store they were given when the command was made: the
 * settings (Loupe, the rulers, the theme), the panels' presence, which reads the settings, the open text editor's
 * formatting. The React Compiler memoizes a surface by what it is given, so a surface must be given something new when
 * one of its commands' answers moves, or it draws the answer from before (ADR-0258's correction, `commandStateLive.pw.ts`).
 * When the shell held every answer, every answer rendered the shell: a Bold press rendered `App`, the menu bar, the ribbon
 * and the status bar (about 15 ms of React work per press, profiled 2026-10-26). Here the shell writes the registry and
 * the base context in and subscribes to nothing, and a surface renders when an answer it places moves.
 *
 * ## What each surface subscribes to
 *
 * The commands its placement can show, shown or hidden, from the registry by the placements it draws
 * ({@link SURFACE_PLACEMENTS}), never a list kept by hand. A surface that draws commands named by id passes those ids,
 * from the one constant it draws them from.
 *
 * ## What it costs
 *
 * Every predicate, whenever a store it reads moves and whenever the shell renders with a new registry or base: 275
 * commands answered in 0.08 ms (measured 2026-10-26 on Node 22 over `App.test.tsx`'s registry, happy-dom, no editor
 * open, 500 runs after 50 to warm), so the work stays where ADR-0258's correction put it, and the renders go.
 */

/** One command's answers in a few characters: hidden (`~`) where its `when` says so, and its `checked` (`+`, `-`). */
function answerOf(command: UiCommand, context: CommandContext): string {
  const shown = command.when?.(context) ?? true;
  const checked = command.checked?.(context);
  return `${shown ? '' : '~'}${checked === undefined ? '' : checked ? '+' : '-'}`;
}

export class CommandAnswers {
  #registry: CommandRegistry | undefined;
  #base: CommandContext | undefined;
  readonly #answers = new Map<string, string>();
  readonly #listeners = new Set<() => void>();
  readonly #settings: SettingsStore;
  #stops: readonly (() => void)[] = [];

  constructor(settings: SettingsStore) {
    this.#settings = settings;
  }

  /** The registry and the base context the predicates are asked against, as the shell renders them. */
  update(registry: CommandRegistry, base: CommandContext): void {
    this.#registry = registry;
    this.#base = base;
    this.#recompute();
  }

  /** `useSyncExternalStore`'s subscribe: the stores the predicates read are watched while anything listens. */
  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.#listeners.size === 0) {
      // THE STORES A PREDICATE READS: the one list to keep, ADR-0258's correction's. A predicate reading another store
      // must have it added here, or the surfaces draw it late.
      this.#stops = [this.#settings.subscribe(() => {
        this.#recompute();
      }), onEditorChange(() => {
        this.#recompute();
      })];
    }
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) {
        for (const stop of this.#stops) stop();
        this.#stops = [];
      }
    };
  };

  /** The answers of `ids` as one string, equal for equal answers, so a surface renders only when one of them moves. */
  answersOf(ids: readonly string[]): string {
    return ids.map((id) => `${id}${this.#answers.get(id) ?? ''}`).join(' ');
  }

  #recompute(): void {
    const registry = this.#registry;
    const base = this.#base;
    if (registry === undefined || base === undefined) return;
    let moved = false;
    const present = new Set<string>();
    for (const command of registry.all()) {
      present.add(command.id);
      const answer = answerOf(command, base);
      if (this.#answers.get(command.id) !== answer) {
        this.#answers.set(command.id, answer);
        moved = true;
      }
    }
    for (const id of [...this.#answers.keys()]) {
      if (present.has(id)) continue;
      this.#answers.delete(id);
      moved = true;
    }
    if (moved) for (const listener of [...this.#listeners]) listener();
  }
}

/**
 * The placement kinds each surface draws, read by {@link useLiveContext} and held against the surfaces' models by
 * `App.test.tsx`, with every command shown: a surface whose model draws a command of a kind not listed here would draw its state late.
 */
export const SURFACE_PLACEMENTS = {
  ribbon: ['ribbon', 'rail'],
  properties: ['properties'],
  quickToolbar: ['quick-toolbar'],
  contextMenu: ['context-menu'],
  startScreen: ['start-screen'],
  statusBar: ['status-bar'],
  menuBar: ['menu-bar', 'menu-bar-commands', 'ribbon'],
} as const satisfies Readonly<Record<string, readonly SurfaceId[]>>;

/** What a surface subscribes to: its placement kinds, every command (the palette, which reads no placements), or ids. */
export type Subscription = readonly SurfaceId[] | 'all' | { readonly ids: readonly string[] };

/** The ids a subscription covers in `registry`. */
export function idsOf(registry: CommandRegistry, subscription: Subscription): readonly string[] {
  if (subscription === 'all') return registry.all().map((command) => command.id);
  if ('ids' in subscription) return subscription.ids;
  const kinds = new Set<SurfaceId>(subscription);
  return registry
    .all()
    .filter((command) => command.placements.some((placement) => kinds.has(placement.surface)))
    .map((command) => command.id);
}

const AnswersContext = createContext<CommandAnswers | null>(null);

/** The shell's one store, given to every surface below it. */
export const CommandAnswersProvider = AnswersContext.Provider;

const NO_SUBSCRIBE = (): (() => void) => () => undefined;

/**
 * The context a surface draws its commands with: the shell's, carrying the answers of the commands `subscription`
 * covers, so the surface, and only it, renders when one of them moves. With no store above it (a surface drawn alone in
 * a test) the context is the shell's as given.
 */
export function useLiveContext(registry: CommandRegistry, context: CommandContext, subscription: Subscription): CommandContext {
  const store = useContext(AnswersContext);
  const ids = useMemo(() => idsOf(registry, subscription), [registry, subscription]);
  const answers = useSyncExternalStore(store?.subscribe ?? NO_SUBSCRIBE, () => (store === null ? '' : store.answersOf(ids)));
  return useMemo(() => (answers === '' ? context : { ...context, answers }), [context, answers]);
}
