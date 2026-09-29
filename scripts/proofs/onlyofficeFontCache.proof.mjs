// @ts-check
/**
 * Proves the ONLYOFFICE font cache is rewritten whole or refused, and that a cache over anything but the tree's own
 * fonts is refused ([ADR-0120](../../docs/DECISIONS/0120-office-import-is-onlyoffices-x2t-contained.md)).
 *
 * ## Why this file exists
 *
 * `x2t` does not fail on a cache whose paths do not resolve: measured 2026-09-29, it converts anyway and embeds a
 * different font program. So `relativeFontCache` is the one thing standing between a staging directory's name and
 * every conversion, and the reassuring answer — a cache that converts — is the one a wrong rewrite also gives.
 *
 * The first rewrite was wrong in exactly that way and converted: it left each record's length stale and the
 * base64 copy in `AllFonts.js` naming the staging directory. Case 1 is therefore a BYTE comparison with the cache the
 * same builder makes from relative paths, because only the correct rewrite produces those bytes: a stale record
 * length or a stale embedded copy differs from them, and both still convert.
 *
 * The caches here are CONSTRUCTED, in the layout read from Document Builder 9.4.0's output — a 32-bit face count,
 * each face a length that counts itself, each path a 32-bit length and its bytes, then a range table naming families.
 * A real cache is a binary this repository does not commit.
 *
 * Usage: node scripts/proofs/onlyofficeFontCache.proof.mjs
 */

import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { bundledOnly, declaredThirdParty, relativeFontCache } from '../provision/onlyoffice.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 12 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/** @param {number} value */
function int32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32LE(value);
  return bytes;
}

/** @param {string} text */
function lengthPrefixed(text) {
  const bytes = Buffer.from(text, 'latin1');
  return Buffer.concat([int32(bytes.length), bytes]);
}

const TREE = 'C:\\stage-7\\tree';
const FORWARD = 'C:/stage-7/tree';
const FILES = ['a.ttf', 'sub/b.ttc'];
const RANGES = Buffer.concat([int32(2), Buffer.from('Alpha\0\x01\0\0\0Beta\0', 'latin1')]);

/**
 * One cache as Document Builder writes it, over `prefix`.
 *
 * @param {{ prefix: string, forward: string, faces?: string[], selfCounting?: boolean, embedAll?: boolean, tail?: Buffer }} options
 */
function cache({ prefix, forward, faces = FILES, selfCounting = true, embedAll = false, tail = RANGES }) {
  const records = faces.map((file, index) => {
    const body = Buffer.concat([
      lengthPrefixed(`Face${String(index)}`),
      int32(0),
      lengthPrefixed(`${prefix}/fonts\\${file.replaceAll('/', '\\')}`),
      Buffer.from([10, 0, 0, 0, 5, 4, 1, 2]),
    ]);
    return Buffer.concat([int32(body.length + (selfCounting ? 4 : 0)), body]);
  });
  const facesBytes = Buffer.concat([int32(faces.length), ...records]);
  const selection = Buffer.concat([facesBytes, tail]);
  const embedded = (embedAll ? selection : facesBytes).toString('base64');
  const script =
    '\uFEFFwindow["__all_fonts_js_version__"] = 2;\n\nwindow["__fonts_files"] = [\n' +
    faces.map((file) => `"${forward}/fonts/${file}"`).join(',\n') +
    `\n];\n\nwindow["g_fonts_selection_bin"] = "${embedded}";\n`;
  return { script, selection: new Uint8Array(selection) };
}

