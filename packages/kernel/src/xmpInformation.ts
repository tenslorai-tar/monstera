/**
 * The six document-information properties in an XMP packet, read and written as TEXT
 * ([ADR-0283](../../../docs/DECISIONS/0283-document-properties-edits-the-info-dictionary-and-the-xmp-packet-together.md)).
 *
 * ## Why text, and not a parse
 *
 * An edit changes six properties and must keep every other one byte for byte (*preserve, never drop*): a parse and
 * re-serialise would rewrite them all, and the kernel carries no XML parser. So the properties this owns are found by
 * the rules XMP itself fixes, and nothing else in the packet is touched:
 *
 * - **a property sits under the prefix the packet binds to its namespace**, which is usually `dc`, `pdf` or `xmp` and
 *   need not be: every prefix bound to each namespace URI is read from the packet's `xmlns:` declarations, so a packet
 *   that spells Dublin Core `dcterms:` is still found;
 * - **a simple property may be an element or an attribute** of its `rdf:Description` (XMP Part 1 §7.9.2.2), so both
 *   are found; a structured one (`dc:title`'s `rdf:Alt`, `dc:creator`'s `rdf:Seq`) is an element;
 * - **an element of one name does not nest inside itself**, so its end is the first close tag of its name.
 *
 * Setting a property removes it wherever it stands and writes all six again in one `rdf:Description` of their own,
 * with their own namespace declarations, before the packet's `</rdf:RDF>`.
 */

/** The six properties, by the names the window and the Info dictionary use. */
export interface XmpInformation {
  readonly title: string | null;
  readonly author: string | null;
  readonly subject: string | null;
  readonly keywords: string | null;
  /** ISO 8601, as XMP writes a date. */
  readonly created: string | null;
  readonly modified: string | null;
}

const NS = {
  dc: 'http://purl.org/dc/elements/1.1/',
  pdf: 'http://ns.adobe.com/pdf/1.3/',
  xmp: 'http://ns.adobe.com/xap/1.0/',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
} as const;

/** Where each property lives: its namespace, its local name, and its shape. */
const PROPERTIES: Readonly<Record<keyof XmpInformation, { readonly ns: keyof typeof NS; readonly name: string; readonly shape: 'alt' | 'seq' | 'simple' }>> = {
  title: { ns: 'dc', name: 'title', shape: 'alt' },
  author: { ns: 'dc', name: 'creator', shape: 'seq' },
  subject: { ns: 'dc', name: 'description', shape: 'alt' },
  keywords: { ns: 'pdf', name: 'Keywords', shape: 'simple' },
  created: { ns: 'xmp', name: 'CreateDate', shape: 'simple' },
  modified: { ns: 'xmp', name: 'ModifyDate', shape: 'simple' },
};

const KEYS = Object.keys(PROPERTIES) as (keyof XmpInformation)[];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** Every prefix the packet binds to `uri`. */
function prefixesOf(packet: string, uri: string): readonly string[] {
  const found = new Set<string>();
  const declaration = new RegExp(`xmlns:([A-Za-z_][\\w.-]*)\\s*=\\s*(["'])${escapeRegExp(uri)}\\2`, 'gu');
  for (const match of packet.matchAll(declaration)) if (match[1] !== undefined) found.add(match[1]);
  return [...found];
}

function decoded(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/giu, (_whole, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_whole, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, '&');
}

function escaped(text: string): string {
  return text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
}

/** The element `prefix:name`'s whole span, self-closed or not; the first wins. */
function elementPattern(prefix: string, name: string): RegExp {
  const tag = `${escapeRegExp(prefix)}:${escapeRegExp(name)}`;
  return new RegExp(`<${tag}(?=[\\s/>])[^>]*?(?:/>|>([\\s\\S]*?)</${tag}\\s*>)`, 'gu');
}

