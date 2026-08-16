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
> {
  readonly params: TParams;
  readonly result: TResult;
  /** Why this channel exists. Surfaced in generated documentation. */
  readonly summary: string;
}

/**
 * Declares a channel. The generic parameters are inferred from the schemas, so
 * the types flow to every derived surface without being restated.
 */
export function channel<TParams extends z.ZodType, TResult extends z.ZodType>(
  summary: string,
  params: TParams,
  result: TResult,
): Channel<TParams, TResult> {
  return { summary, params, result };
}

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
 * Handlers may throw. The boundary wrapper converts a throw into a structured
 * error, so a handler never has to think about the wire.
 */
export type Handlers<TMap extends ChannelMap> = {
  readonly [K in keyof TMap]: (params: ParamsOf<TMap, K>) => Promise<ResultOf<TMap, K>>;
};

/**
 * The renderer-facing surface for a registry.
 *
 * Structurally identical to `Handlers`, and deliberately a separate name: the
 * two sit on opposite sides of a process boundary and read very differently at
 * a call site. Rejections arrive as thrown `Error`s here, reconstructed from
 * the structured form by the bridge.
 */
export type ClientApi<TMap extends ChannelMap> = {
  readonly [K in keyof TMap]: (params: ParamsOf<TMap, K>) => Promise<ResultOf<TMap, K>>;
};
