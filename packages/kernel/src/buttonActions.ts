import {
  type ButtonStep,
  FIELD_ACTION_TRIGGERS,
  type FieldAction,
  type FieldActionTrigger,
  MAX_ACTION_CHAIN,
  MAX_ACTION_SUBTYPE,
  fieldActionSchema,
  stepRunsAs,
} from '@monstera/contract/host';

/**
 * A push button's actions, read and classified ONCE (ADR-0259, B3a).
 *
 * Two object models read a button's actions: MuPDF's, for the listing, the Properties read and a press, and pdf-lib's,
 * for the edit that writes them and must refuse to write over one it would drop. Each has an adapter that turns its
 * dictionaries into a {@link PlainAction}, and THIS module is the only place that decides what a plain action is and how
 * a chain is walked. So the two cannot disagree about which actions are kept, and a kind added tomorrow is classified
 * in one function.
 *
 * Imports no PDF library, so neither host pays at load for the other's (`fieldEditRefusal.ts`' measurement).
 */

/** One action dictionary as either object model reads it: the entries this build classifies, already decoded. */
export interface PlainAction {
  /** `/S`, or `null` where it is not a name. */
  readonly subtype: string | null;
  /**
   * `/Fields`: `null` where absent, else the fully qualified names of its entries, at most {@link MAX_ACTION_FIELDS} + 1
   * (one more says there are more), and `unreadable` where an entry is neither a name nor a field.
   */
  readonly fields: readonly string[] | 'unreadable' | null;
  /** `/Flags`, `0` where absent. */
  readonly flags: number;
  /**
   * `/D`: an explicit destination as its page's zero-based index (`null` where it names no page of this document), its
   * fit's name and the numbers after it (`null` for a `null`); `named` for a named destination; `null` where absent.
   */
  readonly destination:
    | { readonly page: number | null; readonly fit: string | null; readonly numbers: readonly (number | null)[] }
    | 'named'
    | null;
  /** `/URI` as text, or `null` where it is not a string. */
  readonly uri: string | null;
  /** `/N`, a named action's name, or `null` where it is not a name. */
  readonly named: string | null;
  /** `/F` as text: a string, or a file specification's `/UF`, else its `/F`; `null` where neither. */
  readonly file: string | null;
  /** A `/Hide`'s `/T`, read as {@link PlainAction.fields} is: one entry or an array of them, `null` where absent. */
  readonly targets: readonly string[] | 'unreadable' | null;
  /** A `/Hide`'s `/H`: `true` where absent, as the standard defaults it, and `null` where it is not a boolean. */
  readonly hide: boolean | null;
}

/** What one object model offers the walker: a node's plain reading, the nodes its `/Next` names, and its identity. */
export interface ActionModel<Node> {
  readonly plain: (node: Node) => PlainAction;
  /** `/Next`, a dictionary or an array of them, in order; empty where absent. */
  readonly next: (node: Node) => readonly Node[];
  /** The object number of an indirect node, or `undefined` for a direct one, so a loop is seen. */
  readonly identity: (node: Node) => number | undefined;
}

/** The head of each trigger's chain on one widget, `undefined` where it has none. `/AA /U` is listed after `up`. */
export interface ActionHeads<Node> {
  readonly up: Node | undefined;
  readonly upAgain: Node | undefined;
  readonly down: Node | undefined;
  readonly enter: Node | undefined;
  readonly exit: Node | undefined;
}

/** `/Flags` bit 1 of a Reset form or a submission: the fields named are the ones LEFT OUT (ISO 32000-1, table 238). */
const EXCLUDE = 1;

/** A kept action: the document's own, never written over, and run only as `runsAs` says. */
function kept(subtype: string | null, runsAs: FieldAction['kind'] | null): ButtonStep['action'] {
  return { kind: 'kept', subtype: (subtype ?? '').slice(0, MAX_ACTION_SUBTYPE), runsAs };
}

