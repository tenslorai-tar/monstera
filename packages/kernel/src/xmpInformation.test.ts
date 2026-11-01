import { type Element, Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';

import { type XmpInformation, freshXmpPacket, withXmpInformation, xmpInformationOf } from './xmpInformation.js';

/**
 * The XMP half of document properties (ADR-0283), read back by a parser that is not this module: happy-dom's
 * `DOMParser`, which resolves namespaces by URI, so a property found under the wrong prefix is not found.
 *
 * EVERY ELEMENT WALKED and matched on its `namespaceURI` and `localName`, because happy-dom's `getElementsByTagNameNS`
 * answers nothing for an XML document (measured 2026-11-01: 0 for an element whose own `namespaceURI` it reports
 * correctly), and an empty read would pass every "nothing left" assertion below.
 */

const DC = 'http://purl.org/dc/elements/1.1/';
const PDF = 'http://ns.adobe.com/pdf/1.3/';
const XMP = 'http://ns.adobe.com/xap/1.0/';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

/** What an XML parser reads for each property, by namespace URI and local name, elements and attributes both. */
function parsed(packet: string): Record<string, string[]> {
  const document = new new Window().DOMParser().parseFromString(packet.replace(/<\?xpacket[^>]*\?>/gu, ''), 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) throw new Error('not well-formed XML');
  const all = Array.from(document.getElementsByTagName('*'));
  const named = (within: Element[], ns: string, name: string): Element[] =>
    within.filter((element) => element.namespaceURI === ns && element.localName === name);
  const values = (ns: string, name: string): string[] => {
    const found: string[] = [];
    for (const element of named(all, ns, name)) {
      const items = named(Array.from(element.getElementsByTagName('*')), RDF, 'li');
      found.push(...(items.length > 0 ? items.map((item) => item.textContent) : [element.textContent]));
    }
    for (const description of named(all, RDF, 'Description')) {
      // THE PREFIX RESOLVED BY SCOPE, nearest declaring ancestor first, as XML resolves it: happy-dom leaves an
      // attribute's own `namespaceURI` null and has no `lookupNamespaceURI` (both measured the same day), so the
      // attribute half would otherwise read nothing. The module under test resolves packet-wide; this does not.
      const resolve = (prefix: string): string | null => {
        for (let at: Element | null = description; at !== null; at = at.parentElement) {
          const bound = at.getAttribute(`xmlns:${prefix}`);
          if (bound !== null) return bound;
        }
        return null;
      };
      for (const attribute of Array.from(description.attributes)) {
        const [prefix, local] = attribute.name.split(':');
        if (local === name && prefix !== undefined && prefix !== 'xmlns' && resolve(prefix) === ns) found.push(attribute.value ?? '');
      }
    }
    return found;
  };
  // THE READ CAN SEE: the packet's rdf:RDF is found by the same walk, or every empty answer below is a blind one.
  if (named(all, RDF, 'RDF').length !== 1) throw new Error('the walk found no rdf:RDF, so it cannot see this packet');
  return {
    title: values(DC, 'title'),
    author: values(DC, 'creator'),
    subject: values(DC, 'description'),
    keywords: values(PDF, 'Keywords'),
    created: values(XMP, 'CreateDate'),
    modified: values(XMP, 'ModifyDate'),
    tool: values(XMP, 'CreatorTool'),
  };
}

/** A packet as a producer writes one: the dates as attributes, the title in an Alt, a property this does not own. */
const PRODUCED = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="${RDF}">
  <rdf:Description rdf:about="" xmlns:xmp="${XMP}" xmp:CreateDate="2024-01-02T03:04:05Z" xmp:CreatorTool="Writer &amp; Co"/>
  <rdf:Description rdf:about="" xmlns:dc="${DC}">
   <dc:title><rdf:Alt><rdf:li xml:lang="fr">Rapport</rdf:li><rdf:li xml:lang="x-default">Report &lt;old&gt;</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>Ada</rdf:li><rdf:li>Grace</rdf:li></rdf:Seq></dc:creator>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdf="${PDF}"><pdf:Keywords>old, words</pdf:Keywords></rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

const NEW: XmpInformation = {
  title: 'Quarterly <report> & notes',
  author: 'Lin Wei',
  subject: 'Numbers',
  keywords: 'q3, money',
  created: '2025-06-07T08:09:10+02:00',
  modified: '2026-11-01T12:00:00Z',
};

describe('xmpInformationOf — the six as a packet states them', () => {
  it('reads elements and attributes, the x-default title, every creator, and decodes entities', () => {
    expect(xmpInformationOf(PRODUCED)).toStrictEqual({
      title: 'Report <old>',
      author: 'Ada; Grace',
      subject: null,
      keywords: 'old, words',
      created: '2024-01-02T03:04:05Z',
      modified: null,
    });
  });

  it('finds a property under a prefix the packet chose, and CONTROL: not one in a namespace it is not', () => {
    const renamed = PRODUCED.replaceAll('dc:', 'd1:').replace(`xmlns:dc="${DC}"`, `xmlns:d1="${DC}"`);
    expect(renamed).not.toContain('dc:');
    expect(xmpInformationOf(renamed).title).toBe('Report <old>');
    const elsewhere = PRODUCED.replace(`xmlns:dc="${DC}"`, 'xmlns:dc="http://example.org/not-dublin-core/"');
    expect(xmpInformationOf(elsewhere).title).toBeNull();
  });
});

describe('withXmpInformation — the six set, everything else kept', () => {
  it('CONTROL: the second reader sees the producer’s own packet, attributes and items both', () => {
    expect(parsed(PRODUCED)).toStrictEqual({
      title: ['Rapport', 'Report <old>'],
      author: ['Ada', 'Grace'],
      subject: [],
      keywords: ['old, words'],
      created: ['2024-01-02T03:04:05Z'],
      modified: [],
      tool: ['Writer & Co'],
    });
  });

  it('sets all six, each read back once by an XML parser, and keeps the property it does not own', () => {
    const written = withXmpInformation(PRODUCED, NEW);
    const read = parsed(written);
    expect(read).toStrictEqual({
      title: [NEW.title],
      author: [NEW.author],
      subject: [NEW.subject],
      keywords: [NEW.keywords],
      created: [NEW.created],
      modified: [NEW.modified],
      tool: ['Writer & Co'],
    });
    expect(xmpInformationOf(written)).toStrictEqual(NEW);
  });

  it('removes a property set empty, wherever it stood, as an attribute too', () => {
    const read = parsed(withXmpInformation(PRODUCED, { ...NEW, created: null, title: '' }));
    expect(read['created']).toStrictEqual([]);
    expect(read['title']).toStrictEqual([]);
    expect(read['tool']).toStrictEqual(['Writer & Co']);
  });

  it('CONTROL: the packet’s other bytes are its own — only the owned spans and the one new description differ', () => {
    const written = withXmpInformation(PRODUCED, NEW);
    expect(written.startsWith(PRODUCED.slice(0, PRODUCED.indexOf('xmp:CreateDate')))).toBe(true);
    expect(written).toContain('xmp:CreatorTool="Writer &amp; Co"');
    expect(written.endsWith('</rdf:RDF>\n</x:xmpmeta>\n<?xpacket end="w"?>')).toBe(true);
  });

  it('replaces a stream with no rdf:RDF by a packet holding the six, which an XML parser reads', () => {
    for (const broken of ['not xml at all', '<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>']) {
      const written = withXmpInformation(broken, NEW);
      expect(written).toBe(freshXmpPacket(NEW));
      expect(parsed(written)['title']).toStrictEqual([NEW.title]);
    }
  });
});
