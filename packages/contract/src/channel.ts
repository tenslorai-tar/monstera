import { type DeclaredFailure, type Failure, INTERNAL_FAILURE, type InternalFailure, type Result } from '@monstera/shared';
import type { z } from 'zod';

/**
 * One channel: a params schema and a result schema, defined exactly once.
 *
 * Everything else in the system is *derived* from the channel registry rather
 * than written beside it — the main-process handler map, the preload bridge,
 * the renderer's types, and the browser shim. Hand-writing the same channel in
 * several places is how an IPC layer drifts silently and then fails at runtime
 * in a build nobody changed.
 */
export interface Channel<
  TParams extends z.ZodType = z.ZodType,
  TResult extends z.ZodType = z.ZodType,
  TFailure extends string = string,
> {
  readonly params: TParams;
  readonly result: TResult;
  /**
   * The failures this channel can report, **declared beside its schemas**.
   *
   * ADR-0009 §9: a renderer-facing failure is a code, never text. Declaring the
   * codes here is what makes them checkable in both directions — a handler
   * returning an undeclared code does not compile, and the renderer knows the
   * complete set it must handle.
   *
   * `internal` is not listed and never needs to be. It is always available,
   * because an unexpected throw is a failure the channel did not plan for and
   * every channel can have one.
   */
  readonly failures: readonly TFailure[];
  /** Why this channel exists. Surfaced in generated documentation. */
  readonly summary: string;
}

/**
 * Declares a channel. The generic parameters are inferred from the schemas, so
 * the types flow to every derived surface without being restated.
 *
 * `failures` is a tuple of literals rather than a `string[]`, so the codes reach
 * the handler's return type as a union instead of collapsing to `string`.
 */
export function channel<
  TParams extends z.ZodType,
  TResult extends z.ZodType,
  const TFailure extends string = never,
>(
  summary: string,
  params: TParams,
  result: TResult,
  failures: readonly TFailure[] = [],
): Channel<TParams, TResult, TFailure> {
  return { summary, params, result, failures };
}

/**
 * The code that means *"this was not a planned failure"*.
 *
 * Available on every channel without being declared. A handler does not produce
 * it — the boundary does, when something throws — and it carries an incident id
 * rather than the reason, because the reason is the thing that must not cross.
 *
 * **Re-exported, not declared here.** It lives beside `Failure` in
 * `@monstera/shared` because that union's shape turns on it: the id-carrying
 * half is this code's half. Declaring it twice is how a type and a schema get to
 * disagree about which failures carry an id.
 */
export { INTERNAL_FAILURE, type InternalFailure };

/** The codes a channel DECLARED — what its handler may report. */
export type DeclaredOf<TMap extends ChannelMap, K extends keyof TMap> = TMap[K] extends Channel<
  z.ZodType,
  z.ZodType,
  infer C
>
  ? C
  : never;

/** Every failure code one channel can report, including the implicit one. */
export type FailureOf<TMap extends ChannelMap, K extends keyof TMap> =
  | DeclaredOf<TMap, K>
  | InternalFailure;

/** A registry of channels, keyed by channel id. */
export type ChannelMap = Readonly<Record<string, Channel>>;

/** Params type for one channel of a registry, after validation. */
export type ParamsOf<TMap extends ChannelMap, K extends keyof TMap> = z.infer<
  TMap[K]['params']
>;

/** Result type for one channel of a registry. */
export type ResultOf<TMap extends ChannelMap, K extends keyof TMap> = z.infer<
  TMap[K]['result']
>;

/**
 * The main-process handler map for a registry.
 *
 * This mapped type is what makes the registration **exhaustive**: an object
 * annotated with it that omits a channel does not compile, and one that adds a
 * channel the registry does not declare does not compile either. There is no
 * runtime check to forget, and no list to keep in step by hand — which is the
 * whole point, because the failure mode of a forgotten handler is a renderer
 * call that hangs rather than one that errors.
 *
 * ## A handler RETURNS its planned failures and THROWS its unplanned ones
 *
 * The return type carries the channel's declared codes, so producing one the
 * channel did not declare is a compile error rather than a runtime surprise.
 * That is §9 as a type: there is no free-text field to put a path in, and no
 * sanitiser that has to be right every time.
 *
 * A handler may still throw, and a throw is a **defect** rather than an
 * outcome — the boundary turns it into `internal` with an incident id and logs
 * the full diagnostic main-side. The distinction is the same one `Result`
 * already draws: an expected failure is part of the return type, a violated
 * invariant is not.
 *
 * ## `DeclaredFailure`, not `Failure` — and the difference is enforced here
 *
 * A handler returns **only** the codes its channel declared, with no `incident`
 * and no `internal` (ADR-0009, 2026-08-19). The paragraph above has said "a
 * handler does not produce `internal`" since the codes landed, while the return
 * type included it and then demanded an id `wrapHandler` never hands over. This
 * mapped type is now what says it, so the prose and the compiler agree.
 */
export type Handlers<TMap extends ChannelMap> = {
  readonly [K in keyof TMap]: (
    params: ParamsOf<TMap, K>,
  ) => Promise<Result<ResultOf<TMap, K>, DeclaredFailure<DeclaredOf<TMap, K>>>>;
};

/**
 * The renderer-facing surface for a registry.
 *
 * Structurally identical to `Handlers`, and deliberately a separate name: the
 * two sit on opposite sides of a process boundary and read very differently at
 * a call site.
 *
 * **A failure arrives as a value here, not as a throw.** It used to be
 * reconstructed into an `Error` so callers could use `try`/`catch` — which was
 * right while the wire carried a message, and is wrong now that it carries a
 * code: reconstructing an `Error` from a code would mean inventing text on the
 * renderer side, and the renderer's text comes from an i18n key. A `Result` also
 * makes the failure part of the type a caller cannot forget, which a `catch`
 * does not.
 */
export type ClientApi<TMap extends ChannelMap> = {
  readonly [K in keyof TMap]: (
    params: ParamsOf<TMap, K>,
  ) => Promise<Result<ResultOf<TMap, K>, Failure<FailureOf<TMap, K>>>>;
};