/**
 * THE ONE CLASSIFIER: what a plain action is, as this build writes it, or kept.
 *
 * A kind this build runs whose contents are past what an edit writes (a reset naming every field but some, or more than
 * {@link MAX_ACTION_FIELDS}) is kept AND runs: a press reads the document at the time, so the run never depended on the
 * list fitting. A kind this build does not run is kept and never runs (invariant 24).
 */
export function classifyAction(plain: PlainAction): FieldAction | ButtonStep['action'] {
  switch (plain.subtype) {
    case 'ResetForm': {
      if (plain.fields === 'unreadable' || (plain.flags & EXCLUDE) === EXCLUDE) return kept(plain.subtype, 'reset');
      const parsed = fieldActionSchema.safeParse({ kind: 'reset', fields: plain.fields });
      return parsed.success ? parsed.data : kept(plain.subtype, 'reset');
    }
    case 'GoTo': {
      // A NAMED DESTINATION, or one naming no page here, is kept: resolving a name is a reading this build does not do
      // for a button, and a press that went somewhere else would be worse than one that says it went nowhere.
      const destination = plain.destination;
      if (destination === null || destination === 'named' || destination.page === null) return kept(plain.subtype, null);
      const parsed = fieldActionSchema.safeParse({ kind: 'goTo', page: destination.page, ...viewOf(destination) });
      return parsed.success ? parsed.data : kept(plain.subtype, null);
    }
    // ONLY PRINT among the named actions: the standard's four page moves (`NextPage` and the rest) are a reader's own
    // navigation this build does not write, so they are kept rather than run as something they are not.
    case 'Named':
      return plain.named === 'Print' ? { kind: 'print' } : kept(plain.subtype, null);
    case 'Hide': {
      // `/T` NAMING AN ANNOTATION that is not a field is kept and never run: a press shows or hides fields by name, and
      // nothing names that one. More names than an edit writes is kept and runs, since a press reads `/T` again.
      if (plain.targets === 'unreadable' || plain.targets === null || plain.hide === null) return kept(plain.subtype, null);
      const parsed = fieldActionSchema.safeParse({ kind: 'showHide', fields: plain.targets, hide: plain.hide });
      return parsed.success ? parsed.data : kept(plain.subtype, 'showHide');
    }
    case 'ImportData': {
      // A PATH TO SOMEWHERE ELSE is kept, and still runs: the press asks the person to pick, so what the document names
      // is never opened and only an edit would have to rewrite it.
      const parsed = fieldActionSchema.safeParse({ kind: 'importData', file: plain.file });
      return parsed.success ? parsed.data : kept(plain.subtype, 'importData');
    }
    case 'URI': {
      // A SCHEME NOT FOLLOWED (`javascript:`, `file:`) is kept and never run: the contract's link takes only what
      // `isFollowable` does, so it fails the parse here rather than reaching a press.
      const parsed = fieldActionSchema.safeParse({ kind: 'link', address: plain.uri });
      return parsed.success ? parsed.data : kept(plain.subtype, null);
    }
    case null:
    default:
      return kept(plain.subtype, null);
  }
}

/**
 * A destination's fit as {@link fieldActionSchema}'s view (ISO 32000-1, table 151): `/XYZ left top zoom`, where a zoom of
 * 0 is the reader's own, `/Fit`, and `/FitH top`. Any other fit (`/FitV`, `/FitR`, the bounding-box ones) is not a view
 * an edit writes, so it answers nothing and the action is kept.
 */
function viewOf(destination: { readonly fit: string | null; readonly numbers: readonly (number | null)[] }): {
  readonly view?: 'keep' | 'fit' | 'fit-width';
  readonly at?: { readonly left: number | null; readonly top: number | null; readonly zoom: number | null } | null;
} {
  const [first = null, second = null, third = null] = destination.numbers;
  switch (destination.fit) {
    case 'XYZ': {
      const zoom = third === null || third === 0 ? null : third;
      return { view: 'keep', at: first === null && second === null && zoom === null ? null : { left: first, top: second, zoom } };
    }
    case 'Fit':
      return { view: 'fit', at: null };
    case 'FitH':
      return { view: 'fit-width', at: first === null ? null : { left: null, top: first, zoom: null } };
    case null:
    default:
      return {};
  }
}