/** The attribute `prefix:name="…"` on an element, with the white space before it. */
function attributePattern(prefix: string, name: string): RegExp {
  return new RegExp(`\\s${escapeRegExp(prefix)}:${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'gu');
}

/** The `rdf:li` items of a structured property's body, `x-default` first where an `rdf:Alt` names one. */
function itemsOf(body: string, rdf: readonly string[]): readonly string[] {
  const items: { readonly text: string; readonly fallback: boolean }[] = [];
  for (const prefix of rdf) {
    for (const match of body.matchAll(elementPattern(prefix, 'li'))) {
      const whole = match[0];
      const fallback = /xml:lang\s*=\s*["']x-default["']/u.test(whole.slice(0, whole.indexOf('>') + 1));
      items.push({ text: decoded(match[1] ?? '').trim(), fallback });
    }
  }
  return [...items.filter((item) => item.fallback), ...items.filter((item) => !item.fallback)].map((item) => item.text);
}

/** The six properties as `packet` states them; `null` for each it does not. */
export function xmpInformationOf(packet: string): XmpInformation {
  const rdf = prefixesOf(packet, NS.rdf);
  const read = (key: keyof XmpInformation): string | null => {
    const { ns, name, shape } = PROPERTIES[key];
    for (const prefix of prefixesOf(packet, NS[ns])) {
      for (const match of packet.matchAll(elementPattern(prefix, name))) {
        const body = match[1] ?? '';
        if (shape === 'simple') return decoded(body).trim();
        const items = itemsOf(body, rdf);
        if (items.length > 0) return shape === 'seq' ? items.join('; ') : (items[0] ?? null);
      }
      if (shape === 'simple') {
        for (const match of packet.matchAll(attributePattern(prefix, name))) return decoded(match[1] ?? match[2] ?? '');
      }
    }
    return null;
  };
  return {
    title: read('title'),
    author: read('author'),
    subject: read('subject'),
    keywords: read('keywords'),
    created: read('created'),
    modified: read('modified'),
  };
}

/** The six as one `rdf:Description` under the packet's `rdf` prefix, each present value only. */
function description(values: XmpInformation, rdf: string, about: string): string {
  const lines: string[] = [];
  for (const key of KEYS) {
    const value = values[key];
    if (value === null || value === '') continue;
    const { ns, name, shape } = PROPERTIES[key];
    const tag = `${ns}:${name}`;
    if (shape === 'simple') lines.push(`<${tag}>${escaped(value)}</${tag}>`);
    else if (shape === 'alt') lines.push(`<${tag}><${rdf}:Alt><${rdf}:li xml:lang="x-default">${escaped(value)}</${rdf}:li></${rdf}:Alt></${tag}>`);
    else lines.push(`<${tag}><${rdf}:Seq><${rdf}:li>${escaped(value)}</${rdf}:li></${rdf}:Seq></${tag}>`);
  }
  return (
    `<${rdf}:Description ${rdf}:about="${escaped(about)}" xmlns:dc="${NS.dc}" xmlns:pdf="${NS.pdf}" xmlns:xmp="${NS.xmp}">` +
    `${lines.join('')}</${rdf}:Description>`
  );
}

/**
 * The packet header's `begin` value, U+FEFF as XMP Part 1 §7.3.2 asks: built from its code point, because the character
 * itself is invisible in source and the file guard refuses it there.
 */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/** A packet holding only the six, for a document whose metadata stream is not XMP a reader can use. */
export function freshXmpPacket(values: XmpInformation): string {
  return (
    `<?xpacket begin="${BYTE_ORDER_MARK}" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="${NS.rdf}">${description(values, 'rdf', '')}</rdf:RDF></x:xmpmeta>` +
    '<?xpacket end="w"?>'
  );
}

/**
 * `packet` with the six set to `values` and every other byte as it was: each removed wherever it stands, then all
 * written in one description before `</rdf:RDF>`. A packet with no `rdf:RDF` to write into is not XMP a reader can use,
 * and the answer is {@link freshXmpPacket}'s.
 */
export function withXmpInformation(packet: string, values: XmpInformation): string {
  const rdf = prefixesOf(packet, NS.rdf);
  const closing = rdf.map((prefix) => ({ prefix, at: packet.lastIndexOf(`</${prefix}:RDF>`) })).find((each) => each.at !== -1);
  if (closing === undefined) return freshXmpPacket(values);

  let kept = packet;
  for (const key of KEYS) {
    const { ns, name } = PROPERTIES[key];
    for (const prefix of prefixesOf(packet, NS[ns])) {
      kept = kept.replace(elementPattern(prefix, name), '').replace(attributePattern(prefix, name), '');
    }
  }
  const about = new RegExp(`${escapeRegExp(closing.prefix)}:about\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'u').exec(kept);
  const end = kept.lastIndexOf(`</${closing.prefix}:RDF>`);
  return `${kept.slice(0, end)}${description(values, closing.prefix, about?.[1] ?? about?.[2] ?? '')}${kept.slice(end)}`;
}
