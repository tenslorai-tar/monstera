// @ts-check
/**
 * What grew between two V8 heap snapshots: every object counted and summed by its kind and constructor name, and the
 * largest differences printed. The reading `mainMemoryWalk.mjs`' snapshots are taken for.
 *
 * Self size only: what each object occupies itself, which sums to the heap without counting anything twice. What HOLDS a
 * group that grew is then a retainers question for DevTools on the same file; this names which group to ask it about.
 *
 * Its control runs on every use: the objects read must number exactly the node count each snapshot states, and sum to
 * more than nothing, or the stride through the format's flat array was wrong and every row below is noise.
 *
 *   node --max-old-space-size=8192 scripts/research/heapSnapshotDiff.mjs <before.heapsnapshot> <after.heapsnapshot> [rows]
 */
import { readFileSync } from 'node:fs';

/**
 * One snapshot's objects by kind and name: count and self size.
 *
 * @param {string} path
 */
function groups(path) {
  /** @type {{ snapshot: { meta: { node_fields: string[], node_types: [string[]] }, node_count: number }, nodes: number[], strings: string[] }} */
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const fields = parsed.snapshot.meta.node_fields;
  const width = fields.length;
  const typeAt = fields.indexOf('type');
  const nameAt = fields.indexOf('name');
  const sizeAt = fields.indexOf('self_size');
  if (typeAt < 0 || nameAt < 0 || sizeAt < 0) throw new Error(`${path}: no type, name or self_size among ${fields.join(', ')}`);
  const types = parsed.snapshot.meta.node_types[0];
  /** @type {Map<string, { count: number, bytes: number }>} */
  const byGroup = new Map();
  let total = 0;
  let nodes = 0;
  for (let at = 0; at < parsed.nodes.length; at += width) {
    const type = types[parsed.nodes[at + typeAt] ?? 0] ?? '?';
    const size = parsed.nodes[at + sizeAt] ?? 0;
    // A NAME FOR THE KINDS WHOSE NAME IS A CONSTRUCTOR; strings, code and numbers are summed by kind, since each string's
    // own text is its name and would make a group of one.
    const named = type === 'object' || type === 'closure' || type === 'native' || type === 'hidden' || type === 'array';
    const key = named ? `${type} ${parsed.strings[parsed.nodes[at + nameAt] ?? 0] ?? '?'}` : type;
    const held = byGroup.get(key) ?? { count: 0, bytes: 0 };
    held.count += 1;
    held.bytes += size;
    byGroup.set(key, held);
    total += size;
    nodes += 1;
  }
  // THE CONTROL: the node count the snapshot states is the count read, so the stride was right.
  if (nodes !== parsed.snapshot.node_count) throw new Error(`${path}: read ${String(nodes)} nodes where the snapshot states ${String(parsed.snapshot.node_count)}`);
  if (total <= 0) throw new Error(`${path}: the nodes sum to no bytes`);
  return { byGroup, total, nodes };
}

const [beforePath, afterPath, rowsArgument] = process.argv.slice(2);
if (beforePath === undefined || afterPath === undefined) throw new Error('usage: heapSnapshotDiff.mjs <before> <after> [rows]');
const rows = Number(rowsArgument ?? '30');
const before = groups(beforePath);
const after = groups(afterPath);
const MB = 1024 * 1024;
const keys = new Set([...before.byGroup.keys(), ...after.byGroup.keys()]);
const diffs = [...keys]
  .map((key) => {
    const a = before.byGroup.get(key) ?? { count: 0, bytes: 0 };
    const b = after.byGroup.get(key) ?? { count: 0, bytes: 0 };
    return { key, bytes: b.bytes - a.bytes, count: b.count - a.count, after: b.bytes };
  })
  .sort((x, y) => Math.abs(y.bytes) - Math.abs(x.bytes))
  .slice(0, rows);
console.log(
  `before ${(before.total / MB).toFixed(1)} MB in ${String(before.nodes)} objects; after ${(after.total / MB).toFixed(1)} MB in ${String(after.nodes)}; ` +
    `difference ${((after.total - before.total) / MB).toFixed(1)} MB`,
);
for (const { key, bytes, count, after: held } of diffs) {
  console.log(`${(bytes / MB).toFixed(2).padStart(8)} MB ${String(count).padStart(8)} objects  (${(held / MB).toFixed(2)} MB after)  ${key}`);
}