/** Whether a press carries a classified action out: the contract's one rule. */
export function actionRuns(action: ButtonStep['action']): boolean {
  return stepRunsAs(action) !== null;
}

/**
 * Every step of a button, trigger by trigger, each chain in the standard's order (`/Next` depth first, an array's
 * members in order), at most {@link MAX_ACTION_CHAIN} in all.
 *
 * A chain that loops back on itself, or runs past the bound, is never run in part: what it reached is listed kept and
 * not run, so a press cannot carry out the first half of what its author wrote.
 */
export function buttonSteps<Node>(model: ActionModel<Node>, heads: ActionHeads<Node>): readonly ButtonStep[] {
  const steps: ButtonStep[] = [];
  const roots: Readonly<Record<FieldActionTrigger, readonly (Node | undefined)[]>> = {
    up: [heads.up, heads.upAgain],
    down: [heads.down],
    enter: [heads.enter],
    exit: [heads.exit],
  };
  for (const trigger of FIELD_ACTION_TRIGGERS) {
    const chain = chainOf(model, roots[trigger], MAX_ACTION_CHAIN - steps.length);
    // `/AA /U` IS KEPT whatever it is: this build writes mouse up as `/A` alone, so an edit could not keep it.
    const again = heads.upAgain === undefined || trigger !== 'up' ? undefined : chainOf(model, [heads.up], MAX_ACTION_CHAIN).nodes.length;
    chain.nodes.forEach((node, step) => {
      const plain = model.plain(node);
      const action = chain.whole && (again === undefined || step < again) ? classifyAction(plain) : kept(plain.subtype, null);
      steps.push({ trigger, step, action });
    });
  }
  return steps;
}

/** The nodes of one trigger's chain in order, at most `room`, and whether it was read whole: no loop, nothing past it. */
function chainOf<Node>(
  model: ActionModel<Node>,
  roots: readonly (Node | undefined)[],
  room: number,
): { readonly nodes: readonly Node[]; readonly whole: boolean } {
  const nodes: Node[] = [];
  const seen = new Set<number>();
  let whole = true;
  const visit = (node: Node): void => {
    if (!whole) return;
    const identity = model.identity(node);
    if (identity !== undefined) {
      if (seen.has(identity)) {
        whole = false;
        return;
      }
      seen.add(identity);
    }
    if (nodes.length >= room) {
      whole = false;
      return;
    }
    nodes.push(node);
    for (const next of model.next(node)) visit(next);
  };
  for (const root of roots) if (root !== undefined) visit(root);
  return { nodes, whole };
}

/** The action node at one step of one trigger, as {@link buttonSteps} numbers them, or `undefined` where there is none. */
export function nodeAt<Node>(model: ActionModel<Node>, heads: ActionHeads<Node>, trigger: FieldActionTrigger, step: number): Node | undefined {
  const roots = trigger === 'up' ? [heads.up, heads.upAgain] : [heads[trigger]];
  return chainOf(model, roots, MAX_ACTION_CHAIN).nodes[step];
}

/** Which triggers have an action a press carries out, and which hold one that is never run: the listing's summary. */
export function triggersOf(steps: readonly ButtonStep[]): { readonly runs: readonly FieldActionTrigger[]; readonly kept: readonly FieldActionTrigger[] } {
  const runs = FIELD_ACTION_TRIGGERS.filter((trigger) => steps.some((each) => each.trigger === trigger && actionRuns(each.action)));
  const keptHere = FIELD_ACTION_TRIGGERS.filter((trigger) => steps.some((each) => each.trigger === trigger && !actionRuns(each.action)));
  return { runs, kept: keptHere };
}

/** Whether a button holds anything an edit would drop: a kept action, on any trigger. */
export function holdsKept(steps: readonly ButtonStep[]): boolean {
  return steps.some((each) => each.action.kind === 'kept');
}
