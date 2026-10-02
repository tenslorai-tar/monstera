import type { Page } from '@playwright/test';

/**
 * Counts what React renders, in a real browser, on the PRODUCTION build the rendered cases run against.
 *
 * ## The hook React already calls
 *
 * React DOM calls `__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot` after every commit, in production builds as
 * well — it is how the developer tools show a production tree. Installed before the application loads, this hook
 * walks each commit's tree the way the tools decide what rendered: a component that mounted, or one carrying
 * React's `PerformedWork` flag, rendered in that commit; a subtree whose children are the previous commit's own
 * fibers was not entered, so the walk does not enter it either.
 *
 * ## A component is named by what it DRAWS, because the build has no names
 *
 * A production bundle minifies every function name, so a component is identified by its first DOM element and the
 * selectors a case declares: `.m-page-list [data-page]` is a page slot, `.m-context-menu-region` a menu's trigger.
 * Several components can share one first element — a menu area, its root and its trigger all draw the trigger's
 * box — so a commit counts each ELEMENT once, whichever of its components rendered. A count is therefore *how many
 * times an element's components rendered, one per commit*, split by the document layer the element sits in (its
 * index among `.m-document-layer`, `-1` outside every layer).
 *
 * ## Its positive control is the case's
 *
 * A walk that entered nothing would report zero for everything, which is the answer a case about *not rendering*
 * hopes for. So every case reading this asserts first that something it knows rendered was counted — the layer
 * that came forward, the slots a scroll mounted — and only then that something else was not.
 */
export async function installRenderCounter(page: Page, selectors: Readonly<Record<string, string>>): Promise<void> {
  await page.addInitScript((watched: Readonly<Record<string, string>>) => {
    interface Fiber {
      readonly tag: number;
      readonly flags: number;
      readonly child: Fiber | null;
      readonly sibling: Fiber | null;
      readonly alternate: Fiber | null;
      readonly stateNode: unknown;
    }
    // React's work tags for the fibers a component owns, and for a DOM element: `ReactWorkTags.js`.
    const COMPONENT = new Set([0, 1, 11, 14, 15]);
    const HOST = 5;
    const PERFORMED_WORK = 1;
    const totals = new Map<string, number>();
    const unread = (): undefined => undefined;
    let counting = false;
    let commits = 0;

    const firstElement = (fiber: Fiber): Element | undefined => {
      for (let at = fiber.child; at !== null; at = at.child) {
        if (at.tag === HOST) return at.stateNode instanceof Element ? at.stateNode : undefined;
      }
      return undefined;
    };

    const onCommit = (root: { readonly current: Fiber }): void => {
      commits += 1;
      const drawn = new Set<Element>();
      const visit = (first: Fiber | null): void => {
        for (let at = first; at !== null; at = at.sibling) {
          const before = at.alternate;
          if (COMPONENT.has(at.tag) && (before === null || (at.flags & PERFORMED_WORK) === PERFORMED_WORK)) {
            const element = firstElement(at);
            if (element !== undefined) drawn.add(element);
          }
          // NOT ENTERED: the children are the previous commit's own, so nothing under them rendered.
          if (before !== null && at.child === before.child) continue;
          visit(at.child);
        }
      };
      visit(root.current.child);
      const layers = [...document.querySelectorAll('.m-document-layer')];
      for (const element of drawn) {
        const layer = layers.indexOf(element.closest('.m-document-layer') ?? element);
        for (const [name, selector] of Object.entries(watched)) {
          if (!element.matches(selector)) continue;
          const key = `${name}@${String(layer)}`;
          totals.set(key, (totals.get(key) ?? 0) + 1);
        }
      }
    };

    (window as unknown as Record<string, unknown>)['__REACT_DEVTOOLS_GLOBAL_HOOK__'] = {
      supportsFiber: true,
      isDisabled: false,
      renderers: new Map<number, unknown>(),
      inject(this: { renderers: Map<number, unknown> }, renderer: unknown): number {
        this.renderers.set(this.renderers.size + 1, renderer);
        return this.renderers.size;
      },
      onCommitFiberRoot(_renderer: number, root: { readonly current: Fiber }): void {
        if (counting) onCommit(root);
      },
      // THE REST OF THE HOOK REACT CALLS, which this does not read.
      onCommitFiberUnmount: unread,
      onPostCommitFiberRoot: unread,
      checkDCE: unread,
    };
    (window as unknown as Record<string, unknown>)['renderCounter'] = {
      start(): void {
        totals.clear();
        commits = 0;
        counting = true;
      },
      stop(): { readonly commits: number; readonly totals: Record<string, number> } {
        counting = false;
        return { commits, totals: Object.fromEntries(totals) };
      },
    };
  }, selectors);
}

/** What was counted between {@link startCounting} and this call. */
export interface RenderCounts {
  readonly commits: number;
  /** `name@layer` → renders, for each selector name and layer index that rendered at least once. */
  readonly totals: Readonly<Record<string, number>>;
}

export async function startCounting(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { renderCounter: { start: () => void } }).renderCounter.start();
  });
}

export async function stopCounting(page: Page): Promise<RenderCounts> {
  return page.evaluate(() => (window as unknown as { renderCounter: { stop: () => RenderCounts } }).renderCounter.stop());
}

/** One selector's count in one layer: absent from the totals is zero, never a lookup a case has to know to skip. */
export function rendersOf(counts: RenderCounts, name: string, layer: number): number {
  return counts.totals[`${name}@${String(layer)}`] ?? 0;
}
