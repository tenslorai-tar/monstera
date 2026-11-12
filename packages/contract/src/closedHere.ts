import type { Failure, Result } from '@monstera/shared';

import { createClient } from './boundary.js';
import type { ClientApi, DeclaredOf, FailureOf, ParamsOf, ResultOf } from './channel.js';
import { type Channels, channels } from './channels.js';

/**
 * The renderer's own failure: `main` answered `document-not-open` for a document this window had already sent
 * `document.close` for ([ADR-0294](../../../docs/DECISIONS/0294-a-refusal-for-a-document-this-window-closed-is-the-clients-own-code.md)).
 *
 * Never on the wire and no handler can produce it: only {@link closedHereClient} answers it. It travels with the value,
 * so a refusal copied into other props keeps it and the compiler follows it there.
 */
export const DOCUMENT_CLOSED_HERE = 'document-closed-here';
export type DocumentClosedHere = typeof DOCUMENT_CLOSED_HERE;

/**
 * One channel's failure as the renderer's client answers it: what a renderer type holding a refusal declares. The
 * contract's failure, and this window's own where the channel declares `document-not-open`.
 *
 * A MEMBER OF ITS OWN, never a code added inside the contract's: a plain failure is one object whose `code` is a union,
 * so testing the code would not narrow it, and a caller that tested for this one would still hold it on the other side.
 */
export type RendererFailure<K extends keyof Channels> = 'document-not-open' extends DeclaredOf<Channels, K>
  ? Failure<FailureOf<Channels, K>> | { readonly code: DocumentClosedHere }
  : Failure<FailureOf<Channels, K>>;

/** Only {@link closedHereClient} sets it, so a client built any other way is not a `ContractClient`. */
const BUILT: unique symbol = Symbol('closedHereClient');

/**
 * The renderer side, and the shape the browser shim must implement in full: the contract's client, with
 * {@link DOCUMENT_CLOSED_HERE} on every channel that declares `document-not-open`, built only by {@link closedHereClient}.
 */
export type ContractClient = {
  readonly [K in keyof Channels]: (
    params: ParamsOf<Channels, K>,
  ) => Promise<Result<ResultOf<Channels, K>, RendererFailure<K>>>;
} & { readonly [BUILT]: true };

/**
 * The renderer's client over a transport: the contract's channels, through {@link closedHereClient}. The one way the
 * application, the browser shim and every case builds a `ContractClient`, so each meets what the window does.
 */
export function clientOver(invoke: (id: keyof Channels, params: unknown) => Promise<unknown>): ContractClient {
  return closedHereClient(createClient(channels, invoke));
}

/** The `docId` a call names, or `undefined` for a call that names none. */
function docIdOf(params: unknown): string | undefined {
  if (typeof params !== 'object' || params === null || !('docId' in params)) return undefined;
  return typeof params.docId === 'string' ? params.docId : undefined;
}

/**
 * The renderer's client over the contract's: every answer passes it, so the rule lives here and in no reader
 * (ADR-0294).
 *
 * ## A document counts as closed here from the moment its close is SENT
 *
 * `releaseTabs` has already taken the tab off the screen when it sends `document.close`, so from then on nothing this
 * window shows is waiting for an answer about that document. A call sent before the close and answered after it,
 * `document-not-open` because the close ran ahead of it in the document's lane (ADR-0274), is this window's own close
 * answering, and becomes {@link DOCUMENT_CLOSED_HERE}. Every other answer passes unchanged: an `ok` that arrives after the
 * close, and `document-not-open` for a document this window never closed, which is a document `main` lost while it is
 * still on screen and must be said.
 *
 * The set of closed ids grows by one id per document closed this session and is never pruned: an id is never reused, and
 * a call about it can still be in flight at any later moment.
 */
export function closedHereClient(raw: ClientApi<Channels>): ContractClient {
  const closed = new Set<string>();
  const calls = Object.entries(raw).map(([id, call]) => {
    const send = call as (params: unknown) => Promise<Result<unknown, Failure>>;
    const answering = (params: unknown): Promise<Result<unknown, Failure>> => {
      const docId = docIdOf(params);
      // A CALL THAT NAMES NO DOCUMENT is the transport's own promise, untouched: no close can be about it, and an extra
      // hop on every such call would move every answer a tick later for nothing.
      if (docId === undefined) return send(params);
      if (id === 'document.close') closed.add(docId);
      return send(params).then((answer) =>
        !answer.ok && answer.error.code === 'document-not-open' && closed.has(docId) ? { ok: false, error: { code: DOCUMENT_CLOSED_HERE } } : answer,
      );
    };
    return [id, answering] as const;
  });
  return Object.assign(Object.fromEntries(calls), { [BUILT]: true as const }) as unknown as ContractClient;
}
