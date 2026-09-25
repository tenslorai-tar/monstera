import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

/**
 * One OAuth sign-in, received on the loopback interface
 * ([ADR-0059](../../../docs/DECISIONS/0059-a-sign-in-redirect-returns-on-loopback-for-one-request.md)).
 *
 * ## What it does, in the order it does it
 *
 * 1. Listens on `127.0.0.1` — never `0.0.0.0` — on a port the operating system
 *    assigns, or, for a provider that matches its redirect exactly, the first free
 *    port of those registered with it. A known port is safe here for PKCE's reason:
 *    a process squatting on it receives a code it cannot exchange without the
 *    verifier, which never leaves `main`.
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
 * The page's colours: the renderer's tokens, light and dark, COPIED because a browser tab cannot read
 * `tokens.css`. A copy that exists must be proven equal (CLAUDE.md, the CSP's rule), and
 * `docusignSignIn.test.ts` compares every value here with the stylesheet's own; the first draft of this
 * table was written from memory and every value in it was wrong.
 */
export const RETURN_PAGE_TOKENS = {
  light: { bg: '#f5f8f6', surface: '#ffffff', text: '#1d2023', muted: '#5d656c', accent: '#16a34a', 'border-control': '#848688' },
  dark: { bg: '#0e1613', surface: '#131d19', text: '#e6ece8', muted: '#9aa8a1', accent: '#2fb96a', 'border-control': '#6e7a74' },
} as const;

const variables = (theme: keyof typeof RETURN_PAGE_TOKENS): string =>
  Object.entries(RETURN_PAGE_TOKENS[theme])
    .map(([name, value]) => `--${name}:${value}`)
    .join(';');

/** The page's own styles: the application's green and grounds, light or dark as the browser is. */
const RETURN_STYLE = [
  `:root{color-scheme:light dark;${variables('light')}}`,
  `@media (prefers-color-scheme:dark){:root{${variables('dark')}}}`,
  'body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:15px/1.5 "Segoe UI",system-ui,sans-serif}',
  'main{max-width:26rem;margin:16px;padding:28px 32px;border:1px solid var(--border-control);border-radius:10px;background:var(--surface);text-align:center}',
  'h1{margin:0 0 8px;font-size:20px;font-weight:600;color:var(--accent)}',
  'p{margin:0;color:var(--muted)}',
].join('');

/**
 * The page a browser shows after the redirect.
 *
 * **It says only what is true whatever the redirect carried**: the page is written before the state and
 * the code are read, so it cannot say *signed in* — a declined or mismatched sign-in lands here too. The
 * application says what happened, in its own words. What the page adds over the bare sentence it
 * replaces (the Stage 9 run, 2026-09-24: *"bare text on an empty page"*) is that it plainly belongs to
 * Monstera.
 *
 * **No script, and a policy that admits only this page's own styles**, by hash — derived from the text
 * above at load, so the two cannot drift. Nothing on it is a link or a form.
 */
const RETURN_PAGE = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<title>Monstera</title>',
  `<style>${RETURN_STYLE}</style></head>`,
  '<body><main><h1>Monstera</h1><p>You can close this tab and return to Monstera.</p></main></body></html>',
].join('');

const RETURN_POLICY = `default-src 'none'; style-src 'sha256-${createHash('sha256').update(RETURN_STYLE, 'utf8').digest('base64')}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

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
  /**
   * The one path the redirect may arrive on; DocuSign's when absent. A provider whose
   * registration names no path — Microsoft's `http://localhost` — answers on `/`.
   */
  readonly path?: string;
  /**
   * How the redirect STRING names this machine (ADR-0091 Decision 4). The listener is bound to
   * `127.0.0.1` whatever this says; `localhost` is for a provider that matches only that name.
   */
  readonly redirectHost?: 'localhost' | '127.0.0.1';
  /**
   * The ports a provider has REGISTERED, tried in order, for a provider that matches its redirect
   * exactly — DocuSign's documentation, read 2026-09-24: *"The redirect URI strings must match
   * exactly"*. Absent is a port the operating system assigns, which RFC 8252 §7.3 lets a provider
   * accept and Microsoft and Google do. A list rather than one, so a port something else holds does
   * not end the sign-in.
   */
  readonly ports?: readonly number[];
}): Promise<SignInCode> {
  const path = options.path ?? SIGN_IN_PATH;
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
    if (request.method !== 'GET' || url.pathname !== path || expectedState === null) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end();
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': RETURN_POLICY,
      'x-content-type-options': 'nosniff',
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
    const bind = (wanted: number): Promise<number> =>
      new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(wanted, '127.0.0.1', () => {
          server.off('error', reject);
          const address = server.address();
          if (address === null || typeof address === 'string') {
            reject(new Error('the sign-in listener bound to no numeric port'));
            return;
          }
          resolve(address.port);
        });
      });
    let port: number | undefined;
    let lastCause: unknown;
    for (const wanted of options.ports ?? [0]) {
      try {
        port = await bind(wanted);
        break;
      } catch (cause) {
        lastCause = cause;
      }
    }
    if (port === undefined) {
      throw new SignInRefused('listener-failed', 'the sign-in listener could not be opened', { cause: lastCause });
    }

    const redirectUri = `http://${options.redirectHost ?? '127.0.0.1'}:${String(port)}${path}`;
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
