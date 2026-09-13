import { describe, expect, it } from 'vitest';

import { SIGN_IN_PATH, SignInRefused, signInThroughLoopback } from './docusignSignIn.js';

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
