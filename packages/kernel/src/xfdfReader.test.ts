import { describe, expect, it } from 'vitest';

import {
  NamelessFieldError,
  XfdfDoctypeError,
  XfdfRefusedError,
  XfdfTooDeepError,
  readXfdf,
} from './xfdfReader.js';

/**
 * The strict XFDF reader
 * ([ADR-0046](../../../docs/DECISIONS/0046-a-strict-xfdf-reader-rather-than-an-xml-parser.md)).
 *
 * ## THE SIX SHAPES ARE THE FIXTURE SET, verbatim
 *
 * `scripts/research/formDataFormats.mjs` printed six inputs on 2026-09-07 and
 * said the decision should be taken against them. They are repeated here **as
 * written**, not paraphrased: a fixture reworded on its way into a test is a
 * fixture nobody can compare with the measurement that produced it, and five of
 * these six exist to be refused — which is the reassuring direction, so the
 * bytes matter.
 *
 * The ordinary case is the control the other five are read against. Without it
 * a reader that refused **everything** would pass every negative case.
 */

/** The six shapes, from the measurement that decided this reader. */
const SHAPES = {
  ordinary:
    '<?xml version="1.0"?><xfdf xmlns="http://ns.adobe.com/xfdf/"><fields><field name="applicant.name"><value>GRACE HOPPER</value></field></fields></xfdf>',
  xxe: '<?xml version="1.0"?><!DOCTYPE xfdf [<!ENTITY x SYSTEM "file:///c:/windows/win.ini">]><xfdf><fields><field name="a"><value>&x;</value></field></fields></xfdf>',
  expansion:
    '<?xml version="1.0"?><!DOCTYPE xfdf [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">]><xfdf><fields><field name="a"><value>&c;</value></field></fields></xfdf>',
  externalDtd:
    '<?xml version="1.0"?><!DOCTYPE xfdf SYSTEM "http://example.invalid/x.dtd"><xfdf><fields/></xfdf>',
  nameless: '<?xml version="1.0"?><xfdf><fields><field><value>x</value></field></fields></xfdf>',
  deep: `<?xml version="1.0"?><xfdf>${'<fields>'.repeat(5000)}${'</fields>'.repeat(5000)}</xfdf>`,
};

describe('readXfdf, the six measured shapes', () => {
  it('ACCEPTS THE ORDINARY CASE, which is the control the five refusals rest on', () => {
    // Without this, a reader that threw on every input would pass every case
    // below — and *found nothing* is what the five negatives are hoping for.
    expect(readXfdf(SHAPES.ordinary)).toStrictEqual([
      { name: 'applicant.name', values: ['GRACE HOPPER'] },
    ]);
  });

  it('REFUSES ALL THREE DTD SHAPES with one rule, which is the decision', () => {
    // XXE, entity expansion and the external DTD are three attacks and one
    // construct. Asserting the SAME class for all three is what says the rule
    // is `<!DOCTYPE` rather than three special cases that happen to agree.
    for (const shape of [SHAPES.xxe, SHAPES.expansion, SHAPES.externalDtd]) {
      expect(() => readXfdf(shape)).toThrow(XfdfDoctypeError);
    }
  });

  it('REFUSES THE DECLARATION BEFORE READING IT, so a huge internal subset costs nothing', () => {
    // The expansion shape's danger is inside the parser. A reader that consumed
    // the subset first and refused afterwards would have done the work already,
    // which is the same defect with a refusal on the end. Ten megabytes of
    // subset returns as fast as the small one, and the refusal is the same.
    const huge = `<?xml version="1.0"?><!DOCTYPE xfdf [${'<!ENTITY a "aaaa">'.repeat(500_000)}]><xfdf/>`;
    const started = performance.now();
    expect(() => readXfdf(huge)).toThrow(XfdfDoctypeError);
    // A BOUND, NOT A MEASUREMENT. What this asserts is that nothing walked the
    // subset — a reader that scanned it would spend milliseconds per megabyte,
    // and this input is about nine.
    expect(performance.now() - started).toBeLessThan(50);
  });

  it('REFUSES A FIELD WITH NO NAME, which is a refusal in the model', () => {
    // Skipping it would drop a value the file meant to carry, silently, into a
    // document the person then saves.
    expect(() => readXfdf(SHAPES.nameless)).toThrow(NamelessFieldError);
  });

  it('REFUSES DEPTH BY STRUCTURE ALONE, with no entities in the file', () => {
    expect(() => readXfdf(SHAPES.deep)).toThrow(XfdfTooDeepError);
  });

  it('CONTROL: nesting UNDER the bound is accepted, so the rule is a depth and not a nesting ban', () => {
    // Without this the case above is satisfied by a reader that refuses any
    // nesting at all — which would refuse every hierarchical XFDF Acrobat
    // writes, and the case below proves those are the ones that matter.
    const nested = `<xfdf><fields>${'<field name="a">'.repeat(8)}<value>x</value>${'</field>'.repeat(8)}</fields></xfdf>`;
    expect(readXfdf(nested)).toStrictEqual([{ name: 'a.a.a.a.a.a.a.a', values: ['x'] }]);
  });
});

