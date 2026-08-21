import { app, session } from 'electron';

import { createMainWindow } from './window.js';

/**
 * Reports what the renderer was actually served, for `proof:rendererpolicy`.
 *
 * ## Why this runs the real `createMainWindow`
 *
 * A harness that rebuilt the window with the same options would prove that a
 * copy of the policy works. The point of this proof is the *shipped* path, so
 * the window comes from the function `startShell` calls, and the debugger
 * attaches to it afterwards and reloads — the reload goes through the same
 * session and the same `onHeadersReceived`, so the header captured is the one a
 * user's renderer gets.
 *
 * ## Why CDP rather than reading the constant
 *
 * `docs/FEATURES.md` requires the policy to be read back "from the running
 * renderer … never read from the source that sets it". `Network.responseReceived`
 * is the response as Chromium received it; the constant is what we hoped it
 * would be. Those differ exactly when something between them is broken, which is
 * the only case worth testing.
 *
 * ## The second half: delivered is not enforced
 *
 * A header can arrive and be ignored — a malformed directive list is dropped by
 * the parser, and a policy Chromium refuses to parse looks identical to one it
 * is enforcing when all you compare is the string. So the harness also asks the
 * renderer to *do* two forbidden things and reports whether they were blocked.
 * That is the difference between `set` and `enforced` which invariant 25 refuses
 * to elide one layer down.
 *
 * Output is a single JSON line on stdout, prefixed so it cannot be confused with
 * Chromium's own chatter, which is copious and goes to stderr.
 */
const MARKER = 'MONSTERA_CSP_READBACK ';

interface Readback {
  readonly delivered: string | null;
  readonly connectBlocked: boolean;
  readonly evalBlocked: boolean;
  readonly url: string | null;
}

export async function reportDeliveredPolicy(): Promise<void> {
  await app.whenReady();
  const window = createMainWindow(session.defaultSession);
  const { webContents } = window;

  let delivered: string | null = null;
  let url: string | null = null;

  webContents.debugger.attach('1.3');
  webContents.debugger.on('message', (_event, method, params: unknown) => {
    if (method !== 'Network.responseReceived') return;
    const response = (params as { response?: { url?: string; headers?: Record<string, string> } })
      .response;
    if (response?.headers === undefined) return;
    for (const [name, value] of Object.entries(response.headers)) {
      // Case-insensitively, because CDP reports headers as the protocol carried
      // them and nothing guarantees the casing we wrote.
      if (name.toLowerCase() === 'content-security-policy') {
        delivered = value;
        url = response.url ?? null;
      }
    }
  });
  await webContents.debugger.sendCommand('Network.enable');

  await new Promise<void>((resolve) => {
    webContents.once('did-finish-load', () => {
      resolve();
    });
    webContents.reload();
  });

  // Enforcement is read from `securitypolicyviolation`, which ONLY CSP fires —
  // not from whether the operations failed.
  //
  // The first version asked whether `fetch` rejected and whether `new Function`
  // threw. Measured: loosening `connect-src` to `'self' https:` left both
  // answers unchanged, because `https://example.invalid/` fails DNS whatever the
  // policy says. The probe reported "blocked" for a request CSP had just
  // permitted — a fixture the defect handles correctly, which is item 4's
  // fixture rule, and it survived the exact mutation it existed to catch.
  //
  // A violation event cannot be produced by a network failure, a typo in a
  // hostname, or an offline runner. It is emitted by the CSP implementation or
  // not at all, which is the difference between measuring the policy and
  // measuring the weather.
  // `executeJavaScript` is typed `Promise<any>`, so the result is narrowed here
  // rather than asserted: a renderer that returned something else would
  // otherwise flow into `.includes` and report "not blocked" for a shape
  // mismatch — the reassuring answer, produced by a bug in the probe.
  const returned: unknown = await webContents.executeJavaScript(
    `(async () => {
       const seen = [];
       const record = (event) => { seen.push(event.effectiveDirective); };
       document.addEventListener('securitypolicyviolation', record);
       try { await fetch('https://example.invalid/'); } catch { /* the event is the signal */ }
       try { new Function('return 1')(); } catch { /* likewise */ }
       await new Promise((done) => { setTimeout(done, 200); });
       document.removeEventListener('securitypolicyviolation', record);
       return seen;
     })()`,
  );
  const violated: string[] = [];
  if (Array.isArray(returned)) {
    for (const entry of returned as readonly unknown[]) {
      if (typeof entry === 'string') violated.push(entry);
    }
  }
  if (!Array.isArray(returned) || violated.length !== (returned as readonly unknown[]).length) {
    throw new Error(
      `The violation probe returned ${JSON.stringify(returned)} rather than an array of ` +
        `directive names. Treating that as "no violations" would report the policy as ` +
        `unenforced when the probe is what broke.`,
    );
  }
  const connectBlocked = violated.includes('connect-src');
  // Chromium reports eval against `script-src`, and names the narrower
  // `script-src-attr`/`script-src-elem` for other cases, so the family is
  // matched rather than one spelling.
  const evalBlocked = violated.some((directive) => directive.startsWith('script-src'));

  const readback: Readback = { delivered, connectBlocked, evalBlocked, url };
  process.stdout.write(`${MARKER}${JSON.stringify(readback)}\n`);

  webContents.debugger.detach();
  app.exit(0);
}
