import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DOCUSIGN_REDIRECT_PORTS } from '@monstera/kernel';
import { describe, expect, it } from 'vitest';

import { SIGN_IN_PATH, SignInRefused, signInThroughLoopback } from './docusignSignIn.js';

/**
 * The DocuSign help article's redirect URIs are the ones a sign-in sends (the owner's R29).
 *
 * DocuSign refuses a redirect it was not given, character for character (`docusign.ts`, read 2026-09-24), so a person
 * who registers what the article lists and not what Monstera sends gets a DocuSign error at sign-in. The article is
 * read from disk and the addresses come from {@link signInThroughLoopback} itself, once per registered port: the URI is
 * whatever that function hands the provider, never a spelling of it written here.
 */

const ARTICLE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'ui', 'src', 'help', 'en', 'docusign.md');

/** The redirect URI a sign-in on `port` sends, read off the authorization request; the browser never opens. */
async function redirectSentOn(port: number): Promise<string> {
  let sent: string | undefined;
  const pending = signInThroughLoopback({
    authorize: (redirectUri) => {
      sent = redirectUri;
      return { url: 'https://account.example/oauth/auth', state: 'the-state' };
    },
    openInBrowser: () => Promise.reject(new Error('no browser in this case')),
    ports: [port],
  });
  await expect(pending).rejects.toBeInstanceOf(SignInRefused);
  if (sent === undefined) throw new Error(`no sign-in reached the provider on port ${String(port)}; is it held by another program?`);
  return sent;
}

/** Every loopback address the article lists inside a code span, as a person would copy it. */
function listedIn(article: string): readonly string[] {
  return [...article.matchAll(/`(http:\/\/127\.0\.0\.1:[^`]*)`/gu)].map((match) => match[1] ?? '');
}

/** What the article lacks of `sent`, and lists beyond it: both empty when it agrees with the code. */
function disagreement(article: string, sent: readonly string[]): { readonly missing: readonly string[]; readonly extra: readonly string[] } {
  const listed = listedIn(article);
  return { missing: sent.filter((uri) => !listed.includes(uri)), extra: listed.filter((uri) => !sent.includes(uri)) };
}

describe('the DocuSign help article', () => {
  it('lists exactly the redirect URIs a sign-in sends, one per registered port, on the sign-in path', async () => {
    const sent: string[] = [];
    for (const port of DOCUSIGN_REDIRECT_PORTS) sent.push(await redirectSentOn(port));
    // A SEARCH, so it must find what it checks: three ports, each address on the path the listener answers.
    expect(sent).toHaveLength(3);
    for (const uri of sent) expect(new URL(uri).pathname).toBe(SIGN_IN_PATH);
    const article = readFileSync(ARTICLE, 'utf8');
    expect(disagreement(article, sent)).toStrictEqual({ missing: [], extra: [] });

    // CONTROL: the article with one port's line taken out is reported as missing exactly that address.
    const [first] = sent;
    if (first === undefined) throw new Error('no address was sent');
    const without = article.replace(`\`${first}\``, '');
    expect(without).not.toBe(article);
    expect(disagreement(without, sent)).toStrictEqual({ missing: [first], extra: [] });
  });
});
