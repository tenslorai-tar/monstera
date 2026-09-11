// @ts-check
/**
 * Proof that BOTH forms of invariant 9's download rule enforce all four
 * guarantees — behaviourally, on identical inputs (rule B2, ADR-0053).
 *
 * ## What this file is for, and what it is NOT
 *
 * `docs/ARCHITECTURE.md` invariant 9 is the writer of record for four
 * guarantees; `scripts/lib/fetchVerified.mjs` serves the bootstrap layer and
 * `packages/kernel/src/verifiedDownload.ts` serves the shipped application.
 * Neither can import the other — §1.1's own reason, measured on CI's ordering —
 * so this is invariant 27's situation and takes its rule: **a copy that exists
 * must be proven equal.**
 *
 * **Equal means equal in what each REFUSES.** Comparing the two as text is the
 * vacuous shape: two implementations in two languages agree textually only by
 * accident, and a comparison that moves both sides together is
 * indistinguishable from the rule being absent from both.
 *
 * It is NOT a second opinion about either module (B3a). Each form's own policy
 * has its own proof and stays there — `fetchVerified.proof.mjs` holds the
 * bootstrap form's retry rule, which is not law and is deliberately not shared.
 * What is here is exactly the four sentences the invariant pins.
 *
 * ## Every refusal case is built from an input the ABSENT guard lets through
 *
 * A negative probe whose input would fail anyway cannot tell a working guard
 * from a deleted one. So every case below serves bytes that are correct in
 * every other respect — right digest, under the ceiling, from a fetch that
 * would have succeeded — and each is paired with a control that differs on the
 * guarded axis alone and must SUCCEED.
 *
 * Two of the four are pairs that no existing case separated, and writing the
 * table is what found them:
 *
 * - **Guarantee 1 had no case at all.** `fetchVerified.proof.mjs`'s eighteen
 *   cases cover the host allowlist thoroughly and never send an `http://` URL,
 *   so the scheme check could have been deleted with every proof green.
 * - **Guarantee 3's case could not separate its two readings.** A ceiling
 *   breach was proven with a body larger than `maxBytes` and a truthful
 *   `Content-Length` — which an implementation trusting the header refuses too.
 *   The fixture here LIES in both directions: a 4,096-byte body announcing 16,
 *   and a 512-byte body announcing ten million. A header-trusting
 *   implementation gets both of them wrong; a byte-counting one gets both
 *   right. (Measured on Node v24.12.0: a constructed `Response` keeps the
 *   header it was given and delivers the body it was given.)
 *
 * ## And where an end state is ambiguous, the case asserts the DECISION
 *
 * A refusal that never reaches the network and a refusal after one request
 * leave the same empty directory. So the scheme and host cases assert the
 * injected fetch was **never called** — a security refusal that reaches the
 * network is one that can be raced — and the digest case asserts it was called
 * **exactly once**, because a mismatch retried is *downloading until the hash
 * matches*.
 *
 * Usage: node scripts/proofs/verifiedDownload.proof.mjs   (needs `npm run build`)
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRoster } from '../lib/passRoster.mjs';
import { downloadVerified as bootstrapDownload } from '../lib/fetchVerified.mjs';
import { downloadVerified as applicationDownload } from '@monstera/kernel';

/** @type {string[]} */
const failures = [];

/**
 * A LITERAL — eight guarantee cases against each of two forms.
 *
 * Not `CASES.length * FORMS.length`, which is audit item 4c's own example: the
 * failure to fear here makes the set SMALLER, and a count computed from the
 * table agrees with a case or a whole form dropping out of it. The assertion
 * below re-states the arithmetic so a deliberate change has to touch both.
 */
const DECLARED_CASES = 16;

const roster = createRoster(failures, { cases: DECLARED_CASES });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const scratch = mkdtempSync(join(tmpdir(), 'monstera-verifieddownload-'));

const HOST = 'huggingface.co';
const URL_UNDER_TEST = `https://${HOST}/model/resolve/abc123/encoder.onnx`;
const HOSTS = [HOST];
const PAYLOAD = Buffer.from('the pinned bytes, and nothing else');
const DIGEST = createHash('sha256').update(PAYLOAD).digest('hex');
const WRONG_DIGEST = createHash('sha256').update('served instead').digest('hex');

/**
 * A response carrying `bytes` and, optionally, a Content-Length that LIES.
 *
 * @param {Buffer} bytes
 * @param {{ claims?: number }} [options] What `Content-Length` announces, when
 *   it should differ from the truth.
 */