/** @param {() => unknown} run */
function refusal(run) {
  try {
    run();
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

try {
  // ---- 1. CONTROL: the rewrite is byte-for-byte the cache written over `.` ----
  const staged = cache({ prefix: TREE, forward: FORWARD });
  const rewritten = relativeFontCache({ ...staged, tree: TREE, fonts: FILES.length });
  const expected = cache({ prefix: '.', forward: '.' });
  check(
    'a cache over the staging tree is rewritten to exactly the cache over the tree itself',
    Buffer.from(rewritten.selection).equals(Buffer.from(expected.selection)) && rewritten.script === expected.script,
    `selection equal ${String(Buffer.from(rewritten.selection).equals(Buffer.from(expected.selection)))}, script equal ` +
      `${String(rewritten.script === expected.script)}. Only the correct rewrite makes these bytes: a stale record ` +
      'length or a stale embedded copy differs, and both still convert.',
  );

  // ---- 2. The staged name is gone from every copy ----
  check(
    'no copy of the staging path survives — the list, the file or the embedded copy',
    !rewritten.script.includes(FORWARD) &&
      !Buffer.from(rewritten.selection).includes(Buffer.from(TREE, 'latin1')) &&
      !Buffer.from(/"g_fonts_selection_bin"\] = "([^"]*)"/u.exec(rewritten.script)?.[1] ?? '', 'base64').includes(Buffer.from(TREE, 'latin1')),
    'the staging directory is gone once the tree is published; any copy naming it sends x2t to nothing.',
  );

  // ---- 3. A record length that does not count itself is refused ----
  const notSelfCounting = refusal(() =>
    relativeFontCache({ ...cache({ prefix: TREE, forward: FORWARD, selfCounting: false }), tree: TREE, fonts: FILES.length }),
  );
  check(
    'a face record whose length does not count its own four bytes is refused',
    notSelfCounting.startsWith('face '),
    `message "${notSelfCounting}". That is the layout the first rewrite assumed, and it misreads every face after the first.`,
  );

  // ---- 4. An embedded copy that is not the faces is refused ----
  const embedAll = refusal(() =>
    relativeFontCache({ ...cache({ prefix: TREE, forward: FORWARD, embedAll: true }), tree: TREE, fonts: FILES.length }),
  );
  check(
    'an embedded selection that is not exactly the faces is refused',
    embedAll.includes('embeds a font selection'),
    `message "${embedAll}". The embedded copy is rewritten from the faces, so it must be them.`,
  );

  // ---- 5. The tree named after the faces is refused ----
  const tailNamesTree = refusal(() =>
    relativeFontCache({
      ...cache({ prefix: TREE, forward: FORWARD, tail: Buffer.concat([RANGES, Buffer.from(TREE, 'latin1')]) }),
      tree: TREE,
      fonts: FILES.length,
    }),
  );
  check(
    'a path to the tree after the faces is refused, never left in place',
    tailNamesTree.includes('after its faces'),
    `message "${tailNamesTree}".`,
  );

  // ---- 6. A face that does not name the tree is refused ----
  const machine = cache({ prefix: TREE, forward: FORWARD });
  const machineSelection = Buffer.from(machine.selection);
  const at = machineSelection.indexOf(Buffer.from(`${TREE}/fonts\\sub`, 'latin1'));
  Buffer.from('X', 'latin1').copy(machineSelection, at);
  const machineFace = refusal(() =>
    relativeFontCache({ script: machine.script, selection: new Uint8Array(machineSelection), tree: TREE, fonts: FILES.length }),
  );
  check(
    'a face whose file is not under the tree is refused',
    machineFace.startsWith('face 2'),
    `message "${machineFace}". A machine font in the cache is a conversion that depends on the machine.`,
  );

  // ---- 7. The list must name the tree once per font ----
  const miscounted = refusal(() => relativeFontCache({ ...staged, tree: TREE, fonts: FILES.length + 1 }));
  check(
    'a list naming fewer tree fonts than the tree holds is refused',
    miscounted.includes('AllFonts.js names the tree'),
    `message "${miscounted}".`,
  );

  // ---- 8. CONTROL for 9 and 10: a list of exactly the tree's fonts passes ----
  const fonts = 'C:\\stage-7\\tree\\fonts';
  const exactList = refusal(() => bundledOnly(staged.script, fonts, FILES));
  check(
    "a cache naming exactly the tree's fonts passes the bundled-only check",
    exactList === '',
    `message "${exactList}". Without this, a check that refused every cache would pass 9 and 10.`,
  );

  // ---- 9. A machine font in the list is refused ----
  const withMachine = staged.script.replace('"C:/stage-7/tree/fonts/a.ttf"', '"C:/Windows/Fonts/a.ttf"');
  const machineList = refusal(() => bundledOnly(withMachine, fonts, FILES));
  check(
    'a cache naming a font outside the tree is refused',
    machineList.includes('outside the tree'),
    `message "${machineList}". Document Builder indexes the machine's fonts unless told not to.`,
  );

  // ---- 10. A bundled font the list omits is refused ----
  const omitted = refusal(() => bundledOnly(staged.script, fonts, [...FILES, 'c.ttf']));
  check(
    'a cache that omits one of the tree’s fonts is refused',
    omitted.includes('missing c.ttf'),
    `message "${omitted}".`,
  );

  // ---- 11. The declaration's names, spelt as 3DPARTY.md spells its rows ----
  const names = declaredThirdParty(
    '\n## Third-party\n\n- boost ([BSL](https://x/LICENSE))\n- socket.io-client-cpp ([MIT](https://x/L))\n' +
      '- libheif([MIT](https://x/COPYING))\n',
  );
  check(
    '3DPARTY.md rows are read with and without a space before the licence',
    names.join(',') === 'boost,socket.io-client-cpp,libheif',
    `read ${JSON.stringify(names)}. The real file writes libheif, libde265, x265 and pole with no space.`,
  );

  // ---- 12. A declaration with no rows is a broken read ----
  const noRows = refusal(() => declaredThirdParty('## Third-party\n\nNothing here.\n'));
  check(
    'a declaration from which no row is read is an error, not an empty list',
    noRows.includes('declared no component'),
    `message "${noRows}". An empty list would pass the check that every declared name is recorded.`,
  );

  if (failures.length > 0) {
    process.stderr.write(
      `\nONLYOFFICE font-cache proof — ${failures.length} failure(s):\n\n` +
        failures.map((failure) => `  - ${failure}`).join('\n\n') +
        '\n\n',
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`${roster.format('font-cache case')}\n`);
  }
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
}
