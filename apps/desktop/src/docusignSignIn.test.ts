import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { RETURN_PAGE_TOKENS, SIGN_IN_PATH, SignInRefused, signInThroughLoopback } from './docusignSignIn.js';

/**
 * The loopback sign-in, driven by a "browser" that fetches the redirect.
 *
 * ## The listener is REAL and so is the socket
 *
 * Nothing about the port, the path or the close is faked: each case binds a real
 * listener on `127.0.0.1` and the opener makes real HTTP requests to it, as a browser
 * following a provider's redirect would. What is faked is the provider — the opener
 * builds the redirect itself from the authorization URL it was handed.
 */

/** The authorization URL a case builds: the redirect URI and state carried as query parameters. */
function authorize(redirectUri: string): { url: string; state: string } {
  const url = new URL('https://account.example/oauth/auth');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', 'the-state');
  return { url: url.toString(), state: 'the-state' };
}

/** The redirect URI inside an authorization URL. */
function redirectOf(authorizationUrl: string): string {
  const redirect = new URL(authorizationUrl).searchParams.get('redirect_uri');
  if (redirect === null) throw new Error('the authorization URL carries no redirect_uri');
  return redirect;
}

/** The refusal a sign-in rejects with, asserting it is one. */
async function refusalOf(pending: Promise<unknown>): Promise<SignInRefused> {
  try {
    await pending;
  } catch (error) {
    if (error instanceof SignInRefused) return error;
    throw error;
  }
  throw new Error('the sign-in succeeded');
}