function served(bytes, { claims } = {}) {
  return new Response(bytes, {
    status: 200,
    headers: claims === undefined ? {} : { 'content-length': String(claims) },
  });
}

/** @param {string} location */
function redirectedTo(location) {
  return new Response(null, { status: 303, headers: { location } });
}

/**
 * The two forms, addressed through one signature.
 *
 * The signatures already agree, which is the only reason this is a table rather
 * than two adapters — and if they stop agreeing, the adapter is where that gets
 * hidden, so there is none.
 *
 * @typedef {(input: {
 *   url: string,
 *   allowedHosts: readonly string[],
 *   sha256: string,
 *   maxBytes: number,
 *   destination: string,
 *   fetchImpl?: typeof fetch,
 * }) => Promise<string>} Downloader
 *
 * @type {ReadonlyArray<{ name: string, download: Downloader }>}
 */
const FORMS = [
  { name: 'bootstrap', download: bootstrapDownload },
  { name: 'application', download: /** @type {Downloader} */ (applicationDownload) },
];

let destinationSeq = 0;

/**
 * Drives one form with a scripted `fetch`, and reports what it decided.
 *
 * The REQUEST COUNT is half the instrument: it is the only externally visible
 * difference between refused-before-asking, refused-after-asking and retried.
 *
 * @param {Downloader} download
 * @param {(attempt: number, requested: string) => Response} answer
 * @param {{ url?: string, sha256?: string, maxBytes?: number }} [options]
 */
async function run(download, answer, { url = URL_UNDER_TEST, sha256 = DIGEST, maxBytes = 1_048_576 } = {}) {
  destinationSeq += 1;
  const destination = join(scratch, `out-${String(destinationSeq)}.bin`);
  let calls = 0;
  /** @type {Error | null} */
  let error = null;
  let ok = false;

  try {
    await download({
      url,
      allowedHosts: HOSTS,
      sha256,
      maxBytes,
      destination,
      fetchImpl: /** @type {typeof fetch} */ (
        /** @param {string | URL | Request} requested */
        async (requested) => {
          calls += 1;
          return answer(calls, String(requested));
        }
      ),
    });
    ok = true;
  } catch (thrown) {
    error = thrown instanceof Error ? thrown : new Error(String(thrown));
  }

  return {
    ok,
    calls,
    error,
    destination,
    landed: existsSync(destination),
    quarantined: existsSync(`${destination}.unverified`),
    message: String(error?.message ?? ''),
  };
}

