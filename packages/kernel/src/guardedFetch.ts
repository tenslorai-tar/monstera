import { promises as dns, type LookupAddress } from 'node:dns';
import type { IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, type LookupFunction, isIP } from 'node:net';
import { type Readable, Transform, pipeline } from 'node:stream';

import type { UrlFetchRefusal } from '@monstera/contract';

import { receivedByteMeter } from './verifiedDownload.js';

/**
 * Part C8's SSRF guard: the one route by which a URL a person or a document chose is
 * fetched ([ADR-0061](../../../docs/DECISIONS/0061-a-url-a-person-chose-is-fetched-through-one-guard-that-pins-every-resolution.md)).
 *
 * ## The pin is the `lookup` the socket connects through
 *
 * A check made apart from the connection leaves a window in which a name's answer can
 * change — the rebinding attack. So each hop's socket resolves through
 * {@link guardedLookup}, which refuses the whole answer if any address is blocked and
 * hands the socket exactly the addresses it checked. The address connected to is the
 * address checked, in that resolution, and every hop is a new request and so a new
 * resolution.
 *
 * ## A literal host never reaches `lookup`
 *
 * Measured 2026-09-13 under Node 24.12.0 and Electron 43.4.1's Node 24.18.1:
 * `https.request` calls no custom `lookup` for `127.0.0.1` or `::1`. So
 * {@link checkedUrl} judges a literal host before any request is made, and the WHATWG
 * parser has already normalised `2130706433` and `0x7f.1` into the dotted form.
 */

/** Why a URL was not fetched: the contract's list, so the channel carries every reason. */
export type UrlRefusal = UrlFetchRefusal;

/** A URL that was not fetched, carrying which rule stopped it. `DownloadRefused`'s shape. */
export class UrlFetchRefused extends Error {
  readonly reason: UrlRefusal;

  constructor(reason: UrlRefusal, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'UrlFetchRefused';
    this.reason = reason;
  }
}

/** How many redirects one fetch may follow. `verifiedDownload.ts`' figure. */
export const MAX_URL_REDIRECTS = 5;

/**
 * How long a hop may wait for its response, and a body for its next byte.
 *
 * POLICY, NOT A MEASUREMENT (ADR-0061 Decision 8): a stalled server would otherwise hold
 * the import open with nothing to show. There is no total limit, because a large
 * document on a slow link is legitimate.
 */
export const URL_IDLE_MS = 30_000;

/** How far into a body `%PDF-` may begin. */
export const PDF_PREFIX_BYTES = 1024;

/**
 * Every address block this guard refuses.
 *
 * Read 2026-09-13 from IANA's IPv4 and IPv6 Special-Purpose Address Registries (both
 * last updated 2025-10-09): every block marked *Globally Reachable: False*, where a
 * sub-block inside one is covered by it. The multicast blocks come from the IPv4
 * Multicast Address Range Registry (updated 2026-08-20) and the IPv6 Address Space
 * Registry (updated 2025-10-23). 6to4 and Teredo, marked N/A, are refused whole.
 *
 * TWO REGISTRY ROWS ARE DELIBERATELY ABSENT, and each is judged by the IPv4 address it
 * carries instead: `::ffff:0:0/96`, which `BlockList` already maps onto the IPv4 blocks
 * (measured), and `64:ff9b::/96`, handled by {@link nat64Embedded}. Listing either
 * whole would refuse every public address written in that form.
 */
