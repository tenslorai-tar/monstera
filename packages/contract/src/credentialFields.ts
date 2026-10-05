import { z } from 'zod';

/**
 * A field whose name says it carries a credential.
 *
 * By NAME, because a name is the only thing a schema says about what a string is: a password and a page label are
 * both a string of bounded length. So the walk below sees a credential that is named as one, and one named as
 * something else is out of its reach; every caller states that limit rather than reading wider than it is.
 */
export const CREDENTIAL_NAME = /password|passphrase|secret|privatekey|credential/iu;

type Node = Readonly<Record<string, unknown>>;

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The nodes under `key`, whether it holds one schema or a list of them. */
function children(node: Node, key: string): readonly Node[] {
  const value = node[key];
  if (Array.isArray(value)) return value.filter(isNode);
  return isNode(value) ? [value] : [];
}

function walk(node: Node, path: string, found: string[]): void {
  const properties = node['properties'];
  if (isNode(properties)) {
    for (const [name, child] of Object.entries(properties)) {
      if (CREDENTIAL_NAME.test(name)) found.push(`${path}.${name}`);
      if (isNode(child)) walk(child, `${path}.${name}`, found);
    }
  }
  for (const key of ['items', 'prefixItems']) for (const child of children(node, key)) walk(child, `${path}[]`, found);
  for (const key of ['anyOf', 'oneOf', 'allOf']) for (const child of children(node, key)) walk(child, path, found);
  for (const child of children(node, 'additionalProperties')) walk(child, `${path}.*`, found);
  const definitions = node['$defs'];
  if (isNode(definitions)) {
    for (const [name, child] of Object.entries(definitions)) if (isNode(child)) walk(child, `${path}#${name}`, found);
  }
}

/**
 * Every credential-named field a value accepted by `schema` can carry, as dotted paths under `path`.
 *
 * Read out of zod's own JSON Schema, as `maxEncodedBytes` is: `z.toJSONSchema` is the library's answer to *what may
 * this value hold*, and walking zod's classes would be a second opinion about it (B3a). Two callers: the declarations
 * case that keeps a credential out of the undo log, and the contract case that keeps one out of every answer the
 * renderer is sent (ADR-0171 Decisions 3 and 4).
 *
 * `input` is read, the side the wire's JSON is parsed against, so a field a transform drops on arrival is still seen.
 */
export function credentialFields(schema: z.ZodType, path: string): readonly string[] {
  const found: string[] = [];
  walk(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }), path, found);
  return found;
}