for (const form of FORMS) {
  const { download, name } = form;

  // -------------------------------------------------------------------------
  // GUARANTEE 1 — HTTPS only.
  //
  // The URL differs from the control's by its SCHEME and by nothing else: same
  // host, same bytes, same digest, and a fetch that would answer correctly. So
  // an implementation with the scheme check deleted downloads it cleanly, which
  // is what makes this input separating rather than merely refused.
  // -------------------------------------------------------------------------
  {
    const result = await run(download, () => served(PAYLOAD), {
      url: `http://${HOST}/model/resolve/abc123/encoder.onnx`,
    });
    check(
      `${name}: an http:// URL is refused, and the request is NEVER made`,
      !result.ok && result.calls === 0 && !result.landed,
      `calls=${String(result.calls)} landed=${String(result.landed)} error=${result.message.slice(0, 140)}`,
    );
  }

  {
    const result = await run(download, () => served(PAYLOAD));
    check(
      `${name}: CONTROL — the same bytes over https:// land, so the refusal above is the SCHEME`,
      result.ok && result.calls === 1 && readFileSync(result.destination).equals(PAYLOAD),
      `ok=${String(result.ok)} calls=${String(result.calls)} error=${result.message.slice(0, 140)}`,
    );
  }

  // -------------------------------------------------------------------------
  // GUARANTEE 2 — host-locked on EVERY hop, not only the first.
  //
  // Both cases start on the allowed host and redirect once. The refusal's
  // second hop serves the PINNED bytes with the PINNED digest, so a first-hop
  // -only check would complete the download and verify it successfully.
  // -------------------------------------------------------------------------
  {
    /** @type {string[]} */
    const asked = [];
    const result = await run(download, (n, requested) => {
      asked.push(requested);
      return n === 1 ? redirectedTo('https://cdn.elsewhere.example/encoder.onnx') : served(PAYLOAD);
    });
    check(
      `${name}: a redirect hop to an unlisted host is refused, and that hop is never requested`,
      !result.ok &&
        result.calls === 1 &&
        !result.landed &&
        asked.every((url) => url.startsWith(`https://${HOST}/`)),
      `calls=${String(result.calls)} asked=${asked.join(',')} error=${result.message.slice(0, 140)}`,
    );
  }

  {
    const result = await run(download, (n) =>
      n === 1 ? redirectedTo(`https://${HOST}/model/resolve/abc123/moved.onnx`) : served(PAYLOAD),
    );
    check(
      `${name}: CONTROL — a hop to the ALLOWED host is followed and the bytes land`,
      result.ok && result.calls === 2 && readFileSync(result.destination).equals(PAYLOAD),
      `ok=${String(result.ok)} calls=${String(result.calls)} error=${result.message.slice(0, 140)}`,
    );
  }

  // -------------------------------------------------------------------------
  // GUARANTEE 3 — the ceiling counts RECEIVED bytes and never reads
  // Content-Length.
  //
  // The pair is what separates the two readings, and neither case alone does:
  // an implementation trusting the header lets the first through (it announces
  // 16) and refuses the second (it announces ten million). Both are wrong in
  // opposite directions, which no same-direction fixture can show.
  // -------------------------------------------------------------------------
  {
    const large = Buffer.alloc(4096, 7);
    const result = await run(download, () => served(large, { claims: 16 }), {
      sha256: createHash('sha256').update(large).digest('hex'),
      maxBytes: 1024,
    });
    check(
      `${name}: a body past the ceiling is refused though Content-Length announces 16 bytes`,
      !result.ok && !result.landed && !result.quarantined && /ceiling/u.test(result.message),
      `landed=${String(result.landed)} quarantine=${String(result.quarantined)} error=${result.message.slice(0, 140)}`,
    );
  }

  {
    const small = Buffer.alloc(512, 1);
    const result = await run(download, () => served(small, { claims: 10_000_000 }), {
      sha256: createHash('sha256').update(small).digest('hex'),
      maxBytes: 1024,
    });
    check(
      `${name}: CONTROL — a body under the ceiling lands though Content-Length announces 10 MB`,
      result.ok && readFileSync(result.destination).equals(small),
      `ok=${String(result.ok)} error=${result.message.slice(0, 140)}`,
    );
  }

  // -------------------------------------------------------------------------
  // GUARANTEE 4 — the digest is verified in quarantine, and a mismatch is not
  // retried.
  //
  // The bytes arrive COMPLETE and under the ceiling from an allowed host over
  // HTTPS: every other guarantee is satisfied, so only the digest separates
  // this from the control.
  // -------------------------------------------------------------------------
  {
    const result = await run(download, () => served(PAYLOAD), { sha256: WRONG_DIGEST });
    check(
      `${name}: a digest mismatch is refused, asked EXACTLY ONCE, and leaves nothing behind`,
      !result.ok && result.calls === 1 && !result.landed && !result.quarantined,
      `calls=${String(result.calls)} landed=${String(result.landed)} ` +
        `quarantine=${String(result.quarantined)} error=${result.message.slice(0, 140)}`,
    );
  }

  {
    const result = await run(download, () => served(PAYLOAD));
    check(
      `${name}: CONTROL — the pinned digest lands the exact bytes and clears the quarantine`,
      result.ok && readFileSync(result.destination).equals(PAYLOAD) && !result.quarantined,
      `ok=${String(result.ok)} quarantine=${String(result.quarantined)} error=${result.message.slice(0, 140)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// A control on this file's own reach, because every claim above is worth what
// the table covered. Two forms, eight cases each: an implementation silently
// dropping out of `FORMS` would take eight assertions with it and the roster
// would simply be smaller — which is why DECLARED_CASES is a literal and why
// this states the arithmetic rather than deriving it.
// ---------------------------------------------------------------------------
if (FORMS.length * 8 !== DECLARED_CASES) {
  failures.push(
    `The case table covers ${String(FORMS.length)} form(s) at 8 cases each, and this file ` +
      `declares ${String(DECLARED_CASES)}. Invariant 9 has two derived forms and both are owed ` +
      `every guarantee; a form leaving this table is a form nothing holds to the law.`,
  );
}

rmSync(scratch, { recursive: true, force: true });

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} verified-download case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('verified download case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