const BLOCKED_BLOCKS: readonly (readonly [string, number, 'ipv4' | 'ipv6'])[] = [
  ['0.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'],
  ['192.0.2.0', 24, 'ipv4'],
  ['192.88.99.0', 24, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'],
  ['198.51.100.0', 24, 'ipv4'],
  ['203.0.113.0', 24, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'],
  ['240.0.0.0', 4, 'ipv4'],
  ['::1', 128, 'ipv6'],
  ['::', 128, 'ipv6'],
  ['64:ff9b:1::', 48, 'ipv6'],
  ['100::', 64, 'ipv6'],
  ['100:0:0:1::', 64, 'ipv6'],
  ['2001::', 23, 'ipv6'],
  ['2001:db8::', 32, 'ipv6'],
  ['2002::', 16, 'ipv6'],
  ['3fff::', 20, 'ipv6'],
  ['5f00::', 16, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
  ['ff00::', 8, 'ipv6'],
];

const blocked = new BlockList();
for (const [network, prefix, family] of BLOCKED_BLOCKS) blocked.addSubnet(network, prefix, family);

const NAT64 = new BlockList();
NAT64.addSubnet('64:ff9b::', 96, 'ipv6');

/**
 * The IPv4 address a NAT64 address carries, or `null` for any other address.
 *
 * Through a translator, `64:ff9b::7f00:1` IS 127.0.0.1, so the prefix is judged by what
 * it embeds. The address is normalised by the WHATWG parser first, which writes every
 * form — `64:ff9b::127.0.0.1` included — as hexadecimal groups.
 */
function nat64Embedded(address: string): string | null {
  if (!NAT64.check(address, 'ipv6')) return null;
  const groups = new URL(`https://[${address}]/`).hostname.slice(1, -1).split(':');
  const low = hexGroup(groups.at(-1));
  const high = hexGroup(groups.at(-2));
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

/**
 * One IPv6 group's value.
 *
 * AN EMPTY GROUP IS ZERO, and it is a real input: splitting a compressed address such as
 * `64:ff9b::` on `:` leaves empty strings where the zeros were elided. A missing group is
 * zero for the same reason.
 */
function hexGroup(group: string | undefined): number {
  return group === undefined || group === '' ? 0 : Number.parseInt(group, 16);
}

/** Whether this guard refuses an address. Anything that is not an address is refused. */
export function addressBlocked(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family !== 6) return true;
  const embedded = nat64Embedded(address);
  if (embedded !== null) return blocked.check(embedded, 'ipv4');
  return blocked.check(address, 'ipv6');
}

/**
 * A URL this guard may request, or a refusal.
 *
 * Applied to the first URL and to every redirect's target, resolved against the hop it
 * came from. A user name or password is refused: it would send a credential to a host
 * the person did not see.
 */
export function checkedUrl(raw: string, base?: string): URL {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch (cause) {
    throw new UrlFetchRefused('not-https', 'that is not a URL', { cause });
  }
  if (url.protocol !== 'https:') {
    throw new UrlFetchRefused('not-https', `refusing a ${url.protocol} URL; only https: is fetched`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new UrlFetchRefused('credentials', 'refusing a URL that carries a user name or password');
  }
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  if (isIP(host) !== 0 && addressBlocked(host)) {
    throw new UrlFetchRefused('blocked-address', `refusing ${host}: it is not a public address`);
  }
  return url;
}

/** How a name becomes addresses. The system resolver in production. */
export type Resolve = (host: string) => Promise<readonly LookupAddress[]>;

const systemResolve: Resolve = (host) => dns.lookup(host, { all: true });

/**
 * The pin: a `lookup` that judges every address a resolution answered and hands the
 * socket exactly those.
 *
 * THE WHOLE ANSWER IS REFUSED when any address in it is blocked. A name answering one
 * public and one private address is the rebinding shape, and filtering it would let
 * whoever controls the name keep the half that passes.
 */
export function guardedLookup(resolve: Resolve): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        const first = addresses[0];
        if (first === undefined) {
          callback(new UrlFetchRefused('unresolvable', `${hostname} resolved to no address`), '');
          return;
        }
        if (addresses.some((entry) => addressBlocked(entry.address))) {
          callback(
            new UrlFetchRefused('blocked-address', `refusing ${hostname}: it resolved to an address that is not public`),
            '',
          );
          return;
        }
        if (options.all === true) {
          callback(null, addresses.map(({ address, family }) => ({ address, family })));
        } else {
          callback(null, first.address, first.family);
        }
      },
      (cause: unknown) => {
        callback(new UrlFetchRefused('unresolvable', `${hostname} could not be resolved`, { cause }), '');
      },
    );
  };
}

/** One hop's answer, as the redirect loop reads it. */
export interface HopResponse {
  readonly statusCode: number | undefined;
  readonly headers: IncomingHttpHeaders;
  readonly body: Readable;
}

/**
 * How one hop is made. Injected so a case can answer any status or body; production
 * is {@link httpsHop}, and both are handed the guard's `lookup`.
 */
export type HopTransport = (url: URL, lookup: LookupFunction, idleMs: number) => Promise<HopResponse>;

/**
 * One GET through `node:https`, with NO POOLED AGENT, so no reused socket carries a hop
 * past its own resolution.
 */
export const httpsHop: HopTransport = (url, lookup, idleMs) =>
  new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      { method: 'GET', agent: false, lookup, headers: { accept: 'application/pdf' } },
      (response) => {
        resolve({ statusCode: response.statusCode, headers: response.headers, body: response });
      },
    );
    request.setTimeout(idleMs, () => {
      request.destroy(new UrlFetchRefused('unreachable', `${url.host} sent nothing for ${String(idleMs)} ms`));
    });
    request.on('error', (error) => {
      reject(
        error instanceof UrlFetchRefused
          ? error
          : new UrlFetchRefused('unreachable', `${url.host} could not be reached`, { cause: error }),
      );
    });
    request.end();
  });