describe('readXfdf, the shapes a real file has', () => {
  it('JOINS A NESTED NAME WITH DOTS, because that is what a qualified name is', () => {
    // THIS BUILD WRITES THE FLAT FORM AND ACROBAT WRITES THIS ONE, so a reader
    // taking only the flat spelling would refuse every file the feature exists
    // for. The create row measured that a dot in a name makes a parent in the
    // field tree, so the two spellings describe the same field.
    const nested =
      '<xfdf><fields><field name="applicant"><field name="name"><value>Ada</value></field><field name="agrees"><value>Yes</value></field></field></fields></xfdf>';
    expect(readXfdf(nested)).toStrictEqual([
      { name: 'applicant.name', values: ['Ada'] },
      { name: 'applicant.agrees', values: ['Yes'] },
    ]);
  });

  it('READS SEVERAL VALUES for one field, which is how the format says multi-select', () => {
    const several =
      '<xfdf><fields><field name="langs"><value>en</value><value>de</value></field></fields></xfdf>';
    expect(readXfdf(several)).toStrictEqual([{ name: 'langs', values: ['en', 'de'] }]);
  });

  it('UNESCAPES the five predefined entities and numeric references', () => {
    const escaped =
      '<xfdf><fields><field name="a"><value>less &lt; amp &amp; gt &gt; quot &quot; apos &apos; num &#65; hex &#x42;</value></field></fields></xfdf>';
    expect(readXfdf(escaped)[0]?.values[0]).toBe('less < amp & gt > quot " apos \' num A hex B');
  });

  it('REFUSES AN ENTITY IT DOES NOT DEFINE, which is the other half of the DOCTYPE rule', () => {
    // Nothing may declare one, since the construct that declares them is
    // refused. So `&nbsp;` is either a file that needed that construct or a
    // value somebody wrote unescaped — and passing it through as literal text
    // would put `&nbsp;` into a form field.
    expect(() =>
      readXfdf('<xfdf><fields><field name="a"><value>&nbsp;</value></field></fields></xfdf>'),
    ).toThrow(/does not define/u);
  });

  it('READS A CDATA SECTION, which is where an unescaped value legally lives', () => {
    const cdata =
      '<xfdf><fields><field name="a"><value><![CDATA[< & > raw]]></value></field></fields></xfdf>';
    expect(readXfdf(cdata)[0]?.values[0]).toBe('< & > raw');
  });

  it('WALKS PAST the vocabulary an XFDF carries beside its fields', () => {
    // A real file has `<f href="...">`, `<ids>` and often annotations. Refusing
    // an element this build reads nothing from would refuse every Acrobat
    // export; the fields are found wherever they are.
    const rich =
      '<xfdf xmlns="http://ns.adobe.com/xfdf/"><f href="form.pdf"/><ids original="AB" modified="CD"/><fields><field name="a"><value>x</value></field></fields><annots><square page="0"/></annots></xfdf>';
    expect(readXfdf(rich)).toStrictEqual([{ name: 'a', values: ['x'] }]);
  });

  it('IGNORES A NAMESPACE PREFIX, and that is a stated limit rather than support', () => {
    // Resolving a prefix means tracking `xmlns` bindings down the tree, which
    // is the reader becoming a parser — ADR-0046's own re-argue trigger. What
    // it costs is written down: a file using this prefix for some OTHER
    // namespace would be read as XFDF.
    const prefixed =
      '<x:xfdf xmlns:x="http://ns.adobe.com/xfdf/"><x:fields><x:field name="a"><x:value>y</x:value></x:field></x:fields></x:xfdf>';
    expect(readXfdf(prefixed)).toStrictEqual([{ name: 'a', values: ['y'] }]);
  });
});

describe('readXfdf, what it will not read', () => {
  it('REFUSES A FILE THAT IS NOT XFDF, rather than answering no fields', () => {
    // The reassuring answer this reader must not give: an empty list from an
    // HTML page reads exactly like an XFDF for a different form.
    expect(() => readXfdf('<html><body><p>not a form</p></body></html>')).toThrow(
      XfdfRefusedError,
    );
  });

  it('REFUSES AN XFDF WITH NO FIELDS AT ALL, for the same reason', () => {
    expect(() => readXfdf('<xfdf><fields/></xfdf>')).toThrow(/names no fields/u);
  });

  it('REFUSES MARKUP INSIDE A VALUE, which is what an unescaped export produces', () => {
    // The export measurement's own finding read backwards: a naive encoder
    // writes `</field>` into a value and closes the element early. Reading
    // through it would be this reader inventing the content that follows.
    expect(() =>
      readXfdf('<xfdf><fields><field name="a"><value>a <b/> c</value></field></fields></xfdf>'),
    ).toThrow(/may only contain text/u);
  });

  it('REFUSES A TRUNCATED FILE rather than answering with what it managed to read', () => {
    expect(() => readXfdf('<xfdf><fields><field name="a"><value>half')).toThrow(XfdfRefusedError);
  });
});
