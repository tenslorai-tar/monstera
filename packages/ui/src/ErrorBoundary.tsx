import { Component, type ErrorInfo, type ReactElement, type ReactNode } from 'react';

/**
 * The one class component in this build.
 *
 * ## Why a class, when B7 says function components only
 *
 * React has no function form for an error boundary.
 * `getDerivedStateFromError` is declared on `StaticLifecycle` and
 * `componentDidCatch` on `ComponentLifecycle` — both class members — and there
 * is no hook (read 2026-09-03 from `node_modules/@types/react/index.d.ts:1225`
 * and `:1219`, `@types/react` 19.2.18 against `react` 19.2.8). The same
 * declaration says what happens without one: *"Unhandled exceptions will cause
 * the entire component tree to unmount."*
 *
 * So B7 gained a second confined exception rather than a general relaxation
 * ([ADR-0036](../../../docs/DECISIONS/0036-the-error-boundary-is-the-one-class-component.md),
 * `docs/ARCHITECTURE.md` §10.5a), and `monstera/no-class-components` exempts
 * this path and reports every other. The exemption lives in the rule rather
 * than in the config, because it is the rule's meaning — a confinement, not a
 * ban — and a control asserts this file is not reported, without which the two
 * are indistinguishable.
 *
 * ## It carries NO application logic, and that is the amendment's own limit
 *
 * No store, no client, no knowledge of documents, and **no strings**: the
 * fallback is a render prop, so what a reader is told is a function component's
 * job and passes through B9's catalogue like every other sentence. The class is
 * the mechanism React makes us write and nothing else.
 *
 * ## `caught` is a BOX, not a nullable error
 *
 * `null` is a legal thrown value — `throw null` is valid JavaScript, and a
 * rejected promise can carry one. State shaped `error: unknown | null` cannot
 * tell *nothing was caught* from *null was caught*, so a boundary written that
 * way renders its children again, they throw again, and the loop is invisible
 * because the screen never changes. A box distinguishes them by shape (B5).
 *
 * ## What it does NOT catch, stated rather than left to be discovered
 *
 * React catches errors thrown during rendering, in lifecycle methods and in a
 * constructor, within this subtree. It does not catch an event handler, a
 * `setTimeout`, or an unawaited rejection: those never enter React's rendering
 * path. `PageSlot`'s draw is one of them — async, and marking its own canvas on
 * failure since finding AAAAAA-4 — and this neither replaces nor weakens it.
 *
 * ## The error is not swallowed
 *
 * `componentDidCatch` hands the error to `onError` where a caller wants it, and
 * React's own default root handler logs a caught error regardless. What this
 * component must never become is the bare `.catch()` AAAAAA-4 was: a failure
 * that looks exactly like success to every observer.
 */
export interface ErrorBoundaryProps {
  /** The subtree to protect. */
  readonly children: ReactNode;
  /**
   * What to render instead, given the error and a way back.
   *
   * A render prop rather than an element, because the fallback needs `reset`
   * and a caller cannot be handed one before the boundary exists.
   */
  readonly fallback: (details: {
    readonly error: unknown;
    readonly reset: () => void;
  }) => ReactElement;
  /** Told about a caught error, for a caller that logs or reports. */
  readonly onError?: ((error: unknown, info: ErrorInfo) => void) | undefined;
}

/** Nothing caught, or the one error that was — see the header on the box. */
interface ErrorBoundaryState {
  readonly caught: { readonly error: unknown } | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { caught: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { caught: { error } };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  /**
   * Back to rendering the children.
   *
   * A bound field rather than a method, so the identity handed to the fallback
   * is stable across renders and a `useCallback` in the fallback does not have
   * to work around it.
   */
  private readonly reset = (): void => {
    this.setState({ caught: null });
  };

  override render(): ReactNode {
    const { caught } = this.state;
    if (caught === null) return this.props.children;
    return this.props.fallback({ error: caught.error, reset: this.reset });
  }
}