/** What a guarded fetch is built from. Every member has a production default. */
export interface GuardedFetchParts {
  readonly resolve?: Resolve;
  readonly transport?: HopTransport;
  readonly idleMs?: number;
}

/**
 * Refuses a body unless `%PDF-` begins within its first {@link PDF_PREFIX_BYTES}.
 *
 * A signature check on a prefix, not a parse. An HTML error page answered with `200`
 * would otherwise be written where the person chose and then poison on open.
 */
function pdfPrefix(refuse: PdfBodyRefusal): Transform {
  let seen = Buffer.alloc(0);
  let found = false;
  const refusal = () =>
    refuse('not-a-pdf', `the response does not begin with %PDF- within ${String(PDF_PREFIX_BYTES)} bytes`);
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (!found) {
        seen = Buffer.concat([seen, chunk]).subarray(0, PDF_PREFIX_BYTES);
        found = seen.includes('%PDF-');
        if (!found && seen.length >= PDF_PREFIX_BYTES) {
          callback(refusal());
          return;
        }
      }
      callback(null, chunk);
    },
    flush(callback) {
      callback(found ? null : refusal());
    },
  });
}

/**
 * Fetches a PDF from a URL a person chose, and answers its body as bytes arrive.
 *
 * Every hop is checked by {@link checkedUrl} and resolved through {@link guardedLookup}.
 * Only a `2xx` answer is a document. The body is bounded by `receivedByteMeter` — the
 * application's one received-byte rule — and by {@link pdfPrefix}; a failure of either,
 * or of the connection, arrives as an error while the body is being read.
 *
 * @param raw the URL as the person gave it
 * @param maxBytes the ceiling on bytes received
 * @throws UrlFetchRefused before any body, for every refusal a hop can meet
 */
export async function fetchGuardedPdf(
  raw: string,
  maxBytes: number,
  parts: GuardedFetchParts = {},
): Promise<Readable> {
  const lookup = guardedLookup(parts.resolve ?? systemResolve);
  const transport = parts.transport ?? httpsHop;
  const idleMs = parts.idleMs ?? URL_IDLE_MS;

  let url = checkedUrl(raw);
  for (let hop = 0; hop <= MAX_URL_REDIRECTS; hop += 1) {
    const response = await transport(url, lookup, idleMs);
    const status = response.statusCode ?? 0;

    if (status >= 300 && status < 400) {
      // DRAINED, so the socket this hop opened is released before the next one opens.
      response.body.resume();
      const location = response.headers.location;
      if (location === undefined) {
        throw new UrlFetchRefused('http-error', `a ${String(status)} redirect from ${url.host} named no location`);
      }
      url = checkedUrl(location, url.href);
      continue;
    }
    if (status < 200 || status >= 300) {
      response.body.resume();
      throw new UrlFetchRefused('http-error', `${url.host} answered HTTP ${String(status)}`);
    }

    return pdfBody(response.body, maxBytes, (kind, message) => new UrlFetchRefused(kind, message));
  }

  throw new UrlFetchRefused('too-many-redirects', `more than ${String(MAX_URL_REDIRECTS)} redirects`);
}

/** How a caller names a body's refusal in its own error type. */
export type PdfBodyRefusal = (kind: 'too-large' | 'not-a-pdf', message: string) => Error;

/**
 * A body that is a document: bounded by `receivedByteMeter` — the application's one
 * received-byte rule — and refused unless `%PDF-` begins within {@link PDF_PREFIX_BYTES}.
 *
 * ONE CHECK FOR EVERY ROUTE a PDF arrives on over the network: a URL a person gave, and a
 * cloud file (ADR-0091). Each names the refusal in its own error type, which is the only
 * thing that differs.
 */
export function pdfBody(body: Readable, maxBytes: number, refuse: PdfBodyRefusal): Readable {
  const meter = receivedByteMeter(maxBytes, (received) =>
    refuse('too-large', `the document passed ${String(maxBytes)} bytes at ${String(received)}`),
  );
  // THE LAST STREAM CARRIES EVERY FAILURE: `pipeline` destroys the chain on an error
  // in any stage, and a reader of the returned stream sees it as that error.
  return pipeline(body, meter, pdfPrefix(refuse), () => undefined);
}