describe('signInThroughLoopback', () => {
  it('answers the code from the one redirect, on 127.0.0.1 and the one path, and CLOSES the port', async () => {
    let redirect = '';
    const signedIn = await signInThroughLoopback({
      authorize,
      openInBrowser: async (url) => {
        redirect = redirectOf(url);
        // THE BROWSER, following the provider's redirect.
        const page = await fetch(`${redirect}?code=the-code&state=the-state`);
        expect(page.status).toBe(200);
      },
    });

    expect(signedIn).toStrictEqual({ code: 'the-code', redirectUri: redirect });
    const parsed = new URL(redirect);
    expect(parsed.hostname).toBe('127.0.0.1');
    expect(parsed.pathname).toBe(SIGN_IN_PATH);
    expect(Number(parsed.port)).toBeGreaterThan(0);

    // CLOSED: the decision is the assertion — a second request finds nothing
    // listening, so an ended sign-in holds no port for the session.
    await expect(fetch(`${redirect}?code=late&state=the-state`)).rejects.toThrow();
  });

  it('the page the browser lands on is Monstera’s, runs no script, and admits only its own styles', async () => {
    let page: Response | undefined;
    let body = '';
    await signInThroughLoopback({
      authorize,
      openInBrowser: async (url) => {
        page = await fetch(`${redirectOf(url)}?code=the-code&state=the-state`);
        body = await page.text();
      },
    });
    if (page === undefined) throw new Error('the browser never landed');
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(body).toContain('<h1>Monstera</h1>');
    expect(body).toContain('You can close this tab and return to Monstera.');
    // NEITHER *signed in* NOR *failed*: the page is written before the redirect is read.
    expect(body.toLowerCase()).not.toContain('signed in');
    expect(body).not.toContain('<script');
    // THE POLICY'S HASH IS THE PAGE'S OWN STYLE: recomputed here from the body the browser received, so a
    // style edited without its hash — which a browser would silently refuse to apply — reads here.
    const style = /<style>([\s\S]*?)<\/style>/u.exec(body)?.[1];
    if (style === undefined) throw new Error('the page carries no style');
    const hash = createHash('sha256').update(style, 'utf8').digest('base64');
    expect(page.headers.get('content-security-policy')).toContain(`default-src 'none'; style-src 'sha256-${hash}'`);
  });

  it('the page’s colours are the renderer’s tokens, value for value, in both themes', () => {
    // THE COPY'S PROOF: a browser tab cannot read `tokens.css`, so the page carries a copy, and a copy that
    // exists must be shown equal — its first draft was written from memory and all twelve values were wrong.
    const sheet = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../packages/ui/src/tokens.css'), 'utf8');
    const block = (selector: string): string => {
      const start = sheet.indexOf(`${selector} {`);
      if (start < 0) throw new Error(`tokens.css has no ${selector} block`);
      return sheet.slice(start, sheet.indexOf('}', start));
    };
    for (const [theme, selector] of [
      ['light', "[data-theme='light']"],
      ['dark', "[data-theme='dark']"],
    ] as const) {
      const text = block(selector);
      for (const [name, value] of Object.entries(RETURN_PAGE_TOKENS[theme])) {
        expect(new RegExp(`--${name}:\\s*([^;]+);`, 'u').exec(text)?.[1]?.trim(), `${theme} --${name}`).toBe(value);
      }
    }
  });

  it('REGISTERED PORTS (DocuSign, exact match): the first FREE one is the redirect’s, a busy one skipped', async () => {
    // TWO PORTS THE SYSTEM HANDS US, the first then held by another listener — so the case does not
    // depend on any fixed port being free on the machine running it.
    const held = createServer();
    await new Promise<void>((resolve) => held.listen(0, '127.0.0.1', resolve));
    const spare = createServer();
    await new Promise<void>((resolve) => spare.listen(0, '127.0.0.1', resolve));
    const heldPort = (held.address() as AddressInfo).port;
    const sparePort = (spare.address() as AddressInfo).port;
    await new Promise<void>((resolve) => {
      spare.close(() => {
        resolve();
      });
    });
    try {
      let redirect = '';
      await signInThroughLoopback({
        authorize,
        ports: [heldPort, sparePort],
        openInBrowser: async (url) => {
          redirect = redirectOf(url);
          await fetch(`${redirect}?code=the-code&state=the-state`);
        },
      });
      // THE SECOND, because the first was taken — and not a port the system chose instead.
      expect(Number(new URL(redirect).port)).toBe(sparePort);

      // ALL TAKEN: refused by name before any browser opens.
      let opened = false;
      await expect(
        signInThroughLoopback({
          authorize,
          ports: [heldPort],
          openInBrowser: () => {
            opened = true;
            return Promise.resolve();
          },
        }),
      ).rejects.toMatchObject({ reason: 'listener-failed' });
      expect(opened).toBe(false);
    } finally {
      await new Promise<void>((resolve) => {
        held.close(() => {
          resolve();
        });
      });
    }
  });

  it('MICROSOFT’S SHAPE (ADR-0091): the redirect string says localhost on the root path, and the listener is still 127.0.0.1', async () => {
    let redirect = '';
    let strayStatus = 0;
    const signedIn = await signInThroughLoopback({
      authorize,
      redirectHost: 'localhost',
      path: '/',
      openInBrowser: async (url) => {
        redirect = redirectOf(url);
        const port = new URL(redirect).port;
        // DOCUSIGN'S PATH IS NOT THIS SIGN-IN'S: refused, and the sign-in goes on.
        strayStatus = (await fetch(`http://127.0.0.1:${port}${SIGN_IN_PATH}?code=x&state=the-state`)).status;
        // THE BROWSER resolves `localhost` to the loopback interface the listener is bound to.
        const page = await fetch(`http://127.0.0.1:${port}/?code=the-code&state=the-state`);
        expect(page.status).toBe(200);
      },
    });

    expect(new URL(redirect).hostname).toBe('localhost');
    expect(new URL(redirect).pathname).toBe('/');
    expect(strayStatus).toBe(404);
    expect(signedIn.code).toBe('the-code');
    expect(signedIn.redirectUri).toBe(redirect);
  });

  it('refuses a redirect whose state is not this sign-in’s', async () => {
    const refused = await refusalOf(
      signInThroughLoopback({
        authorize,
        openInBrowser: async (url) => {
          await fetch(`${redirectOf(url)}?code=the-code&state=someone-elses`);
        },
      }),
    );
    expect(refused.reason).toBe('mismatched-state');
  });

  it('answers a redirect carrying an error as DENIED', async () => {
    const refused = await refusalOf(
      signInThroughLoopback({
        authorize,
        openInBrowser: async (url) => {
          await fetch(`${redirectOf(url)}?error=access_denied&state=the-state`);
        },
      }),
    );
    expect(refused.reason).toBe('denied');
  });

  it('answers a stray path with 404 and CHANGES NOTHING — the sign-in still completes', async () => {
    const signedIn = await signInThroughLoopback({
      authorize,
      openInBrowser: async (url) => {
        const redirect = new URL(redirectOf(url));
        const stray = await fetch(`${redirect.origin}/favicon.ico`);
        expect(stray.status).toBe(404);
        await fetch(`${redirect.toString()}?code=the-code&state=the-state`);
      },
    });
    expect(signedIn.code).toBe('the-code');
  });

  it('times out when no redirect arrives, and CONTROL: an abort is a cancellation, not a timeout', async () => {
    const timedOut = await refusalOf(
      signInThroughLoopback({ authorize, openInBrowser: () => Promise.resolve(), timeoutMs: 50 }),
    );
    expect(timedOut.reason).toBe('timed-out');

    const controller = new AbortController();
    const cancelled = await refusalOf(
      signInThroughLoopback({
        authorize,
        openInBrowser: () => {
          controller.abort();
          return Promise.resolve();
        },
        signal: controller.signal,
        timeoutMs: 60_000,
      }),
    );
    expect(cancelled.reason).toBe('cancelled');
  });

  it('answers a browser that cannot be opened as a listener failure, and still closes the port', async () => {
    let redirect = '';
    const refused = await refusalOf(
      signInThroughLoopback({
        authorize: (redirectUri) => {
          redirect = redirectUri;
          return authorize(redirectUri);
        },
        openInBrowser: () => Promise.reject(new Error('no browser in the case')),
      }),
    );
    expect(refused.reason).toBe('listener-failed');
    await expect(fetch(`${redirect}?code=x&state=the-state`)).rejects.toThrow();
  });
});
