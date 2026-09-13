import { createServer } from 'node:http';

/**
 * One OAuth sign-in, received on the loopback interface
 * ([ADR-0059](../../../docs/DECISIONS/0059-a-sign-in-redirect-returns-on-loopback-for-one-request.md)).
 *
 * ## What it does, in the order it does it
 *
 * 1. Listens on `127.0.0.1`, on a port the operating system assigns — never
 *    `0.0.0.0`, and never a known port something could be waiting on.
 * 2. Builds the redirect URI from that port and hands it to the caller, which builds
 *    the authorization URL and its `state`.
 * 3. Opens that URL in the person's own browser, through a function the composition
 *    root supplies — this file imports no Electron.
 * 4. Waits, bounded, for the ONE redirect to the ONE path. Anything else reaching
 *    the port gets a 404 and changes nothing.
 * 5. Closes the listener, whatever happened.
 *
 * `containment`'s loopback control in `composition.ts` is the shape it copies: bound
 * to the IP literal, ephemeral, closed in a `finally` after one use.
 *
 * ## The page it answers says one thing
 *
 * That the person may return to the application. The code is exchanged in `main`,
 * never in the page, and nothing about the account or the document is written into
 * it — this is a page on a port any local process could also have reached.
 */

/** The one path a redirect may arrive on. */
export const SIGN_IN_PATH = '/docusign';

/**
 * How long a sign-in may wait for its redirect, in milliseconds.
 *
 * **A bound, not a measurement**: generous, because a person may need to find a
 * password or a second factor, and the cost of the bound is only that an abandoned
 * sign-in releases its port rather than holding it for the session.
 */
export const SIGN_IN_TIMEOUT_MS = 300_000;

/**
 * The page a browser shows after the redirect.
 *
 * Plain text, because the page exists only to end the browser's side; the person's
 * next step is back in the application, which says what happened in its own words.
 */
const RETURN_PAGE = 'You can close this tab and return to Monstera.';

/** Why a sign-in produced no code. */
export type SignInRefusal =
  /** The caller's signal aborted it. */
  | 'cancelled'
  /** No redirect arrived within the bound. */
  | 'timed-out'
  /** The provider redirected with an `error` — the person declined, or it refused. */
  | 'denied'
  /** A redirect arrived whose `state` was not this sign-in's (RFC 6749 §10.12). */
  | 'mismatched-state'
  /** The listener could not be opened, or the browser could not be. */
  | 'listener-failed';

/** A sign-in that produced no code. */
export class SignInRefused extends Error {
  override readonly name = 'SignInRefused';
  readonly reason: SignInRefusal;

  constructor(reason: SignInRefusal, message: string, options?: ErrorOptions) {
    super(message, options);
    this.reason = reason;
  }
}

/** Opens a URL in the person's own browser. */
export type OpenInBrowser = (url: string) => Promise<void>;

/** What a completed sign-in hands back. */
export interface SignInCode {
  readonly code: string;
  /** The redirect URI the code was issued for — the exchange must send it too. */
  readonly redirectUri: string;
}

/**
 * Runs one sign-in and answers its authorization code.
 *
 * @param options.authorize builds the authorization URL for a redirect URI, with
 *   the `state` it carries.
 * @param options.openInBrowser the composition root's browser opener.
 * @param options.timeoutMs the wait's bound; a case passes a short one.
 * @param options.signal aborts the sign-in, as a person cancelling does.
 */
export async function signInThroughLoopback(options: {
  readonly authorize: (redirectUri: string) => { readonly url: string; readonly state: string };
  readonly openInBrowser: OpenInBrowser;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}): Promise<SignInCode> {
  let settle: { resolve: (code: string) => void; reject: (error: SignInRefused) => void } | null =
    null;
  const outcome = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject };
  });
  // MARKED HANDLED AT BIRTH, and it swallows nothing: `await outcome` below still
  // throws the refusal. A forged or declined redirect can arrive while the browser
  // opener is still awaiting, before anything awaits this promise — and Node reports
  // a rejection with no handler attached at that moment as unhandled, even though it
  // is handled an instant later. Measured on this file's own mismatched-state case.
  outcome.catch(() => undefined);
  let expectedState: string | null = null;

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    // ONE PATH. Anything else is refused and changes nothing, so a stray request
    // — a browser asking for a favicon — cannot end or corrupt the sign-in.
    if (request.method !== 'GET' || url.pathname !== SIGN_IN_PATH || expectedState === null) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end();
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'close',
    });
    response.end(RETURN_PAGE);

    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (state !== expectedState) {
      settle?.reject(new SignInRefused('mismatched-state', 'a redirect arrived for another sign-in'));
    } else if (error !== null) {
      settle?.reject(new SignInRefused('denied', 'the provider redirected with an error'));
    } else if (code === null || code === '') {
      settle?.reject(new SignInRefused('denied', 'the redirect carried no code'));
    } else {
      settle?.resolve(code);
    }
  });

  const timer = setTimeout(() => {
    settle?.reject(new SignInRefused('timed-out', 'no redirect arrived within the sign-in’s bound'));
  }, options.timeoutMs ?? SIGN_IN_TIMEOUT_MS);
  const onAbort = (): void => {
    settle?.reject(new SignInRefused('cancelled', 'the sign-in was cancelled'));
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address === null || typeof address === 'string') {
          reject(new Error('the sign-in listener bound to no numeric port'));
          return;
        }
        resolve(address.port);
      });
    }).catch((cause: unknown) => {
      throw new SignInRefused('listener-failed', 'the sign-in listener could not be opened', { cause });
    });

    const redirectUri = `http://127.0.0.1:${String(port)}${SIGN_IN_PATH}`;
    const { url, state } = options.authorize(redirectUri);
    expectedState = state;
    try {
      await options.openInBrowser(url);
    } catch (cause) {
      throw new SignInRefused('listener-failed', 'the browser could not be opened', { cause });
    }
    if (options.signal?.aborted === true) onAbort();

    return { code: await outcome, redirectUri };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    // CLOSED WHATEVER HAPPENED, and every connection with it, so a browser holding a
    // keep-alive socket cannot keep the port open after the sign-in has ended.
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
}
